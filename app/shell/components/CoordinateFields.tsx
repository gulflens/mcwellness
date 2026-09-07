import { useEffect, useRef, useState } from 'react';
import { Button, Field, Note } from './Controls';
import { googleMapsUrl, requestCurrentPosition } from './geolocation';

/**
 * Latitude, longitude, "Use my current position" and "Open in Google Maps"
 * (docs/SPEC/client-record.md section 4.2, "verify pin"): no map library and
 * no map key exist on the web yet, so this is the whole of it — a small form,
 * never blocking when geolocation is refused or unsupported. Shared by
 * LocationForm's entrance point and the standalone "Verify pin" action on an
 * existing location.
 *
 * **Where it lives, and why it moved.** It began in `app/admin/clients/`,
 * where "verify pin" was the only screen that needed it. From 8 September
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
 */

const BOUNDS = { lat: 90, lng: 180 } as const;

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
}: {
  /** Unique per instance on screen, so two open at once never share an id. */
  idPrefix?: string;
  lat: number | null;
  lng: number | null;
  onChange: (point: { lat: number | null; lng: number | null }) => void;
  error?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
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
        <Button
          type="button"
          variant="secondary"
          disabled={locating}
          onClick={() => void fillFromCurrentPosition()}
        >
          {locating ? 'Locating…' : 'Use my current position'}
        </Button>
        {lat !== null && lng !== null ? (
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
      {locateNote ? <Note>{locateNote}</Note> : null}
    </div>
  );
}
