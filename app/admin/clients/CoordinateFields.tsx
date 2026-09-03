import { useState } from 'react';
import { Button, Field, Note } from '../../shell/components/Controls';
import { googleMapsUrl, requestCurrentPosition } from './geolocation';

/**
 * Latitude, longitude, "Use my current position" and "Open in Google Maps"
 * (docs/SPEC/client-record.md section 4.2, "verify pin"; task brief item 4):
 * no map library and no map key exist on the web yet, so this is the whole
 * of it — a small form, never blocking when geolocation is refused or
 * unsupported. Shared by LocationForm's entrance point and the standalone
 * "Verify pin" action on an existing location.
 */
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

  return (
    <div className="coordinate-fields">
      <div className="field-row">
        <Field
          id={`${idPrefix}-lat`}
          label="Latitude"
          type="number"
          step="any"
          min={-90}
          max={90}
          value={lat ?? ''}
          onChange={(e) =>
            onChange({ lat: e.target.value === '' ? null : Number(e.target.value), lng })
          }
        />
        <Field
          id={`${idPrefix}-lng`}
          label="Longitude"
          type="number"
          step="any"
          min={-180}
          max={180}
          value={lng ?? ''}
          onChange={(e) =>
            onChange({ lat, lng: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </div>
      {error ? <p className="field__hint field__hint--error small">{error}</p> : null}
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
          >
            Open in Google Maps
          </a>
        ) : null}
      </div>
      {locateNote ? <Note>{locateNote}</Note> : null}
    </div>
  );
}
