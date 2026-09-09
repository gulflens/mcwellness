# Approved Consent Wording v1.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the legal advisor's four recommendations — remove photographs, separate general from sensitive data, take a specific consent for neurofeedback and QEEG data, and state how the data will not be used — across the wording, the app, the reports and the practice's public legal pages.

**Architecture:** The simple wording set becomes version 1.0 and moves to where the seed reads it; the long drafts move to a `superseded/` folder rather than being deleted, because a recorded consent names the text it was given against. A new `health_data` consent purpose gates activation. The setup-photograph capability is removed in the same round as its wording, because that consent is what authorises the camera at runtime.

**Tech Stack:** TypeScript, Vitest, Postgres (numbered SQL migrations), Vite, Hono-style API routes, Hostinger static hosting for the public site.

**Spec:** `docs/superpowers/specs/2026-09-09-approved-wording-design.md`

## Global Constraints

- **This repository is public.** The practice's legal name, trade licence number, tax registration number and registered address must never appear in it. Identity is rendered from owner settings in the database.
- **British English.** Plain language, no clinical vocabulary beyond what the law requires. A person at a kitchen table should be able to read it.
- **Console screens are English only** (`tests/lint/console-is-english.test.ts`). Arabic appears on client-facing surfaces only.
- **Nothing in a client-facing document mentions Claude, AI, tools, repositories or pull requests.** Client-facing text reads as the practice speaking.
- **Enum values are never dropped.** Staging holds 42 consent rows using `photo_video`. Retired purposes stop being offered; they stay legal in the database.
- **Never delete a wording file** that a recorded consent could name. Supersede it.
- Verification gate: `pnpm verify` (format:check, lint, typecheck, audit:secrets, audit:migrations, test).
- Migrations are numbered; the next free number is **960**.

---

### Task 1: The loader accepts several purposes for one wording

The simple `agreement.md` is one page that `participation`, `minor_participation` and `home_visit` all point at. The loader today demands exactly one `purpose:` per file, so it cannot express that without duplicating the text three times and inviting drift.

**Files:**
- Modify: `db/seed/consent-text.ts`
- Test: `db/seed/consent-text.test.ts`

**Interfaces:**
- Produces: `loadConsentTexts(): ConsentText[]` — unchanged signature. A file whose front matter reads `purpose: a, b, c` now yields one `ConsentText` per purpose, each carrying the same `bytes`, the same `sha256Hex` and the same `file`.

- [ ] **Step 1: Write the failing test**

In `db/seed/consent-text.test.ts`:

```ts
it('gives one text per purpose when a file serves several', () => {
  const texts = loadConsentTexts();
  const agreement = texts.filter((t) => t.file === 'agreement.en.md');
  expect(agreement.map((t) => t.purpose).sort()).toEqual([
    'home_visit',
    'minor_participation',
    'participation',
  ]);
  // One page, so the bytes behind each purpose are the same bytes.
  expect(new Set(agreement.map((t) => t.sha256Hex)).size).toBe(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test db/seed/consent-text.test.ts`
Expected: FAIL — no `agreement.en.md` exists yet, so the filter is empty.

- [ ] **Step 3: Teach the loader to split the field**

In `db/seed/consent-text.ts`, replace the single-purpose construction inside `loadConsentTexts` with a `flatMap`:

```ts
const texts: ConsentText[] = files.flatMap((file): ConsentText[] => {
  const bytes = readFileSync(fileURLToPath(new URL(file, CONSENT_DIR)));
  const fields = frontMatter(bytes.toString('utf8'), file);
  const locale = required(fields, 'locale', file);
  const status = required(fields, 'status', file);
  if (locale !== 'en' && locale !== 'ar') {
    throw new Error(`${file} has locale "${locale}"; the practice publishes English and Arabic.`);
  }
  if (status !== 'draft' && status !== 'approved') {
    throw new Error(`${file} has status "${status}"; a wording is draft or approved.`);
  }
  // One page may serve several purposes: the simple agreement is shown for
  // participation, a minor's participation and a home visit alike. Each
  // purpose still files its own document, because a consent names one.
  const purposes = required(fields, 'purpose', file)
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (purposes.length === 0) {
    throw new Error(`${file} names no purpose; a wording is shown for at least one.`);
  }
  const sha256Hex = createHash('sha256').update(bytes).digest('hex');
  const version = required(fields, 'version', file);
  return purposes.map((purpose) => ({ file, purpose, locale, status, version, bytes, sha256Hex }));
});
```

