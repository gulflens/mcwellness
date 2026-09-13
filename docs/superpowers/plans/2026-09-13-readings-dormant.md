# Readings dormant, the software's export attached — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop asking a practitioner to transcribe readings off the practice's professional software during a visit, and let them attach that software's exported result to the visit instead — with the app's own reading capability switched off rather than deleted.

**Architecture:** One practice-wide boolean, shipped `false`, removes two steps from the visit's sequence while leaving every component, domain function and database column in place. A second nullable `document` reference on `session` carries the export, mirroring the `setup_photo_document_id` that already exists there, and reusing the upload route, signature check and storage keys the assessment side already uses.

**Tech Stack:** TypeScript, React 18, Hono, PostgreSQL (Supabase), Vitest + Testing Library, Prettier, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-13-readings-dormant-design.md` (commit `d3da0c2`)

## Global Constraints

- **Migration ranges are owned.** The trunk's are `000–099 and 900–999`; core is exhausted at 099 so the trunk continues at 900. **964 is the next free trunk number.** `session-capture` owns `300–399`; **307 is the next free.** Never renumber, and check every OPEN branch before claiming a number, not just `main`.
- **Every migration declares `-- Needs:`** naming the migrations it depends on, and `checkNeeds` refuses a `Needs` at or above the file's own number. Follow the header shape in `db/migrations/963_backfill_primary_location.sql`.
- **McWellness is a wellness business, not a clinic.** No code, copy, schema or fixture describes a diagnosis, a treatment, a patient or a medical claim. Clients have goals, sessions and measurements.
- **Never write real or realistic personal data** into any file, test, fixture, seed or commit. Emirates IDs must be `784-1900-*`; UAE mobiles `+971 50 000 xxxx`. `.claude/hooks/no-real-identifiers.sh` enforces this on `Write`/`Edit` but **not** on shell heredocs.
- **Business rules live in `domain/` as pure functions with tests written first.** No business logic in components, routes or SQL.
- **Every read and write of personal data goes through the audit context middleware.** Never log personal data.
- **Retention is a MINIMUM of 5 years** after last activity; erasure happens when the client asks. A new client document must be swept by erasure like every other.
- **Colour comes only from `app/shell/tokens.css`.** No hex literals in components.
- **The admin console and practitioner app are English only.** No `lang="ar"` or `dir="rtl"` there.
- **This repo has no jest-dom**: use `.value` / `toBe`, not `toHaveValue`; add `afterEach(cleanup)`; component tests need `// @vitest-environment jsdom` as the FIRST line.
- **`react-hooks/set-state-in-effect` is enforced.** Do not set state inside `useEffect`; use the render-body resync pattern in `app/shell/components/DateField.tsx`.
- **Run `pnpm verify` before declaring work done** — `format:check && lint && typecheck && audit:secrets && audit:migrations && test`. **Prettier fails first**, so run `npx prettier --write .` before verifying.
- Conventional commit messages, body ending with exactly:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `db/migrations/964_practice_records_readings.sql` | The switch's column, default `false` |
| `db/migrations/307_session_export_document.sql` | The export's `document` reference on `session` |
| `app/api/sessions/export.ts` | The upload route for a session's export |
| `app/therapist/session/ExportStep.tsx` | Attaching the export at the visit |
| `tests/lint/dormant-readings-stay-alive.test.ts` | Guard: dormant code must not rot |
| `docs/CHANGE-REQUESTS/trunk-round-49.md` | The round's ownership record |

**Modified:** `app/api/practice/schema.ts` and its route (the field); `app/admin/settings/PracticeDrawer.tsx` (the control); `app/therapist/session/steps.ts` (the sequence); `RunStep.tsx` (the reading panel); `SessionRunner.tsx` (the step wiring); `app/api/sessions/schema.ts` and `close.ts`; `app/admin/clients/` session list (the missing-export marker); `docs/SPEC/session-capture.md` sections 3.3, 3.4, 9.

