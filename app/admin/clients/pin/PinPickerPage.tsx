import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Button, Note } from '../../../shell/components/Controls';
import { browserMapKey, loadGoogleMaps, type GoogleMaps } from '../../../shell/maps/googleMaps';
import { mapStyle } from '../../../shell/maps/mapStyle';
import { PIN_MESSAGE_TYPE, type PinMessage } from '../../../shell/maps/pinMessage';
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
 * **What the URL carries.** An opaque key (`?k=<uuid>`) and nothing else —
 * never a point, an emirate or a label. A household's entrance coordinate is
 * personal data, and `.claude/rules/ui.md` forbids personal data in a URL: a
 * new tab sends its own URL to whatever serves it, and that would put the
 * coordinate in the access log of a host the practice does not control
 * (finding 3 of the review of this page). `CoordinateFields.openPicker`
 * writes the point, under that key, to `sessionStorage` — private to this
 * browser and never sent to a server — and this page reads it back by the
 * same key and removes it immediately, so it does not linger once read. A
 * missing key, or one whose item cannot be read or parsed, is treated exactly
 * like a client with no pin yet: centred on the UAE (or the emirate, once one
 * is known), no marker, "Use this pin" disabled.
 *
 * **What Google receives.** The browser's address, the map viewport and the
 * key, as any map page sends — and, only while the search box is used, the
 * address text as it is typed, restricted to the UAE. Nothing here names a
 * person, a record or a location id, and the point chosen on this page never
 * reaches Google or any server of this app's own
 * (docs/COMPLIANCE/approved-vendors.md, Google Maps Platform, amended in trunk
 * round 43).
 *
 * **Who may receive the point.** The message is posted to `window.opener`
 * with this page's own origin as the target, so only a document of this app
 * can read it; the opener checks the origin again before using it
 * (app/shell/components/CoordinateFields.tsx). The message shape itself lives
 * in `app/shell/maps/pinMessage.ts`, not here — CoordinateFields.tsx is part
 * of the console's own bundle, and it must not import anything of this page's
 * (the Places library included) to read it.
 */

const NO_KEY = 'The map needs the practice’s browser key.';
const NOT_LOADED = 'The map did not load. Check the connection and try again.';
const WRONG_DOOR =
  'This page has to be opened from the record, not typed into the address bar: only the door it opens by admits the map.';
const NO_OPENER =
  'The record that asked for this pin is no longer open. Copy the coordinates below into it instead.';

type Point = { lat: number; lng: number };

/** The shape `CoordinateFields.openPicker` writes under `mcwellness:pin:<key>`. */
type StoredPin = { lat?: number; lng?: number; emirate?: string; label?: string };

/** `mcwellness:pin:<key>` — the same item name `CoordinateFields.openPicker` writes. */
function itemKeyFor(key: string): string {
  return `mcwellness:pin:${key}`;
}

/**
 * The blob written under this key, or null for a missing key, an item
 * already gone (a stale link, or another tab that got there first), a value
 * that fails to parse, or a browser that throws on the storage call at all
 * (site data blocked). Every one of those is the same "no starting point"
 * case the fallback below already handles. Read-only: it does not remove the
 * item, so calling it more than once for the same key — which is exactly
 * what happens once, harmlessly, under Strict Mode's extra development-only
 * invocation of a `useState` initializer — reads the same still-present
 * value both times, rather than the second call finding nothing left.
 * Removal happens once, separately, in the effect below.
 */
function readStored(key: string | null): StoredPin | null {
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(itemKeyFor(key));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredPin) : null;
  } catch {
    return null;
  }
}

/**
 * The point a stored blob names, or null when it names none. `lat` and `lng`
 * are read together: a blob missing one of them, or carrying something that
 * is not a finite, in-range number for one, describes no point at all rather
 * than one anchored at zero.
 */
function pointFrom(stored: StoredPin | null): Point | null {
  if (!stored) return null;
  const { lat, lng } = stored;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
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
  const keyParam = params.get('k');
  // Read once, as a lazy `useState` initializer — never a ref read during
  // render, which React's own hooks lint now refuses outright. `readStored`
  // is safe to call twice (Strict Mode's development-only extra invocation
  // of this exact initializer) because it never removes anything; removal is
  // the separate effect just below, and removal is safe to run twice because
  // it is idempotent.
  const [stored] = useState<StoredPin | null>(() => readStored(keyParam));
  useEffect(() => {
    if (!keyParam) return;
    try {
      // Removed here, not inside `readStored`: so it does not linger once
      // read (finding 3 of the review of this page — the point must not sit
      // in the URL, and sessionStorage is where it travels instead), while
      // staying safe under Strict Mode's mount → cleanup → mount replay,
      // which would otherwise run a read-and-remove twice and lose the
      // second read.
      window.sessionStorage.removeItem(itemKeyFor(keyParam));
    } catch {
      // A browser that cannot remove it could not have read it either; the
      // fallback below already covers that browser as "no starting point".
    }
  }, [keyParam]);
  const label = typeof stored?.label === 'string' && stored.label ? stored.label : 'Location';
  const emirate = typeof stored?.emirate === 'string' ? stored.emirate : '';
  const start = pointFrom(stored);

  const key = browserKey === undefined ? browserMapKey() : browserKey;
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
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
    // The marker's drag and the map's click are native events, not React's
    // own — Google dispatches them outside any synthetic event, so nothing
    // schedules the batch a synthetic handler would. `flushSync` commits the
    // pin's new position before the callback returns, the same reason React's
    // own docs give it: a third-party integration whose next line of code
    // (or, on this page, the very next test assertion) expects the DOM
    // already updated.
    const read = (): void => {
      const p = marker.getPosition();
      if (p) setPoint({ lat: p.lat(), lng: p.lng() });
    };
    marker.addListener('dragend', () => {
      flushSync(() => {
        setAddress(null);
        read();
      });
    });
    map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      // Read the two numbers off the event's own LatLng rather than round
      // through `marker.getPosition()` afterwards: `setPosition` accepts the
      // LatLng object as-is, and asking the marker to hand it straight back
      // is one call this page does not need to make.
      const next = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      marker.setPosition(next);
      flushSync(() => {
        setAddress(null);
        setPoint(next);
      });
    });

    // The search box: Google's own element, restricted to the UAE. Its input
    // sends the typed text to Google as it is typed; that is the one thing on
    // this page that leaves the practice, and it is used on purpose.
    const places = (maps as unknown as { places?: { PlaceAutocompleteElement?: unknown } }).places;
    if (places?.PlaceAutocompleteElement && searchRef.current) {
      const Element = places.PlaceAutocompleteElement as new (options: unknown) => HTMLElement;
      const box = new Element({ includedRegionCodes: ['ae'] });
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
          const next = { lat: place.location.lat(), lng: place.location.lng() };
          marker.setPosition(next);
          map.panTo(next);
          map.setZoom(17);
          flushSync(() => {
            setAddress(place.formattedAddress ?? null);
            setPoint(next);
          });
        });
      });
    }
    return () => {
      marker.setMap(null);
    };
    // `start`, `emirate` and `label` come from the sessionStorage blob
    // consumed once above and do not change across this component's renders.
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
      {note ? <Note tone={key === null ? 'muted' : 'critical'}>{note}</Note> : null}
      <div ref={mapRef} className="pin-picker__map" aria-label="Map" />
      <footer className="pin-picker__foot">
        <p className="numeric">{point ? shown(point) : 'No pin yet. Tap the map to place one.'}</p>
        {address ? <p className="small muted">{address}</p> : null}
        <div className="pin-picker__actions">
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