- [ ] **Step 4: Run the whole seed suite**

Run: `pnpm test db/seed/`
Expected: the new test still fails on the missing file (Task 2 supplies it); every existing test passes, because a single-purpose front matter splits to a list of one.

- [ ] **Step 5: Commit**

```bash
git add db/seed/consent-text.ts db/seed/consent-text.test.ts
git commit -m "feat(consent): one page may be shown for several purposes"
```

---

### Task 2: `health_data` becomes a purpose, and a required one

**Files:**
- Modify: `domain/client/types.ts:13-21`, `domain/client/types.ts:39`
- Modify: `domain/client/requiredConsents.ts`
- Modify: `app/api/clients/record-schema.ts:21-28`
- Create: `db/migrations/960_health_data_consent.sql`
- Test: `domain/client/requiredConsents.test.ts`

**Interfaces:**
- Produces: `ConsentPurpose` gains `'health_data'`. `RequiredConsentPurpose` becomes `'participation' | 'minor_participation' | 'home_visit' | 'health_data'`. `requiredConsents()` returns `health_data` for every client.

- [ ] **Step 1: Write the failing test**

In `domain/client/requiredConsents.test.ts`:

```ts
it('always requires the health-data consent', () => {
  const record = adultRecordAt('2026-09-09');
  expect(requiredConsents(record, ['studio'], '2026-09-09')).toEqual([
    'health_data',
    'participation',
  ]);
});

it('requires health_data alongside a minor and a home visit', () => {
  const record = minorRecordAt('2026-09-09');
  expect(requiredConsents(record, ['home'], '2026-09-09')).toEqual([
    'health_data',
    'home_visit',
    'minor_participation',
    'participation',
  ]);
});
```

Use whichever record helpers the existing tests in this file already use; do not invent new ones.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test domain/client/requiredConsents.test.ts`
Expected: FAIL — received arrays lack `health_data`.

- [ ] **Step 3: Add the purpose to both type lists**

In `domain/client/types.ts`, add `'health_data',` to `CONSENT_PURPOSES` after `'home_visit',`, and widen the required type:

```ts
export type RequiredConsentPurpose =
  | 'participation'
  | 'minor_participation'
  | 'home_visit'
  | 'health_data';
