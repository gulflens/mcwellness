import { useEffect, useRef, useState } from 'react';
import { Button, Field, Note } from './Controls';
import { googleMapsUrl, requestCurrentPosition } from './geolocation';
import { browserMapKey } from '../maps/googleMaps';
import { PIN_MESSAGE_TYPE, type PinMessage } from '../maps/pinMessage';

/**
 * Latitude, longitude, "Use my current position", "Open in Google Maps" and,
 * since trunk round 43 part two, "Pick on the map"
 * (docs/SPEC/client-record.md section 4.2, "check the pin"): a small form,
 * never blocking when geolocation is refused or unsupported. Shared by
 * LocationForm's entrance point, the standalone "Check the pin" action on an
 * existing location, and the practitioner base drawer.
 *
 * **"Pick on the map" (`mapPicker` prop).** The map itself never renders here
 * — Google's script is admitted only on the pin picker's own document
 * (`app/admin/clients/pin/PinPickerPage.tsx`, docs/SPEC/route-planning.md
 * section 8), so this button opens that document in a new tab, and a
 * listener takes back the point it posts. The point these boxes hold never
 * rides in that tab's URL: `.claude/rules/ui.md` forbids personal data in a
 * URL or query string, and a household's entrance coordinate is exactly
 * that. `openPicker` writes it instead to `sessionStorage`, under a fresh
 * `crypto.randomUUID()` key, and opens the picker with only that key
 * (`?k=<uuid>`) in its URL; the picker reads the blob back by the same key
 * and deletes it immediately (the review of this component, finding 3). A
 * browser that blocks site data throws on the write — caught here, reported
 * next to the button, and the tab is not opened at all. The message shape
 * the listener below reads lives in `../maps/pinMessage.ts`, not in the
 * picker page itself, so this component — part of the console's own bundle —
 * never imports the page (and the Places library it loads) to read it.
 *
 * **Where it lives, and why it moved.** It began in `app/admin/clients/`,
 * where "check the pin" was the only screen that needed it. From 8 September
 * 2026 a practitioner sets their own home base on
 * `/admin/settings/practitioners` — standing at their own front door, tapping
 * "Use my current position" — which is the second module to need exactly this
 * form. `docs/SPEC/OWNERSHIP.md`'s own rule for a thing two modules share is
 * that it moves here, whole and unforked, and both import it: the alternative
 * is two copies of a coordinate box drifting apart, and a coordinate box is
 * not a thing to have two opinions about. `geolocation.ts` came with it,
 * being the browser API half of the same component.
 *
 * Text with a decimal keypad, never `type="number"`: a spinner or a scroll
 * wheel over a coordinate box moves where a practitioner drives, and does it
 * without anyone meaning to. The bounds a number input would have carried are
 * kept in `parse` instead, and what was typed stays on screen while it is
 * being typed — a box that blanked itself at the third character of "255"
 * would be worse than the spinner.
 *
 * **`offerMapLink` is not a preference.** `docs/COMPLIANCE/approved-vendors.md`
 * approves Google Maps Platform for coordinates, and every sentence of that row
 * is written about households: "a client's entrance coordinates only on the
 * practitioner's deliberate tap", "the day's stop coordinates in order". A
 * member of staff's home is a category of personal data that row does not
 * describe, so the base drawer passes `false` and the link is not rendered
 * there (the review of pull request 126, finding 6). "Use my current position"
 * stays wherever this component is used: it reaches the browser and nobody
 * else.
 */

const BOUNDS = { lat: 90, lng: 180 } as const;

/**
 * The literal words every caller resolves `mapPicker.label` to today —
 * LocationForm.tsx, VerifyPinForm.tsx and PractitionerBaseDrawer.tsx each
 * turn their own enum value into one of exactly these before handing it
 * here. A kind-of-place word is fine to keep beside a coordinate in
 * `sessionStorage`, briefly, for the picker's page heading and marker
 * tooltip; a record's own words are not (the review of this component,
 * finding 3). This component cannot tell a future caller's free text from a
 * client's own nickname for a location except by checking it against this
 * finite list, so anything not on it is left out of the stored blob.
 */