---

## Task 1: The switch's column

**Files:**
- Create: `db/migrations/964_practice_records_readings.sql`
- Test: `tests/db/practice.test.ts` (extend; find the file that already asserts practice columns)

**Interfaces:**
- Produces: `tenant.record_readings boolean not null default false` — the practice IS the tenant row; there is no `practice` table

- [ ] **Step 1: Confirm 964 is still free across every open branch**

```bash
git fetch origin
for b in $(git branch -r --format='%(refname:short)'); do git ls-tree --name-only "$b" db/migrations/ 2>/dev/null; done | sort -u | grep -E '^96[0-9]' 
```
Expected: nothing at `964`. If something appears, take the next free number and say so in your report.

- [ ] **Step 2: Write the failing test**

Find the existing database test that asserts the practice's columns (grep `tests/db/` for `vat_registered`) and add:

```ts
it('records readings off by default, because the practice uses its own software', async () => {
  const { rows } = await sql(
    `select record_readings from public.tenant where id = $1`,
    [tenantId],
  );
  expect(rows[0].record_readings).toBe(false);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:db -- practice`
Expected: FAIL — `column "record_readings" does not exist`.

- [ ] **Step 4: Write the migration**

```sql
-- 964_practice_records_readings.sql
-- Needs: 905 (practice identity columns)
--
-- The practice runs its brain mapping and its neurofeedback on professional
-- software, on a Windows laptop the practitioner carries as part of the
-- equipment (the operator, 13 September 2026). This app never measured
-- anything — session-capture.md section 3.3 has always described its figures
-- as "manual entry of the vendor software's numbers" — so what stops is a
-- practitioner transcribing three numbers off that software's screen.
--
-- Default false, deliberately. A newly bootstrapped environment must behave
-- the way this practice works rather than inheriting a behaviour nobody wants
-- and having to be corrected later; docs/CHANGE-REQUESTS records what fresh
-- environments have silently lacked before, and this must not join that list.
--
-- Nothing is dropped. The reading columns, the event shapes and the domain
-- functions all stay, and this switch turns them back on.

alter table tenant
  add column record_readings boolean not null default false;

comment on column public.tenant.record_readings is
  'Whether a visit asks the practitioner to enter signal, artefact and reward figures. Off since 2026-09-13: the practice uses its own professional software and attaches its export instead.';
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm db:migrate && pnpm test:db -- practice`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write db tests
git add db/migrations/964_practice_records_readings.sql tests/db
git commit -m "feat(practice): a switch for the app's own readings, off"
```

---

## Task 2: The switch through the route and onto the screen

**Files:**
- Modify: `app/api/practice/schema.ts`, the practice route that reads and writes it, `app/admin/settings/PracticeDrawer.tsx`
- Test: `app/admin/settings/PracticePage.test.tsx` (extend)

**Interfaces:**
- Consumes: `tenant.record_readings` from Task 1 (the practice IS the tenant row)
- Produces: `recordReadings: boolean` on the practice response and its update body

- [ ] **Step 1: Write the failing tests**

In `app/admin/settings/PracticePage.test.tsx`:

```tsx
it('shows the readings switch off, with a reason', async () => {
  render(<PracticePage />, { wrapper: withPractice({ recordReadings: false }) });
  const box = await screen.findByLabelText('Record readings during a session');
  expect((box as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/uses its own software/i)).toBeTruthy();
});

it('sends the switch when it is turned on', async () => {
  const user = userEvent.setup();
  const sent = mockPatch();
  render(<PracticePage />, { wrapper: withPractice({ recordReadings: false }) });
  await user.click(await screen.findByLabelText('Record readings during a session'));
  await user.click(screen.getByRole('button', { name: /save/i }));
  expect(sent.body).toMatchObject({ recordReadings: true });
});
```

Match the file's existing fixture helpers rather than the invented names above — read the top of `PracticePage.test.tsx` first and use whatever it already provides.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run app/admin/settings/PracticePage.test.tsx`
Expected: FAIL — no such label.

