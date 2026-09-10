import { useState } from 'react';
import { IdResponse, type Location } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { CoordinateFields } from '../../shell/components/CoordinateFields';

const GENERIC_ERROR = 'The pin could not be verified. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to change this client's locations.";

/**
 * "Check the pin" (docs/SPEC/client-record.md section 4.2; task brief item 4):
 * drag-the-marker becomes latitude and longitude, "Use my current
 * position", and "Open in Google Maps" so the person can eyeball the point
 * — no map library, no map key, both still absent from the web app
 * (docs/CHANGE-REQUESTS/client-record-02.md). Posts to the existing
 * verify-pin route (locations.ts).
 */
export function VerifyPinForm({
  clientId,
  location,
  onSaved,
  onCancel,
}: {
  clientId: string;
  location: Location;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const [lat, setLat] = useState<number | null>(location.entranceLat);
  const [lng, setLng] = useState<number | null>(location.entranceLng);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (lat === null || lng === null) {
      setError('Set the point, or use your current position.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/locations/${location.id}/verify-pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.status === 200) {
        IdResponse.parse(await res.json());
        onSaved();
        return;
      }
      setError(res.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify-pin">
      <h4 className="drawer__section">Where the practitioner should arrive</h4>
      <p className="small muted">Move it to the door the practitioner should knock on.</p>
      <CoordinateFields
        idPrefix={`verify-pin-${location.id}`}
        lat={lat}
        lng={lng}
        onChange={(next) => {
          setLat(next.lat);
          setLng(next.lng);
        }}
      />
      {error ? <Note tone="critical">{error}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save pin'}
        </Button>
      </div>
    </div>
  );
}
