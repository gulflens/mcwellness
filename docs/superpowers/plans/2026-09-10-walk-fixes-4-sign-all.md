# The walk's fixes, part four: one signature — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household sign once for every consent the client needs, on one screen, with one scroll to the end, while every consent row still records the exact wording it was given against.

**Architecture:** A bundle route, `POST /api/clients/:id/consents/bundle`, runs the single route's checks for each purpose, files the one signature image once, and writes one consent row per purpose sharing `signature_document_id`, in one transaction. A `SignAllForm` stacks the wordings `requiredConsents` names under their own headings, gates the pad on the end of the stack, and sends the bundle. The per-consent form stays for re-consents, withdrawals, paper forms and verbal re-confirmations. No wording changes: each row points at its purpose's current version.

**Tech Stack:** Hono, zod, PostgreSQL, React 19, the existing `SignaturePad`, Vitest with jsdom and the local database.

**Spec:** `docs/superpowers/specs/2026-09-10-walk-fixes-design.md`, section "Pull request 4".

## Global Constraints

- Branch `trunk-round-43`, after parts one to three. Client-record paths (`app/admin/clients/**`, `app/api/clients/**`, `tests/client/**`) under the round's authority; note them in the trunk note.
- A consent records the exact text shown: every row's `text_document_id` is the current approved wording for its purpose and the client's locale, checked by `checkWording` exactly as the single route checks it.
- A typed name is not a signature; the pad's PNG is the evidence, filed immutable, once.
- The bundle never records a purpose the client does not need (`requiredConsents(record, ['home'], today)`), never `verbal_witnessed`, never a purpose twice.
- Every task ends with its tests green; the PR ends with `pnpm verify`, `pnpm test:db`, and the compliance and security reviewers (compliance is the centre of this one).
- Commit after every task, conventional message, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: The signature image says what it was signed for

