# Trunk notes — gaps the streams will hit

The reverse of the other files in this folder: things the trunk noticed while
laying shared ground, written down instead of built, either because a stream
owns the path or because the work is a stage of its own. Each is addressed to
whoever owns it.

---

## Round 14, 2026-09-03 (the storage seam, session settings, consent wording)

### 1. Two scheduling fixtures file a bare consent wording document

**Who.** `scheduling`.

**What.** `tests/scheduling/db/appointments.test.ts` (about line 129) and
`tests/scheduling/db/client_visibility.test.ts` (about line 231) both insert

```sql
insert into document (id, tenant_id, kind, storage_key, mime_type, sha256)
values ($1, $2, 'consent_text', 'consent-text-v1', 'text/plain', ...)
```

**The ask, and it is one word.** Change `kind` in both fixtures from
`'consent_text'` to `'referral'`. What those fixtures stand in for is any
document a consent can point at — `consent.text_document_id` is a plain
foreign key to `document` — not the practice's own published wording, and a
referral letter is the honest stand-in. Nothing else in either test changes.

Migration 902 gives a consent wording document five columns of its own —
`purpose`, `locale`, `version`, `status`, `retired_at` — because that is what
`SPEC/client-record.md` section 7 asks for: the wording is versioned per
purpose and per language, and a consent row records the exact version shown.
The alternative to the one-word fix is adding `'participation', 'en', '1',
'draft'` to both fixtures, which makes them describe a real wording; that
works too, but it makes two scheduling tests carry the practice's consent
wording, which is not what they are about.

**Why it matters beyond tidiness.** The trunk wanted a check constraint
saying every `consent_text` document carries all four, and did not add it,
because a constraint the trunk cannot fix on the other side of the ownership
line is a broken stream rather than a stronger schema. What shipped instead
is the weaker pair: no other kind of document may carry any of the four, and
within a row they are all present or all absent. Once both fixtures are off
`consent_text`, the trunk adds the completeness constraint in its next round.
Until then the database will accept a wording that names no purpose, and the
streams should not rely on that.

Gating that completeness check on `client_id is null` was considered and does
not help: migration 902 now requires a `consent_text` row to have no client at
all, and both fixtures already set none, so the gate would catch exactly the
rows it was meant to spare. The fixtures are the fix.

Note also that these two fixtures write as the raw owner connection with no
role stamped, which is why migration 903's write floor does not refuse them:
that guard stands aside when `app.actor_roles` is unset, the same way
`app.guard_location_notes()` does. A fixture that starts stamping a role will
need `'owner'` or `'admin'` to file a `consent_text` row — another reason the
one-word fix is the better one.

### 2. The storage-deletion job an erasure already asks for

**Who.** `client-record`, or a job stage.

**What.** `app.erase_client` (migration 100) records
`storage_keys_to_delete` on the erasure request and deliberately leaves the
bytes alone, noting that "a storage-deletion job to remove them ... is a
later pull request". That job now has something to call:
`storage.delete(key)` through the seam (`docs/SEAMS.md`), which is the same
call against a bucket or a folder and needs no vendor on a laptop.

**Why it matters.** Until it exists, an erasure removes the row and leaves
the file. CLAUDE.md rule 8 and `SPEC/00-data-model.md` section 7 both promise
the file goes.

**And one rule it must carry.** A deletion job must check what still
references a document before it calls `storage.delete`, never work from
`retention_until` alone. A `consent_text` document is exempt from the
five-year upload clock and its `retention_until` is deliberately null — it is
kept while any `consent` still points at it and the last of those clients is
still within their own retention — so null there means "not on an upload
clock", never "keep forever" and never "nobody computed it"
(`domain/shared/storage.ts`, migration 903, docs/SEAMS.md).

### 3. Nothing yet uploads or fetches a document

**Who.** Whichever stream needs documents first — `client-record` for
consent signatures, `session-capture` for setup photos, `reports` for PDFs.

**What.** The seam is laid and `c.get('storage')` is published on the request
context, but no route puts a file in or hands one out. When one is written:

- Build the key with `clientDocumentKey` or `practiceDocumentKey`; never
  compose one by hand, and never put a name or a record number in it.