- [ ] **Step 3: Add the field to the schema**

In `app/api/practice/schema.ts`, add `recordReadings: z.boolean()` to the response shape and `recordReadings: z.boolean().optional()` to the update body, beside the existing `vatRegistered`. Map the snake-case column in the route the same way `vat_registered` is mapped — find it and copy that line's shape exactly.

- [ ] **Step 4: Add the control**

In `PracticeDrawer.tsx`, beside the VAT switch, using the shared `Checkbox`:

```tsx
<Checkbox
  id="practice-record-readings"
  label="Record readings during a session"
  checked={recordReadings}
  onChange={setRecordReadings}
/>
<p className="small muted">
  The practice uses its own software for readings, so a visit does not ask for
  them. Turning this on brings back the signal check and the artefact and
  reward figures.
</p>
```

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run app/admin/settings/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write app
git add app/api/practice app/admin/settings
git commit -m "feat(settings): the readings switch, and why it is off"
```

---

## Task 3: The visit without readings

**Files:**
- Modify: `app/therapist/session/steps.ts`, `SessionRunner.tsx`, `RunStep.tsx`
- Test: `app/therapist/session/` — extend the runner's existing test file

**Interfaces:**
- Consumes: `recordReadings: boolean`, delivered to the runner from the practice settings the session screen already loads
- Produces: nothing later tasks depend on

**Do NOT delete anything.** `SignalStep.tsx`, `SignalDots.tsx`, the reading panel in `RunStep`, `domain/session/scoreSignalQuality.ts` and the `reading` / `telemetry_chunk` event shapes all stay, with their tests running. Task 5 adds a guard that proves it.

- [ ] **Step 1: Write the failing tests**

```tsx
it('skips the signal check when the practice does not record readings', async () => {
  render(<SessionRunner {...props} recordReadings={false} />);
  await checkIn();
  await completePreflight();
  expect(screen.queryByText(/signal/i)).toBe(null);
  expect(screen.getByRole('button', { name: /end session/i })).toBeTruthy();
});

it('offers no reading panel on the run screen when readings are off', async () => {
  render(<SessionRunner {...props} recordReadings={false} />);
  await reachTheRunScreen();
  expect(screen.queryByRole('button', { name: /record a reading/i })).toBe(null);
});

it('is exactly the sequence it is today when readings are on', async () => {
  render(<SessionRunner {...props} recordReadings={true} />);
  await checkIn();
  await completePreflight();
  expect(screen.getByText(/signal/i)).toBeTruthy();
});

it('still shows readings a session already holds, even with the switch off', async () => {
  render(<SessionRunner {...props} recordReadings={false} session={sessionWithReadings} />);
  await reachTheSummary();
  expect(screen.getByText('18')).toBeTruthy(); // the stored artefact figure
});
```

Use the test file's own existing helpers for `checkIn`, `completePreflight` and so on — read it first; the names above are illustrative.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run app/therapist/session/`
Expected: FAIL — the signal step renders regardless.

- [ ] **Step 3: Make the sequence a function of the switch**

In `steps.ts`, beside the existing step definitions:

```ts
/**
 * The steps a visit runs through. `signal` is absent while the practice takes
 * its readings on its own software (the operator, 13 September 2026): the step,
 * its component and every domain function behind it stay in the tree, and
 * `record_readings` in Settings › Practice brings them back without a deploy.
 */
export function stepsFor(recordReadings: boolean): readonly Step[] {
  return recordReadings
    ? (['preflight', 'signal', 'run', 'post', 'summary'] as const)
    : (['preflight', 'run', 'post', 'summary'] as const);
}
```

Adjust the literal step names to whatever the file already uses — read it and match.

- [ ] **Step 4: Hide the reading panel**

