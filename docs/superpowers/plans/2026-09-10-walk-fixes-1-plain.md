# The walk's fixes, part one: the plain fixes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mend the nine things the 10 September walk found that need no decision: identity edit, the primary-location link, a date in the booking panel, "Moved to" on a rescheduled row, a quieter timeline, and six small wording and feedback fixes.

**Architecture:** Every change lands on existing screens and routes; one new component (`IdentityForm`), one new migration (963, a backfill), one new response field (`movedTo`), one new timeline field (`count`). Business rules stay in `domain/`, routes stay thin, screens submit only what changed.

**Tech Stack:** TypeScript, React 19, Hono, PostgreSQL (Supabase image), Vitest with jsdom for components and the local database for routes and migrations.

**Spec:** `docs/superpowers/specs/2026-09-10-walk-fixes-design.md`, section "Pull request 1".

## Global Constraints

- Branch `trunk-round-43`, worktree `/Volumes/Storage/McWellness/mcwellness-accounting` (database port 5443, API 3011, web 5184). This is a trunk round: shared-zone files may be edited, and the round's note goes in `docs/CHANGE-REQUESTS/trunk-notes.md` under "Round 43".
- Never write real or realistic personal data anywhere; tests use the synthetic names already in `tests/db/helpers.ts` and the seed's style ("Synthetic Studio", "Alpha").
- No hex colours in components; colour and spacing come from `app/shell/tokens.css`. No ALL-CAPS labels, no arrows in button text.
- Console copy is English only (`tests/lint/console-is-english.test.ts` guards it).
- Migration files start with the file name and a `-- Needs:` line, as `db/migrations/962_erasure_guard_admits_the_sweep.sql` does; `pnpm audit:migrations` checks the range.
- Every task ends with `pnpm test` green for the files it touched; the round ends with `pnpm verify` and `pnpm test:db` green.
- Commit after every task, conventional message, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run the sweep `.claude/hooks/no-real-identifiers.sh` mentally on fixtures: no real names, phones, or identity numbers.

---

### Task 1: A self contact answers to the client's own name

**Files:**
- Modify: `app/admin/clients/contactName.tsx`
- Modify: `app/admin/clients/RecordConsentForm.tsx:350` (the "Given by" option)
- Modify: `app/admin/clients/OverviewTab.tsx:133-141` (key contacts)
- Test: `app/admin/clients/contactName.test.ts` (new)

**Interfaces:**
- Produces: `contactDisplayName(contact, client): string` where `client` is `{ givenName: string; familyName: string }`. Returns the contact's own name when it has one; for `relationship === 'self'` with no name, the client's name; otherwise the relationship label.

- [ ] **Step 1: Write the failing test**

```ts
// app/admin/clients/contactName.test.ts
import { describe, expect, it } from 'vitest';
import { contactDisplayName } from './contactName';

const client = { givenName: 'Alpha', familyName: 'Synthetic' };

describe('contactDisplayName', () => {
  it('uses the contact’s own name when it has one', () => {
    expect(
      contactDisplayName(
        { givenName: 'Beta', familyName: 'Synthetic', relationship: 'mother' },
        client,
      ),
    ).toBe('Beta Synthetic');
  });

  it('is the client’s own name for a self contact with no name of its own', () => {
    expect(
      contactDisplayName({ givenName: null, familyName: null, relationship: 'self' }, client),
    ).toBe('Alpha Synthetic');
  });

  it('falls back to the relationship for any other unnamed contact', () => {
    expect(
      contactDisplayName({ givenName: null, familyName: null, relationship: 'guardian' }, client),
    ).toBe('Guardian');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/contactName.test.ts`
Expected: FAIL, `contactDisplayName` is not exported.

- [ ] **Step 3: Add the helper**

Append to `app/admin/clients/contactName.tsx`:

```ts
/**
 * The name a screen shows for a contact, with the one fallback a `self` contact
 * needs: the wizard files the client's own phone under a contact with no name
 * of its own, so "Unnamed contact — self" on a consent was the client being
 * asked to sign as nobody (the walk of 10 September). The client's own name is
 * the honest label; any other unnamed contact keeps the relationship.
 */
export function contactDisplayName(
  contact: Pick<Contact, 'givenName' | 'familyName' | 'relationship'>,
  client: { givenName: string; familyName: string },
): string {
  const own = contactName(contact);
  if (own) return own;
  if (contact.relationship === 'self') {
    return [client.givenName, client.familyName].filter(Boolean).join(' ').trim();
  }
  return relationshipLabel(contact.relationship);
}
```

- [ ] **Step 4: Use it on the consent form and the overview**