- Write the `document` row and the bytes in the same unit of work, bytes
  first, so a row never points at nothing.
- Hand out `getSignedUrl`, never a permanent URL, and never the bytes through
  a route of your own.
- `c.get('storage')` is typed `| undefined`: a deployment without a store
  configured must be refused cleanly by the route, not assumed away.
- **Call `auditDocumentRead(db, document)` before you sign a link**, every
  time (`app/api/_middleware/storage/audit.ts`, docs/SEAMS.md). Signing is the
  only moment the trail can be written — the folder implementation serves its
  own bytes from ahead of the authentication fence, where there is no actor to
  name, and the bucket's bytes never reach this API at all — so it is the
  seam's rule rather than each route's to decide. A signed link that is never
  fetched is a read that did not complete, not a read that did not happen.
- **`put` refuses a key that already holds an object.** That is the default
  and it is the right one; pass `overwrite: true` only for a retry that knows
  its first attempt half-finished, and expect **409 `document_exists`**
  otherwise.
- **Compute `retention_until` at upload** with `documentRetentionUntil`
  (`domain/shared/storage.ts`). Do not invent the arithmetic, and do not write
  a date for a `consent_text` row: it answers null there on purpose.

### 4. The shape of a checklist item is nobody's yet

**Who.** `session-capture`.

**What.** Migration 901 checks only that `service_type.preflight_checklist`
and `rating_questions` hold JSON arrays. The shape of an item —
`{ key, label_en, label_ar }` and `{ key, label_en, label_ar, min, max }` —
is deliberately validated at the edge rather than by a constraint, so a bad
item can be refused with a sentence instead of a constraint violation. That
parser belongs in `domain/session`, and the seed's neurofeedback defaults are
drafts the practice will edit, not a fixed list to code against.

### 5. `pnpm seed:sql` is a command that does not exist

**Who.** The trunk, in a later round.

**What.** `docs/STAGING.md` refers to `pnpm seed:sql` in two places, but
`package.json` has no such script; the working command is the one the same
document also gives, `node --env-file=.env.staging --import tsx
db/seed/render-cli.ts`. Left alone this round on purpose — it is not this
round's work and a one-line script is the sort of thing that quietly widens a
pull request — but the two should be made to agree.

### 6. A client contact cannot read the wording they signed

**Who.** `client-record`.

**What.** `db/policies/client/readers.sql` gives a client contact their own
client's documents, and gives a practice document (`client_id` null) to the
four staff roles only. Consent wording is a practice document, so the one
person with the strongest claim to read it — the contact who signed under it —
cannot. The policy wants a fifth arm on the `client_id is null` branch: a
`client_contact` may select a `consent_text` document that a `consent` of
their own client points at.

**Why it is not done here.** `db/policies/client/**` is the client-record
stream's, not the trunk's (docs/SPEC/OWNERSHIP.md), and a read policy about
which contact may see which wording is a client-record judgement. The trunk
laid the column that makes it expressible (`document.kind = 'consent_text'`)
and the write floor that keeps the row honest (migration 903), and stops
there.

**Why it matters.** A person is entitled to a copy of what they agreed to.
Until this exists, the client app can show a consent but not the words behind
it.

### 7. The comment in 080_audit_triggers.sql about nested jsonb is now false

**Who.** The trunk, in a later round.

**What.** `080_audit_triggers.sql` carries a note to the effect that the core
tables have no nested jsonb, which is why the redaction only looked at
top-level values. That stopped being true when `service_type.preflight_checklist`
and `rating_questions` arrived (migration 901) and again with
`session_event.payload`. Migration 904 fixed the behaviour — the dropping and
the truncation now reach inside any jsonb object value, at any depth — but 080
is a merged migration and its text may never be edited, so the false comment
stands in the file and is corrected here instead.

**What is still not covered.** jsonb **arrays** are not descended into. The
arrays in this schema hold settings, not personal data. A stream that means to
put free text or a coordinate inside a jsonb array must raise it as a change
request first (`docs/SPEC/audit.md` section 8).

---

