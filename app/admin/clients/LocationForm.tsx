import { useState, type FormEvent } from 'react';
import {
  EMIRATES,
  LOCATION_LABELS,
  IdResponse,
  type Location,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { Checkbox, Textarea } from './FormAtoms';
import { CoordinateFields } from '../../shell/components/CoordinateFields';

const EMIRATE_LABELS: Record<string, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};

// A household's own place: the practice's own locations ('studio', 'base')
// are never created through this form (docs/SPEC/00-data-model.md section 2).
const CLIENT_LOCATION_LABELS = LOCATION_LABELS.filter((l) => l !== 'studio' && l !== 'base');
const LOCATION_LABEL_TEXT: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  school: 'School',
  other: 'Other',
};

const GENERIC_ERROR = 'This location could not be saved. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to change this client's locations.";

type FieldErrors = { emirate?: string; makani?: string; point?: string };

/**
 * Add or edit one location (docs/SPEC/client-record.md section 4.2). A
 * location's emirate and entrance point are set once, at creation
 * (locations.ts does not let either move through the ordinary edit route —
 * the point moves only through "Verify pin", CoordinateFields.tsx), so edit
 * mode hides both and asks only for what the edit route accepts. Reused by
 * the drawer's Locations tab and the enrolment wizard's location step.
 */
export function LocationForm({
  clientId,
  location,
  onSaved,
  onCancel,
}: {
  clientId: string;
  /** Absent: create a new location. Present: edit this one (never its point — see above). */
  location?: Location;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const editing = location !== undefined;
  const [label, setLabel] = useState(location?.label ?? 'home');
  const [emirate, setEmirate] = useState(location?.emirate ?? '');
  const [makani, setMakani] = useState(location?.makaniNumber ?? '');
  const [lat, setLat] = useState<number | null>(location?.entranceLat ?? null);
  const [lng, setLng] = useState<number | null>(location?.entranceLng ?? null);
  const [displayAddress, setDisplayAddress] = useState(location?.displayAddress ?? '');
  const [accessNotes, setAccessNotes] = useState(location?.accessNotes ?? '');
  const [isPrimary, setIsPrimary] = useState(location?.isPrimary ?? true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clear(key: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const errors: FieldErrors = {};
    if (!editing && !emirate) errors.emirate = 'Choose an emirate.';
    if (!editing && (lat === null || lng === null)) {
      errors.point = 'Set the entrance point, or use your current position.';
    }
    if (makani.trim() && !/^[0-9]{10}$/.test(makani.trim())) {
      errors.makani = 'A Makani number is ten digits.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const res = await apiFetch(
        editing
          ? `/api/clients/${clientId}/locations/${location.id}`
          : `/api/clients/${clientId}/locations`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            editing
              ? {
                  label,
                  makaniNumber: makani.trim() || null,
                  displayAddress: displayAddress.trim() || null,
                  accessNotes: accessNotes.trim() || null,
                  isPrimary,
                }
              : {
                  label,
                  emirate,
                  ...(makani.trim() ? { makaniNumber: makani.trim() } : {}),
                  entranceLng: lng,
                  entranceLat: lat,
                  ...(displayAddress.trim() ? { displayAddress: displayAddress.trim() } : {}),
                  ...(accessNotes.trim() ? { accessNotes: accessNotes.trim() } : {}),
                  isPrimary,
                },
          ),
        },
      );
      if (res.status === 200 || res.status === 201) {
        IdResponse.parse(await res.json());
        onSaved();
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_ERROR);
        return;
      }
      setFormError(GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="drawer__form" onSubmit={(e) => void submit(e)}>
      <Select
        id="location-label"
        label="Kind of place"
        value={label}
        onChange={(e) => setLabel(e.target.value as (typeof CLIENT_LOCATION_LABELS)[number])}
      >
        {CLIENT_LOCATION_LABELS.map((l) => (
          <option key={l} value={l}>
            {LOCATION_LABEL_TEXT[l]}
          </option>
        ))}
      </Select>
      {!editing ? (
        <Select
          id="location-emirate"
          label="Emirate"
          value={emirate}
          onChange={(e) => {
            setEmirate(e.target.value);
            clear('emirate');
          }}
          error={fieldErrors.emirate}
        >
          <option value="">Choose an emirate</option>
          {EMIRATES.map((e) => (
            <option key={e} value={e}>
              {EMIRATE_LABELS[e]}
            </option>
          ))}
        </Select>
      ) : null}
      <Field
        id="location-makani"
        label="Makani number (Dubai only, optional)"
        type="text"
        inputMode="numeric"
        value={makani}
        onChange={(e) => {
          setMakani(e.target.value);
          clear('makani');
        }}
        hint="Ten digits, for example 1234567890. Find it on the building's Makani plate or in the Dubai Municipality app."
        error={fieldErrors.makani}
      />
      {!editing ? (
        <CoordinateFields
          lat={lat}
          lng={lng}
          onChange={(next) => {
            setLat(next.lat);
            setLng(next.lng);
            clear('point');
          }}
          error={fieldErrors.point}
        />
      ) : null}
      <Field
        id="location-address"
        label="Address (optional)"
        type="text"
        value={displayAddress}
        onChange={(e) => setDisplayAddress(e.target.value)}
      />
      <Textarea
        id="location-access-notes"
        label="Access notes (optional)"
        rows={3}
        value={accessNotes}
        onChange={(e) => setAccessNotes(e.target.value)}
      />
      <Checkbox
        id="location-is-primary"
        label="Primary location"
        checked={isPrimary}
        onChange={setIsPrimary}
      />
      {formError ? <Note tone="critical">{formError}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save location' : 'Add location'}
        </Button>
      </div>
    </form>
  );
}