In `app/admin/clients/RecordConsentForm.tsx` the option currently reads
`{contactName(contact) ?? 'Unnamed contact'} —{' '}`. Replace it with
`{contactDisplayName(contact, record)} —{' '}` (the form already receives `record`;
its `givenName` and `familyName` are the client's). Add `contactDisplayName` to the
import from `./contactName`.

In `app/admin/clients/OverviewTab.tsx` replace the key-contacts `<span>` body (lines
136–138) with:

```tsx
{`${contactDisplayName(contact, record)} (${(RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship).toLowerCase()})`}
```

and add `contactDisplayName` to the import.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run app/admin/clients/contactName.test.ts app/admin/clients/ConsentCapture.test.tsx app/admin/clients/ClientDrawer.test.tsx`
Expected: PASS. If `ConsentCapture.test.tsx` asserted the old "Unnamed contact" text, update that assertion to the client's name.

- [ ] **Step 6: Commit**

```bash
git add app/admin/clients/contactName.tsx app/admin/clients/contactName.test.ts app/admin/clients/RecordConsentForm.tsx app/admin/clients/OverviewTab.tsx
git commit -m "fix(clients): a self contact is shown under the client's own name"
```

---

### Task 2: Example values leave the boxes; the payment error is announced

**Files:**
- Modify: `app/admin/clients/ContactForm.tsx:301-334`
- Modify: `app/admin/clients/EnrolmentWizard.tsx` (the phone and Emirates ID fields, around lines 424–458)
- Modify: `app/admin/clients/LocationForm.tsx:172-182`
- Modify: `app/admin/billing/PaymentDrawer.tsx:203-215`
- Modify: `app/shell/components/Controls.tsx` (the `Field` error paragraph)
- Test: `app/admin/clients/ContactForm.test.tsx`, `app/shell/components/Controls.test.tsx` (create if absent)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

Add to `app/admin/clients/ContactForm.test.tsx` inside `describe('ContactForm')`:

```tsx
  it('shows example values as hints, never as grey text inside the box', () => {
    mount();
    const phone = screen.getByLabelText('Phone (optional)') as HTMLInputElement;
    const emiratesId = screen.getByLabelText('Emirates ID (optional)') as HTMLInputElement;
    expect(phone.placeholder).toBe('');
    expect(emiratesId.placeholder).toBe('');
    expect(screen.getByText(/for example 784-1900-1234567-1/i)).toBeTruthy();
  });
```

Create `app/shell/components/Controls.test.tsx` (or add to it if it exists):

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from './Controls';

afterEach(cleanup);

describe('Field', () => {
  it('announces its error so a refused submit is heard, not only seen', () => {
    render(
      <Field id="f" label="Reference" value="a,b" onChange={() => undefined} error="Letters only." />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Letters only.');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run app/admin/clients/ContactForm.test.tsx app/shell/components/Controls.test.tsx`
Expected: FAIL on the placeholder assertions and on `getByRole('alert')`.

- [ ] **Step 3: Move the examples into hints**

`app/admin/clients/ContactForm.tsx`: delete `placeholder="+971500001234"` from the phone
field (its `hint={PHONE_HINT}` already says "Include the country code, for example
+971 50 000 1234"). On the Emirates ID field delete `placeholder="784-1900-1234567-1"` and set
`hint="For example 784-1900-1234567-1. Only when the practice must verify this adult. Never required."`
(keep whatever the existing hint says after the example; read the file for the current text).

`app/admin/clients/EnrolmentWizard.tsx`: the same two deletions on `wizard-phone` and
`wizard-emirates-id`, and the same hint on the Emirates ID field.

`app/admin/clients/LocationForm.tsx`: delete `placeholder="1234567890"` on `location-makani`
and prepend the example to its hint: `hint="Ten digits, for example 1234567890. Find it on the building's Makani plate or in the Dubai Municipality app."`

- [ ] **Step 4: Announce the field error**

In `app/shell/components/Controls.tsx`, in `Field`, find the element that renders `error`
(a `<p>` with the error class). Give it `role="alert"`. Check `PasswordField` and `Select`
render their errors the same way; if they do, give those `role="alert"` too. This makes the
payment reference message, and every other inline refusal, announced on submit.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run app/admin/clients app/shell/components app/admin/billing`
Expected: PASS. A snapshot or text assertion in another test may reference the old hint text; update it.

- [ ] **Step 6: Commit**

```bash
git add app/admin/clients/ContactForm.tsx app/admin/clients/ContactForm.test.tsx app/admin/clients/EnrolmentWizard.tsx app/admin/clients/LocationForm.tsx app/shell/components/Controls.tsx app/shell/components/Controls.test.tsx
git commit -m "fix(console): examples live in hints, and a field's error is announced"
```

---

### Task 3: The pin is the verification, and the screen says so

**Files:**
- Modify: `app/admin/clients/activation.ts:48`
- Modify: `app/admin/clients/LocationsTab.tsx:105` (button label) and its status after a save
- Modify: `app/admin/clients/VerifyPinForm.tsx:63,83`
- Test: `app/admin/clients/ClientDrawer.test.tsx` or `app/admin/clients/LocationsTab.test.tsx` (whichever exists; create `LocationsTab.test.tsx` if neither covers the tab)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

In the locations test file, mount `LocationsTab` with a record holding one location (copy the
record fixture from `ClientDrawer.test.tsx`), then:

```tsx
  it('calls the pin what it is: a pin to check, and says when it is saved', async () => {
    const { calls } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Check the pin' }));
    expect(screen.getByRole('heading', { name: 'Where the practitioner should arrive' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save pin' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/verify-pin'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Pin saved.'));
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/LocationsTab.test.tsx`
Expected: FAIL, no button named "Check the pin".

- [ ] **Step 3: Rename and announce**

- `app/admin/clients/activation.ts:48`: `verified_location: 'A location with its pin set',`.
- `app/admin/clients/LocationsTab.tsx:105`: the button text `Verify pin` becomes `Check the pin`.
  Where the tab handles `onSaved` from `VerifyPinForm`, keep a `pinSaved` state
  (`useState<string | null>(null)`) set to `'Pin saved.'` on save and cleared when the form
  opens again, and render `<div role="status" className="small muted">{pinSaved}</div>` under
  the location card. Read the file for where `VerifyPinForm` is rendered and mirror how the
  tab already shows other notices.
- `app/admin/clients/VerifyPinForm.tsx`: the intro paragraph under the heading currently says
  "Check it on the map before saving." Change it to "Move it to the door the practitioner
  should knock on." (the map itself arrives in part two).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/admin/clients domain/client`
Expected: PASS. `activation.test.ts` or `ActivationSummary` tests may assert the old label; update them to "A location with its pin set".

- [ ] **Step 5: Commit**

```bash
git add app/admin/clients/activation.ts app/admin/clients/LocationsTab.tsx app/admin/clients/LocationsTab.test.tsx app/admin/clients/VerifyPinForm.tsx
git commit -m "fix(clients): the pin is the verification, and saving it says so"
```

---

### Task 4: Edit a client's identity

**Files:**
- Create: `app/admin/clients/IdentityForm.tsx`
- Modify: `app/admin/clients/OverviewTab.tsx` (an Edit button above the facts; the form in place of the facts while editing)
- Modify: `app/admin/clients/EnrolmentWizard.tsx:311-360, 484-486` (the Identity tab becomes a button once `created`; the step body shows `IdentityForm`)
- Test: `app/admin/clients/IdentityForm.test.tsx` (new)

**Interfaces:**
- Consumes: `UpdateClientBody` from `app/api/clients/record-schema.ts` (fields `givenName`, `familyName`, `givenNameAr`, `familyNameAr`, `dateOfBirth`, `sexAtBirth`, `referralSource`, all optional), `PATCH /api/clients/:id` which returns 200, 403 or 400.
- Produces: `IdentityForm({ clientId, record, onSaved, onCancel })` where `record` is `ClientRecordResponse`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/admin/clients/IdentityForm.test.tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { UpdateClientBody, type ClientRecordResponse } from '../../api/clients/record-schema';
import { IdentityForm } from './IdentityForm';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const CLIENT_ID = '00000008-0000-4000-8000-0000000000c1';

// Only the fields the form reads; the rest of the record is not this form's business.
const record = {
  id: CLIENT_ID,
  mrn: 'MW-000099',
  givenName: 'Alpha',
  familyName: 'Synthetic',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: null,
  sexAtBirth: null,
  referralSource: null,
  status: 'lead',
} as unknown as ClientRecordResponse;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const onSaved = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return json({ id: CLIENT_ID }, status);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <IdentityForm clientId={CLIENT_ID} record={record} onSaved={onSaved} onCancel={vi.fn()} />
    </AuthProviderBoundary>,
  );
  return { calls, onSaved };
}

describe('IdentityForm', () => {
  it('sends only what changed, parsed by the route’s own schema', async () => {
    const { calls, onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-03-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]?.url).toBe(`/api/clients/${CLIENT_ID}`);
    expect(calls[0]?.init?.method).toBe('PATCH');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({ dateOfBirth: '1990-03-12' });
    expect(UpdateClientBody.safeParse(body).success).toBe(true);
  });

  it('refuses a date of birth in the future before sending anything', async () => {
    const { calls } = mount();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('says so when the person may not edit this record', async () => {
    mount(403);
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Alef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/IdentityForm.test.tsx`
Expected: FAIL, module `./IdentityForm` not found.

- [ ] **Step 3: Write the form**

```tsx
// app/admin/clients/IdentityForm.tsx
import { useState, type FormEvent } from 'react';
import type { ClientRecordResponse, UpdateClientBody } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { FieldRow } from './FormAtoms';
import { practiceToday } from './activation';
import { focusFirstError, isPastDate } from './formRules';

const FORBIDDEN_ERROR = "You don't have permission to edit this record.";
const GENERIC_ERROR = 'The change could not be saved. Try again.';
const FUTURE_DATE_ERROR = 'A date of birth is in the past.';

type Errors = { givenName?: string; familyName?: string; dateOfBirth?: string };

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
  const [givenNameAr, setGivenNameAr] = useState(record.givenNameAr ?? '');
  const [familyNameAr, setFamilyNameAr] = useState(record.familyNameAr ?? '');
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
    const givenAr = givenNameAr.trim() || null;
    const familyAr = familyNameAr.trim() || null;
    if (givenAr !== (record.givenNameAr ?? null)) body.givenNameAr = givenAr;
    if (familyAr !== (record.familyNameAr ?? null)) body.familyNameAr = familyAr;
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
      focusFirstError(['givenName', 'familyName', 'dateOfBirth'], {
        givenName: next.givenName ? 'identity-given-name' : undefined,
        familyName: next.familyName ? 'identity-family-name' : undefined,
        dateOfBirth: next.dateOfBirth ? 'identity-dob' : undefined,
      } as Record<string, string | undefined>);
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
      <FieldRow>
        <Field
          id="identity-given-name-ar"
          label="Given name in Arabic (optional)"
          value={givenNameAr}
          onChange={(e) => setGivenNameAr(e.target.value)}
          dir="rtl"
        />
        <Field
          id="identity-family-name-ar"
          label="Family name in Arabic (optional)"
          value={familyNameAr}
          onChange={(e) => setFamilyNameAr(e.target.value)}
          dir="rtl"
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
```

Check `app/admin/clients/formRules.ts` exports `isPastDate` and `focusFirstError` (the wizard
imports both; if `focusFirstError`'s signature differs, call it the way the wizard does at
`EnrolmentWizard.tsx:180-188`). If `Field` has no `dir` prop, add `dir?: 'rtl' | 'ltr'` to it
in `Controls.tsx` and pass it to the input. If `Note` uses `tone="critical"` to render
`role="alert"`, the test's `findByRole('alert')` finds it; if not, give the critical `Note`
`role="alert"` in `Controls.tsx`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/admin/clients/IdentityForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Offer it on the Overview**

In `app/admin/clients/OverviewTab.tsx` add `const [editing, setEditing] = useState(false);` and
import `IdentityForm`. Replace the `<dl className="record-facts">` block's first four rows
(date of birth, sex, preferred language, referral) as follows: keep the rows, drop the
"Preferred language" row entirely (the client table has no such column; the "English" it showed
was a default), and above the `<dl>` render:

```tsx
{mayWrite && record.status !== 'erased' && !editing ? (
  <div className="drawer__actions">
    <Button variant="secondary" onClick={() => setEditing(true)}>
      Edit
    </Button>
  </div>
) : null}
{editing ? (
  <IdentityForm
    clientId={record.id}
    record={record}
    onSaved={() => {
      setEditing(false);
      onChanged();
    }}
    onCancel={() => setEditing(false)}
  />
) : (
  <dl className="record-facts">…the existing rows, minus preferred language…</dl>
)}
```

Also show the name rows the form can change, so the edit is visible where it lands: add a
first `record-facts__row` with `<dt>Name in Arabic</dt>` and
`<dd>{[record.givenNameAr, record.familyNameAr].filter(Boolean).join(' ') || 'Not recorded'}</dd>`.

- [ ] **Step 6: Let the wizard revisit identity**

In `app/admin/clients/EnrolmentWizard.tsx`:
- Line 339: `const reachable = created !== null && index <= furthest;` (drop `index > 0`).
- Line 313: `const canGoBack = stepIndex > 0;`
- Line 364: the identity form renders only while `!created`: change the condition to
  `step === 'identity' && !created`.
- After the existing `{step !== 'identity' && created ? (` block, add a sibling block:

```tsx
{step === 'identity' && created && record ? (
  <div className="wizard__step-body">
    <IdentityForm
      clientId={created.id}
      record={record}
      onSaved={() => {
        void refetch();
        goTo('contacts');
      }}
      onCancel={() => goTo('contacts')}
    />
    {gate ? <ActivationSummary missing={gate.missing} /> : null}
  </div>
) : null}
```

Delete the comment at lines 336–338 and 311–312 that say identity is one-time.

- [ ] **Step 7: Run the wider tests**

Run: `pnpm vitest run app/admin/clients`
Expected: PASS. `EnrolmentWizard.test.tsx`, if it asserts "Identity" is plain text after creation, now expects a button.

- [ ] **Step 8: Commit**

```bash
git add app/admin/clients/IdentityForm.tsx app/admin/clients/IdentityForm.test.tsx app/admin/clients/OverviewTab.tsx app/admin/clients/EnrolmentWizard.tsx app/shell/components/Controls.tsx
git commit -m "feat(clients): a client's identity can be edited after the first step"
```

---

### Task 5: The primary location is linked to the client, and backfilled

**Files:**
- Modify: `app/api/clients/locations.ts:57-77` (POST), `:141-147` (PATCH)
- Create: `db/migrations/963_backfill_primary_location.sql`
- Test: `tests/client/db/primary_location.test.ts` (new, route level), `tests/db/primary-location-backfill.test.ts` (new)

**Interfaces:**
- Produces: `client.primary_location_id` is set whenever a location is created with `isPrimary: true` or patched to it; all the client's other locations get `is_primary = false` in the same statement.

- [ ] **Step 1: Write the failing route test**

```ts
// tests/client/db/primary_location.test.ts
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import { AUTH, IDS, freshDatabase, seedClient, seedTenant } from '../../db/helpers';

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(AUTH.ownerA)}`);
  if (init.body) headers.set('content-type', 'application/json');
  return api.request(path, { ...init, headers });
}

const home = {
  label: 'home',
  emirate: 'DXB',
  entranceLat: 25.2048,
  entranceLng: 55.2708,
  isPrimary: true,
};

async function primaryOf(clientId: string): Promise<string | null> {
  const { rows } = await owner.query<{ primary_location_id: string | null }>(
    'select primary_location_id from client where id = $1',
    [clientId],
  );
  return rows[0]?.primary_location_id ?? null;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  // Copy the pool/api construction from tests/client/db/routes.test.ts beforeAll verbatim:
  // createPool(process.env.API_DATABASE_URL), createTokenVerifier({ secret: SECRET, issuer: ISSUER }),
  // createApi({...}) and mountClientRecord(api).
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('client.primary_location_id', () => {
  it('is set when a primary location is added', async () => {
    const res = await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify(home),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await primaryOf(IDS.clientA)).toBe(id);
  });

  it('moves to a second location marked primary, and demotes the first', async () => {
    const first = await primaryOf(IDS.clientA);
    const res = await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify({ ...home, label: 'work', isPrimary: true }),
    });
    const { id } = (await res.json()) as { id: string };
    expect(await primaryOf(IDS.clientA)).toBe(id);
    const { rows } = await owner.query<{ is_primary: boolean }>(
      'select is_primary from location where id = $1',
      [first],
    );
    expect(rows[0]?.is_primary).toBe(false);
  });

  it('follows a patch that marks an existing location primary', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "select id from location where owner_id = $1 and label = 'home'",
      [IDS.clientA],
    );
    const homeId = rows[0]?.id as string;
    const res = await request(`/api/clients/${IDS.clientA}/locations/${homeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    });
    expect(res.status).toBe(200);
    expect(await primaryOf(IDS.clientA)).toBe(homeId);
  });

  it('leaves the link alone when a location is added that is not primary', async () => {
    const before = await primaryOf(IDS.clientA);
    await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify({ ...home, label: 'other', isPrimary: false }),
    });
    expect(await primaryOf(IDS.clientA)).toBe(before);
  });
});
```

Read `tests/client/db/routes.test.ts` lines 70–110 for the exact `createPool`, `createTokenVerifier` and `createApi` calls and paste them into `beforeAll`; the `label` enum values come from `CreateLocationBody` in `record-schema.ts` (use the ones it lists).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --config vitest.db.config.ts tests/client/db/primary_location.test.ts`
Expected: FAIL, `primary_location_id` stays null.

- [ ] **Step 3: Write the link in the routes**

In `app/api/clients/locations.ts`, after the insert in POST (line 77) add:

```ts
    if (body.data.isPrimary) {
      await makePrimary(db, clientId, locationId);
    }
```

In PATCH, after the update (line 146), add:

```ts
    if (d.isPrimary === true) {
      await makePrimary(db, clientId, locationId);
    }
```

And above `mountLocations` (or whatever the mounting function is called) add:

```ts
/**
 * One client, one primary location, and the client row knows which.
 *
 * The list's Emirate column reads `client.primary_location_id`
 * (app/api/clients/list.ts), and until the walk of 10 September nothing but the
 * seed ever wrote it: every client enrolled through the app showed no emirate.
 * The flag on the location and the link on the client are set together so the
 * two can never disagree, and the other locations are demoted in the same
 * breath so "primary" keeps meaning one.
 */
async function makePrimary(db: Db, clientId: string, locationId: string): Promise<void> {
  await db.query(
    "update location set is_primary = (id = $2) where owner_type = 'client' and owner_id = $1",
    [clientId, locationId],
  );
  await db.query('update client set primary_location_id = $2 where id = $1', [
    clientId,
    locationId,
  ]);
}
```

`Db` is whatever type `c.get('db')` has in this file (read the top of the file; it is the
request's transaction client). Both statements run inside the request's transaction.

- [ ] **Step 4: Run the route test**

Run: `pnpm vitest run --config vitest.db.config.ts tests/client/db/primary_location.test.ts`
Expected: PASS. If the `client` audit trigger refuses the update for a missing column in
`app.audit_columns` or similar, read `db/migrations/080_audit_triggers.sql` and
`097_audit_client_id_any_table.sql`: the update must be allowed for the API role via
`db/policies/client/writers.sql`; if `writers.sql` lists columns, add `primary_location_id`
to the ones an admin may write and note it in the trunk note.

- [ ] **Step 5: Write the failing backfill test**

```ts
// tests/db/primary-location-backfill.test.ts
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, MORE_IDS, freshDatabase, seedClient, seedLocation, seedTenant } from './helpers';

/**
 * Migration 963 fills client.primary_location_id from the flag on the location
 * (or the client's only location) for every client enrolled before the link
 * was written by the routes. freshDatabase() runs every migration, so this
 * test seeds the three cases and re-runs the migration's statements against
 * them, which is what the file would do on a database that already had them.
 */
let owner: pg.Client;

const FLAGGED = '00000000-0000-4000-8000-00000000a001';
const LONE = '00000000-0000-4000-8000-00000000a002';
const AMBIGUOUS = '00000000-0000-4000-8000-00000000a003';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedClient(owner, IDS.tenantA, FLAGGED, IDS.ownerA, 'Flagged');
  await seedClient(owner, IDS.tenantA, LONE, IDS.ownerA, 'Lone');
  await seedClient(owner, IDS.tenantA, AMBIGUOUS, IDS.ownerA, 'Ambiguous');
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationB, FLAGGED, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationC, FLAGGED, IDS.ownerA);
  await owner.query('update location set is_primary = true where id = $1', [MORE_IDS.locationC]);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationD, LONE, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationE, AMBIGUOUS, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationF, AMBIGUOUS, IDS.ownerA);
  await owner.query('update client set primary_location_id = null where id = any($1)', [
    [FLAGGED, LONE, AMBIGUOUS],
  ]);
  const sql = await import('node:fs/promises').then((fs) =>
    fs.readFile('db/migrations/963_backfill_primary_location.sql', 'utf8'),
  );
  await owner.query(sql);
});

afterAll(async () => {
  await owner.end();
});

async function primaryOf(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ primary_location_id: string | null }>(
    'select primary_location_id from client where id = $1',
    [id],
  );
  return rows[0]?.primary_location_id ?? null;
}

describe('963_backfill_primary_location', () => {
  it('takes the flagged location when there is one', async () => {
    expect(await primaryOf(FLAGGED)).toBe(MORE_IDS.locationC);
  });
  it('takes the only location when none is flagged', async () => {
    expect(await primaryOf(LONE)).toBe(MORE_IDS.locationD);
  });
  it('leaves a client with several unflagged locations alone', async () => {
    expect(await primaryOf(AMBIGUOUS)).toBeNull();
  });
});
```

If `MORE_IDS` in `tests/db/helpers.ts` has fewer location ids than this uses, add
`locationB`…`locationF` there as new UUID constants in the same style.

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm vitest run --config vitest.db.config.ts tests/db/primary-location-backfill.test.ts`
Expected: FAIL, the migration file does not exist.

- [ ] **Step 7: Write the migration**

```sql
-- 963_backfill_primary_location.sql
-- Needs: 060 (client.primary_location_id), 030 (location.is_primary)
--
-- Every client enrolled through the app until trunk round 43 (2026-09-10) has
-- primary_location_id null: the location routes wrote the flag on the location
-- and never the link on the client, and only the seed wrote both. The list's
-- Emirate column reads the link, so those clients showed no emirate. From this
-- round the routes write both (app/api/clients/locations.ts, makePrimary); this
-- fills in the past.
--
-- Two rules, in order. A flagged primary wins. A client with exactly one
-- location and no flag gets that one, since it is the only place a practitioner
-- could be sent. A client with several unflagged locations is left null: the
-- office marks one, and the list shows no emirate until it does, as today.
-- Idempotent: only null links are written.
--
-- Audit context, as 956 sets it: the client table's triggers stamp an actor and
-- a reason on every change, and a migration has neither.
do $$
begin
  perform set_config('app.reason', '963_backfill_primary_location.sql: the link the routes never wrote', true),
          set_config('app.request_id', gen_random_uuid()::text, true),
          set_config('app.actor_id', '', true),
          set_config('app.actor_roles', '', true);

  update public.client c
     set primary_location_id = l.id
    from public.location l
   where l.owner_type = 'client'
     and l.owner_id = c.id
     and l.is_primary
     and c.primary_location_id is null;

  update public.client c
     set primary_location_id = only_one.id
    from (
      select owner_id, min(id::text)::uuid as id
        from public.location
       where owner_type = 'client'
       group by owner_id
      having count(*) = 1
    ) only_one
   where only_one.owner_id = c.id
     and c.primary_location_id is null;

  update public.location l
     set is_primary = true
    from public.client c
   where c.primary_location_id = l.id
     and not l.is_primary;
end
$$;
```

Read `db/migrations/956_bootstrap_practice.sql` lines 195–210 to confirm the four
`set_config` keys the audit triggers expect and copy them exactly if they differ.

- [ ] **Step 8: Run both tests and the migration audit**

Run: `pnpm vitest run --config vitest.db.config.ts tests/db/primary-location-backfill.test.ts tests/client/db/primary_location.test.ts tests/db/checksums.test.ts && pnpm audit:migrations`
Expected: PASS. If `checksums.test.ts` keeps a list of migration files, add 963 to it.

- [ ] **Step 9: Commit**

```bash
git add app/api/clients/locations.ts db/migrations/963_backfill_primary_location.sql tests/client/db/primary_location.test.ts tests/db/primary-location-backfill.test.ts tests/db/helpers.ts
git commit -m "fix(clients): the primary location is linked to the client, and backfilled"
```

---

### Task 6: A date in the booking panel

**Files:**
- Modify: `app/admin/schedule/NewAppointmentDrawer.tsx:73-100, 150-180, 240-260, 455-470`
- Test: `app/admin/schedule/NewAppointmentDrawer.test.tsx` (exists; add cases)

**Interfaces:**
- Consumes: `composeWindowStart(date, time)` from `./windows.ts`; the options request at line 158 (`params.set('date', date)`).
- Produces: the drawer keeps its `date` prop as the default and books on its own `bookingDate` state.

- [ ] **Step 1: Write the failing test**

Read the existing test file's `mount` helper and add, in the same style:

```tsx
  it('books on the day chosen in the panel, defaulting to the day shown', async () => {
    const { calls } = mount({ date: '2026-09-10' });
    const dateField = screen.getByLabelText('Date') as HTMLInputElement;
    expect(dateField.value).toBe('2026-09-10');
    fireEvent.change(dateField, { target: { value: '2026-09-11' } });
    // …choose a client, service, location, practitioner and 10:00 the way the
    // existing "books an appointment" test does…
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST');
    const body = JSON.parse(String(post?.init?.body));
    expect(body.windowStart).toBe(new Date('2026-09-11T10:00:00+04:00').toISOString());
    // The practitioner list was fetched again for the new day.
    expect(calls.filter((c) => c.url.includes('date=2026-09-11')).length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/schedule/NewAppointmentDrawer.test.tsx`
Expected: FAIL, no field labelled "Date".

- [ ] **Step 3: Add the field**

In `NewAppointmentDrawer.tsx`:
- Add `const [bookingDate, setBookingDate] = useState(date);` beside `startTime`.
- Replace every use of `date` inside the component body with `bookingDate` (the options
  fetch at line 158, its effect dependency at 176, the practitioner refetch, and
  `composeWindowStart(date, startTime)` at line 250). Keep the prop as the initial value only.
- In the JSX, before the client search, render:

```tsx
<Field
  id="new-appointment-date"
  label="Date"
  type="date"
  value={bookingDate}
  onChange={(e) => {
    setBookingDate(e.target.value);
    // A practitioner certified on one day may be away on another: the list is
    // filtered by date on the server, so the choice is cleared and fetched again.
    setSelectedPractitionerId(null);
  }}
  hint="The visit is booked on this day."
/>
```

- Update the doc comment on the `date` prop: "The day the schedule was showing when the panel opened; the panel's own date field starts there."

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/admin/schedule`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/schedule/NewAppointmentDrawer.tsx app/admin/schedule/NewAppointmentDrawer.test.tsx
git commit -m "feat(schedule): the booking panel carries its own date"
```

---

### Task 7: "Moved to" on a rescheduled row

**Files:**
- Modify: `app/api/appointments/schema.ts:56-73` (`AppointmentRow` gains `movedTo`)
- Modify: `app/api/appointments/list.ts:98-140, 180-200` (columns, join, mapping)
- Modify: `app/admin/schedule/SchedulePage.tsx:218-226` (status cell)
- Test: `tests/scheduling/db/list.test.ts` (or the file that already tests `/api/appointments`; add a case), `app/admin/schedule/SchedulePage.test.tsx` (add a case)

**Interfaces:**
- Produces: `AppointmentRow.movedTo: { id: string; windowStart: string } | null`.

- [ ] **Step 1: Write the failing route test**

In the scheduling route test file that already books and moves an appointment (search
`tests/scheduling` for `rescheduled_from_id` or `/move`), add:

```ts
  it('says where a rescheduled visit went', async () => {
    // book, confirm, then move to the next day at 10:00 the way the move test does
    const list = await request(ownerAuth, `/api/appointments?date=${DAY}`);
    const rows = (await list.json()).appointments as AppointmentRow[];
    const old = rows.find((r) => r.status === 'rescheduled');
    expect(old?.movedTo).toEqual({
      id: expect.any(String),
      windowStart: new Date(`${NEXT_DAY}T10:00:00+04:00`).toISOString(),
    });
    const live = rows.find((r) => r.status === 'confirmed');
    expect(live?.movedTo).toBeNull();
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --config vitest.db.config.ts tests/scheduling`
Expected: FAIL, `movedTo` undefined.

- [ ] **Step 3: Return it from the route**

`schema.ts`: inside `AppointmentRow` add
`movedTo: z.object({ id: z.uuid(), windowStart: z.iso.datetime() }).nullable(),`.

`list.ts`:
- `PracticeRow` gains `moved_to_id: string | null; moved_to_window_start: Date | null;`.
- `PRACTICE_COLUMNS` gains `', n.id as moved_to_id, n.window_start as moved_to_window_start'`.
- Add a lateral join used only by the practice query. `FROM_AND_WHERE` is shared with the
  practitioner's own query, so build the practice SQL as
  `BASE_COLUMNS + PRACTICE_COLUMNS + FROM_AND_WHERE.replace(' where ', MOVED_TO_JOIN + ' where ') + ORDER`
  with

```ts
// The appointment that replaced a rescheduled one, if any: the move rule writes
// the new row with rescheduled_from_id pointing back (scheduling-manual.md
// section 3), and the old row on the old day should say where the visit went
// rather than only that it did (the walk of 10 September).
const MOVED_TO_JOIN =
  'left join lateral (select n.id, n.window_start from appointment n ' +
  'where n.rescheduled_from_id = a.id and n.tenant_id = app.current_tenant_id() ' +
  'order by n.created_at desc limit 1) n on true';
```

  (If `appointment` has no `created_at`, order by `n.window_start desc`.)
- `toPracticeRow` adds
  `movedTo: r.moved_to_id && r.moved_to_window_start ? { id: r.moved_to_id, windowStart: r.moved_to_window_start.toISOString() } : null,`.

- [ ] **Step 4: Run the route test**

Run: `pnpm vitest run --config vitest.db.config.ts tests/scheduling`
Expected: PASS.

- [ ] **Step 5: Show it on the schedule**

In `SchedulePage.tsx` the status column's `render` becomes:

```tsx
render: (row) => (
  <span className="schedule__status">
    <StatusChip
      label={APPOINTMENT_STATUS_LABELS[row.status]}
      tone={APPOINTMENT_STATUS_TONES[row.status]}
    />
    {row.movedTo ? (
      <Link className="link small" to={`/admin/schedule?date=${practiceDay(row.movedTo.windowStart)}`}>
        Moved to {formatMovedTo(row.movedTo.windowStart)}
      </Link>
    ) : null}
  </span>
),
```

Add to `windows.ts`:

```ts
/** "Fri 11 Sept 10:00", the way the move drawer names a visit. */
export function formatMovedTo(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));
}
```

Check `practiceDay` in `windows.ts` takes an ISO string and returns YYYY-MM-DD in Dubai time
(the page already uses it); if it takes a `Date`, wrap with `new Date(...)`. Add
`.schedule__status { display: inline-flex; flex-direction: column; gap: var(--space-1); }` to
`schedule.css` using the spacing token the file already uses.

Add a `SchedulePage.test.tsx` case: a row with `status: 'rescheduled'` and `movedTo` renders a
link whose text starts with "Moved to" and whose `href` contains the next day's date.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run app/admin/schedule`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/appointments/schema.ts app/api/appointments/list.ts app/admin/schedule/SchedulePage.tsx app/admin/schedule/SchedulePage.test.tsx app/admin/schedule/windows.ts app/admin/schedule/schedule.css tests/scheduling
git commit -m "feat(schedule): a rescheduled row says where the visit went"
```

---

### Task 8: A quieter timeline

**Files:**
- Modify: `domain/shared/audit-narrative.ts:281-288, 1008-1015, 1021-1026`
- Modify: `app/api/audit/schema.ts:5-13` (`TimelineEvent` gains `count`)
- Modify: `app/api/audit/timeline.ts:105-120`
- Modify: `app/admin/audit/RecordTimeline.tsx:207-222`
- Test: `domain/shared/audit-narrative.test.ts`, `tests/audit/timeline.test.ts` (or the existing timeline route test), `app/admin/audit/RecordTimeline.test.tsx`

**Interfaces:**
- Produces: `TimelineEvent.count: number` (1 for a single event; N when N identical consecutive reads were folded).

- [ ] **Step 1: Write the failing narrative tests**

In `domain/shared/audit-narrative.test.ts`, near the existing `'seeing a record in a list'` case:

```ts
  it('says an appointment was seen in the schedule, not "recorded list"', () => {
    const n = narrate(event({ entityType: 'appointment', action: 'list' }), 'en');
    expect(n?.sentence).toBe('Hazel Harbour saw the appointment in the schedule');
    expect(n?.kind).toBe('read');
  });

  it('carries a reason only on a change, never on a read', () => {
    const read = narrate(event({ action: 'read', reason: 'Client asked for a morning slot' }), 'en');
    expect(read?.reason).toBeNull();
    const change = narrate(
      event({ action: 'update', changedFields: ['status'], reason: 'Client asked for a morning slot' }),
      'en',
    );
    expect(change?.reason).toBe('Client asked for a morning slot');
  });
```

Use the same `event(...)` helper the file already has (it fills a synthetic actor named Hazel Harbour and a client entity by default).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run domain/shared/audit-narrative.test.ts`
Expected: FAIL on both.

- [ ] **Step 3: Change the narrative**

In `sentenceFor`'s generic branch (around line 1005) add, before `case 'read'`:

```ts
        case 'list':
          return pick(
            t(`${actor} saw the ${entity} in the schedule`, `${actor} رأى ${entity} في الجدول`),
            locale,
          );
```

only when `entity` is the appointment's label; for other entities keep the default. The
simplest form: at the top of the `switch (event.action)` in that branch, if
`event.entityType === 'appointment' && event.action === 'list'` return the sentence above.

In `narrate` (line 1021):

```ts
export function narrate(event: AuditEvent, locale: Locale): Narration | null {
  const sentence = sentenceFor(event, locale);
  if (sentence === null) return null;
  const kind = kindOf(event);
  // A reason is stamped on every audit row a request writes
  // (app/api/_middleware/request-context.ts), so the read a move drawer makes
  // while it opens carries the move's reason. The reason explains a change; on
  // a read it explains nothing and misleads (the walk of 10 September).
  const reason = kind === 'read' ? null : event.reason?.trim() || null;
  return { sentence, reason, kind };
}
```

- [ ] **Step 4: Run the narrative tests**

Run: `pnpm vitest run domain/shared/audit-narrative.test.ts`
Expected: PASS.

- [ ] **Step 5: Fold repeated reads in the route**

`app/api/audit/schema.ts`: add `count: z.number().int().positive(),` to `TimelineEvent`.

`app/api/audit/timeline.ts`, replace the loop that pushes `events` with:

```ts
    const events: TimelineEvent[] = [];
    for (const row of page) {
      const event = toEvent(row);
      const narration = narrate(event, locale);
      if (narration === null) continue;
      const previous = events[events.length - 1];
      // Nine "saw the appointment in the schedule" lines inside one minute are
      // one fact said nine times: the same person, the same sentence, the same
      // minute fold into one entry with a count. Only reads fold; every change
      // keeps its own line.
      if (
        previous &&
        narration.kind === 'read' &&
        previous.kind === 'read' &&
        previous.sentence === narration.sentence &&
        previous.actor?.name === (event.actor?.name ?? null) &&
        sameMinute(previous.occurredAt, event.occurredAt)
      ) {
        previous.count += 1;
        continue;
      }
      events.push({
        id: event.id,
        occurredAt: event.occurredAt,
        sentence: narration.sentence,
        reason: narration.reason,
        kind: narration.kind,
        count: 1,
        actor:
          event.actor === null ? null : { name: event.actor.name, roles: [...event.actor.roles] },
      });
    }
```

with, above `mountTimeline`:

```ts
function sameMinute(a: string, b: string): boolean {
  return a.slice(0, 16) === b.slice(0, 16);
}
```

Add a route test case in the existing timeline test: three `list` audit rows on the same
appointment within one minute by the same actor come back as one event with `count: 3`;
two `update` rows with the same sentence stay two events.

- [ ] **Step 6: Show the count**

`RecordTimeline.tsx` line 208: `<p className="timeline__sentence">{event.sentence}{event.count > 1 ? ` (${event.count} times)` : ''}</p>`.
Add a `RecordTimeline.test.tsx` case that renders an event with `count: 3` and expects the
text to end with "(3 times)".

- [ ] **Step 7: Run everything touched**

Run: `pnpm vitest run domain/shared app/admin/audit && pnpm vitest run --config vitest.db.config.ts tests/audit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add domain/shared/audit-narrative.ts domain/shared/audit-narrative.test.ts app/api/audit/schema.ts app/api/audit/timeline.ts app/admin/audit/RecordTimeline.tsx app/admin/audit/RecordTimeline.test.tsx tests/audit
git commit -m "fix(audit): the timeline says what a read was, folds repeats, and keeps reasons for changes"
```

---

### Task 9: Activation is announced, and the list keeps up with the wizard

**Files:**
- Modify: `app/admin/clients/EnrolmentWizard.tsx:96-101, 213, 295-297`
- Modify: `app/admin/clients/ClientsPage.tsx:117-138, 281`
- Test: `app/admin/clients/ClientsPage.test.tsx` (add a case), `app/admin/clients/EnrolmentWizard.test.tsx` (add a case)

**Interfaces:**
- Produces: `EnrolmentWizard` props `onCreated?: () => void` (called once the lead exists) and `onActivated?: (name: string) => void` (called with the client's display name after a successful Activate, before `onDone`).

- [ ] **Step 1: Write the failing tests**

In `EnrolmentWizard.test.tsx`, in the style of its existing tests:

```tsx
  it('tells the page when the lead exists and when it is activated', async () => {
    const onCreated = vi.fn();
    const onActivated = vi.fn();
    // mount with onCreated and onActivated, fill identity, submit
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // …drive the record to activatable with the fetch stub and press Activate…
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith('Alpha Synthetic'));
  });
```

In `ClientsPage.test.tsx`:

```tsx
  it('announces an activation on the list', async () => {
    // mount the page, open the wizard, and call the wizard's onActivated by
    // stubbing EnrolmentWizard with vi.mock to a button that calls props.onActivated('Alpha Synthetic')
    fireEvent.click(screen.getByRole('button', { name: 'activate-stub' }));
    expect(screen.getByRole('status').textContent).toBe('Alpha Synthetic is now active.');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run app/admin/clients/EnrolmentWizard.test.tsx app/admin/clients/ClientsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wire the callbacks**

`EnrolmentWizard.tsx`: add the two optional props; after `setCreated(body);` call
`onCreated?.();`; in `activate()` before `onDone();` call
`onActivated?.(`${record?.givenName ?? ''} ${record?.familyName ?? ''}`.trim());`.

`ClientsPage.tsx`: add `const [notice, setNotice] = useState<string | null>(null);`; pass
`onCreated={() => setReloadToken((t) => t + 1)}` and
`onActivated={(name) => setNotice(`${name} is now active.`)}` to the wizard; render
`<div role="status" className="small muted">{notice}</div>` under the page header (the same
place billing renders its status). Clear `notice` when the search or filter changes.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/admin/clients`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/clients/EnrolmentWizard.tsx app/admin/clients/EnrolmentWizard.test.tsx app/admin/clients/ClientsPage.tsx app/admin/clients/ClientsPage.test.tsx
git commit -m "feat(clients): the list hears when a lead is created and when it is activated"
```

---

### Task 10: The round's note, the gate, and the pull request

**Files:**
- Modify: `docs/CHANGE-REQUESTS/trunk-notes.md` (append "Round 43 — the walk's fixes, part one (2026-09-10)")
- Modify: `docs/SPEC/client-record.md:42` (the Locations line: "check the pin" wording), `docs/SPEC/scheduling-manual.md` (the day view mentions "Moved to")
- Modify: `docs/SPEC/audit.md` (section 9: reads carry no reason; repeats fold)

- [ ] **Step 1: Write the trunk note**

Append to `docs/CHANGE-REQUESTS/trunk-notes.md`, in the voice of rounds 41 and 42 (read round 42 first):

```markdown
## Round 43 — the walk's fixes, part one (2026-09-10)

The console was driven in a browser as the practice owner through ten everyday
jobs (docs/superpowers/specs/2026-09-10-walk-fixes-design.md). This first of
four pull requests mends what needed no decision:

- A client's identity can be edited after the first wizard step
  (`app/admin/clients/IdentityForm.tsx`; the Overview's Edit; the wizard's
  Identity tab). `PATCH /api/clients/:id` had accepted every field since piece
  four; no screen offered it.
- `client.primary_location_id` is written by the location routes and
  backfilled by migration 963. Every client the app enrolled showed no emirate
  in the list because only the seed had ever written the link.
- The booking panel carries its own date. A rescheduled row says where the
  visit went (`AppointmentRow.movedTo`).
- The timeline says "saw the appointment in the schedule", folds identical
  reads inside one minute into one line with a count (`TimelineEvent.count`),
  and attaches a reason only to a change: `app.reason` is stamped on every row
  a request writes, so a read made while a move drawer opened carried the
  move's reason.
- A self contact is shown under the client's own name. Example values moved
  from placeholders into hints. A field's error is announced. Activation is
  announced on the list, which reloads as soon as the lead exists. "Verify pin"
  is "Check the pin", and the checklist says "a location with its pin set".

Shared-zone files touched by this trunk round: `app/shell/components/Controls.tsx`,
`domain/shared/audit-narrative.ts`, `db/migrations/963_*`. Streams' files
touched under the round's authority: `app/admin/clients/**`, `app/api/clients/**`,
`app/admin/schedule/**`, `app/api/appointments/**`, `app/admin/audit/**`,
`app/api/audit/**`, `app/admin/billing/PaymentDrawer.tsx`.
```

- [ ] **Step 2: Touch the specs**

`docs/SPEC/client-record.md:42`: "verify pin" → "check the pin" and "opens a map to drag the
marker (part two of the walk's fixes; until then the coordinate boxes)".
`docs/SPEC/scheduling-manual.md`, the day view paragraph: add one sentence, "A rescheduled row
says where the visit went and links to that day."
`docs/SPEC/audit.md` section 9: add "A read carries no reason. Identical reads by one person
inside one minute are shown once, with a count."

- [ ] **Step 3: Run the whole gate**

Run: `pnpm verify` then `pnpm test:db`
Expected: both green. Fix anything they raise before continuing (format with `pnpm format`).

- [ ] **Step 4: Commit and open the pull request**

```bash
git add docs/CHANGE-REQUESTS/trunk-notes.md docs/SPEC/client-record.md docs/SPEC/scheduling-manual.md docs/SPEC/audit.md
git commit -m "docs(trunk): round 43, part one — what the walk found and what this mends"
git push -u origin trunk-round-43
gh pr create --title "trunk round 43, part one: the walk's plain fixes" --body-file <(cat <<'EOF'
The console was driven as the practice owner through ten everyday jobs on 10 September
(docs/superpowers/specs/2026-09-10-walk-fixes-design.md). This is the first of four pull
requests: everything that needed no decision.

- Identity edit on the Overview and in the wizard
- client.primary_location_id written by the routes and backfilled (migration 963)
- Date in the booking panel; "Moved to" on a rescheduled row
- Timeline: reads named, repeats folded, reasons only on changes
- Self contact under the client's name; examples in hints; errors announced;
  activation announced; "Check the pin"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 5: Reviews**

Dispatch `compliance-reviewer` and `security-reviewer` on the branch's diff against main, and
`schema-reviewer` for migration 963. Address every finding as a fix commit; re-run the gate;
do not merge until every CI check reads SUCCESS (see the memory note on merge guards: check
conclusions positively, merge in a separate command).