**Files:**
- Modify: `app/admin/clients/SignaturePad.tsx:44-48, 65-80, 114-160`
- Test: `app/admin/clients/SignaturePad.test.tsx` (add a case; create in the file's own style if absent)

**Interfaces:**
- Produces: `SignaturePad` prop `caption?: string`, drawn as a third line in the image's foot, smaller than the name and the date.

- [ ] **Step 1: Write the failing test**

```tsx
  it('prints a caption beneath the name and the date when it is given one', async () => {
    const fillText = vi.fn();
    // jsdom has no canvas: stub getContext so the pad renders through this spy.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      fillRect: vi.fn(), fillText,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QUJD');
    const onChange = vi.fn();
    render(
      <SignaturePad
        signedName="Alpha Synthetic"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today="10 September 2026"
        caption="Signed for: participation, visits at home, brain-map and neurofeedback information"
      />,
    );
    const canvas = screen.getByLabelText('Signature');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 20, pointerId: 1 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const texts = fillText.mock.calls.map((call) => call[0]);
    expect(texts).toContain('Alpha Synthetic');
    expect(texts).toContain('10 September 2026');
    expect(texts).toContain(
      'Signed for: participation, visits at home, brain-map and neurofeedback information',
    );
  });
```

Read the existing `SignaturePad.test.tsx` (or `ConsentCapture.test.tsx`) for how it draws a stroke in jsdom and copy that instead of the pointer events above if it differs.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/SignaturePad.test.tsx`
Expected: FAIL, no caption in the image.

- [ ] **Step 3: Draw it**

In `SignaturePad.tsx` add the prop `caption?: string` (doc: "What the signature covers, printed
small beneath the date when a signature stands for several consents at once; the image is the
evidence, so the image says so."). In `render`, after the date line:

```ts
    if (caption) {
      ctx.font = '12px sans-serif';
      ctx.fillText(caption, 24, captionTop + 66);
    }
```

and make room: `const captionTop = SIGNATURE_HEIGHT - (caption ? CAPTION_HEIGHT + 20 : CAPTION_HEIGHT);`.
Add `caption` to `render`'s dependency list and to the effect that re-renders when the name
changes.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run app/admin/clients/SignaturePad.test.tsx app/admin/clients/ConsentCapture.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/clients/SignaturePad.tsx app/admin/clients/SignaturePad.test.tsx
git commit -m "feat(clients): the signature image can say what it was signed for"
```

---

### Task 2: The bundle route

**Files:**
- Modify: `app/api/clients/record-schema.ts` (after `RecordConsentBody`)
- Modify: `app/api/clients/consents.ts` (a second route inside `mountConsents`; the helpers are reused)
- Test: `tests/client/db/consent_bundle.test.ts` (new)

**Interfaces:**
- Produces: `RecordConsentBundleBody = { purposes: { purpose, textDocumentId }[] (1–4, unique purposes), givenByContactId, method: 'app_signature' | 'paper_scan', evidence: DocumentBytes }`; `POST /api/clients/:id/consents/bundle` answers 201 `{ ids: string[], signatureDocumentId: string }`, or 400 with the single route's codes plus `purpose_not_needed`, `purpose_repeated`, `method_not_accepted`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/db/consent_bundle.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import { AUTH, IDS, freshDatabase, seedClient, seedContact, seedTenant } from '../../db/helpers';

/**
 * One signature, several consents (trunk round 43): the bundle route writes one
 * consent row per purpose the client needs, each against its own current
 * wording, all pointing at one filed signature. Seeding follows
 * consent_documents.test.ts: copy its seedWording helper and its api/pool
 * construction into this file rather than importing them, so this suite reads
 * on its own.
 */
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const ADULT_ID = '00000000-0000-4000-8000-000000000201';
const ADULT_CONTACT = '00000000-0000-4000-8000-000000000211';
const WORDING_PARTICIPATION = '00000000-0000-4000-8000-000000000221';
const WORDING_HOME_VISIT = '00000000-0000-4000-8000-000000000222';
const WORDING_HEALTH_DATA = '00000000-0000-4000-8000-000000000223';
const WORDING_MINOR = '00000000-0000-4000-8000-000000000224';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let dir: string;

// mint(), request(), seedWording(): copied from consent_documents.test.ts.

const bundle = (purposes: { purpose: string; textDocumentId: string }[]) => ({
  purposes,
  givenByContactId: ADULT_CONTACT,
  method: 'app_signature',
  evidence: { mimeType: 'image/png', bytesBase64: PNG_BASE64 },
});

const THREE = [
  { purpose: 'participation', textDocumentId: WORDING_PARTICIPATION },
  { purpose: 'home_visit', textDocumentId: WORDING_HOME_VISIT },
  { purpose: 'health_data', textDocumentId: WORDING_HEALTH_DATA },
];

beforeAll(async () => {
  owner = await freshDatabase();
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-bundle-'));
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedClient(owner, IDS.tenantA, ADULT_ID, IDS.ownerA, 'Alpha');
  await owner.query("update client set date_of_birth = '1990-03-12' where id = $1", [ADULT_ID]);
  await seedContact(owner, IDS.tenantA, ADULT_CONTACT, ADULT_ID, IDS.ownerA, {
    relationship: 'self',
    canConsent: true,
  });
  await seedWording(WORDING_PARTICIPATION, 'participation', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_HOME_VISIT, 'home_visit', 'en', '1.0', 'approved', false);
  await seedWording(WORDING_HEALTH_DATA, 'health_data', 'en', '1.1', 'approved', false);
  await seedWording(WORDING_MINOR, 'minor_participation', 'en', '1.0', 'approved', false);
  // pool, api, mountClientRecord as consent_documents.test.ts builds them, with localDiskStorage({ dir, ... }).
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/clients/:id/consents/bundle', () => {
  it('writes one consent per purpose, all pointing at one filed signature', async () => {
    const res = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ids: string[]; signatureDocumentId: string };
    expect(body.ids).toHaveLength(3);
    const { rows } = await owner.query<{
      purpose: string;
      text_document_id: string;
      signature_document_id: string;
      status: string;
      method: string;
    }>(
      'select purpose, text_document_id, signature_document_id, status, method from consent ' +
        'where client_id = $1 order by purpose',
      [ADULT_ID],
    );
    expect(rows.map((r) => r.purpose)).toEqual(['health_data', 'home_visit', 'participation']);
    expect(new Set(rows.map((r) => r.signature_document_id)).size).toBe(1);
    expect(rows[0]?.signature_document_id).toBe(body.signatureDocumentId);
    expect(rows.every((r) => r.status === 'active' && r.method === 'app_signature')).toBe(true);
    expect(rows.find((r) => r.purpose === 'health_data')?.text_document_id).toBe(WORDING_HEALTH_DATA);
    const docs = await owner.query("select count(*)::int as n from document where kind = 'consent_signature'");
    expect(docs.rows[0]?.n).toBe(1);
  });

  it('supersedes the earlier active consent for each purpose, as the single route does', async () => {
    const again = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle(THREE)),
    });
    expect(again.status).toBe(201);
    const { rows } = await owner.query<{ status: string }>(
      "select status from consent where client_id = $1 and purpose = 'participation' order by created_at",
      [ADULT_ID],
    );
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'active']);
  });

  it('refuses a purpose the client does not need, a repeated purpose, and a verbal method', async () => {
    const notNeeded = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle([...THREE, { purpose: 'minor_participation', textDocumentId: WORDING_MINOR }])),
    });
    expect(notNeeded.status).toBe(400);
    expect((await notNeeded.json()).code).toBe('purpose_not_needed');

    const repeated = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle([THREE[0]!, THREE[0]!])),
    });
    expect(repeated.status).toBe(400);
    expect((await repeated.json()).code).toBe('purpose_repeated');

    const verbal = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify({ ...bundle(THREE), method: 'verbal_witnessed' }),
    });
    expect(verbal.status).toBe(400);
  });

  it('refuses the whole bundle when one wording is not the current one, writing nothing', async () => {
    const before = await owner.query('select count(*)::int as n from consent where client_id = $1', [ADULT_ID]);
    const res = await request(AUTH.ownerA, `/api/clients/${ADULT_ID}/consents/bundle`, {
      method: 'POST',
      body: JSON.stringify(bundle([THREE[0]!, { purpose: 'home_visit', textDocumentId: WORDING_HEALTH_DATA }])),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('wording_wrong_purpose');
    const after = await owner.query('select count(*)::int as n from consent where client_id = $1', [ADULT_ID]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('is refused for a practitioner, who may not write the record', async () => {
    // seed a practitioner user as consent_documents.test.ts does, then:
    // expect((await request(PRACTITIONER_AUTH, ..., { method: 'POST', body })).status).toBe(403);
  });
});
```

Fill in the practitioner case and the copied helpers from `consent_documents.test.ts` (read it in full first; `seedContact`'s options object may differ, match it).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --config vitest.db.config.ts tests/client/db/consent_bundle.test.ts`
Expected: FAIL, 404 on the route.

- [ ] **Step 3: The body schema**

In `record-schema.ts`, after `RecordConsentBody`:

```ts
/**
 * One signature for several consents (trunk round 43). Each purpose names the
 * wording it was read against, as the single body does; one piece of evidence
 * covers them all. A verbal re-confirmation is one purpose's own and is not a
 * method here.
 */
export const RecordConsentBundleBody = z.object({
  purposes: z
    .array(z.object({ purpose: z.enum(CONSENT_PURPOSES), textDocumentId: z.uuid() }))
    .min(1)
    .max(CONSENT_PURPOSES.length),
  givenByContactId: z.uuid(),
  method: z.enum(['app_signature', 'paper_scan']),
  evidence: DocumentBytes,
});
export type RecordConsentBundleBody = z.infer<typeof RecordConsentBundleBody>;

export const ConsentBundleResponse = z.object({
  ids: z.array(z.uuid()),
  signatureDocumentId: z.uuid(),
});
export type ConsentBundleResponse = z.infer<typeof ConsentBundleResponse>;
```

- [ ] **Step 4: The route**

Inside `mountConsents` in `consents.ts`, after the single route, add (imports:
`RecordConsentBundleBody`, `ConsentBundleResponse` from `./record-schema`; `requiredConsents`
and `canGiveConsent` from `../../../domain/client`):

```ts
  /**
   * `POST /api/clients/:id/consents/bundle` — one signature, every consent the
   * client needs (the operator's decision of 10 September 2026).
   *
   * Every check the single route makes is made here per purpose, before
   * anything is written: the wording is the current one for that purpose and
   * this client's language, the giver may give it, the evidence fits the
   * method. Two checks are the bundle's own. A purpose the client does not need
   * (`requiredConsents`) is refused, so a screen can never file more than the
   * household was asked for; and a purpose twice is refused, since one signing
   * gives one consent per purpose. The signature is filed once and every row
   * points at it: the image is what was signed, and its foot names the purposes
   * (app/admin/clients/SignaturePad.tsx, `caption`).
   *
   * The request's transaction is the bundle's: a refusal on the third purpose
   * leaves no first and second.
   */
  api.post('/api/clients/:id/consents/bundle', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = RecordConsentBundleBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    const purposes = body.data.purposes.map((p) => p.purpose);
    if (new Set(purposes).size !== purposes.length) {
      return c.json({ error: 'bad_request', code: 'purpose_repeated', requestId }, 400);
    }

    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') return c.json({ error: 'erased', requestId }, 400);

    const clientRow = await db.query<{ preferred_locale: string; date_of_birth: string | null }>(
      'select preferred_locale, date_of_birth from client where id = $1',
      [clientId],
    );
    const client = clientRow.rows[0];
    if (!client) return c.json({ error: 'not_found', requestId }, 404);

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    // What this client needs today, judged as the Consent tab judges it: a
    // home visit is assumed, since every client of this practice is trained
    // at home (docs/SPEC/client-record.md section 3).
    const needed = new Set<string>(
      requiredConsents({ client: { dateOfBirth: client.date_of_birth } } as never, ['home'], today),
    );
    for (const purpose of purposes) {
      if (!needed.has(purpose)) {
        return c.json({ error: 'bad_request', code: 'purpose_not_needed', requestId }, 400);
      }
    }

    const contact = await db.query<{ id: string; can_consent: boolean; is_legal_guardian: boolean }>(
      'select id, can_consent, is_legal_guardian from contact where id = $1 and client_id = $2',
      [body.data.givenByContactId, clientId],
    );
    const giver = contact.rows[0];
    if (!giver) return c.json({ error: 'not_found', requestId }, 404);

    for (const { purpose, textDocumentId } of body.data.purposes) {
      const wording = await checkWording(db, textDocumentId, purpose, client.preferred_locale);
      if (!wording.ok) {
        return c.json({ error: 'bad_request', code: wording.code, requestId }, 400);
      }
      const permitted = canGiveConsent(
        { dateOfBirth: client.date_of_birth },
        { id: giver.id, canConsent: giver.can_consent, isLegalGuardian: giver.is_legal_guardian },
        purpose,
        today,
      );
      if (!permitted.ok) {
        return c.json({ error: 'bad_request', code: permitted.reason, requestId }, 400);
      }
      const evidence = checkEvidence(body.data.method, purpose, body.data.evidence);
      if (!evidence.ok) {
        return c.json({ error: 'bad_request', code: evidence.code, requestId }, 400);
      }
    }

    const filed = await fileClientDocument(db, c.get('storage'), actor, {
      clientId,
      kind: body.data.method === 'app_signature' ? CONSENT_SIGNATURE_KIND : CONSENT_SCAN_KIND,
      file: body.data.evidence,
      isImmutable: true,
      now: now(),
    });
    if (!filed.ok) {
      return filed.reason === 'storage_unavailable'
        ? c.json({ error: 'storage_unavailable', requestId }, 503)
        : c.json({ error: 'bad_request', code: filed.reason, requestId }, 400);
    }

    const ids: string[] = [];
    for (const { purpose, textDocumentId } of body.data.purposes) {
      await db.query(
        "update consent set status = 'superseded' where client_id = $1 and purpose = $2 and status = 'active'",
        [clientId, purpose],
      );
      const consentId = randomUUID();
      await db.query(
        'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
          'text_document_id, method, expires_at, signature_document_id, witnessed_by_user_id) ' +
          'values ($1, $2, $3, $4, $5, 1, $6, $7, null, $8, null)',
        [consentId, actor.tenantId, clientId, body.data.givenByContactId, purpose, textDocumentId, body.data.method, filed.document.id],
      );
      ids.push(consentId);
    }
    return c.json(ConsentBundleResponse.parse({ ids, signatureDocumentId: filed.document.id }), 201);
  });
```

`requiredConsents` takes a `ClientRecord`; read `domain/client/types.ts` for its shape and build
the smallest honest object rather than the `as never` above (only `client.dateOfBirth` is read
today; if the type demands more, pass what `toActivationRecord` would, or add a narrower
`requiredConsentsFor({ dateOfBirth }, modes, today)` helper in `requiredConsents.ts` with a
test, and use it in `ConsentTab.tsx` too).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run --config vitest.db.config.ts tests/client/db/consent_bundle.test.ts tests/client/db/consent_documents.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/clients/record-schema.ts app/api/clients/consents.ts tests/client/db/consent_bundle.test.ts domain/client
git commit -m "feat(clients): one signature records every consent a client needs"
```

---

### Task 3: The "Sign everything at once" form

**Files:**
- Create: `app/admin/clients/SignAllForm.tsx`
- Modify: `app/admin/clients/ConsentTab.tsx:126-131, 195-230` (a button above the list; the form in place of the list while open)
- Test: `app/admin/clients/SignAllForm.test.tsx` (new)

**Interfaces:**
- Consumes: `GET /api/clients/consent-wording?purpose=&locale=` per purpose (`ConsentWordingResponse`, then its `textUrl` for the markdown), `ConsentText`, `SignaturePad` with `caption`, `canGiveConsent`, `requiredConsents`, `contactDisplayName`, `POST …/consents/bundle`.
- Produces: `SignAllForm({ clientId, record, onSaved, onCancel })`.

- [ ] **Step 1: Write the failing test**

Model the `mount` helper on `ConsentCapture.test.tsx` (its fetch stub answers the wording,
storage and consent routes; extend it so `/api/clients/consent-wording?purpose=X` answers a
wording whose `id` and `purpose` follow `X`, and so `…/consents/bundle` with `POST` answers
`json({ ids: ['a', 'b', 'c'], signatureDocumentId: 'd' }, 201)`). Then:

```tsx
describe('SignAllForm', () => {
  it('stacks every wording the client needs, gates the pad on the end, and sends one bundle', async () => {
    const calls: Call[] = [];
    const onSaved = vi.fn();
    mount(<SignAllForm clientId={CLIENT_ID} record={adultRecord} onSaved={onSaved} onCancel={vi.fn()} />, { calls });
    expect(await screen.findByRole('heading', { name: 'Participation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Visits at home' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Brain-map and neurofeedback information' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "Guardian's consent for a child" })).toBeNull();
    expect(screen.getByText('Scroll to the end of the wording before signing.')).toBeTruthy();
    stubHeights(1800, 500);
    fireEvent.scroll(screen.getByRole('region', { name: 'Consent wording' }), { target: { scrollTop: 1300 } });
    // draw and name, the way ConsentCapture.test.tsx does
    fireEvent.change(screen.getByLabelText('Name, as the person writes it'), { target: { value: 'Alpha Synthetic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record all three consents' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = calls.find((c) => c.url.endsWith('/consents/bundle'));
    const body = JSON.parse(String(post?.init?.body));
    expect(body.purposes.map((p: { purpose: string }) => p.purpose).sort()).toEqual(['health_data', 'home_visit', 'participation']);
    expect(body.method).toBe('app_signature');
    expect(body.evidence.mimeType).toBe('image/png');
    expect(RecordConsentBundleBody.safeParse(body).success).toBe(true);
  });

  it('asks for the guardian’s consent too when the client is a child, and only a guardian may sign', async () => {
    mount(<SignAllForm clientId={CLIENT_ID} record={childRecord} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: "Guardian's consent for a child" })).toBeTruthy();
    const giver = screen.getByLabelText('Given by') as HTMLSelectElement;
    expect([...giver.options].map((o) => o.textContent)).toEqual(['Beta Synthetic — mother (legal guardian)']);
  });

  it('names the refusal when one wording has moved on', async () => {
    mount(<SignAllForm … />, { bundleResponse: json({ error: 'bad_request', code: 'wording_superseded' }, 400) });
    // …scroll, sign, submit…
    expect((await screen.findByRole('alert')).textContent).toMatch(/newer version/);
  });
});
```

`adultRecord` and `childRecord` are `ClientRecordResponse` fixtures as `ConsentCapture.test.tsx`
builds them (an adult with a self contact who may consent; a child with a mother who is a legal
guardian and may consent).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/clients/SignAllForm.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the form**

```tsx
// app/admin/clients/SignAllForm.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canGiveConsent, requiredConsents, type ConsentPurpose } from '@domain/client';
import {
  ConsentWordingResponse,
  RecordConsentBundleBody,
  type ClientRecordResponse,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { ConsentText } from './ConsentText';
import { SignaturePad, type SignatureResult } from './SignaturePad';
import { compressToFit, type UploadFile } from './fileUpload';
import { contactDisplayName, relationshipLabel } from './contactName';
import { practiceToday, practiceTodayInWords, toActivationRecord } from './activation';

/**
 * Every consent the client needs, signed once (trunk round 43, the operator's
 * decision of 10 September 2026).
 *
 * The wordings are the same approved texts the per-consent form shows, one
 * after another under their own headings; the household reads them all, and
 * the pad unlocks at the end of the stack. One signature image is filed and
 * every consent row points at it, with the purposes printed into the image's
 * foot so the evidence says what it covers. Each row still records the exact
 * wording it was read against: nothing about the wordings changes.
 *
 * What it does not do: a verbal re-confirmation (one purpose's own, at the
 * door) and a withdrawal stay on the per-consent form beneath.
 */

const PURPOSE_LABELS: Record<string, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  health_data: 'Brain-map and neurofeedback information',
};

const REFUSALS: Record<string, string> = {
  wording_not_found: 'One wording is no longer on file. Reopen this form to load the current ones.',
  wording_retired: 'One wording has been retired. Reopen this form for the current ones.',
  wording_superseded:
    'The practice has published a newer version of one wording. Reopen this form to show it.',
  wording_wrong_purpose: 'One wording is for a different consent. Reopen this form.',
  wording_wrong_locale: "One wording is not in this client's own language. Reopen this form.",
  contact_may_not_consent: 'This contact may not give consent.',
  guardian_required: 'A legal guardian has to sign for this client.',
  purpose_not_needed: 'One of these consents is not one this client needs. Reopen this form.',
  evidence_required: 'The signature or the scanned form has to go with the consents.',
};
const FORBIDDEN_ERROR = "You don't have permission to record consent.";
const STORAGE_ERROR = 'The signature could not be filed. Try again in a moment.';
const GENERIC_ERROR = 'The consents could not be recorded. Try again.';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

type Method = 'app_signature' | 'paper_scan';
type Loaded = { purpose: ConsentPurpose; wording: ConsentWordingResponse; markdown: string };
type WordingsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing'; purpose: ConsentPurpose }
  | { kind: 'ready'; wordings: Loaded[] };

function countInWords(n: number): string {
  return ['no', 'one', 'two', 'three', 'four'][n] ?? String(n);
}

export function SignAllForm({
  clientId,
  record,
  onSaved,
  onCancel,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onSaved: (purposes: ConsentPurpose[]) => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const today = practiceToday();
  const purposes = useMemo(
    () => requiredConsents(toActivationRecord(record), ['home'], today) as ConsentPurpose[],
    [record, today],
  );
  // A giver who may give every one of these; a guardian's purpose in the
  // stack narrows the list to guardians, which is the rule the route holds.
  const consenting = useMemo(
    () =>
      record.contacts.filter((contact) =>
        purposes.every(
          (purpose) =>
            canGiveConsent(
              { dateOfBirth: record.dateOfBirth },
              { id: contact.id, canConsent: contact.canConsent, isLegalGuardian: contact.isLegalGuardian },
              purpose,
              today,
            ).ok,
        ),
      ),
    [record.contacts, record.dateOfBirth, purposes, today],
  );
  const locale = record.preferredLocale ?? 'en';
  const [givenByContactId, setGivenByContactId] = useState(consenting[0]?.id ?? '');
  const [method, setMethod] = useState<Method>('app_signature');
  const [state, setState] = useState<WordingsState>({ kind: 'loading' });
  const [readToEnd, setReadToEnd] = useState(false);
  const [signature, setSignature] = useState<SignatureResult | null>(null);
  const [signedName, setSignedName] = useState('');
  const [scan, setScan] = useState<UploadFile | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const loaded: Loaded[] = [];
      for (const purpose of purposes) {
        const res = await apiFetch(
          `/api/clients/consent-wording?purpose=${encodeURIComponent(purpose)}&locale=${encodeURIComponent(locale)}`,
        );
        if (res.status === 404) return { kind: 'missing' as const, purpose };
        if (!res.ok) return { kind: 'error' as const };
        const wording = ConsentWordingResponse.parse(await res.json());
        const text = await fetch(wording.textUrl);
        if (!text.ok) return { kind: 'error' as const };
        loaded.push({ purpose, wording, markdown: await text.text() });
      }
      return { kind: 'ready' as const, wordings: loaded };
    })()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, locale, purposes]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget;
    if (box.scrollHeight <= box.clientHeight || box.scrollTop + box.clientHeight >= box.scrollHeight - 8) {
      setReadToEnd(true);
    }
  }, []);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (node && node.scrollHeight <= node.clientHeight) setReadToEnd(true);
  }, []);

  async function chooseScan(file: File | null): Promise<void> {
    setScanError(null);
    setScan(null);
    if (!file) return;
    const prepared = await compressToFit(file, MAX_DOCUMENT_BYTES);
    if (!prepared.ok) {
      setScanError(prepared.message);
      return;
    }
    setScan(prepared.file);
  }

  const caption = `Signed for: ${purposes.map((p) => (PURPOSE_LABELS[p] ?? p).toLowerCase()).join(', ')}`;

  async function submit(): Promise<void> {
    if (state.kind !== 'ready') return;
    const evidence = method === 'app_signature' ? signature : scan && { mimeType: scan.mimeType, bytesBase64: scan.bytesBase64 };
    if (!evidence) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = RecordConsentBundleBody.parse({
        purposes: state.wordings.map((w) => ({ purpose: w.purpose, textDocumentId: w.wording.id })),
        givenByContactId,
        method,
        evidence,
      });
      const res = await apiFetch(`/api/clients/${clientId}/consents/bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        onSaved(purposes);
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_ERROR);
        return;
      }
      if (res.status === 503) {
        setFormError(STORAGE_ERROR);
        return;
      }
      const answer = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      setFormError(REFUSALS[answer?.code ?? ''] ?? REFUSALS[answer?.error ?? ''] ?? GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const evidenceReady =
    method === 'app_signature' ? signature !== null && signedName.trim() !== '' : scan !== null;
  const canSubmit = !busy && state.kind === 'ready' && readToEnd && givenByContactId !== '' && evidenceReady;

  return (
    <section className="tab-section consent-form">
      <h3 className="drawer__section" tabIndex={-1} ref={(node) => node?.focus()}>
        Sign everything at once
      </h3>
      <p className="small muted">
        {countInWords(purposes.length)[0]?.toUpperCase()}
        {countInWords(purposes.length).slice(1)} consents, read one after another and signed once.
        Each is recorded against the wording shown here.
      </p>

      {consenting.length === 0 ? (
        <Note tone="critical">
          No contact on this record may give all of these consents. A child needs a legal guardian who may consent; mark one on the Contacts tab first.
        </Note>
      ) : (
        <Select id="sign-all-giver" label="Given by" value={givenByContactId} onChange={(e) => setGivenByContactId(e.target.value)}>
          {consenting.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contactDisplayName(contact, record)} — {relationshipLabel(contact.relationship).toLowerCase()}
              {contact.isLegalGuardian ? ' (legal guardian)' : ''}
            </option>
          ))}
        </Select>
      )}

      {state.kind === 'loading' ? <Note>Loading the wordings.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">The wordings could not be loaded. Try again.</Note> : null}
      {state.kind === 'missing' ? (
        <Note tone="critical">
          The practice has no wording on file for {(PURPOSE_LABELS[state.purpose] ?? state.purpose).toLowerCase()} in this client’s language, so nothing can be signed at once yet.
        </Note>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <div
            className="consent-text"
            ref={measure}
            onScroll={onScroll}
            tabIndex={0}
            role="region"
            aria-label="Consent wording"
            {...(locale === 'ar' ? { lang: 'ar', dir: 'rtl' as const } : {})}
          >
            {state.wordings.map((w) => (
              <section key={w.purpose} className="consent-text__part">
                <h4 className="consent-text__part-heading">{PURPOSE_LABELS[w.purpose] ?? w.purpose}</h4>
                <p className="small muted">
                  Version <span className="numeric">{w.wording.version}</span>
                </p>
                <ConsentText markdown={w.markdown} />
              </section>
            ))}
          </div>
          {readToEnd ? null : <p className="small muted">Scroll to the end of the wording before signing.</p>}

          <Select id="sign-all-method" label="How it is being given" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="app_signature">Signed on screen</option>
            <option value="paper_scan">Paper form, photographed or scanned</option>
          </Select>

          {method === 'app_signature' ? (
            <SignaturePad
              signedName={signedName}
              onSignedNameChange={setSignedName}
              onChange={setSignature}
              disabled={!readToEnd}
              today={practiceTodayInWords()}
              caption={caption}
            />
          ) : (
            <div className="field">
              <label htmlFor="sign-all-scan" className="field__label">The signed form</label>
              <input id="sign-all-scan" className="field__input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={!readToEnd} onChange={(e) => void chooseScan(e.target.files?.[0] ?? null)} />
              {scan ? <p className="small muted">Ready to file: {scan.name}</p> : null}
              {scanError ? <Note tone="critical">{scanError}</Note> : null}
            </div>
          )}

          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button type="button" variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
              {busy ? 'Recording…' : `Record all ${countInWords(purposes.length)} consents`}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
```

Read `RecordConsentForm.tsx` for the exact names of `MAX_DOCUMENT_BYTES`, `practiceTodayInWords`,
the `SignaturePad` name handling (`signedName` vs a typed name kept separately) and the
consent-text CSS, and match them. Add `.consent-text__part + .consent-text__part { margin-top: var(--space-6); border-top: 1px solid var(--line); padding-top: var(--space-4); }` to `clients.css` with the tokens it already uses.

- [ ] **Step 4: Offer it on the tab**

In `ConsentTab.tsx` add `const [signingAll, setSigningAll] = useState(false);`. Above the list
(`<ul>` at ~line 200), when `mayWrite && !erased` and at least one required purpose has no
active consent:

```tsx
{missingAny && !signingAll ? (
  <div className="drawer__actions">
    <Button variant="primary" onClick={() => { setOutcome(null); setError(null); setSigningAll(true); }}>
      Sign everything at once
    </Button>
    <p className="small muted">One reading, one signature, every consent this client needs.</p>
  </div>
) : null}
{signingAll ? (
  <SignAllForm
    clientId={clientId}
    record={record}
    onSaved={(purposes) => {
      setSigningAll(false);
      setOutcome(`Consents recorded: ${purposes.map((p) => (PURPOSE_LABELS[p] ?? p).toLowerCase()).join(', ')}.`);
      onChanged();
    }}
    onCancel={() => setSigningAll(false)}
  />
) : null}
```

with `const missingAny = [...required].some((purpose) => !record.consents.some((c) => c.purpose === purpose && c.status === 'active'));`.
Hide the per-consent list while `signingAll` is true (render the `<ul>` only when it is false).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run app/admin/clients && pnpm typecheck && pnpm lint`
Expected: PASS. `ConsentCapture.test.tsx` may count buttons; if "Sign everything at once" changes a count, update the assertion.

- [ ] **Step 6: Commit**

```bash
git add app/admin/clients/SignAllForm.tsx app/admin/clients/SignAllForm.test.tsx app/admin/clients/ConsentTab.tsx app/admin/clients/clients.css
git commit -m "feat(clients): sign everything at once"
```

---

### Task 4: Docs, the gate, the pull request

**Files:**
- Modify: `docs/SPEC/client-record.md` section 7 (consent capture: the bundle and what it never does), `docs/CONSENT/README.md` (one paragraph: a signature may cover several wordings; each consent still names its own), `docs/CHANGE-REQUESTS/trunk-notes.md` (Round 43, part four)

- [ ] **Step 1: Write the docs**

`client-record.md` section 7: a subsection "Signing everything at once" stating the route, the
checks, the one image with its caption, the refusals, and that verbal re-confirmation and
withdrawal stay per consent. `docs/CONSENT/README.md`: the paragraph above, and that no wording
version changed for it. Trunk note: the decision, the compliance reading (each row records the
exact text shown; one evidence document shared), and the files touched.

- [ ] **Step 2: The gate and the pull request**

Run: `pnpm verify && pnpm test:db`. Then:

```bash
git add docs
git commit -m "docs(trunk): round 43, part four — one signature, every consent"
git push
gh pr create --title "trunk round 43, part four: one signature for every consent" --body-file <(cat <<'EOF'
A household signs once for every consent the client needs. The wordings are unchanged and
each consent row still records the exact wording it was read against; what changes is the
evidence: one signature image, filed once, shared by the rows, its foot naming the purposes.

- `POST /api/clients/:id/consents/bundle`, with the single route's checks per purpose and two of its own
- `SignAllForm` on the Consent tab and in the wizard: stacked wordings, one scroll gate, one pad
- `SignaturePad` prints a caption of what the signature covers

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 3: Reviews**

Dispatch `compliance-reviewer` first (the consent model is its centre), then `security-reviewer`.
Fix, re-run the gate, merge only when every check reads SUCCESS.