## Round 20, 2026-09-03 (the practice's identity and its VAT registration)

### 1. VAT is recorded but not yet charged: the three pieces billing owes

**Who.** `billing`.

**What the trunk built.** Migration 905 gives `tenant` a `vat_registered`
switch (false today) and a `vat_trn`, and snapshots both onto every invoice as
`supplier_vat_registered` and `supplier_vat_trn` at numbering time, beside the
legal name, address and corporate-tax number the stamp already copied. There is
now a Practice settings screen where the owner records the registration.

**What it deliberately did not build, and nobody should assume.** *Nothing
charges from that switch.* `400_billing_catalogue.sql` stamps the standard rate
on every price and `app.charge_single_visit` (404) writes VAT on every sale,
whatever the practice is registered for. The trunk's own copy was reworded to
say so plainly — the screen, the column comments and the migration header all
now say the switch records the registration and changes no charge — precisely
so that nobody reads a column called `vat_registered` and assumes a rule that
does not exist. **McWellness is not registered for VAT today, so every invoice
the platform currently issues charges VAT it should not be charging.** That is
the defect; these three requests close it.

**Request 1a — charge VAT only when the practice is registered.** At the moment
of sale, in `app.charge_single_visit` and in the package-sale path
(`app/api/billing/sales.ts` and whatever writes `package_price`'s invoice), the
VAT on an invoice line is zero unless `tenant.vat_registered` is true. Net stays
net; gross equals net. The price list keeps its stamped
`vat_rate_basis_points` and `vat_setting_version` — those are what the rate
*was*, and a registration later makes them live without a data migration — but
the money written to `invoice.vat_fils` and `invoice_line.vat_fils` follows the
registration. The outcome to aim at: **no invoice can carry `vat_fils > 0` for
an unregistered practice.**

**Request 1b — the constraint that holds it, in the same migration.** Add to
billing's own migration, in the same commit as 1a:

```sql
alter table invoice add constraint invoice_no_vat_unless_supplier_registered
  check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0);
```

The trunk wrote this constraint, ran it, and **took it out again**: with 1a
unbuilt it refuses every charge the platform makes, and fourteen tests in
`tests/billing` fail — which is how this was established rather than argued.
It is a one-line addition once 1a lands, and it is the difference between a
rule and a habit. The two sibling constraints it belongs with are already in
905 (`invoice_supplier_vat_trn_fifteen_digits`,
`invoice_supplier_vat_trn_needs_registration`), and
`app.stamp_invoice_supplier` enforces both again in the trigger so the
supply-your-own-snapshot path cannot slip past them.

**Request 1c — the rendered invoice reads the invoice, never the tenant.**
Whoever writes the PDF: every supplier fact comes from the `invoice` row's own
`supplier_*` columns. Reading `tenant` at render time would make last year's
invoice re-render with this year's registration, which is the whole reason the
snapshot exists. Specifically, when `supplier_vat_registered` is false or null:

- no **"Tax Invoice"** heading — it is an invoice, and calling it a tax invoice
  is a statement about a registration the practice does not hold;
- no VAT registration number anywhere on the page;
- no rate, and no VAT line in the totals;
- a single AED amount, not a net/VAT/gross breakdown.

And `supplier_trn` is the **corporate-tax** number: it carries a column comment
saying so, in the same words `tenant.trn` carries. It must never be printed
labelled as a VAT number. If the layout wants to show it at all, label it
"Tax registration number".

### 2. Two things a UAE tax invoice needs that the snapshot has not got

**Who.** `billing`, with a decision from the operator on the second.

Raised here because they are cheap to add while the snapshot is young and
expensive once invoices exist that lack them — an issued invoice is
append-only, so a missing column can never be backfilled.

- **Date of supply, where it differs from the issue date.** A UAE tax invoice
  states the date of supply as well as the date of issue. For a single visit
  charged on the day they are the same, and `issued_on` carries both. For a
  package sold in January and delivered through May, and for any invoice
  raised after the fact, they are not. One nullable `supplied_on date`, written
  when it differs and left null when it does not, keeps the row honest and the
  renderer simple.
- **A recipient snapshot, or the decision that none is needed.** The invoice
  snapshots the supplier and names the client by foreign key, so a household
  that is renamed or erased changes what an already-issued invoice renders as.
  A full tax invoice must carry the recipient's name and address; a
  **simplified** tax invoice, which is what a registered business issues to a
  private individual below the threshold, need not. The practice bills
  households, so "we issue simplified tax invoices" is very likely the right
  answer — but it is an answer somebody has to give in writing, with the tax
  advisor `docs/SPEC/billing.md` section 5.3 already says to consult, not a gap
  to be discovered at the first audit. Either add `recipient_name` (and
  address) to the snapshot, or record the simplified-invoice decision in
  `docs/SPEC/billing.md` and say there that the recipient is deliberately not
  snapshotted.

---

## Round 23, 2026-09-04 (what the trunk did not do, and why)

Three streams have open pull requests whose change-request files ask the shared
zone for things. This round did four of them — the requester's phone on the
redaction list (migration 906), the erasure sentence in
`docs/SPEC/client-record.md` section 8, the sending seam in `docs/SEAMS.md`
with the WhatsApp row corrected, and `logAction` in
`app/api/_middleware/audit.ts`. Everything below is deliberately left.

Nothing here is blocked work of the trunk's own making. Each is a change whose
correctness cannot be seen from `main`, because the code that gives it meaning
is on a branch.

### 1. After the merges of 51, 52 and 54

Pull request 51 is `client-record-5`, 52 is `scheduling-3`, 54 is `billing-3`.
51 and 54 were merged on 2026-09-04, and this round took `logSensitiveAction`
(`app/api/billing/audit.ts`, billing-04 request 4's interim copy) out with the
merge, re-pointing `app/api/billing/documents.ts` at the shared `logAction`.
Everything in the table is now round 24's, the moment 52 is on `main`.

| What | Asked in | Waits on | Why it cannot be done first |
|---|---|---|---|
| A route for `/admin/schedule/week` in `app/shell/App.tsx` | scheduling-04 item 2 | 52 | `app/admin/schedule/WeekPage.tsx` is on the branch. A route to a component that does not exist does not compile, and one added blind is a route nobody has seen render |
| `appointment.move` and `appointment.cancel` in `domain/shared/actor.ts` | scheduling-04 item 3 | 52 | The union members would compile alone, but a `canActor` case with no caller is an audience nobody has exercised. The audience table lands with `move.ts` and `cancel.ts`, which assert it against the running routes |
| `formatFils` moved to `domain/shared/fils.ts` | scheduling-04 item 4 | 52 and 54 | The source is `app/admin/billing/money.ts`, billing's path, and both streams have callers mid-flight. Moving it under two open branches is a conflict in three worktrees rather than a tidy in one |
| `alter table invoice add constraint invoice_no_vat_unless_supplier_registered` in a 9xx migration | billing-04 request 1 | 54 | The trunk wrote this constraint in round 20, ran it, and took it out again: until billing charges VAT only when the practice is registered (54's request 1a), it refuses every charge the platform makes and fourteen tests in `tests/billing` fail. It is one line the moment 1a is on `main` |
| The practice's logo as a replaceable document, on `app/admin/settings/**` | billing-04 request 5 | 54 | The settings page is the trunk's, but the two halves that make it mean anything — `app/api/billing/document-source.ts` reading it onto the model, and an `/XObject` in `domain/billing/document/pdf.ts` drawing it — are billing's and unwritten. An upload box feeding a renderer that ignores it is worse than the wordmark, which is at least honest |
| `jobs/client/retry-erasure-deletions.ts` and its `package.json` script | client-record-04 CR-14 | 51 | The job is twenty lines around `sweepErasureFiles`, which is in `app/api/clients/erasure-file-sweep.ts` on the branch. The sweep itself already works and is tested; what waits is the command an operator can be told to run |

**Every row of that table was done in round 24**, below, once 52 was on `main`. The table stays as the record of what each was waiting for; what happened to each is round 24 section 1.

### 2. Not waiting on a merge, and still not done this round

Recorded so the next trunk round picks them up rather than rediscovers them.
Each could be done from `main` today; none was in this round's scope.

- **`docs/SPEC/billing.md` section 5.4, the simplified-tax-invoice
  decision** (billing-04 request 2). `docs/SPEC/**` is the trunk's and the text
  is written out in full in that file. It answers round 20's own second note,
  which asked for either a recipient snapshot or the decision recorded in
  writing — so leaving it open leaves a question the trunk asked unanswered.
  The nearest thing to urgent on this list.
- **A `client.erase` sentence in `domain/shared/audit-narrative.ts`**
  (client-record-04 CR-16). One case beside the existing
  `erasure_request.insert`, so the timeline stops rendering "X recorded erase
  on the client". The generic sentence is not wrong, only unwritten by anybody.
- **The `erasure-letter` filter in `db/seed/consent-text.ts`**
  (client-record-04 CR-15), which would let the two letter templates sit at
  `docs/CONSENT/erasure-letter.en.md` and `.ar.md` rather than one directory
  down. `db/seed/**` was not in this round's zone. Worth noting that the stream
  itself says a subdirectory is arguably the better home for a family of
  templates about to grow a second member, and that closing this as declined
  costs nothing.

### 3. One thing for whoever integrates, not for a stream

`tests/client/db/erasure_act.test.ts` has a case named "a rendered tax
document" that **skips itself while `billing_document` is absent** and stops
skipping the moment 54 is on `main` (client-record-04 CR-20). Migration 105
holds rendered invoices and credit notes back from an erasure through a
`to_regclass` guard, for two reasons at once: without it the delete raises for
any household that ever had an invoice rendered, and deleting a rendered tax
document would breach the five-year financial-record rule.

So the first `pnpm test:db` after 51 and 54 are both on `main` runs a test that
has never run in CI. If it fails, that is where to look first, and the failure
is real rather than a merge artefact.

---

## Round 24, 2026-09-04 (the asks the streams left at the trunk's door)

Pull requests 52, 56, 57 and 58 are on `main`, so every file round 23 was
waiting for is here. This round did all seven rows of that round's table and
eight other things beside; what follows is what happened to each, what it
deliberately left, and the lines the streams asked for.

### 1. Round 23 section 1's table, answered

| What | Asked in | What round 24 did |
|---|---|---|
| A route for `/admin/schedule/week` | scheduling-04 item 2 | Applied, exactly as the diff was written, with two tests in `app/shell/App.test.tsx`: an admin reaches the week, a practitioner is sent home. `canOpenSchedule` is the rule, the same one the day sits behind |
| `appointment.move` and `appointment.cancel` in `domain/shared/actor.ts` | scheduling-04 item 3 | Applied, with the change request's own audience table as a unit test beside the existing actor tests. No route's behaviour changes |
| `formatFils` moved to `domain/shared/fils.ts` | scheduling-04 item 4 | Moved, and re-exported from `domain/billing/money.ts` and `app/admin/billing/money.ts`, so not one caller moved. It is on `domain/shared`'s barrel too |
| The `invoice_no_vat_unless_supplier_registered` constraint | billing-04 request 1 | Migration **950**, the first in the trunk's new 950s. Proved with the trigger from 406 switched off, which is the case a constraint exists for |
| The practice's logo as a replaceable document | billing-04 request 5 | Migration **909** and Settings › Practice. Upload, replace and remove, PNG or JPEG, 500 KB, through the storage seam. See section 4 below, addressed to billing |
| `jobs/client/retry-erasure-deletions.ts` and its script | client-record-04 CR-14 | Written as the change request proposed, with `pnpm job:erasure-files` in `package.json` |
| A `client.erase` sentence in `domain/shared/audit-narrative.ts` | client-record-04 CR-16 | Added, both languages, with its case in the narrative test |

And from round 23 section 2: **`docs/SPEC/billing.md` section 5.4** is written
(billing-04 section 2's text verbatim; e-invoicing became 5.5), and **CR-19**
was confirmed already applied in round 23 and needed nothing.

### 2. `invoice.document_id` is still there, and here is what has to happen first

**Who.** `billing`.

**What.** billing-04 request 5 asks for the dead column to be dropped
"whenever `invoice` is next touched", which was migration 950. It was not
dropped, because the grep the trunk ran before dropping it found a reader:

```
tests/billing/db/packages.test.ts:327
  'select reference, kind, net_fils, vat_fils, gross_fils, document_id from invoice ' +
```

That test asserts `document_id: null` with a comment saying nothing writes it
— which is exactly right, and is a test *of* the column. `tests/billing/**` is
the billing stream's path, so the trunk left both alone.

**The ask.** Take that column out of the select and the expectation in
`packages.test.ts` (the assertion the test is really making — one invoice, one
line, the right figures — does not need it), and say so; the trunk drops the
column in its next round, in the 950s, where a migration that alters
`invoice` now belongs.

### 3. The two `hasRole` calls in the appointment routes

**Who.** `scheduling`.

**What.** `appointment.move` and `appointment.cancel` are now actions on
`domain/shared/actor.ts` (scheduling-04 section 3, applied verbatim). The two
`hasRole` calls at the top of `app/api/appointments/move.ts` and `cancel.ts`
may become `canActor` calls with those actions whenever that stream next opens
those files. Nothing is broken until they do: the audiences are identical, and
`tests/scheduling/db/move_and_cancel.test.ts` asserts them against the running
routes either way.

### 4. Two files that can now shrink, and one that is ready to read

**`app/therapist/session/dirhams.ts` can become a re-export** (`session-capture`).
`formatFils` lives in `domain/shared/fils.ts` from this round, which is what
that file's own comment says it was waiting for: "the right home for these two
pure functions is `domain/shared` … and when it is granted this file becomes a
re-export and then goes." `formatFilsAsAed` and `formatFils` differ in one
respect — the first clamps a negative to zero, which a parking cost wants and
a balance does not — so the re-export is not quite a rename, and that is the
stream's call to make.

**`app/therapist/today/TodayPage.tsx` can stop importing billing's money
module** (`scheduling`). It reaches `formatFils` through
`app/admin/billing/money.ts`, which imports `@domain/billing` for `previewVat`
— the transitive reach scheduling-04 section 4 objected to. `import { formatFils }
from '@domain/shared'` is the same function and none of the rest.

**The practice's logo is ready to read** (`billing`). A row on `document` with
`kind = 'practice_logo'`, `client_id` null, one per practice (migration 909's
partial unique index), PNG or JPEG (its check constraint), keyed by
`practiceDocumentKey`, and on no upload clock — `retention_until` is null,
because there is one logo at a time and it is replaced rather than expired
(`RETENTION_EXEMPT_KINDS`, `domain/shared/storage.ts`).
`app/api/billing/document-source.ts` can select it straight, or call
`GET /api/practice/logo`, which answers the document id and a signed URL or a
plain 404 — that route is `practice.settings.write` today
(the owner and an admin), and widening it to whoever renders a document is a
decision for whoever writes that half, not one to take in advance. Remember
`auditDocumentRead` before signing any link (docs/SEAMS.md). Nothing in the
renderer or in `document-source.ts` was touched.

### 5. Round 14 item 7, closed: 904 and 908 are the correction

`080_audit_triggers.sql` carries a note saying the core tables have no nested
jsonb, which stopped being true at migration 901. Round 14 recorded it as a
false comment in a merged migration that may never be edited. **Migration 904
is the correction to the behaviour** — the dropping and the truncation reach
inside any jsonb object value, at any depth — and **migration 908 is the
correction to its reach**: the redaction now runs from `app.audit_chain_link()`
rather than from `app.audit_row()` alone, so it covers every insert into
`audit_log` and not only the ones a table trigger wrote. Both are recorded in
`docs/SPEC/audit.md` section 8. Nothing further is owed here; jsonb **arrays**
are still not descended into, and that remains a change request rather than a
gap.

### 6. CR-15 is declined, as the stream itself suggested

**Who.** `client-record`.

**What.** CR-15 asks `db/seed/consent-text.ts` to skip files whose name starts
`erasure-letter`, so the two letter templates can sit flat in `docs/CONSENT`.
Declined, on the stream's own reasoning: "a subdirectory is arguably the
better home for a family of templates that is about to grow a second member —
the practice will want a 'your request has been received' letter eventually —
and this request can be closed as declined." `docs/CONSENT/erasure-letter/`
already works, `app/api/clients/erasure-letter.ts` already reads from it, and
`loadConsentTexts()` keeps the simple rule that every `*.md` in that folder is
a piece of consent wording. Nothing to change on either side.

### 7. Two erasure-test guards are dead weight now

Found in the review of pull request 57, and neither file is the trunk's.

**`tests/billing/db/erasure.test.ts`, lines 53–58** (`billing`). The case
"erasing a household that has a rendered invoice" opens with
`if (!(await erasureSparesBillingDocuments())) { return; }` — a **silent
return, not a `skip()`**, so a skipped run reads as a passing one. Both the
guard and the helper can go: `billing_document` and the erasure are both on
`main` since pull requests 51 and 54.

**`tests/client/db/erasure_act.test.ts`, lines 866–870** (`client-record`).
The same shape, done properly with `skip()`, guarding on
`to_regclass('public.billing_document')`. That table is on `main` too, so the
guard now only costs a query. The test itself has run in CI since 54 merged
and passes.

### 8. What this round deliberately left

Each could be picked up next; none was this round's.

- **Billing's takings aggregate** (billing-04 section 8). `GET /api/billing/summary`
  reads the ledger under row security, and `db/policies/billing/ledger.sql`
  puts every client-scoped read behind `app.client_erasure_gate` — so cash
  collected, revenue recognised and the deferred balance are all *smaller for
  finance than for the owner* on any month containing an erased household. A
  total that depends on who is looking is not a total. The fix is a
  security-definer aggregate reading the ledger whole and answering three
  integers naming no client, which is a migration and a route change in
  billing's own range and not something to smuggle into a shared-zone round.
- **The Arabic clipboard** (billing-04 section 8). The renderer shapes Arabic
  into presentation forms and reverses it before writing, and builds
  `/ToUnicode` from the glyphs drawn, so text copied out of an Arabic run
  arrives reversed and spelt in the FE70 block. The fix is to record the
  logical character behind each drawn glyph and map that instead — a change to
  `domain/billing/document`, which is billing's.
- **`invoice.supplied_on`** (billing-04 section 8). The column exists and
  nothing writes it, on purpose: a single visit is supplied on the day it is
  invoiced, and the tax point on a **prepaid package** is the open question
  `docs/SPEC/billing.md` section 5.3 sends to the tax adviser. Writing a date
  before that answer exists would be inventing the answer. Left exactly as it
  is, and named here so a later round does not read the empty column as an
  oversight.

### 9. `pnpm seed:sql` exists, and STAGING.md now says which environment file

Round 14 item 5 asked for it; it landed in the trunk's round of 2026-09-03
(`node --env-file-if-exists=.env --import tsx db/seed/render-cli.ts`) and this
round only closed the half-inch left between the script and the document. A
staging render must read `.env.staging` rather than the laptop's `.env`, which
is why `docs/STAGING.md` writes that one command out in full, and it now says
so rather than leaving a reader to notice.

## Round 25, 2026-09-05 (the portal's doors, written down before the builder starts)

Piece seven is the first piece built under the cost rules of
`docs/HANDOVER.md` section 6, and this round is documentation only: the
integrator read what the portal must stand on and wrote it down, so the
builder reads files rather than a long prompt.

### 1. The draft spec of 2026-09-02 is superseded

`docs/SPEC/client-portal.md` on the unmerged `client-portal` branch was
written before any of pieces one to six existed: it planned a policy folder to
give a contact rows the `client_contact` arms in `db/policies/client/readers.sql`
and `db/policies/billing/ledger.sql` have since granted, it had no sign-in door,
and its screens were the record's rather than the plan's five. The new file on
`main` replaces it; the branch stays in history and is not merged. Its four
change requests (01 to 04) are folded into `client-portal-05.md`.

### 2. What the portal reads today, and the two arms it lacks

Every table the five screens need already admits a contact for their own
client, with one exception in each direction. `appointment` has no contact arm
in `scheduling_read_scope` (the scheduling spec's section 2 promised one for
"Stage 2"), and `contact` has no self-update arm in `client_record_update_writers`
(client-record's section 2 promised the same). Both are one line each and both
are in another stream's file; neither stream has a session open, so the
integrator authorised the portal's builder to add them, each with a deny test,
in `client-portal-05.md` item 6. The column boundary on the self-update is a
guard trigger in the portal's own range, the pattern of
`app.guard_location_notes` (migration 100).

### 3. The plan's builder note and the map disagreed; the map wins

The plan named a worktree `portal` owning `app/portal/**`. The ownership map
has said `client-portal` owning `app/client/**` since the scaffold, and the
worktree script knows only the map's names and ports. The row is widened for
the piece (an admin page, a small domain, a policy folder) and the name is
unchanged.

### 4. Shared-zone edits ride in the piece's pull request

Eight items, listed in `client-portal-05.md`, would ordinarily be a trunk
round of their own. Under cost rule 6 they are applied by the portal's builder
in the same pull request, each named in its body, and reviewed there once.
The only trunk-range migration among them, `910_practice_whatsapp.sql`, sits
in the first half of the range because it alters `tenant`.

### 5. Two things the plan carried from the old app that the record has no field for

A guardian and an emergency-contact field on the Family screen. The platform's
`contact` row has a relationship and a legal-guardian flag and nothing else of
the kind; adding a field is a personal-data decision with a stated need
(`.claude/rules/compliance.md`), so it is left out and named in the spec's
section 12 for the operator to ask for.

### 6. A flaky focus assertion, noted for the trunk (added after piece seven merged)

`app/admin/settings/PracticeLogo.test.tsx`, the focus assertion near line
208, fails under full-suite load about two runs in five on the laptop and
passes alone and on re-run. Untouched by piece seven, not reproduced in CI,
and not fixed in passing (it is the trunk's file and the round was the
portal's). A small thing for the next trunk round: wait for the element to
receive focus rather than assert it on the same tick.

## Round 26, 2026-09-05 (the practitioner's phone, written down before the builder starts)

### 1. Three old asks are met, in the form the spec decides

`session-capture-02.md` asked, on 2 September, for installability (section 1), a door for the photo's bytes (section 2) and the shell's half of the sign-out rule (section 5). All three are answered by `docs/SPEC/practitioner-phone.md` and authorised in `session-capture-04.md`. The worker takes the plugin the old request said would be "a better answer" rather than the hand-written file it drafted, keeping that draft's three rules and two messages inside a source file of our own; the reason is the precache, which is what makes "the screens are cached" true by construction rather than only for screens already opened online.

### 2. The plan's builder note and the spec differ in three places, and the spec says why

The note named the Distance Matrix API; the spec takes the Routes API's compute route matrix, which is the product Google now sells. The note said "a map library loaded from cdnjs"; the content security policy allows only the app's own files and the vendor register bars third-party scripts, so the picture is fetched by the server and cached with the day, and the browser loads nothing from anybody. The note put the calibration rule in `checkConflicts`; the spec keeps it at check-in, where `session-capture.md` section 3.1 has always had it, and gives the reason in section 6.3.

### 3. Two tables were weighed and one was refused

`drive_estimate` is created: two location ids, a duration and a source, naming no person. A table for the day's picture was refused: a picture of several households' positions is personal data with no single `client_id` to file it under, and the audit trigger would write a fingerprint of it on every insert. It lives in process memory until the day ends and on the device, where the worker caches it beside the day sheet the device already holds.

### 4. Shared-zone edits ride in the piece's pull request

Eleven items, listed in `session-capture-04.md`; the three documentation items are done here so the builder starts against a register and a model that already describe what it builds. Same decision as round 25, same reason: one review instead of two.

### 5. What waits for the operator

Enabling the two Google products and minting a server key restricted to them (the old app's key is embedded in mobile binaries and is not reused); the cap in the console; and, for the real iPhone check, either piece nine's HTTPS address or a local tunnel asked for earlier. Staging runs `ROUTING_PROVIDER=straight-line` until the key exists, and Today says so on the screen.