```

In `app/api/clients/record-schema.ts`, add `'health_data',` to `CONSENT_PURPOSES` in the same position, so the route validator and the domain agree.

- [ ] **Step 4: Require it**

In `domain/client/requiredConsents.ts`, seed the list with both purposes and update the doc comment to say so:

```ts
const purposes: RequiredConsentPurpose[] = ['participation', 'health_data'];
```

- [ ] **Step 5: Add the enum value in the database**

Create `db/migrations/960_health_data_consent.sql`:

```sql
-- The advisor asked for a specific consent for neurofeedback and QEEG data,
-- separate from the agreement to take part, because health information is
-- more sensitive than a name and deserves its own yes.
--
-- Added, never swapped: `photo_video`, `research` and `marketing` stay legal
-- values because rows already name them. What changes is what the console
-- offers, not what the column may hold.
alter type public.consent_purpose add value if not exists 'health_data';
```

- [ ] **Step 6: Run the tests and the migration audit**

Run: `pnpm test domain/client/ && pnpm audit:migrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add domain/client/types.ts domain/client/requiredConsents.ts domain/client/requiredConsents.test.ts app/api/clients/record-schema.ts db/migrations/960_health_data_consent.sql
git commit -m "feat(consent): health data is its own consent, and it is required"
```

---

### Task 3: Promote the simple set, retire the long drafts

The seed reads `docs/CONSENT/*.md` and does not recurse. The approved pages must therefore sit at that level, and the superseded drafts must sit below it.

**Files:**
- Move: `docs/CONSENT/simple/agreement.md` → `docs/CONSENT/agreement.en.md`
- Move: `docs/CONSENT/simple/your-information.md` → `docs/CONSENT/your-information.en.md`
- Move: `docs/CONSENT/{participation,minor-participation,home-visit,photo-video}.{en,ar}.md` → `docs/CONSENT/superseded/`
- Move: `docs/CONSENT/simple/{README.md,for-review.md,bookings-and-packages.md}` → keep in `docs/CONSENT/simple/` (they are not consent wording; `bookings-and-packages.md` and `for-review.md` have no front matter and must not be loaded)
- Modify: `docs/CONSENT/README.md`

- [ ] **Step 1: Move the files**

```bash
cd docs/CONSENT
mkdir -p superseded
git mv participation.en.md participation.ar.md minor-participation.en.md minor-participation.ar.md home-visit.en.md home-visit.ar.md photo-video.en.md photo-video.ar.md superseded/
git mv simple/agreement.md agreement.en.md
git mv simple/your-information.md your-information.en.md
cd ../..
```

- [ ] **Step 2: Give the two promoted pages their front matter**

At the very top of `docs/CONSENT/agreement.en.md`:

```markdown
---
purpose: participation, minor_participation, home_visit
locale: en
version: 1.0
status: approved
written: 2026-09-09
---
```

At the very top of `docs/CONSENT/your-information.en.md`:

```markdown
---
purpose: information_notice
locale: en
version: 1.0
status: approved
written: 2026-09-09
---
```

`information_notice` is not a consent purpose and no consent is recorded against it; it is filed so the version a household was shown can be named. Add `'information_notice'` to neither `CONSENT_PURPOSES` list — the loader's `purpose` field is a free string, and the database's `document.kind` is what constrains it.

- [ ] **Step 3: Mark the superseded drafts**

In each of the eight files under `docs/CONSENT/superseded/`, change the front matter `status:` line to `status: draft` (unchanged) and add one line directly beneath the front matter:

```markdown
**Superseded on 9 September 2026 by the approved wording in the folder above. Kept because consents recorded on staging name this text.**
```

- [ ] **Step 4: Stop the loader reading the superseded folder**

`readdirSync` does not recurse, so the folder is already invisible to it. Confirm rather than assume:

Run: `pnpm test db/seed/consent-text.test.ts`
Expected: the Task 1 test now PASSES; any test asserting eight wording files fails and must be updated to the new set (`agreement.en.md` × 3 purposes, `your-information.en.md`).

- [ ] **Step 5: Rewrite `docs/CONSENT/README.md`**

Replace the "Status: DRAFT, pending the lawyer" section with a section recording that the advisor approved the wording on 9 September 2026 subject to four changes, listing them, and stating that the identity of the practice is rendered from owner settings and never written here. Update the purpose table to the five live purposes and note the three retired ones.

- [ ] **Step 6: Commit**

```bash
git add docs/CONSENT
git commit -m "feat(consent): the simple wording is the approved wording"
```

---

### Task 4: The photographs come out of the agreement

**Files:**
- Modify: `docs/CONSENT/agreement.en.md`

- [ ] **Step 1: Delete the section**

Remove these five lines entirely, leaving no heading behind:

```markdown
## Photographs (optional)

[ ] The practitioner may photograph the sensor placement at the start of a
session, so the next one can match it. Never the face. Kept with my record,
never shared, deleted when my record is.
```

- [ ] **Step 2: Check nothing else in the file mentions a photograph**

Run: `grep -in "photo\|picture\|camera\|image" docs/CONSENT/agreement.en.md`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add docs/CONSENT/agreement.en.md
git commit -m "feat(consent): no photographs are taken, so none are agreed to"
```

---

### Task 5: Ordinary details and health information read apart

Recommendation 2 (separate the two kinds) and recommendation 4 (say how the data will not be used).

**Files:**
- Modify: `docs/CONSENT/your-information.en.md`

- [ ] **Step 1: Replace the "What we keep" paragraph with two**

```markdown
**What we keep — your ordinary details.** Your name and contact details, your
date of birth, the address we visit, the agreements you sign, your
appointments, and what you have paid. For a child, the parent's or guardian's
name and contact details too. If you give us your Emirates ID number we store
it sealed so staff cannot read it back; we never keep a picture of an ID.

**What we keep — your health information.** Your session records: the sensor
readings, any brain map (qEEG) and the reports written from it, the health
answers you gave us, and the ratings you give before and after a session.
This is more sensitive than the rest, so we ask for it separately and you
agree to it separately, on the page "Your brain-map and neurofeedback
information".
```

- [ ] **Step 2: Replace the "Who sees it" sentence about selling with a section of its own**

Leave "Who sees it" describing only who sees it, and add directly after it:

```markdown
**How we will not use it.** We never sell your information. We never use it
for advertising. We never use it for research, and we never use it for
anything unrelated to your sessions and your account with us. If that ever
changes we will ask you first, separately, and you may say no.
```

- [ ] **Step 3: Read the whole page back**

Run: `cat docs/CONSENT/your-information.en.md`
Check: no photograph is mentioned anywhere; "Where it is kept" still names Mumbai, India; "How long" still says five years.

- [ ] **Step 4: Commit**

```bash
git add docs/CONSENT/your-information.en.md
git commit -m "feat(consent): ordinary details and health information read apart"
```

---

### Task 6: The new health-data consent

The page the advisor asked for and has not seen. It answers their six requirements in their order.

**Files:**
- Create: `docs/CONSENT/health-data.en.md`

- [ ] **Step 1: Write the page**

```markdown
---
purpose: health_data
locale: en
version: 1.0
status: approved
written: 2026-09-09
---

# Your brain-map and neurofeedback information

McWellness, Dubai. September 2026. This page is about one kind of information:
what your brain is doing. It is separate from the rest because it is more
sensitive than a name or a phone number, and it deserves its own yes.

## What we collect

The sensor readings taken during a session — your brain's own electrical
activity, picked up from the scalp. A brain map (qEEG) where one is made: a
recording of the same kind, taken across the head. The reports we write from
them. The health answers you gave us, and the ratings you give before and
after a session.

## Why we collect it

To set your training up safely, to choose what each session works on, and to
see whether it is helping. Without it there is nothing to train on and no way
to tell whether anything has changed.

## How we use it

To plan, deliver and review your own sessions, and to write your own reports.
That is all.

## How we will not use it

We do not sell it. We do not use it for advertising. We do not use it for
research. We do not use it for anything unrelated to your sessions. If that
ever changes we will ask you first, separately, and you may say no.

## Who can see it

Your practitioner, and the practice's staff where their job needs it. For a
child under eighteen, the parent or guardian who signs. Nobody else — not a
school, not an employer, not another family member — unless you tell us so in
writing, or the law requires it, or we believe someone is in serious danger.

## Where it is kept

In our own system, hosted in Mumbai, India, by our hosting provider, under
contract and only to run the service. It is encrypted on the way there, and
each household can only ever see its own records.

## How long we keep it

Five years after your last session or contact with us, and then it is deleted.

## What you can do about it

Ask to see it. Ask us to correct it. Ask us to delete it. Withdraw this
agreement whenever you like — which means we stop collecting it, and sessions
cannot continue, because there would be nothing to train on. None of this
costs you anything and none of it changes how we treat you.

## Agreement

I understand what a brain map and a neurofeedback recording are, and I agree
to McWellness collecting and using mine as this page describes.

Name: ______________________________

Signature: ______________________________  Date: ______________
```

- [ ] **Step 2: Prove the loader files it**

Run: `pnpm test db/seed/consent-text.test.ts`
Expected: PASS, with a `health_data`/`en`/`1.0` text present.

- [ ] **Step 3: Commit**

```bash
git add docs/CONSENT/health-data.en.md
git commit -m "feat(consent): a specific agreement for brain-map and neurofeedback information"
```

---

### Task 7: Arabic, translated once

The founder's instruction was that Arabic follows once the English is final, so the words are translated once. This is that moment. **Risk recorded in the spec: no Arabic reader reviews these before a household signs.**

**Files:**
- Create: `docs/CONSENT/agreement.ar.md`
- Create: `docs/CONSENT/your-information.ar.md`
- Create: `docs/CONSENT/health-data.ar.md`

**Interfaces:**
- Produces: three files whose front matter mirrors the English exactly except `locale: ar`. Same `purpose` lists, same `version: 1.0`, same `status: approved`.

- [ ] **Step 1: Translate, faithfully and section for section**

These are the texts an Arabic-speaking client signs — faithful translations, not summaries. Every heading, paragraph and signature line in the English has a counterpart. Use these headings so the terminology cannot drift between the three pages:

| English | Arabic |
|---|---|
| Agreement to take part | اتفاقية المشاركة |
| What we do | ما نقوم به |
| What a session is like | كيف تسير الجلسة |
| Please tell us before the first session | أخبرنا قبل الجلسة الأولى |
| Bookings and your information | الحجوزات ومعلوماتك |
| For a child under 18 | للأطفال دون سن الثامنة عشرة |
| Agreement | الإقرار |
| Your information | معلوماتك |
| Your brain-map and neurofeedback information | معلومات خريطة الدماغ والارتجاع العصبي |
| What we collect | ما الذي نجمعه |
| Why we collect it | لماذا نجمعه |
| How we use it | كيف نستخدمه |
| How we will not use it | ما لن نستخدمه فيه |
| Who can see it | من يمكنه الاطلاع عليه |
| Where it is kept | أين يُحفظ |
| How long we keep it | مدة الاحتفاظ به |
| What you can do about it | حقوقك بشأنه |

Keep "qEEG" and "McWellness" in Latin script, as the invoice and report renderers already do.

- [ ] **Step 2: Prove every purpose has both languages**

Add to `db/seed/consent-text.test.ts`:

```ts
it('publishes every live purpose in both languages at version 1.0', () => {
  const texts = loadConsentTexts();
  for (const purpose of ['participation', 'minor_participation', 'home_visit', 'health_data']) {
    for (const locale of ['en', 'ar'] as const) {
      const text = texts.find((t) => t.purpose === purpose && t.locale === locale);
      expect(text, `${purpose}/${locale}`).toBeDefined();
      expect(text?.version).toBe('1.0');
      expect(text?.status).toBe('approved');
    }
  }
});
```

- [ ] **Step 3: Run it**

Run: `pnpm test db/seed/consent-text.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/CONSENT/*.ar.md db/seed/consent-text.test.ts
git commit -m "feat(consent): the approved wording in Arabic"
```

---

### Task 8: The console stops offering the retired purposes

`photo_video`, `research` and `marketing` stay legal in the database and disappear from every screen.

**Files:**
- Modify: `app/admin/clients/ConsentTab.tsx:19`
- Modify: `app/admin/clients/RecordConsentForm.tsx:41`
- Modify: `app/client/i18n/dictionary.ts:193-195`
- Modify: `domain/shared/audit-narrative.ts:173-174`
- Test: `app/admin/clients/ConsentCapture.test.tsx`

**Interfaces:**
- Consumes: `ConsentPurpose` from Task 2, now including `'health_data'`.
- Produces: an `OFFERED_CONSENT_PURPOSES` list exported from `domain/client/types.ts`:

```ts
/**
 * The purposes a screen may offer today. `photo_video`, `research` and
 * `marketing` are absent deliberately: the practice takes no photographs and
 * uses health information for nothing but the household's own sessions. They
 * remain in `CONSENT_PURPOSES` because rows already name them.
 */
