import { useState, type FormEvent } from 'react';
import type { ClientRecordResponse, UpdateClientBody } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { FieldRow } from './FormAtoms';
import { practiceToday } from './activation';
import { FUTURE_DATE_ERROR, focusFirstError, isPastDate } from './formRules';

const FORBIDDEN_ERROR = "You don't have permission to edit this record.";
const GENERIC_ERROR = 'The change could not be saved. Try again.';

type Errors = { givenName?: string; familyName?: string; dateOfBirth?: string };

/** The fields in the order they are read, so a refusal lands the caret on the first one. */
const IDENTITY_FIELD_ORDER = [
  'identity-given-name',
  'identity-family-name',
  'identity-dob',
] as const;
const FIELD_INPUT_ID: Record<keyof Errors, string> = {
  givenName: 'identity-given-name',
  familyName: 'identity-family-name',
  dateOfBirth: 'identity-dob',
};

/**
 * The client's own facts, editable after the first wizard step.
 *
 * Until the walk of 10 September nothing on the console could change a name or
 * a date of birth once the lead existed: the wizard's Identity step was
 * submit-only and the Overview showed the facts as text. A lead enrolled without
 * a date of birth could never be activated from the screen, though
 * `PATCH /api/clients/:id` had accepted the field all along
 * (docs/superpowers/specs/2026-09-10-walk-fixes-design.md).
 *
 * Only the fields that changed are sent: the route's body is partial, and a
 * form that resent every field would turn an untouched box into a write on the
 * audit trail.
 *
 * No Arabic-name fields here: the console is English only (docs/DESIGN-BRIEF.md
 * section 10 item 4), and the enrolment wizard and the contact form already
 * dropped theirs for the same reason (commit 421734c). An Arabic name already
 * on the record is untouched by this form, the same way it survives an edit
 * from the contact form.
 */
export function IdentityForm({
  clientId,
  record,
  onSaved,
  onCancel,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const [givenName, setGivenName] = useState(record.givenName);
  const [familyName, setFamilyName] = useState(record.familyName);
  const [dateOfBirth, setDateOfBirth] = useState(record.dateOfBirth ?? '');
  const [sexAtBirth, setSexAtBirth] = useState(record.sexAtBirth ?? '');
  const [referralSource, setReferralSource] = useState(record.referralSource ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changed(): UpdateClientBody {
    const body: UpdateClientBody = {};
    const given = givenName.trim();
    const family = familyName.trim();
    if (given !== record.givenName) body.givenName = given;
    if (family !== record.familyName) body.familyName = family;
    const dob = dateOfBirth || null;
    if (dob !== (record.dateOfBirth ?? null)) body.dateOfBirth = dob;
    const sex = (sexAtBirth || null) as UpdateClientBody['sexAtBirth'];
    if (sex !== (record.sexAtBirth ?? null)) body.sexAtBirth = sex;
    const referral = referralSource.trim() || null;
    if (referral !== (record.referralSource ?? null)) body.referralSource = referral;
    return body;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!givenName.trim()) next.givenName = 'A given name is needed.';
    if (!familyName.trim()) next.familyName = 'A family name is needed.';
    if (dateOfBirth && !isPastDate(dateOfBirth, practiceToday())) {
      next.dateOfBirth = FUTURE_DATE_ERROR;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Same convention as EnrolmentWizard.tsx's own call (lines 180-188): `order` is
      // the element ids in the order they appear on the form, `wrong` maps an id to
      // its message only when that field is actually wrong.
      focusFirstError(
        IDENTITY_FIELD_ORDER,
        Object.fromEntries(
          Object.entries(next).map(([key, value]) => [FIELD_INPUT_ID[key as keyof Errors], value]),
        ),
      );
      return;
    }
    const body = changed();
    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 200) {
        onSaved();
        return;
      }
      setFormError(res.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="drawer__form" onSubmit={(e) => void submit(e)}>
      <FieldRow>
        <Field
          id="identity-given-name"
          label="Given name"
          value={givenName}
          onChange={(e) => setGivenName(e.target.value)}
          error={errors.givenName}
        />
        <Field
          id="identity-family-name"
          label="Family name"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          error={errors.familyName}
        />
      </FieldRow>
      <Field
        id="identity-dob"
        label="Date of birth"
        type="date"
        value={dateOfBirth}
        onChange={(e) => setDateOfBirth(e.target.value)}
        hint="Needed before this client can be activated."
        error={errors.dateOfBirth}
      />
      <Select
        id="identity-sex"
        label="Sex at birth"
        value={sexAtBirth}
        onChange={(e) => setSexAtBirth(e.target.value)}
      >
        <option value="">Not recorded</option>
        <option value="female">Female</option>
        <option value="male">Male</option>
        <option value="unknown">Unknown</option>
      </Select>
      <Field
        id="identity-referral"
        label="Referral (optional)"
        value={referralSource}
        onChange={(e) => setReferralSource(e.target.value)}
        maxLength={200}
      />
      {formError ? <Note tone="critical">{formError}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
