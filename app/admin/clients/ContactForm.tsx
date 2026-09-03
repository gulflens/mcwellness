import { useState, type FormEvent } from 'react';
import { validateEmiratesId } from '@domain/client';
import { toLatinDigits } from '../../api/clients/emirates-id-shape';
import { RELATIONSHIPS, type Contact, IdResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { Checkbox } from './FormAtoms';

/** `relationship`'s plain-language labels, matching ClientsPage.tsx's own list. */
const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

type FieldErrors = { relationship?: string; phone?: string; emiratesId?: string };

const GENERIC_ERROR = 'This contact could not be saved. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to change this client's contacts.";
const IN_USE_ERROR = 'This Emirates ID is already on file.';
const UNAVAILABLE_ERROR =
  'The identity service is not configured yet, so an Emirates ID cannot be saved right now.';

/**
 * Add or edit one contact (docs/SPEC/client-record.md section 4.2), reused
 * by the drawer's Contacts tab and the enrolment wizard's contacts step.
 * Never shows a captured Emirates ID back — only `hasEmiratesId` says one is
 * on file (record.ts's own rule) — so editing always starts from a blank
 * identity field: leaving it blank keeps whatever is already sealed, typing
 * a new one replaces it, and "Remove" (edit mode only, when one is on file)
 * clears it in its own, separate request.
 */
export function ContactForm({
  clientId,
  contact,
  onSaved,
  onCancel,
}: {
  clientId: string;
  /** Absent: create a new contact. Present: edit this one. */
  contact?: Contact;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const editing = contact !== undefined;
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [isLegalGuardian, setIsLegalGuardian] = useState(contact?.isLegalGuardian ?? false);
  const [canConsent, setCanConsent] = useState(contact?.canConsent ?? false);
  const [canReceiveReports, setCanReceiveReports] = useState(contact?.canReceiveReports ?? true);
  const [canPay, setCanPay] = useState(contact?.canPay ?? false);
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [whatsappOptIn, setWhatsappOptIn] = useState(contact?.whatsappOptIn ?? false);
  const [emiratesId, setEmiratesId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clear(key: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setFormError(null);
  }

  async function handleErrorResponse(res: Response): Promise<void> {
    if (res.status === 403) {
      setFormError(FORBIDDEN_ERROR);
      return;
    }
    if (res.status === 409) {
      setFieldErrors((prev) => ({ ...prev, emiratesId: IN_USE_ERROR }));
      return;
    }
    if (res.status === 503) {
      setFieldErrors((prev) => ({ ...prev, emiratesId: UNAVAILABLE_ERROR }));
      return;
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === 'invalid_emirates_id') {
        setFieldErrors((prev) => ({
          ...prev,
          emiratesId: 'Enter fifteen digits starting 784, or leave this blank.',
        }));
        return;
      }
      setFormError(GENERIC_ERROR);
      return;
    }
    setFormError(GENERIC_ERROR);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const errors: FieldErrors = {};
    if (!relationship) errors.relationship = 'Choose how this person relates to the client.';
    // Folded to Latin digits before it is judged or sent, so an Arabic keyboard
    // captures an identity number as readily as it searches for one
    // (app/api/clients/emirates-id-shape.ts). The server normalises again.
    const trimmedEmiratesId = toLatinDigits(emiratesId.trim());
    if (trimmedEmiratesId && !validateEmiratesId(trimmedEmiratesId).ok) {
      errors.emiratesId = 'Enter fifteen digits starting 784, or leave this blank.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Create and edit do not speak the same dialect about an empty field: the create
    // body takes phone and email as optional (absent means "not given"), the edit body
    // as nullable (null means "clear what is there"). Sending null to create is a 400,
    // so a blank field is omitted there and cleared here.
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const contactDetails = editing
      ? { phone: trimmedPhone || null, email: trimmedEmail || null }
      : {
          ...(trimmedPhone ? { phone: trimmedPhone } : {}),
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
        };

    setBusy(true);
    try {
      const res = await apiFetch(
        editing
          ? `/api/clients/${clientId}/contacts/${contact.id}`
          : `/api/clients/${clientId}/contacts`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            relationship,
            isLegalGuardian,
            canConsent,
            canReceiveReports,
            canPay,
            ...contactDetails,
            whatsappOptIn,
            ...(trimmedEmiratesId ? { emiratesId: trimmedEmiratesId } : {}),
          }),
        },
      );
      if (res.status === 200 || res.status === 201) {
        IdResponse.parse(await res.json());
        onSaved();
        return;
      }
      await handleErrorResponse(res);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function removeEmiratesId() {
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emiratesId: null }),
      });
      if (res.status === 200) {
        onSaved();
        return;
      }
      await handleErrorResponse(res);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="drawer__form" onSubmit={(e) => void submit(e)}>
      <Select
        id="contact-relationship"
        label="Relationship to the client"
        value={relationship}
        onChange={(e) => {
          setRelationship(e.target.value);
          clear('relationship');
        }}
        error={fieldErrors.relationship}
      >
        <option value="">Choose a relationship</option>
        {RELATIONSHIPS.map((r) => (
          <option key={r} value={r}>
            {RELATIONSHIP_LABELS[r]}
          </option>
        ))}
      </Select>
      <Field
        id="contact-phone"
        label="Phone"
        type="tel"
        placeholder="+971500001234"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Field
        id="contact-email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="contact-emirates-id"
        label="Emirates ID (optional)"
        type="text"
        placeholder="784-1900-1234567-1"
        value={emiratesId}
        onChange={(e) => {
          setEmiratesId(e.target.value);
          clear('emiratesId');
        }}
        hint={
          editing && contact?.hasEmiratesId
            ? 'One is already on file. Leave blank to keep it, or type a new one to replace it.'
            : 'Only when the practice must verify this adult. Never required.'
        }
        error={fieldErrors.emiratesId}
      />
      {editing && contact?.hasEmiratesId ? (
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={() => void removeEmiratesId()}
        >
          Remove identity number on file
        </Button>
      ) : null}
      <Checkbox
        id="contact-legal-guardian"
        label="Legal guardian"
        checked={isLegalGuardian}
        onChange={setIsLegalGuardian}
      />
      <Checkbox
        id="contact-can-consent"
        label="May give consent"
        checked={canConsent}
        onChange={setCanConsent}
      />
      <Checkbox
        id="contact-can-receive-reports"
        label="Receives reports"
        checked={canReceiveReports}
        onChange={setCanReceiveReports}
      />
      <Checkbox
        id="contact-can-pay"
        label="Pays for sessions"
        checked={canPay}
        onChange={setCanPay}
      />
      <Checkbox
        id="contact-whatsapp"
        label="WhatsApp messages welcome"
        checked={whatsappOptIn}
        onChange={setWhatsappOptIn}
      />
      {formError ? <Note tone="critical">{formError}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save contact' : 'Add contact'}
        </Button>
      </div>
    </form>
  );
}