export const OFFERED_CONSENT_PURPOSES = [
  'participation',
  'minor_participation',
  'home_visit',
  'health_data',
] as const satisfies readonly ConsentPurpose[];
```

- [ ] **Step 1: Write the failing test**

In `app/admin/clients/ConsentCapture.test.tsx`:

```ts
it('offers no retired purpose', () => {
  render(<RecordConsentForm {...defaultProps} />);
  for (const gone of ['Photographs and video', 'research', 'marketing']) {
    expect(screen.queryByText(new RegExp(gone, 'i'))).toBeNull();
  }
  expect(screen.getByText(/brain-map and neurofeedback/i)).toBeInTheDocument();
});
```

Reuse whatever `defaultProps` the neighbouring tests in this file already build.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test app/admin/clients/ConsentCapture.test.tsx`
Expected: FAIL — "Photographs and video" is still offered.

- [ ] **Step 3: Change the labels**

In `ConsentTab.tsx` and `RecordConsentForm.tsx`, delete the `photo_video`, `research` and `marketing` entries from the label maps and add:

```ts
health_data: 'Brain-map and neurofeedback information',
```

Drive both screens' iteration from `OFFERED_CONSENT_PURPOSES` rather than from `CONSENT_PURPOSES`, so a retired purpose cannot reappear by being added to the wrong list.

