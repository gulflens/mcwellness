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
 * (app/shell/components/CoordinateFields.tsx). The message shape itself lives
 * in `app/shell/maps/pinMessage.ts`, not here — CoordinateFields.tsx is part
 * of the console's own bundle, and it must not import anything of this page's
 * (the Places library included) to read it.
 */

export { PIN_MESSAGE_TYPE };
export type { PinMessage };

const NO_KEY = 'The map needs the practice’s browser key.';
const NOT_LOADED = 'The map did not load. Check the connection and try again.';
const WRONG_DOOR =
  'This page has to be opened from the record, not typed into the address bar: only the door it opens by admits the map.';
const NO_OPENER =
  'The record that asked for this pin is no longer open. Copy the coordinates below into it instead.';

type Point = { lat: number; lng: number };

/**
 * The point the query string names, or null when it names none. `lat` and
 * `lng` are read together: a URL missing one of them, or carrying an empty
 * value for one, describes no point at all rather than one anchored at zero.
 */
function pointFrom(params: URLSearchParams): Point | null {
  const latRaw = params.get('lat');
  const lngRaw = params.get('lng');
  if (!latRaw || !lngRaw) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
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