In `RunStep.tsx`, take a `recordReadings: boolean` prop and render the "Record a reading" toggle and its panel only when it is true. Change nothing else on that screen — the timer, the client line and the End button are unaffected.

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run app/therapist/session/`
Expected: PASS, including the existing tests unchanged.

- [ ] **Step 6: Commit**

```bash
npx prettier --write app
git add app/therapist/session
git commit -m "feat(session): a visit that does not ask for readings"
```

---

## Task 4: The export on a session

**Files:**
- Create: `db/migrations/307_session_export_document.sql`, `app/api/sessions/export.ts`, `app/therapist/session/ExportStep.tsx`
- Modify: `app/api/sessions/schema.ts`, the session's route mount, the client record's session list
- Test: `tests/session/db/export.test.ts`, plus a component test beside `ExportStep.tsx`

**Interfaces:**
- Consumes: `ASSESSMENT_FILE_KINDS`, `isAssessmentFileMimeType`, `bytesAreAnEdf` from `@domain/assessment`; `clientDocumentKey` from `@domain/shared`
- Produces: `session.export_document_id`; `PUT /api/sessions/:id/export`

**Read first, and mirror it rather than inventing:** `app/api/assessments/file.ts` — the upload route, its signature check, its audit row and its refusal codes. And `db/migrations/302_session_close.sql` around `setup_photo_document_id`, which is the shape your column copies.

- [ ] **Step 1: Confirm 307 is free across every open branch**

```bash
git fetch origin
for b in $(git branch -r --format='%(refname:short)'); do git ls-tree --name-only "$b" db/migrations/ 2>/dev/null; done | sort -u | grep -E '^30[0-9]'
```
Expected: nothing at `307`.

- [ ] **Step 2: Write the failing database test**

```ts
it('carries the export from the practice software, as the setup photo did before it', async () => {
  const { rows } = await sql(
    `select column_name, is_nullable from information_schema.columns
      where table_name = 'session' and column_name = 'export_document_id'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].is_nullable).toBe('YES');
});

it('is swept by erasure like every other client document', async () => {
  // Attach an export, run the erasure act for that client, assert the
  // document row and the stored object are both gone. Copy the shape of the
  // existing erasure test that covers setup_photo_document_id.
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test:db -- export`
Expected: FAIL — no such column.

- [ ] **Step 4: Write the migration**

```sql
-- 307_session_export_document.sql
-- Needs: 302 (session.setup_photo_document_id, the shape this copies), 060 (document)
--
-- The practice runs its neurofeedback on professional software and attaches
-- that software's exported result to the visit (the operator, 13 September
-- 2026). A file on a session is already a solved problem here — the setup
-- photo has referenced `document` since 302 — so this is the same reference
-- under a second name rather than a second mechanism.
--
-- Nullable and never required: a practitioner standing in someone's home must
-- always be able to close the visit. A missing export is a marker on the
-- record, not a gate.

alter table public.session
  add column export_document_id uuid references public.document (id);

create index session_export_document_idx on public.session (export_document_id);

comment on column public.session.export_document_id is
  'The practice software''s exported result for this visit. Optional; never blocks check-out.';
```

- [ ] **Step 5: Run and watch it pass**

Run: `pnpm db:migrate && pnpm test:db -- export`
Expected: PASS.

- [ ] **Step 6: Write the route's failing tests, then the route**

Mirror `app/api/assessments/file.ts` exactly: the same three accepted kinds (`vendor_pdf`, `edf_recording`, `native_recording`), the same signature check, the same audit row, the same refusal for a declared type the bytes contradict. Tests must cover: each accepted kind stored; a fourth kind refused; bytes that contradict the declared type refused; the document row and storage key matching the setup photo's conventions; and the route refusing a session that is not this practitioner's.

- [ ] **Step 7: Add the attach control**

`ExportStep.tsx`, shown on the Summary step: a file input, the chosen file's name, and a plain sentence saying the export is optional. Reuse `app/admin/assessments/ExportFiles.tsx`'s upload shape — read it and follow it. Tokens only, no hex.

- [ ] **Step 8: Mark the sessions that lack one**

On the client record's session list, mark a closed session with no export. One quiet marker, using the existing status vocabulary; no red alert.

- [ ] **Step 9: Run everything and commit**

```bash
pnpm verify
npx prettier --write .
git add db app tests
git commit -m "feat(session): attach the practice software's export to a visit"
```

---

## Task 5: The guard that keeps dormant code alive

**Files:**
- Create: `tests/lint/dormant-readings-stay-alive.test.ts`

**Read first:** `tests/lint/tabs-are-always-styled.test.ts` for the house shape of a guard — a walker, a fail-closed count assertion, and a comment explaining WHY the guard exists rather than only what it checks.

- [ ] **Step 1: Write the guard**

It must assert that each of these still exists and is still referenced by something that runs:
`app/therapist/session/SignalStep.tsx`, `SignalDots.tsx`, `domain/session/scoreSignalQuality.ts`, `domain/session/deriveObservationFlag.ts`, and the `reading` / `telemetry_chunk` shapes in `domain/session/events.ts`.

The point is that "dormant" must not decay into "deleted by a later tidy-up, and nobody noticed because nothing rendered it". Assert file existence AND that each still has a test file covering it, so coverage cannot silently lapse either.

- [ ] **Step 2: Prove it bites**

Temporarily rename `app/therapist/session/SignalStep.tsx`; run the guard; it must FAIL naming that file. Restore it; it must PASS. Capture both outputs in your report. A guard that cannot fail is worse than no guard.

- [ ] **Step 3: Commit**

```bash
npx prettier --write tests
git add tests/lint
git commit -m "test(lint): dormant is not deleted, and stays covered"
```

---

## Task 6: The spec amendment and the change request

**Files:**
- Modify: `docs/SPEC/session-capture.md` sections 3.3, 3.4, 9
- Create: `docs/CHANGE-REQUESTS/trunk-round-49.md`

- [ ] **Step 1: Amend the specification**

Section 3.3 and 3.4: say the figures are dormant, name `record_readings`, and keep the existing text describing what they were, so a later reader can revive them. Section 9 ("Out of scope"): amend "amplifier file ingest" — a session now takes the vendor's export as a file; what remains out of scope is *parsing* it. Do not rewrite history; amend and date.

- [ ] **Step 2: Write the change request**

Following the round 41 entry in `docs/CHANGE-REQUESTS/trunk-notes.md`: what landed in the shared zone, every file touched outside the trunk's own paths grouped by owning stream (`session-capture` for `app/therapist/session/**`, `app/api/sessions/**`, `domain/session/**`, migration 307; `client-record` for the session list marker), the one-round widening sentence, and the closing line that nothing in those paths is the trunk's beyond this round. State the two migrations by number and range.

- [ ] **Step 3: Commit**

```bash
npx prettier --write docs
git add docs
git commit -m "docs: the readings are dormant, and a visit carries an export"
```

---

## Self-review notes

- **Spec coverage:** the switch (Tasks 1–2), the visit without readings (Task 3), the export on a session (Task 4), dormancy that cannot rot (Task 5), the record (Task 6). The spec's "brain mapping needs no work" is a verification, not a task — it is folded into Task 4's final walk.
- **Deliberate gaps, both named in the spec as out of scope:** the practitioner app's desk layout, and parsing the vendor's export to recover the figures.
- **A verification the plan cannot script:** whether the practice's software exports a format the three accepted kinds admit. This needs a real file from the operator. Task 4 refuses an unknown format cleanly rather than storing something unreadable, so the failure mode is a clear refusal, not corruption — but the question is open until a real export is tried.
- **Type consistency:** `record_readings` (column) / `recordReadings` (API and props) / `stepsFor(recordReadings)` / `export_document_id` (column) / `PUT /api/sessions/:id/export` are each used under one name throughout.