In `app/client/i18n/dictionary.ts`, delete the `photo_video`, `research` and `marketing` entries and add:

```ts
health_data: t('brain-map and neurofeedback information', 'معلومات خريطة الدماغ والارتجاع العصبي'),
```

In `domain/shared/audit-narrative.ts`, keep every existing entry — an audit line must still narrate a historical `photo_video` withdrawal — and add the `health_data` entry alongside.

- [ ] **Step 4: Run the console tests**

Run: `pnpm test app/admin/clients/ && pnpm test domain/shared/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain/client/types.ts app/admin/clients app/client/i18n/dictionary.ts domain/shared/audit-narrative.ts
git commit -m "feat(consent): the console offers only what the practice asks for"
```

---

### Task 9: The photograph capability is removed

The document and the capability move together. Leaving the routes would leave a live way to store photographs of clients with nothing signed to permit it.

**Files:**
- Delete: `app/api/sessions/photo.ts`, `app/api/sessions/photo-link.ts`, `app/api/sessions/photo-availability.ts`
- Modify: `app/api/create-api.ts` (drop the route registrations)
- Modify: `app/api/sessions/schema.ts:90`, `:247` (drop the consent flag and the `consent_missing_photo_video` refusal reason)
- Modify: `app/api/sessions/events.ts:46,150-152`, `open.ts:110`, `checkin.ts:66`, `session-row.ts`, `close.ts`
- Modify: `app/api/clients/withdrawal.ts`, `app/api/clients/consents.ts:448-460`, `app/api/clients/documents.ts:137-152`
- Modify: `app/therapist/session/PreflightStep.tsx`, `PostStep.tsx`, `SessionRunner.tsx`, `CheckInPage.tsx`
- Test: `app/api/clients/withdrawal.test.ts`, `tests/session/outbox.test.ts`, `tests/session/db/run.test.ts`, `tests/portal/fixtures.ts`, `tests/db/document-guard.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/session/outbox.test.ts`, replace the assertion that photo events are refused with one that no photo route exists:

