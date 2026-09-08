import { useRef, useState, type FormEvent } from 'react';
import {
  EMIRATES,
  PractitionerBaseResponse,
  type Emirate,
  type PractitionerRow,
} from '../../api/practitioners/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CoordinateFields } from '../../shell/components/CoordinateFields';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from '../../shell/components/useDrawer';
import { EMIRATE_LABELS } from './emirates';

/**
 * Setting where a practitioner's driving day starts and ends
 * (docs/SPEC/route-planning.md section 5.4, migration 913).
 *
 * **A coordinate and nothing else.** There is no address box here and no box
 * for arrival notes, because this is somebody's home rather than a household
 * the practice visits: the route has no field for either and the database
 * writes null into both columns itself. The note above the form says so in
 * as many words, so the person filling it in knows what the practice is
 * keeping about them.
 *
 * `CoordinateFields` is the reason it moved to the shell
 * (app/shell/components/CoordinateFields.tsx): "Use my current position" is
 * exactly the right control here — a practitioner standing at their own front
 * door taps it once — and the client record's verify-pin form needs the same
 * boxes. It is used here with `offerMapLink={false}`: the third control that
 * form carries hands a coordinate to Google, which the vendor listing approves
 * for households and does not describe for a member of staff's home.
 *
 * A reason is required, as it is on the practice's own address: this is a move
 * (docs/SPEC/audit.md section 6), and the trail records it against the row.
 */

export const DRAWER_TITLE = 'Set the home base';
export const DRAWER_NOTE =
  "This is where this practitioner's driving day starts and ends. The practice keeps the " +
  'coordinate and nothing else — no address, no notes.';
const REASON_LABEL = 'Why is this being set?';

const FORBIDDEN_MESSAGE = 'A home base is the practitioner’s own to set.';
const REASON_MESSAGE = 'Say why this is being set before saving.';
const COORDINATES_MESSAGE = 'A base needs both a latitude and a longitude.';
const GENERIC_MESSAGE = 'The home base could not be saved. Try again.';

const FIELD_IDS = {
  coordinates: 'base-coordinates-lat',
  emirate: 'base-emirate',
  reason: 'base-reason',
} as const;

export function PractitionerBaseDrawer({
  practitioner,
  defaultEmirate,
  onClose,
  onSaved,
}: {
  practitioner: PractitionerRow;
  /** The practice's own emirate, so a first base opens on the likeliest answer. */
  defaultEmirate: Emirate;
  onClose: () => void;
  onSaved: (saved: PractitionerRow) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [point, setPoint] = useState<{ lat: number | null; lng: number | null }>({
    lat: practitioner.base?.point.lat ?? null,
    lng: practitioner.base?.point.lng ?? null,
  });
  const [emirate, setEmirate] = useState<Emirate>(practitioner.base?.emirate ?? defaultEmirate);
  const [reason, setReason] = useState('');
  const [coordinateError, setCoordinateError] = useState<string | undefined>(undefined);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const missingPoint = point.lat === null || point.lng === null;
    const missingReason = reason.trim().length === 0;
    setCoordinateError(missingPoint ? COORDINATES_MESSAGE : undefined);
    setReasonError(missingReason ? REASON_MESSAGE : undefined);
    if (missingPoint || missingReason) {
      // Focus the first thing that is wrong, so a refusal is heard as well as seen.
      document.getElementById(missingPoint ? FIELD_IDS.coordinates : FIELD_IDS.reason)?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch(`/api/practitioners/${practitioner.id}/base`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ lat: point.lat, lng: point.lng, emirate }),
      });
      if (res.ok) {
        onSaved(PractitionerBaseResponse.parse(await res.json()).practitioner);
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFormError(body?.error === 'reason_required' ? REASON_MESSAGE : COORDINATES_MESSAGE);
        return;
      }
      setFormError(GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="practitioner-base-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="practitioner-base-title">{DRAWER_TITLE}</h2>
          <p className="small muted">{practitioner.displayName}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <form className="drawer__form" onSubmit={(e) => void submit(e)}>
          <p className="small muted">{DRAWER_NOTE}</p>

          <CoordinateFields
            idPrefix="base-coordinates"
            // No "Open in Google Maps" here. The vendor listing approves that
            // hand-off for a household's coordinates on the practitioner's own
            // tap (docs/COMPLIANCE/approved-vendors.md); a member of staff's
            // home is a category of personal data it does not describe, and the
            // note directly above this form promises the practice keeps the
            // coordinate and nothing else. "Use my current position" stays: it
            // reaches the browser and nobody else.
            offerMapLink={false}
            lat={point.lat}
            lng={point.lng}
            onChange={(next) => {
              setPoint(next);
              setCoordinateError(undefined);
              setFormError(null);
            }}
            error={coordinateError}
          />

          <Select
            id={FIELD_IDS.emirate}
            label="Emirate"
            value={emirate}
            onChange={(e) => setEmirate(e.target.value as Emirate)}
          >
            {EMIRATES.map((code) => (
              <option key={code} value={code}>
                {EMIRATE_LABELS[code]}
              </option>
            ))}
          </Select>

          <Field
            id={FIELD_IDS.reason}
            label={REASON_LABEL}
            hint="Recorded against the change, and read later by whoever asks what happened."
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
              setFormError(null);
            }}
            error={reasonError}
          />

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save the home base'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