const PLACE_KIND_LABELS = new Set([
  'Home',
  'Work',
  'School',
  'Other',
  'The studio',
  'Base',
  'Home base',
  'Location',
]);

/** A coordinate, or null when the box is empty or holds nothing usable yet. */
function parse(value: string, limit: number): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed) <= limit ? parsed : null;
}

/** What to show in the box for a value that arrived from outside the component. */
function display(value: number | null): string {
  return value === null ? '' : String(value);
}

export function CoordinateFields({
  idPrefix = 'coord',
  lat,
  lng,
  onChange,
  error,
  offerMapLink = true,
  browserKey,
  mapPicker,
}: {
  /** Unique per instance on screen, so two open at once never share an id. */
  idPrefix?: string;
  lat: number | null;
  lng: number | null;
  onChange: (point: { lat: number | null; lng: number | null }) => void;
  error?: string;
  /**
   * Whether to offer "Open in Google Maps" for the point in the boxes. True for
   * a household the practitioner is driving to, which is what the vendor row
   * approves; false for a member of staff's own home, which it does not.
   */
  offerMapLink?: boolean;
  /** Tests hand the browser key in; the component reads the build's otherwise. */
  browserKey?: string | null;
  /**
   * When set, offers "Pick on the map": a button that opens the pin picker in
   * a new tab, handing it the point these boxes hold through `sessionStorage`
   * rather than the tab's URL, and a listener that takes back the point it
   * posts. Absent only for nothing today — every caller of this component
   * passes it — but kept optional rather than forced.
   */
  mapPicker?: {
    /** Centres the picker on the emirate when there is no point yet. */
    emirate?: string;
    /** Shown on the picker's page and used as the marker's title. */
    label: string;
    /** A caller may take the address the picker's search found. */
    onAddress?: (address: string) => void;
  };
}) {
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const [pickerFailure, setPickerFailure] = useState<string | null>(null);
  // What is in the boxes, which is not always what the parent holds: half of a
  // number on the way to being one parses to null, and the characters must stay.
  const [raw, setRaw] = useState({ lat: display(lat), lng: display(lng) });
  // The last pair this component reported, so a value arriving from outside — the
  // current position, or a location being edited — is told apart from our own echo.
  const reported = useRef({ lat, lng });

  useEffect(() => {
    if (reported.current.lat === lat && reported.current.lng === lng) return;
    reported.current = { lat, lng };
    setRaw({ lat: display(lat), lng: display(lng) });
  }, [lat, lng]);

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
      // Report it the same way `fillFromCurrentPosition` does: `onChange` only,
      // never touching `raw` or `reported` here directly. A point from the
      // picker is a value arriving from outside, not this component's own
      // echo of what was typed, so it takes the same path back in as an edited
      // location's point does — through the parent, and the `[lat, lng]`
      // effect above reconciles the boxes once it comes back down. Setting
      // `reported.current` here instead would make that effect think its own
      // echo had already arrived and skip updating the boxes, leaving them
      // showing the old point while the parent holds the new one.
      onChange({ lat: data.lat, lng: data.lng });
      if (data.address && mapPicker.onAddress) mapPicker.onAddress(data.address);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mapPicker, onChange]);

  function openPicker(): void {
    if (!mapPicker) return;
    setPickerFailure(null);
    const pinKey = crypto.randomUUID();
    // Only a kind-of-place word travels with the point — see PLACE_KIND_LABELS
    // above — and `lat`/`lng` are omitted entirely rather than written as
    // `null` when there is no point yet, so the picker's own "is there a
    // starting point" check (reading the parsed object's fields) sees the
    // same "missing" shape either way.
    const toStore: { lat?: number; lng?: number; emirate?: string; label?: string } = {};
    if (lat !== null && lng !== null) {
      toStore.lat = lat;
      toStore.lng = lng;
    }
    if (mapPicker.emirate) toStore.emirate = mapPicker.emirate;
    if (PLACE_KIND_LABELS.has(mapPicker.label)) toStore.label = mapPicker.label;
    try {
      window.sessionStorage.setItem(`mcwellness:pin:${pinKey}`, JSON.stringify(toStore));
    } catch {
      // A browser blocking site data (private mode, storage switched off) must
      // not silently open a picker with no way to hand its point back safely,
      // and must not fall back to the URL either — that is the very thing
      // this key exists to avoid. Say so, and stop here.
      setPickerFailure(
        'The map could not be opened: this browser is blocking site data. Enter the coordinates by hand instead.',
      );
      return;
    }
    // A new tab, never a frame: the picker is its own document with its own
    // policy, and the console's policy refuses to be framed and to frame.
    // `noopener=no` is deliberate, not an oversight: the picker needs
    // `window.opener` to post the chosen point back, and both documents are
    // this app's own origin, so there is nothing to gain by cutting it off.
    // The URL carries only the opaque key: no point, no emirate, no label —
    // `.claude/rules/ui.md` forbids personal data in a URL or query string,
    // and a household's entrance coordinate is exactly that.
    window.open(`/admin/clients/pin?k=${pinKey}`, '_blank', 'noopener=no');
  }

  function edit(axis: 'lat' | 'lng', value: string) {
    const next = { ...raw, [axis]: value };
    setRaw(next);
    const point = {
      lat: parse(next.lat, BOUNDS.lat),
      lng: parse(next.lng, BOUNDS.lng),
    };
    reported.current = point;
    onChange(point);
  }

  async function fillFromCurrentPosition() {
    setLocating(true);
    setLocateNote(null);
    const position = await requestCurrentPosition();
    setLocating(false);
    if (!position) {
      setLocateNote(
        'Your current position is not available. Enter the coordinates by hand instead.',
      );
      return;
    }
    onChange({ lat: position.lat, lng: position.lng });
  }

  // One message for a pair of boxes, so it is announced once and both inputs point
  // at it rather than it sitting beside them as an unlinked paragraph.
  const errorId = error ? `${idPrefix}-error` : undefined;
  const describedBy = error ? { 'aria-describedby': errorId, 'aria-invalid': true } : {};

  return (
    <div className="coordinate-fields">
      <div className="field-row">
        <Field
          id={`${idPrefix}-lat`}
          label="Latitude"
          type="text"
          inputMode="decimal"
          value={raw.lat}
          onChange={(e) => edit('lat', e.target.value)}
          {...describedBy}
        />
        <Field
          id={`${idPrefix}-lng`}
          label="Longitude"
          type="text"
          inputMode="decimal"
          value={raw.lng}
          onChange={(e) => edit('lng', e.target.value)}
          {...describedBy}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="field__hint field__hint--error small">
          {error}
        </p>
      ) : null}
      <div className="coordinate-fields__actions">
        {mapPicker && key !== null ? (
          <Button type="button" variant="primary" onClick={openPicker}>
            Pick on the map
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={locating}
          onClick={() => void fillFromCurrentPosition()}
        >
          {locating ? 'Locating…' : 'Use my current position'}
        </Button>
        {offerMapLink && lat !== null && lng !== null ? (
          <a
            className="link"
            href={googleMapsUrl(lat, lng)}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open in Google Maps, opens in a new tab"
          >
            Open in Google Maps
          </a>
        ) : null}
      </div>
      {mapPicker && key === null ? (
        <p className="small muted">The map needs the practice’s browser key.</p>
      ) : null}
      {pickerFailure ? <Note tone="critical">{pickerFailure}</Note> : null}
      {locateNote ? <Note>{locateNote}</Note> : null}
    </div>
  );
}