```ts
it('has no photograph route to call', async () => {
  const response = await app.request('/api/sessions/00000000-0000-0000-0000-000000000001/photo', {
    method: 'POST',
  });
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tests/session/outbox.test.ts`
Expected: FAIL — the route answers 403, not 404.

- [ ] **Step 3: Delete the routes and their registrations**

```bash
git rm app/api/sessions/photo.ts app/api/sessions/photo-link.ts app/api/sessions/photo-availability.ts
```

Remove the matching `import` and `.route(...)` lines from `app/api/create-api.ts`.

- [ ] **Step 4: Unpick the consent probes**

In `open.ts`, `checkin.ts` and `events.ts`, delete the `select app.session_consent_active($1, 'photo_video')` queries and every field they fed. In `schema.ts`, remove the photo-consent boolean from the session shape and `'consent_missing_photo_video'` from the refusal-reason union. In `events.ts`, delete the branch that refuses a photo event by that name.

In `consents.ts` and `documents.ts`, delete the `photo_video` special cases — the comments at `consents.ts:448` and `documents.ts:137` explain what they did, and both go with the feature. In `withdrawal.ts`, delete the setup-photo deletion path and its doc comment; withdrawing a consent no longer deletes any file.

- [ ] **Step 5: Take the camera out of the session runner**

Remove the photo step from `PreflightStep.tsx` and `PostStep.tsx`, the photo state and handlers from `SessionRunner.tsx`, and the photo-consent probe from `CheckInPage.tsx`. A session's steps must renumber cleanly — read each file's step sequence and check nothing refers to a step that no longer exists.

- [ ] **Step 6: Update the fixtures and remaining tests**

In `tests/portal/fixtures.ts` and `tests/session/db/run.test.ts`, drop `photo_video` from the purposes each fixture grants and drop the `photoConsent` option. In `tests/db/document-guard.test.ts` and `tests/client/db/consent_documents.test.ts`, keep the tests that prove historical `photo_video` rows are still readable and delete the ones that exercise capture.

- [ ] **Step 7: Run everything**

