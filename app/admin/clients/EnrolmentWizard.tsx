import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { validateEmiratesId } from '@domain/client';
import { RELATIONSHIPS, type CreateClientResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { ActivationSummary } from './ActivationSummary';
import { canActivate, practiceToday, toActivationRecord } from './activation';
import { Checkbox } from './FormAtoms';
import { ConsentTab } from './ConsentTab';
import { ContactsTab } from './ContactsTab';
import { GoalsTab } from './GoalsTab';
import { LocationsTab } from './LocationsTab';
import { useClientRecord } from './useClientRecord';

const STEPS = ['identity', 'contacts', 'location', 'goals', 'consent', 'summary'] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = {
  identity: 'Identity',
  contacts: 'Contacts',
  location: 'Location',
  goals: 'Goals',
  consent: 'Consent',
  summary: 'Summary',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

type IdentityFieldErrors = {
  givenName?: string;
  familyName?: string;
  relationship?: string;
  phone?: string;
  emiratesId?: string;
};

const GENERIC_ERROR = 'This could not be saved. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to enrol a client.";

/**
 * The enrolment wizard (docs/SPEC/client-record.md section 4.3 — the
 * operator's name for it is "enrolment", never "intake"): identity,
 * contacts, location, goals, consent, summary. It saves as a `lead` at the
 * end of the identity step, and every later step writes through the
 * record's own routes — reusing the same tabs the drawer shows, so leaving
 * at any step leaves a real lead with whatever it already holds. Rendered
 * in the drawer, never a modal, never its own route
 * (docs/DESIGN-BRIEF.md; docs/CHANGE-REQUESTS/client-record-01.md CR-04,
 * which the shell's existing default route to /admin/clients already
 * resolves).
 */
export function EnrolmentWizard({ onDone }: { onDone: () => void }) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<Step>('identity');
  const [furthestStep, setFurthestStep] = useState<Step>('identity');
  const [created, setCreated] = useState<CreateClientResponse | null>(null);
  const { state, refetch } = useClientRecord(created?.id ?? null);

  // Identity step's own fields.
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [givenNameAr, setGivenNameAr] = useState('');
  const [familyNameAr, setFamilyNameAr] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isLegalGuardian, setIsLegalGuardian] = useState(false);
  const [canConsent, setCanConsent] = useState(false);
  const [emiratesId, setEmiratesId] = useState('');
  const [identityErrors, setIdentityErrors] = useState<IdentityFieldErrors>({});
  const [identityFormError, setIdentityFormError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  /** The one way the step moves, so the high-water mark can never drift from it. */
  function goTo(next: Step) {
    setStep(next);
    setFurthestStep((seen) => (STEPS.indexOf(next) > STEPS.indexOf(seen) ? next : seen));
  }

  function clearIdentityError(key: keyof IdentityFieldErrors) {
    setIdentityErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setIdentityFormError(null);
  }

  async function submitIdentity(event: FormEvent) {
    event.preventDefault();
    setIdentityFormError(null);
    const errors: IdentityFieldErrors = {};
    if (!givenName.trim()) errors.givenName = "Enter the client's given name.";
    if (!familyName.trim()) errors.familyName = "Enter the client's family name.";
    if (!relationship) errors.relationship = "Choose the contact's relationship to the client.";
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) errors.phone = 'Enter a phone number, e.g. +971500001234.';
    const trimmedEmiratesId = emiratesId.trim();
    if (trimmedEmiratesId && !validateEmiratesId(trimmedEmiratesId).ok) {
      errors.emiratesId = 'Enter fifteen digits starting 784, or leave this blank.';
    }
    setIdentityErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const res = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          givenName: givenName.trim(),
          familyName: familyName.trim(),
          ...(givenNameAr.trim() ? { givenNameAr: givenNameAr.trim() } : {}),
          ...(familyNameAr.trim() ? { familyNameAr: familyNameAr.trim() } : {}),
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(referralSource.trim() ? { referralSource: referralSource.trim() } : {}),
          contact: {
            relationship,
            phone: trimmedPhone,
            ...(email.trim() ? { email: email.trim() } : {}),
            isLegalGuardian,
            canConsent,
            ...(trimmedEmiratesId ? { emiratesId: trimmedEmiratesId } : {}),
          },
        }),
      });
      if (res.status === 201) {
        const body = (await res.json()) as CreateClientResponse;
        setCreated(body);
        goTo('contacts');
        return;
      }
      if (res.status === 403) {
        setIdentityFormError(FORBIDDEN_ERROR);
        return;
      }
      if (res.status === 409) {
        setIdentityErrors((prev) => ({
          ...prev,
          emiratesId: 'This Emirates ID is already on file.',
        }));
        return;
      }
      if (res.status === 503) {
        setIdentityErrors((prev) => ({
          ...prev,
          emiratesId:
            'The identity service is not configured yet, so an Emirates ID cannot be saved right now.',
        }));
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'invalid_emirates_id') {
          setIdentityErrors((prev) => ({
            ...prev,
            emiratesId: 'Enter fifteen digits starting 784, or leave this blank.',
          }));
          return;
        }
      }
      setIdentityFormError(GENERIC_ERROR);
    } catch {
      setIdentityFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const record = state.kind === 'ready' ? state.record : null;
  const gate = useMemo(
    () => (record ? canActivate(toActivationRecord(record), practiceToday()) : null),
    [record],
  );

  async function activate() {
    if (!created) return;
    setBusy(true);
    setActivationError(null);
    try {
      const res = await apiFetch(`/api/clients/${created.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'active' }),
      });
      if (res.status === 200) {
        onDone();
        return;
      }
      setActivationError(res.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR);
    } catch {
      setActivationError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  // The furthest step reached, not the current one: stepping back to Contacts must not
  // put Goals out of reach again, since the lead already holds whatever was saved there.
  const furthest = Math.max(stepIndex, STEPS.indexOf(furthestStep));
  // Never back past 'contacts' (index 1): identity is a one-time, submit-only step in
  // this pull request, matching the breadcrumb's own floor above.
  const canGoBack = stepIndex > 1;
  const canGoNext = step !== 'identity' && step !== 'summary' && stepIndex < STEPS.length - 1;

  return (
    <aside className="drawer" role="dialog" aria-labelledby="enrolment-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="enrolment-title">Enrolment</h2>
          {created ? <p className="small muted numeric">{created.mrn}</p> : null}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onDone}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <ol className="wizard__steps small">
          {STEPS.map((s, index) => {
            // Identity is a one-time, submit-only step in this pull request (no route
            // yet edits it from here): once it has created the lead, index 0 is a plain
            // label, not a step to revisit. Every later step is reachable once reached.
            const reachable = created !== null && index > 0 && index <= furthest;
            return (
              <li
                key={s}
                className={[
                  'wizard__step-name',
                  s === step ? 'wizard__step-name--current' : null,
                  index > furthest ? 'wizard__step-name--locked' : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {reachable ? (
                  <button type="button" className="link" onClick={() => goTo(s)}>
                    {STEP_LABELS[s]}
                  </button>
                ) : (
                  STEP_LABELS[s]
                )}
              </li>
            );
          })}
        </ol>

        {step === 'identity' ? (
          <form className="drawer__form" onSubmit={(e) => void submitIdentity(e)}>
            <Field
              id="wizard-given-name"
              label="Given name"
              value={givenName}
              onChange={(e) => {
                setGivenName(e.target.value);
                clearIdentityError('givenName');
              }}
              error={identityErrors.givenName}
            />
            <Field
              id="wizard-family-name"
              label="Family name"
              value={familyName}
              onChange={(e) => {
                setFamilyName(e.target.value);
                clearIdentityError('familyName');
              }}
              error={identityErrors.familyName}
            />
            <Field
              id="wizard-given-name-ar"
              label="Given name (Arabic, optional)"
              lang="ar"
              dir="rtl"
              value={givenNameAr}
              onChange={(e) => setGivenNameAr(e.target.value)}
            />
            <Field
              id="wizard-family-name-ar"
              label="Family name (Arabic, optional)"
              lang="ar"
              dir="rtl"
              value={familyNameAr}
              onChange={(e) => setFamilyNameAr(e.target.value)}
            />
            <Field
              id="wizard-dob"
              label="Date of birth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              hint="Needed before this client can be activated."
            />
            <Field
              id="wizard-referral"
              label="Referral (optional)"
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
            />

            <h3 className="drawer__section">Primary contact</h3>
            <Select
              id="wizard-relationship"
              label="Relationship to the client"
              value={relationship}
              onChange={(e) => {
                setRelationship(e.target.value);
                clearIdentityError('relationship');
              }}
              error={identityErrors.relationship}
            >
              <option value="">Choose a relationship</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </Select>
            <Field
              id="wizard-phone"
              label="Phone"
              type="tel"
              placeholder="+971500001234"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clearIdentityError('phone');
              }}
              error={identityErrors.phone}
            />
            <Field
              id="wizard-email"
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              id="wizard-emirates-id"
              label="Emirates ID (optional)"
              placeholder="784-1900-1234567-1"
              value={emiratesId}
              onChange={(e) => {
                setEmiratesId(e.target.value);
                clearIdentityError('emiratesId');
              }}
              hint="Only when the practice must verify this adult. Never required."
              error={identityErrors.emiratesId}
            />
            <Checkbox
              id="wizard-legal-guardian"
              label="Legal guardian"
              checked={isLegalGuardian}
              onChange={setIsLegalGuardian}
            />
            <Checkbox
              id="wizard-can-consent"
              label="May give consent"
              checked={canConsent}
              onChange={setCanConsent}
            />

            {identityFormError ? <Note tone="critical">{identityFormError}</Note> : null}
            <div className="drawer__actions">
              <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save and continue'}
              </Button>
            </div>
          </form>
        ) : null}

        {step !== 'identity' && created ? (
          <div className="wizard__step-body">
            {state.kind === 'loading' ? <Note>Loading the record.</Note> : null}
            {state.kind === 'error' ? (
              <Note tone="critical">The record could not be loaded. Try again.</Note>
            ) : null}
            {record ? (
              <>
                {step === 'contacts' ? (
                  <ContactsTab
                    clientId={created.id}
                    record={record}
                    onChanged={() => void refetch()}
                  />
                ) : null}
                {step === 'location' ? (
                  <LocationsTab
                    clientId={created.id}
                    record={record}
                    onChanged={() => void refetch()}
                  />
                ) : null}
                {step === 'goals' ? (
                  <GoalsTab
                    clientId={created.id}
                    record={record}
                    onChanged={() => void refetch()}
                  />
                ) : null}
                {step === 'consent' ? <ConsentTab record={record} /> : null}
                {step === 'summary' && gate ? (
                  <div className="tab-section">
                    <h3 className="drawer__section">
                      {gate.ok ? 'Ready to activate' : 'Still to complete'}
                    </h3>
                    <ActivationSummary missing={gate.missing} heading="Still needed" />
                    {activationError ? <Note tone="critical">{activationError}</Note> : null}
                    {gate.ok ? (
                      <div className="drawer__actions">
                        <Button variant="primary" disabled={busy} onClick={() => void activate()}>
                          {busy ? 'Activating…' : 'Activate'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* Every step, not only the last, says what is still missing: the person
                    filling this in should never have to reach the end to learn that a
                    date of birth was the thing standing in the way (task brief item 2). */}
                {step !== 'summary' && gate ? <ActivationSummary missing={gate.missing} /> : null}
              </>
            ) : null}

            <div className="wizard__nav">
              <Button
                variant="secondary"
                disabled={!canGoBack}
                onClick={() => goTo(STEPS[stepIndex - 1] ?? 'identity')}
              >
                Back
              </Button>
              {canGoNext ? (
                <Button variant="secondary" onClick={() => goTo(STEPS[stepIndex + 1] ?? 'summary')}>
                  Next
                </Button>
              ) : null}
              {step !== 'summary' ? (
                <Button variant="quiet" onClick={onDone}>
                  Finish later
                </Button>
              ) : (
                <Button variant="quiet" onClick={onDone}>
                  Close
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
