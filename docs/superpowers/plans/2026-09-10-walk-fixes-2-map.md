# The walk's fixes, part two: the pin on a map — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coordinator set a client's home pin, and a practitioner their home base, by dragging a marker on a Google map or searching an address, instead of typing latitude and longitude.

**Architecture:** The map is its own document, `/admin/clients/pin`, served with the same widened content security policy the day map already has (Google's script is admitted on exactly those two paths and nowhere else). The coordinate boxes gain a "Pick on the map" button that opens that document in a new tab with the current point; the picker posts the chosen point and address back to the opener with `postMessage` and closes. The Maps loader moves to the shell so both documents share it, and learns to load the `places` library on request.

**Tech Stack:** Google Maps JavaScript API (quarterly channel, browser key), `PlaceAutocompleteElement` from the `places` library (Places API New), React 19, Hono security middleware, Vitest with a fake `google.maps` namespace.

**Spec:** `docs/superpowers/specs/2026-09-10-walk-fixes-design.md`, section "Pull request 2", as amended by this plan: the picker is a separate document, not a panel above the boxes, because the console's strict policy refuses Google's script everywhere but the map paths (`app/api/_middleware/security.ts`, `tests/security/headers.test.ts`), and widening every console page for one map would undo the one-page confinement the security design chose.

## Global Constraints

- Branch `trunk-round-43`, after part one is merged or rebased onto it. Trunk round: shared-zone files (`app/shell/**`, `app/api/_middleware/**`, `docs/COMPLIANCE/**`) may be edited; note them in the trunk note.
- The browser key is `VITE_GOOGLE_MAPS_BROWSER_KEY`, read only through `browserMapKey()`. The server key never reaches a browser.
- Google receives, from the picker document: the browser's IP, the map viewport, the key, and, only when the search box is used, the typed address as typed, restricted to the UAE. Never a name, a record number, an id, or a Makani number. The vendor register row is amended to say exactly this (Task 6).
- No hex colours in components (`app/shell/tokens.css`; the day map's `mapStyle.ts` reads tokens off the document). English-only console copy.
- Every task ends with its tests green; the PR ends with `pnpm verify`, `pnpm test:db`, and the two reviewers.
- Commit after every task, conventional message, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: The loader moves to the shell and learns libraries

**Files:**
- Move: `app/admin/schedule/map/googleMaps.ts` → `app/shell/maps/googleMaps.ts`
- Modify: `app/admin/schedule/map/DayMapPage.tsx:14`, `app/admin/schedule/map/DayMap.tsx:3`, `app/admin/schedule/map/overlays.ts:1` (import paths only)
- Test: `app/shell/maps/googleMaps.test.ts` (new)

**Interfaces:**
- Produces: `loadGoogleMaps(key: string, options?: { libraries?: readonly ('places')[]; doc?: Document }): Promise<GoogleMaps>`; `browserMapKey()`, `resetGoogleMapsLoader()`, `MAPS_VERSION`, `type GoogleMaps` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// app/shell/maps/googleMaps.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loadGoogleMaps, resetGoogleMapsLoader } from './googleMaps';

afterEach(() => {
  resetGoogleMapsLoader();
  document.head.innerHTML = '';
  delete (window as unknown as { google?: unknown }).google;
});

describe('loadGoogleMaps', () => {
  it('asks for nothing it does not draw: no libraries unless told', () => {
    void loadGoogleMaps('browser-key-under-test').catch(() => undefined);
    const src = document.head.querySelector('script')?.getAttribute('src') ?? '';
    expect(src.startsWith('https://maps.googleapis.com/maps/api/js?')).toBe(true);
    expect(new URL(src).searchParams.get('libraries')).toBeNull();
    expect(new URL(src).searchParams.get('region')).toBe('AE');
  });

  it('asks for the places library when the picker needs it', () => {
    void loadGoogleMaps('browser-key-under-test', { libraries: ['places'] }).catch(
      () => undefined,
    );
    const src = document.head.querySelector('script')?.getAttribute('src') ?? '';
    expect(new URL(src).searchParams.get('libraries')).toBe('places');
  });

  it('adds one script per document however often it is asked', () => {
    void loadGoogleMaps('browser-key-under-test').catch(() => undefined);
    void loadGoogleMaps('browser-key-under-test').catch(() => undefined);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/shell/maps/googleMaps.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Move the file and add the option**

```bash
mkdir -p app/shell/maps
git mv app/admin/schedule/map/googleMaps.ts app/shell/maps/googleMaps.ts
```

In the moved file change the signature and the parameters:

```ts
export function loadGoogleMaps(
  key: string,
  options: { libraries?: readonly 'places'[]; doc?: Document } = {},
): Promise<GoogleMaps> {
  const doc = options.doc ?? document;
  if (pending !== null) return pending;
  …
    const parameters = new URLSearchParams({
      key,
      v: MAPS_VERSION,
      loading: 'async',
      callback: CALLBACK,
      language: 'en',
      region: 'AE',
    });
    // Only the pin picker asks for a library, and only for one: the day map
    // draws its own pins and needs nothing beyond the map
    // (docs/SPEC/route-planning.md section 4.6).
    if (options.libraries && options.libraries.length > 0) {
      parameters.set('libraries', options.libraries.join(','));
    }
```

Replace every `doc` that referred to the old second parameter. Update the three imports:
`DayMapPage.tsx` → `from '../../../shell/maps/googleMaps'`; `DayMap.tsx` and `overlays.ts` likewise
(type import). Add one line to the header comment: "Since trunk round 43 this lives in the shell:
the day map and the pin picker (`app/admin/clients/pin/PinPickerPage.tsx`) both load it, which is
the ownership map's rule for a thing two modules share."

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/shell/maps app/admin/schedule && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/shell/maps app/admin/schedule/map
git commit -m "refactor(shell): the Maps loader moves to the shell and can load places"
```

---

### Task 2: The pin document is served like the map document

**Files:**
- Modify: `app/api/_middleware/security.ts:14` (`MAP_DOCUMENT_PATHS`)
- Modify: `app/shell/sw.ts:84` (`WIDENED_DOCUMENTS`)
- Test: `tests/security/headers.test.ts` (add the path to the near-miss table and the "every other document" loop), `app/shell/sw.test.ts` (add the path)

**Interfaces:**
- Produces: `GET /admin/clients/pin` carries the widened policy with a nonce and `'strict-dynamic'`; every other console path stays strict.

- [ ] **Step 1: Write the failing tests**

In `tests/security/headers.test.ts`, add to the `nearMisses` table:

```ts
    ['/admin/clients/pin', true, 'the pin picker is the second map document (trunk round 43)'],
    ['/admin/clients/pin?lat=25.2&lng=55.27', true, 'a query string is not part of the path'],
    ['/admin/clients/pins', false, 'one letter more is a different path'],
    ['/admin/clients', false, 'the clients list is not the picker'],
```

In `app/shell/sw.test.ts`, beside the existing case that proves `/admin/schedule/map` is never
cached as the offline shell, add the same assertion for `/admin/clients/pin`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/security/headers.test.ts app/shell/sw.test.ts`
Expected: FAIL on the new rows.

- [ ] **Step 3: Add the path in both places**

`security.ts:14`:

```ts
export const MAP_DOCUMENT_PATHS: readonly string[] = ['/admin/schedule/map', '/admin/clients/pin'];
```

and extend the comment above it: "Two documents, from trunk round 43: the day map and the pin
picker. Each is its own page and carries the wider policy; the console around them stays strict."

`sw.ts:84`: `const WIDENED_DOCUMENTS = ['/admin/schedule/map', '/admin/clients/pin'];`

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/security app/shell/sw.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/_middleware/security.ts app/shell/sw.ts tests/security/headers.test.ts app/shell/sw.test.ts
git commit -m "feat(security): the pin picker is the second widened document"
```

---

### Task 3: The pin picker page

**Files:**
- Create: `app/admin/clients/pin/PinPickerPage.tsx`
- Create: `app/admin/clients/pin/pin.css`
- Create: `app/admin/clients/pin/emirates.ts`
- Modify: `app/shell/App.tsx:149-155` (a second widened route)
- Test: `app/admin/clients/pin/PinPickerPage.test.tsx` (new)

**Interfaces:**
- Consumes: `loadGoogleMaps(key, { libraries: ['places'] })`, `browserMapKey()`, `mapStyle(document.documentElement)` from `app/admin/schedule/map/mapStyle.ts`.
- Produces: the document at `/admin/clients/pin?lat=&lng=&emirate=&label=`; on "Use this pin" it posts `{ type: 'mcwellness:pin', lat: number, lng: number, address: string | null }` to `window.opener` with the page's own origin as target, then closes. The message shape is exported as `PIN_MESSAGE_TYPE` and `type PinMessage`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/admin/clients/pin/PinPickerPage.test.tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIN_MESSAGE_TYPE, PinPickerPage } from './PinPickerPage';

afterEach(cleanup);

/** The slice of google.maps the picker touches, as plain objects. */
function fakeMaps() {
  const listeners: Record<string, Array<(e?: unknown) => void>> = {};
  const marker = {
    position: { lat: 25.2048, lng: 55.2708 },
    setPosition(p: { lat: number; lng: number }) {
      this.position = p;
    },
    getPosition() {
      const p = this.position;
      return { lat: () => p.lat, lng: () => p.lng };
    },
    addListener(name: string, fn: (e?: unknown) => void) {
      (listeners[`marker:${name}`] ??= []).push(fn);
    },
  };
  const map = {
    addListener(name: string, fn: (e?: unknown) => void) {
      (listeners[`map:${name}`] ??= []).push(fn);
    },
    panTo: vi.fn(),
    setZoom: vi.fn(),
  };
  const autocomplete = document.createElement('div');
  const maps = {
    Map: vi.fn(() => map),
    Marker: vi.fn(() => marker),
    places: { PlaceAutocompleteElement: vi.fn(() => autocomplete) },
  };
  return { maps: maps as unknown as typeof google.maps, listeners, marker, map, autocomplete };
}

function mount(query: string, fake = fakeMaps()) {
  const opener = { postMessage: vi.fn() };
  Object.defineProperty(window, 'opener', { value: opener, configurable: true });
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  render(
    <MemoryRouter initialEntries={[`/admin/clients/pin${query}`]}>
      <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
    </MemoryRouter>,
  );
  return { opener, close, ...fake };
}

describe('PinPickerPage', () => {
  it('opens on the point it was given and posts it back when used', async () => {
    const { opener, close, maps } = mount('?lat=25.2048&lng=55.2708&label=Home');
    await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
    const options = (maps.Marker as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      position: { lat: number; lng: number };
      draggable: boolean;
    };
    expect(options.position).toEqual({ lat: 25.2048, lng: 55.2708 });
    expect(options.draggable).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: PIN_MESSAGE_TYPE, lat: 25.2048, lng: 55.2708, address: null },
      window.location.origin,
    );
    expect(close).toHaveBeenCalled();
  });

  it('follows the marker when it is dragged, and a tap on the map', async () => {
    const { listeners, marker, maps } = mount('?lat=25.2048&lng=55.2708');
    await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
    marker.setPosition({ lat: 25.21, lng: 55.28 });
    for (const fn of listeners['marker:dragend'] ?? []) fn();
    expect(screen.getByText(/25\.21000, 55\.28000/)).toBeTruthy();
    for (const fn of listeners['map:click'] ?? []) {
      fn({ latLng: { lat: () => 25.3, lng: () => 55.4 } });
    }
    expect(screen.getByText(/25\.30000, 55\.40000/)).toBeTruthy();
  });

  it('centres on the emirate when it has no point yet', async () => {
    const { maps } = mount('?emirate=SHJ');
    await waitFor(() => expect(maps.Map).toHaveBeenCalled());
    const options = (maps.Map as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      center: { lat: number; lng: number };
    };
    expect(options.center).toEqual({ lat: 25.3463, lng: 55.4209 });
    expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
  });

  it('says so when the practice has no browser key', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients/pin']}>
        <PinPickerPage browserKey={null} loadMaps={async () => fakeMaps().maps} />
      </MemoryRouter>,
    );
    expect(screen.getByText('The map needs the practice’s browser key.')).toBeTruthy();
  });

  it('never posts to a stranger: the target is this page’s own origin', async () => {
    const { opener } = mount('?lat=25.2&lng=55.3');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use this pin' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage.mock.calls[0]?.[1]).toBe(window.location.origin);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/pin/PinPickerPage.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: The emirate centres**

```ts
// app/admin/clients/pin/emirates.ts
/**
 * Where the map opens when a location has no pin yet: the middle of the
 * emirate the coordinator chose. Rounded to a city centre, not to any
 * address; a starting view, never a stored coordinate.
 */
export const EMIRATE_CENTRES: Record<string, { lat: number; lng: number }> = {
  DXB: { lat: 25.2048, lng: 55.2708 },
  AUH: { lat: 24.4539, lng: 54.3773 },
  SHJ: { lat: 25.3463, lng: 55.4209 },
  AJM: { lat: 25.4052, lng: 55.5136 },
  UAQ: { lat: 25.5647, lng: 55.5534 },
  RAK: { lat: 25.7895, lng: 55.9432 },
  FUJ: { lat: 25.1288, lng: 56.3265 },
};

export const UAE_CENTRE = { lat: 24.9, lng: 55.0 };
```

- [ ] **Step 4: The page**

```tsx
// app/admin/clients/pin/PinPickerPage.tsx
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Note } from '../../../shell/components/Controls';
import { browserMapKey, loadGoogleMaps, type GoogleMaps } from '../../../shell/maps/googleMaps';
import { mapStyle } from '../../schedule/map/mapStyle';
import { EMIRATE_CENTRES, UAE_CENTRE } from './emirates';
import './pin.css';

/**
 * The pin picker: its own document, for the same reason the day map is
 * (docs/SPEC/route-planning.md section 8). Google's script is admitted only on
 * the two widened paths, so the console opens this page in a new tab, the
 * coordinator drags the marker or searches an address, and "Use this pin"
 * hands the point back to the tab that asked through `postMessage`, then
 * closes.
 *
 * **What Google receives.** The browser's address, the map viewport and the
 * key, as any map page sends — and, only while the search box is used, the
 * address text as it is typed, restricted to the UAE. Nothing here names a
 * person, a record or a location id; the query string carries a point, an
 * emirate and a label like "Home" and nothing else
 * (docs/COMPLIANCE/approved-vendors.md, Google Maps Platform, amended in trunk
 * round 43).
 *
 * **Who may receive the point.** The message is posted to `window.opener`
 * with this page's own origin as the target, so only a document of this app
 * can read it; the opener checks the origin again before using it
 * (app/shell/components/CoordinateFields.tsx).
 */

export const PIN_MESSAGE_TYPE = 'mcwellness:pin';

export type PinMessage = {
  type: typeof PIN_MESSAGE_TYPE;
  lat: number;
  lng: number;
  /** The address the search found, or null when the pin was placed by hand. */
  address: string | null;
};

const NO_KEY = 'The map needs the practice’s browser key.';
const NOT_LOADED = 'The map did not load. Check the connection and try again.';
const WRONG_DOOR =
  'This page has to be opened from the record, not typed into the address bar: only the door it opens by admits the map.';
const NO_OPENER = 'The record that asked for this pin is no longer open. Copy the coordinates below into it instead.';

type Point = { lat: number; lng: number };

function pointFrom(params: URLSearchParams): Point | null {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function shown(point: Point): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

export function PinPickerPage({
  browserKey,
  loadMaps,
}: {
  /** Tests hand the key in; the page reads the build's otherwise. */
  browserKey?: string | null;
  /** Tests hand a fake namespace in; the page loads Google's otherwise. */
  loadMaps?: (key: string) => Promise<GoogleMaps>;
} = {}) {
  const [params] = useSearchParams();
  const label = params.get('label') ?? 'Location';
  const emirate = params.get('emirate') ?? '';
  const start = pointFrom(params);

  const key = browserKey === undefined ? browserMapKey() : browserKey;
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [maps, setMaps] = useState<GoogleMaps | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(start);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    const load = loadMaps ?? ((k: string) => loadGoogleMaps(k, { libraries: ['places'] }));
    void load(key)
      .then((namespace) => {
        if (live) setMaps(namespace);
      })
      .catch(() => {
        if (!live) return;
        setFailure(document.querySelector('script[nonce]') === null ? WRONG_DOOR : NOT_LOADED);
      });
    return () => {
      live = false;
    };
  }, [key, loadMaps]);

  useEffect(() => {
    if (!maps || !mapRef.current) return;
    const centre = start ?? EMIRATE_CENTRES[emirate] ?? UAE_CENTRE;
    const map = new maps.Map(mapRef.current, {
      center: centre,
      zoom: start ? 17 : emirate ? 12 : 8,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      styles: mapStyle(document.documentElement),
    });
    const marker = new maps.Marker({
      map,
      position: start ?? undefined,
      draggable: true,
      title: label,
    });
    markerRef.current = marker;
    const read = (): void => {
      const p = marker.getPosition();
      if (p) setPoint({ lat: p.lat(), lng: p.lng() });
    };
    marker.addListener('dragend', () => {
      setAddress(null);
      read();
    });
    map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      marker.setPosition(event.latLng);
      setAddress(null);
      read();
    });

    // The search box: Google's own element, restricted to the UAE. Its input
    // sends the typed text to Google as it is typed; that is the one thing on
    // this page that leaves the practice, and it is used on purpose.
    const places = (maps as unknown as { places?: { PlaceAutocompleteElement?: unknown } }).places;
    if (places?.PlaceAutocompleteElement && searchRef.current) {
      const Element = places.PlaceAutocompleteElement as new (options: unknown) => HTMLElement;
      const box = new Element({ componentRestrictions: { country: ['ae'] } });
      box.setAttribute('aria-label', 'Search for an address');
      searchRef.current.replaceChildren(box);
      box.addEventListener('gmp-select', (event: Event) => {
        const prediction = (event as unknown as { placePrediction?: { toPlace: () => unknown } })
          .placePrediction;
        if (!prediction) return;
        const place = prediction.toPlace() as {
          fetchFields: (o: { fields: string[] }) => Promise<unknown>;
          location?: google.maps.LatLng | null;
          formattedAddress?: string | null;
        };
        void place.fetchFields({ fields: ['location', 'formattedAddress'] }).then(() => {
          if (!place.location) return;
          marker.setPosition(place.location);
          map.panTo(place.location);
          map.setZoom(17);
          setAddress(place.formattedAddress ?? null);
          read();
        });
      });
    }
    return () => {
      marker.setMap(null);
    };
    // `start`, `emirate` and `label` come from the query string and do not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps]);

  function useThisPin(): void {
    if (!point) return;
    const opener = window.opener as Window | null;
    if (!opener) {
      setFailure(NO_OPENER);
      return;
    }
    const message: PinMessage = { type: PIN_MESSAGE_TYPE, ...point, address };
    opener.postMessage(message, window.location.origin);
    window.close();
  }

  const note = key === null ? NO_KEY : failure;

  return (
    <main className="pin-picker">
      <header className="pin-picker__head">
        <h1>Where the practitioner should arrive</h1>
        <p className="muted">
          {label}. Drag the marker to the door, or search for the address. The pin is the door to
          knock on, not the middle of the building.
        </p>
      </header>
      <div ref={searchRef} className="pin-picker__search" />
      {note ? <Note tone={key === null ? 'neutral' : 'critical'}>{note}</Note> : null}
      <div ref={mapRef} className="pin-picker__map" aria-label="Map" />
      <footer className="pin-picker__foot">
        <p className="numeric">{point ? shown(point) : 'No pin yet. Tap the map to place one.'}</p>
        {address ? <p className="small muted">{address}</p> : null}
        <div className="drawer__actions">
          <Button variant="secondary" onClick={() => window.close()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!point} onClick={useThisPin}>
            Use this pin
          </Button>
        </div>
      </footer>
    </main>
  );
}
```

Check `Note`'s `tone` values in `Controls.tsx` and use whichever means "plain" if `neutral`
is not one. If `@types/google.maps` 3.66 lacks `MapMouseEvent`, type the click handler's
argument as `{ latLng?: google.maps.LatLng | null }`.

```css
/* app/admin/clients/pin/pin.css — a full-window picker, tokens only */
.pin-picker {
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  min-height: 100dvh;
  background: var(--surface-ground);
  color: var(--text);
}
.pin-picker__head {
  padding: var(--space-4) var(--space-5) var(--space-2);
}
.pin-picker__head h1 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xl);
}
.pin-picker__search {
  padding: 0 var(--space-5) var(--space-3);
}
.pin-picker__search gmp-place-autocomplete {
  width: 100%;
}
.pin-picker__map {
  min-height: 320px;
}
.pin-picker__foot {
  padding: var(--space-3) var(--space-5) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
```

Use the token names `app/shell/tokens.css` actually defines (read it; the names above follow
the day map's `map.css`, copy from there if they differ).

- [ ] **Step 5: The route**

In `app/shell/App.tsx`, beside the day-map route at line 149, add:

```tsx
<Route
  path="/admin/clients/pin"
  element={
    <RequireSignedIn>
      <PinPickerPage />
    </RequireSignedIn>
  }
/>
```

using whatever wrapper the day-map route uses (read lines 145–160 and mirror it exactly,
including the `DocumentBoundary` if the map route wraps in one; the picker holds no client
data, so if the boundary is about memory of the record, it is not needed here). Import
`PinPickerPage` from `'../admin/clients/pin/PinPickerPage'`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run app/admin/clients/pin app/shell && pnpm typecheck && pnpm lint`
Expected: PASS. The lint rule that forbids hex colours and the one that keeps the console English both pass.

- [ ] **Step 7: Commit**

```bash
git add app/admin/clients/pin app/shell/App.tsx
git commit -m "feat(clients): a pin picker document with a draggable marker and an address search"
```

---

### Task 4: "Pick on the map" from the coordinate boxes

**Files:**
- Modify: `app/shell/components/CoordinateFields.tsx:58-175`
- Modify: `app/admin/clients/LocationForm.tsx` (pass `emirate`, `label`, `onAddress`), `app/admin/clients/VerifyPinForm.tsx` (pass `emirate`, `label`), `app/admin/settings/PractitionerBaseDrawer.tsx` (pass `label="Home base"`)
- Test: `app/shell/components/CoordinateFields.test.tsx`

**Interfaces:**
- Produces: `CoordinateFields` props gain `mapPicker?: { emirate?: string; label: string; onAddress?: (address: string) => void }`. When set and `browserMapKey()` is not null, a "Pick on the map" button opens the picker; when set and the key is null, a line says the map needs the practice's key.

- [ ] **Step 1: Write the failing tests**

Add to `CoordinateFields.test.tsx`:

```tsx
  it('opens the picker with the point it holds, and takes the point it sends back', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const onChange = vi.fn();
    const onAddress = vi.fn();
    render(
      <CoordinateFields
        lat={25.2048}
        lng={55.2708}
        onChange={onChange}
        browserKey="browser-key-under-test"
        mapPicker={{ emirate: 'DXB', label: 'Home', onAddress }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    const url = new URL(String(open.mock.calls[0]?.[0]), window.location.origin);
    expect(url.pathname).toBe('/admin/clients/pin');
    expect(url.searchParams.get('lat')).toBe('25.2048');
    expect(url.searchParams.get('emirate')).toBe('DXB');
    expect(url.searchParams.get('label')).toBe('Home');
    fireEvent(
      window,
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcwellness:pin', lat: 25.21, lng: 55.28, address: 'Villa 12, Street 4' },
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ lat: 25.21, lng: 55.28 });
    expect(onAddress).toHaveBeenCalledWith('Villa 12, Street 4');
    open.mockRestore();
  });

  it('ignores a message from any other origin', () => {
    const onChange = vi.fn();
    render(
      <CoordinateFields
        lat={null}
        lng={null}
        onChange={onChange}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Home' }}
      />,
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'mcwellness:pin', lat: 1, lng: 2, address: null },
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says the map needs the key when the build has none', () => {
    render(
      <CoordinateFields lat={null} lng={null} onChange={vi.fn()} browserKey={null} mapPicker={{ label: 'Home' }} />,
    );
    expect(screen.queryByRole('button', { name: 'Pick on the map' })).toBeNull();
    expect(screen.getByText('The map needs the practice’s browser key.')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run app/shell/components/CoordinateFields.test.tsx`
Expected: FAIL, no such button.

- [ ] **Step 3: Add the button and the listener**

In `CoordinateFields.tsx` add the props `browserKey?: string | null` (tests only; the component
reads `browserMapKey()` when undefined) and `mapPicker?: { emirate?: string; label: string; onAddress?: (address: string) => void }`.
Import `browserMapKey` from `'../maps/googleMaps'` and `PIN_MESSAGE_TYPE, type PinMessage` from
`'../../admin/clients/pin/PinPickerPage'` (a type and a string constant; the picker page itself
is not pulled into the console bundle because nothing renders it here — check with
`pnpm build` that `PinPickerPage` stays in its own chunk; if it does not, move the two exports
to `app/shell/maps/pinMessage.ts` and import them from there in both places).

```tsx
  const key = browserKey === undefined ? browserMapKey() : browserKey;

  useEffect(() => {
    if (!mapPicker) return;
    // The picker posts to its opener with this origin as the target, and this
    // side checks the origin again: a message from anywhere else is not a pin.
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Partial<PinMessage> | null;
      if (!data || data.type !== PIN_MESSAGE_TYPE) return;
      if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
      reported.current = { lat: data.lat, lng: data.lng };
      onChange({ lat: data.lat, lng: data.lng });
      if (data.address && mapPicker.onAddress) mapPicker.onAddress(data.address);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mapPicker, onChange]);

  function openPicker(): void {
    if (!mapPicker) return;
    const params = new URLSearchParams({ label: mapPicker.label });
    if (lat !== null && lng !== null) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }
    if (mapPicker.emirate) params.set('emirate', mapPicker.emirate);
    // A new tab, never a frame: the picker is its own document with its own
    // policy, and the console's policy refuses to be framed and to frame.
    window.open(`/admin/clients/pin?${params.toString()}`, '_blank', 'noopener=no');
  }
```

`noopener=no` is deliberate: the picker needs `window.opener` to post back; both documents are
this app's own origin. In the actions row, before "Use my current position":

```tsx
        {mapPicker && key !== null ? (
          <Button type="button" variant="primary" onClick={openPicker}>
            Pick on the map
          </Button>
        ) : null}
```

and after the actions row:

```tsx
      {mapPicker && key === null ? (
        <p className="small muted">The map needs the practice’s browser key.</p>
      ) : null}
```

- [ ] **Step 4: Pass it from the three callers**

`LocationForm.tsx`: `mapPicker={{ emirate, label: LABELS[label] ?? 'Location', onAddress: (a) => { if (!displayAddress.trim()) setDisplayAddress(a); } }}`
(use the form's own state names for the address and the kind-of-place label; read the file).
`VerifyPinForm.tsx`: `mapPicker={{ emirate: location.emirate, label: labelOf(location) }}`.
`PractitionerBaseDrawer.tsx`: `mapPicker={{ label: 'Home base' }}` (no emirate, no address).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run app/shell/components app/admin/clients app/admin/settings && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/shell/components/CoordinateFields.tsx app/shell/components/CoordinateFields.test.tsx app/admin/clients/LocationForm.tsx app/admin/clients/VerifyPinForm.tsx app/admin/settings/PractitionerBaseDrawer.tsx
git commit -m "feat(shell): Pick on the map from every coordinate box"
```

---

### Task 5: The picker on a laptop, once, by hand

**Files:** none changed.

- [ ] **Step 1: Run the app and open the picker**

Run `pnpm dev` in the worktree with `VITE_GOOGLE_MAPS_BROWSER_KEY` unset. Open
`http://localhost:5184/admin/clients`, a record, Locations, "Check the pin": the line "The map
needs the practice’s browser key." shows and the boxes still work. Then set the variable to
any non-empty string, restart, and press "Pick on the map": a new tab opens on
`/admin/clients/pin?…` and, without a real key, shows "The map did not load" rather than a
blank page. Stop the server.

- [ ] **Step 2: Note what you saw in the trunk note (Task 6).**

---

### Task 6: The register, the seams, the note, the pull request

**Files:**
- Modify: `docs/COMPLIANCE/approved-vendors.md:12` (Google Maps Platform row)
- Modify: `docs/SEAMS.md:335-340`
- Modify: `docs/SPEC/client-record.md:42`, `docs/SPEC/route-planning.md` section 8 (the second widened document)
- Modify: `docs/CHANGE-REQUESTS/trunk-notes.md` (Round 43, part two)

- [ ] **Step 1: Amend the vendor row**

In the Google Maps Platform row's *data* column, after the piece-seventeen sentence about the
browser key, add:

> From trunk round 43 (operator's decision, 10 September 2026) the pin picker
> (`/admin/clients/pin`) loads the same API with the Places library, and its search box sends
> the address text a coordinator types, as it is typed and restricted to the UAE, to Google's
> Places service — the one address that leaves the practice, on the coordinator's deliberate
> use of the box, and never with a name, a record number, a location id or a Makani number.
> A pin dragged by hand sends only the viewport.

And in the *approval* column: "Address search approved by the operator, 10 September 2026,
for the pin picker alone."

- [ ] **Step 2: The seams and the specs**

`docs/SEAMS.md`: beside the day map's paragraph, one sentence naming the picker and that it
loads `places`. `docs/SPEC/route-planning.md` section 8: "Two widened documents from trunk
round 43: `/admin/schedule/map` and `/admin/clients/pin`; `MAP_DOCUMENT_PATHS` lists both."
`docs/SPEC/client-record.md:42`: "check the pin" opens the picker in a new tab; the boxes stay
for a coordinator who has the numbers.

- [ ] **Step 3: The trunk note**

Append "## Round 43 — the walk's fixes, part two: the pin (2026-09-10)" to
`docs/CHANGE-REQUESTS/trunk-notes.md`, saying: the loader moved to `app/shell/maps/`; the second
widened document and why the picker is a document and not a panel (the strict policy on every
console page); the message contract and its origin check; the register amendment; what the
operator still has to do (enable the Places API on the browser key's project; set the browser
key on the production build). Shared-zone files touched: `app/shell/**`,
`app/api/_middleware/security.ts`, `docs/COMPLIANCE/approved-vendors.md`.

- [ ] **Step 4: The gate and the pull request**

Run: `pnpm verify && pnpm test:db`. Then:

```bash
git add docs
git commit -m "docs(trunk): round 43, part two — the pin picker and what Google receives"
git push
gh pr create --title "trunk round 43, part two: the pin on a map" --body-file <(cat <<'EOF'
The home pin is set on a Google map: a draggable marker and an address search, in the picker
document `/admin/clients/pin`, opened from every coordinate box with "Pick on the map".

- The Maps loader moves to the shell and can load `places`
- `/admin/clients/pin` is the second widened document (security.ts, sw.ts, headers test)
- Picker page with marker, tap-to-place, Places search, `postMessage` back to the opener
- "Pick on the map" on the client location, verify pin and practitioner home base
- Vendor register amended for the address search (operator's decision, 10 September)

For the operator: enable the Places API on the browser key's project; confirm
VITE_GOOGLE_MAPS_BROWSER_KEY is set on the production build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 5: Reviews**

Dispatch `compliance-reviewer` (the register amendment is its centre) and `security-reviewer`
(the second widened path, the `postMessage` origin check, `noopener=no`). Fix, re-run the gate,
merge only when every check reads SUCCESS.