Run: `pnpm verify`
Expected: PASS. Fix any straggling reference the compiler names.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sessions): the practice takes no photographs, so the app cannot"
```

---

### Task 10: The database forgets how to authorise a photograph

**Files:**
- Create: `db/migrations/961_retire_setup_photo.sql`

- [ ] **Step 1: Read what migration 306 created**

Run: `sed -n '280,320p' db/migrations/306_kit_and_setup_photo.sql`
Note the exact function name and signature at line 288 onwards before writing the drop.

- [ ] **Step 2: Write the migration**

Create `db/migrations/961_retire_setup_photo.sql`, naming the function exactly as Step 1 found it:

```sql
-- The practice does not photograph clients or their sessions, on the legal
-- advisor's recommendation of 9 September 2026. The wording that authorised a
-- setup photograph is withdrawn, so the function that checked for it goes too:
-- a guard with nothing left to guard is a guard someone will later mistake for
-- permission.
--
-- The `photo_video` enum value stays. Rows on staging name it and history is
-- not ours to rewrite.
drop function if exists app.setup_photo_permitted(uuid);

-- Any bytes already captured are removed with their rows; production has none.
delete from session_photo;
drop table if exists session_photo;
```

Confirm both object names against the schema before running; if `session_photo` is named differently, use the real name.

- [ ] **Step 3: Run the migration against a local database**

Run: `pnpm db:up && pnpm db:migrate && pnpm audit:migrations`
Expected: applies cleanly; the audit passes.

- [ ] **Step 4: Run the database tests**

Run: `pnpm test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/961_retire_setup_photo.sql
git commit -m "feat(db): retire the setup photograph and its guard"
```

---

### Task 11: The draft line comes off

**Files:**
- Modify: `domain/reports/document/strings.ts:19-23`, `:105-120`, `:160-170`
- Modify: `app/admin/clients/RecordConsentForm.tsx`, `app/api/clients/consent-wording.ts`
- Test: `domain/reports/document/` tests covering `NOT_A_CLINIC` and the draft line

- [ ] **Step 1: Write the failing test**

```ts
it('quotes the approved agreement word for word', () => {
  const agreement = readFileSync('docs/CONSENT/agreement.en.md', 'utf8');
  expect(agreement).toContain(NOT_A_CLINIC.en);
});

it('prints no draft line once the wording is approved', () => {
  expect(WORDING_IS_DRAFT).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test domain/reports/`
Expected: FAIL on both — the quote comes from the retired draft, and the flag is still `true`.

- [ ] **Step 3: Re-point the quotation**

`NOT_A_CLINIC` quotes `participation.en.md` section 2, which is now superseded. Replace its English with the approved agreement's own sentence, copied exactly from `docs/CONSENT/agreement.en.md`:

```ts
export const NOT_A_CLINIC: Phrase = {
  en:
    'We are a wellness practice, not a clinic. We do not diagnose or treat medical or ' +
    'psychological conditions, and we are not an emergency service. Keep seeing your doctor. ' +
    'People respond differently and we cannot promise a result.',
  ar: '<the same sentence, copied exactly from docs/CONSENT/agreement.ar.md>',
};
```

Update the file's doc comment at lines 13-17 to name `docs/CONSENT/agreement.en.md` instead of the retired draft.

- [ ] **Step 4: Turn the flag off**

```ts
export const WORDING_IS_DRAFT = false;
```

Update the comment above it: the pull request carrying the approved text is this one, and the advisor approved on 9 September 2026.

- [ ] **Step 5: Drop the draft line from the agreements**

In `RecordConsentForm.tsx` and `app/api/clients/consent-wording.ts`, remove the draft banner. A wording whose front matter says `status: approved` shows no draft line; keep the code path that would still show one for a `status: draft` text, so a future draft is not silently presented as approved.

- [ ] **Step 6: Run everything**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(reports): the wording is approved, so no copy says otherwise"
```

---

### Task 12: Seed the wording and walk it on staging

**Files:** none changed; this is a verification task.

- [ ] **Step 1: Clear the filled storage keys on staging**

Staging holds 12 wording documents whose storage keys are filled, and neither `seed` nor `seed:wording` overwrites a filled key. Clear them first, or the old bytes stay behind the new rows. `docs/CONSENT/README.md` describes the rule; follow it exactly.

- [ ] **Step 2: Migrate and seed staging**

Run: `pnpm db:migrate && pnpm seed:wording` against staging.
Expected: eight rows written — four purposes × two languages.

- [ ] **Step 3: Walk the enrolment by hand**

Enrol a test household on staging and confirm: four consents are asked for, one of them the brain-map page; no photograph is offered anywhere; no draft line appears on the agreement or on a rendered report; the Arabic pages render right-to-left and read as complete documents rather than summaries.

- [ ] **Step 4: Confirm a client cannot be activated without the health consent**

Record every consent except `health_data` and attempt activation. Expected: refused, naming the missing consent.

- [ ] **Step 5: Report to the operator and stop**

Production waits on the operator's word, as every previous round has. Do not seed or deploy production in this task.

---

### Task 13: The public legal pages

**Files:** the live static site at `the account's document root for that domain (the hosting username is not written in this public repository)` (Hostinger), pages `terms` and `privacy`.

- [ ] **Step 1: Fetch both pages**

Pull the current `terms` and `privacy` pages down before editing, and keep the originals in the scratchpad so a mistake is reversible.

- [ ] **Step 2: Apply document 8's corrections**

`Documents/For the lawyer 2026-09-07/8 Website terms and privacy policy - corrections.md` tabulates every sentence, its replacement and why. Apply the table.

- [ ] **Step 3: Apply the four new changes, and one reversal**

- **Reversal:** document 8 proposed *adding* a photographs section to the privacy policy. That proposal is dead. Remove every mention of photographs from both pages instead; the practice takes none.
- Split the "what we hold" list into ordinary details and health information, matching `docs/CONSENT/your-information.en.md`.
- Add a neurofeedback and QEEG section matching `docs/CONSENT/health-data.en.md`.
- Add the negative-use statement: never sold, never for advertising, never for research, never for anything unrelated.

- [ ] **Step 4: Check for contradictions with the app**

Run: `grep -in "photo\|tax invoice\|clinical\|VAT" <the two fetched pages>`
Expected: no photograph mention; no "tax invoice" (the practice is not VAT-registered); no "clinical".

- [ ] **Step 5: Deploy, after checking nobody else is deploying**

Use `ListAgents` and message any other live session before deploying — a parallel deploy deletes the loser's uploaded archive with no logs. Then deploy and confirm both pages serve.

- [ ] **Step 6: Commit the local copies**

```bash
git add -A
git commit -m "docs: the website's legal pages match what the practice does"
```

---

### Task 14: The covering note, and the subdomains

- [ ] **Step 1: Write the covering note**

Write `Documents/For the lawyer 2026-09-09/health-data consent for confirmation.md`, **outside** anything that would go in the public repository if it names the practice's identity. It reads as the practice speaking — never as a tool, a repository or a pull request — and it says: what was asked for, the page written in answer, and a request to confirm or correct it. Attach the English and Arabic health-data pages.

- [ ] **Step 2: Report on the subdomains**

Inspect `intake.mcwellnessuae.com` and `qeeg.mcwellnessuae.com`. For each, report to the operator: whether it collects personal or health information, whether it shows any legal text, and whether it mentions photographs. Recommend whether a follow-up round is needed. **Do not change them** — the operator scoped this round to the main site.

- [ ] **Step 3: Hand over**

Report: what shipped, what is on staging, what waits on the operator's word for production, and the three risks from the spec's section 7 restated plainly.

---

## Self-Review

**Spec coverage.** Recommendation 1 → Tasks 4, 9, 10, 13. Recommendation 2 → Tasks 5, 13. Recommendation 3 → Tasks 2, 6, 7, 13. Recommendation 4 → Tasks 5, 6, 13. Draft line → Task 11. Simple set to v1.0 → Tasks 1, 3. Retired purposes → Task 8. Arabic → Task 7. Website → Task 13. Covering note and subdomain report → Task 14. No spec section is unclaimed.

**Types.** `OFFERED_CONSENT_PURPOSES` is defined in Task 8 and used only there and after. `RequiredConsentPurpose` is widened in Task 2 before `requiredConsents` returns `health_data`. `ConsentText` keeps its shape across Task 1; only the number of records changes.

**Known soft spots, to resolve during execution rather than guess at now.**
- Task 10 names `app.setup_photo_permitted` and `session_photo` from a partial read of migration 306. Step 1 of that task exists precisely to confirm both before the drop is written.
- Task 11's Arabic for `NOT_A_CLINIC` is marked to be copied from `agreement.ar.md`, which Task 7 creates. It cannot be written earlier without inventing it.
