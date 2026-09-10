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

## Round 27, 2026-09-05 (a home for the platform, written down before the builder starts)

### 1. The host was checked rather than assumed, and one answer changed the plan

`docs/SPEC/hosting.md` is piece nine's design checkpoint. The operator answered the plan's domain decision on 5 September — `app.mcwellnessuae.com` on the practice's existing Hostinger account, the Premium plan that already serves the website and its `intake` and `qeeg` subdomains — and named three things to confirm before any deploy, "none of them assumed". All three were put to the Hostinger API with listing and reading calls only, and they came back as follows. **Whether the plan runs a persistent Node.js application is not confirmed**, and the evidence points away from it: all four sites on the account report `"website_type": "other"`, asking for the account's Node.js sites returns none, and the plan's runtime reads as ordinary shared PHP hosting — PHP 8.3.33 under CloudLinux `alt-php`, `disable_functions` including `proc_open` and `shell_exec`, and both `pgsql` and `pdo_pgsql` disabled. Hostinger's own pages contradict each other, listing Node.js under Premium's features while selling persistent Node.js as two separate products. The Node.js pipeline endpoints do answer for this website rather than refusing it, which is the one point in favour, but nothing readable establishes the property that actually matters, which is not that Node.js exists but that the process is always on, keeping a connection pool and the in-memory rate limiter alive between requests. **There is no UAE data centre**: fourteen are offered to this order and the nearest to Dubai is Mumbai, which is also where the database already sits, so the spec places the web tier there for latency, not for law; which one the plan sits in today is not exposed by the read calls and stays a confirmation the operator reads in hPanel. **Hostinger would receive everything in transit** — it terminates TLS and its CDN is already in the path for the two existing subdomains — so the spec drafts its register row as a proposal and leaves `docs/COMPLIANCE/approved-vendors.md` untouched, which still has no hosting row of any kind.

What changed in the plan because of it: the piece no longer assumes the fifth site on the Premium plan is where the API runs. That is now the spec's decision 1, the operator's to settle, with the recommendation being Hostinger's managed Node.js product on the same account and in Mumbai — one vendor, one bill, one register row — and with the Premium plan to be put to Hostinger in writing in parallel, so a yes is a saving discovered rather than a bet taken. The domain itself is unchanged.

### 2. Three things the repository already says that the hosting spec had to reconcile

The API runs its TypeScript through `tsx`, which is a development dependency, so an install of production dependencies alone cannot start it; the spec's decision 3 keeps `tsx` and installs development dependencies rather than adding a compile step nobody has asked for. The rate limiter's counters live in this process's memory (`docs/SECURITY.md` layer 3), so a second instance halves every limit silently; horizontal scaling is therefore named in the spec's section 12 as deliberately left out rather than left unsaid. And `/api/health` (`app/api/create-api.ts:172`) deliberately touches nothing environment-specific, database included, so a monitor on it alone stays green through a complete Postgres outage; the spec adds a second route, `/api/health/deep`, doing one `SELECT 1` and answering ok or not-ok and nothing else, and leaves the existing route exactly as it is.

### 3. The production Supabase project is not created yet, and that is the sequencing point

A Supabase project's region cannot be changed after creation, so creating one in Mumbai before the lawyer answers is not a setting that can be flipped later but a new project and a migration of every row and every file. Everything else in the piece — the tagged release, the migration guard, the backups and the rehearsed restore, both health routes, the error lines without a third-party tracker, the weekly dependency audit already in place, and the deep security scan — is written so the region is a setting and can be built now. `pg-boss` is named in `CLAUDE.md` and in the plan as the job runner but is not a dependency today, so the spec hosts no jobs and says so instead of pretending.

## Round 28, 2026-09-06 (a home for the platform, built)

### 1. The repository facts the build reconciled

**Staging cannot be dumped from this laptop, and that is not a fault in
staging.** The only staging credential on the machine is the API's own role,
`mcwellness_api`, which is deliberately restricted: it holds no direct table
grants and works only through `app_role` inside a request's transaction.
`pg_dump` needs an access share lock on every table, so it stops on the first
one. The weekly dump therefore needs a credential of its own, read-only,
created with the production project — which `.github/workflows/backup.yml`
already names and `docs/RUNBOOK/restore.md` records. The rehearsal used a
local stand-in built from the same migrations and the same synthetic
practice, and says so plainly rather than implying it dumped staging.

**A dump of one database is not a dump of a cluster.** `app_role` and
`mcwellness_api` are created by migrations `000` and `096` as cluster roles,
and `grant app_role to mcwellness_api` is a cluster fact too; none of the
three is in a `pg_dump` of the database, so a restore recreates them by hand
or the API fails on its first `set local role`. The same is true of the
`extensions` schema: the platform's tables are declared with
`extensions.geography(...)`, so PostGIS must exist in the target before the
first table is created. Both are steps in the runbook now.

**A whole-database dump cannot be restored by the role that made it.** Three
separate refusals proved it — an event trigger owned by PostgREST, PostGIS's
`spatial_ref_sys`, and Supabase's `vault.secrets` — all of them objects that
belong to the host and not to the practice. Naming the platform's own two
schemas, `public` and `app`, ends the class rather than excluding tables one
at a time. The cost is that the sign-in accounts, which live in Supabase's
`auth` schema, are not in the weekly dump; they come back from Supabase's own
daily snapshot or from the owner's hand, and the runbook says so.

**The `production` GitHub Environment does not exist and this build could not
create it.** The repository has no environments at all. The attempt was
refused by the session's own permission layer, because creating one changes
the repository's settings. Both ways of doing it are written out in
`docs/RUNBOOK/restore.md` section 3 for the operator. Until it exists the
release workflow's `deploy` job cannot run, which is the safe direction to
fail in.

**`c.req.routePath` is what a log line may carry.** The API's paths hold
opaque ids and the query string holds staff's search terms, so the error line
logs the pattern the router matched and never the path or the URL. This is
the same rule `.claude/rules/ui.md` states for the browser, applied to the
log file.

### 2. Every default taken beyond the spec's wording

1. **The migration guard is written from the local end.** The spec says the
   guard refuses "when the URL names the production project", and no
   production project exists to name. So the rule is the other way round: any
   database that is not on this machine is refused unless `MIGRATE_TARGET`
   says which it is, and `production` additionally wants `RELEASE_TAG` to be
   a `v*` tag the checked-out revision genuinely carries. It needs no list to
   be complete and it fails closed for a database nobody has named. Recorded
   in the spec's section 5 as an amendment.
2. **The release tag is read from the checkout, not from a second variable.**
   `git tag --points-at HEAD` in `db/migrate.ts`, so the tag has to be on the
   revision rather than merely asserted beside it. It still stops a mistake
   and not a determined person, which the spec now says.
3. **`/api/health/deep` answers `{"ok":true}` or `{"ok":false}`, with a 503
   for the second.** The spec says "ok or not-ok and nothing else", so the
   `service` name its neighbour carries is left out; a monitor needs a
   non-2xx to notice, hence the 503.
4. **The migration step sits inside the approval gate, not in front of it.**
   The spec lists the steps in order and the migration comes before the
   deploy job in that list; putting it before the gate would mean a tag push
   changes the practice's database with no person in the loop, which is what
   decision 7 exists to prevent.
5. **The deploy job builds the screens.** `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` are environment secrets and only a job in the
   environment may read them, so the production build happens behind the
   gate. The checks that need no secret run before it, so the operator is
   never asked to approve something that then fails lint.
6. **The weekly dump's flags.** `--no-owner --schema=public --schema=app`,
   and no `--clean`, arrived at by the rehearsal above rather than chosen.
7. **The uptime candidate is Better Stack's free tier**, marked as Claude's
   default in the register. What decision 5 actually requires is a free tier
   that sends a telephone alert rather than only drawing a graph; the
   operator may name any other that does.
8. **`yaml` is a new development dependency**, and the only dependency this
   piece adds. It exists so that a test can prove every workflow file parses
   and that the release trigger and the environment gate are what they say
   they are. Adding it re-keyed the lockfile's `vite` entries, because vite
   declares `yaml` as an optional peer; nothing about the build changes.
9. **A first step in each new workflow checks its own secrets.** Neither
   workflow can run today, and a workflow that half-runs on empty strings is
   worse than one that stops on its first line saying which name is missing.
10. **Both rounds of this file were kept** when the branch met `main`, round 28
    ahead of round 29, rather than one of them overwriting the other. The
    conflict was a rebase artefact and neither round is a draft of the other.

All ten are also listed on the pull request itself, one line each, so the
operator can overrule any of them from the page they approve on.

### 3. What is still the operator's, and what was deliberately left undone

The operator's list is the pull request's own, and it is section 11 of the
spec plus the production GitHub Environment. Deliberately not built: every
item in the spec's section 12, and the deep security scan of section 9, which
runs in its own session against the first tag's revision and not against
`main`, which moves.

---

## Round 29, 2026-09-06 (the document writer's byte-level half, and the sending seam)

Piece ten opens two worktrees, and one of them renders documents. The writer
that renders invoices lived inside billing, and `docs/SPEC/OWNERSHIP.md` rule 3
forbids one module importing another's `domain/` — so the choice was to move it
or to copy it, and a copied Arabic shaper is a copy that drifts. This round is
the move, taken before the worktree opens exactly as `docs/PLAN/piece-ten.md`'s
builder notes and `docs/SPEC/reports-v1.md` section 10, decision 1 asked for.

### 1. What moved, and what deliberately did not

`pdf.ts`, `truetype.ts`, `arabic.ts` and `extract.ts` are now
`domain/shared/document`, with a barrel of their own and the Arabic test beside
them. `model.ts`, `render.ts` and `strings.ts` stayed in
`domain/billing/document`: an invoice's wording, its layout and its model are
billing's and always were. Billing's own barrel exports the same names it
always did, so nothing outside those two folders changed an import except
`app/api/billing/fonts.ts`, which reads the font programs off disk and now
names their new home. All by `git mv`, so history follows.

The new barrel is **not** re-exported through `domain/shared/index.ts`. A
barrel every screen imports should not carry a PDF writer's names, and the two
modules that render documents import it by its own path. Because no barrel
reaches it, the browser-safety walk in
`tests/lint/no-node-imports-in-browser-bundle.test.ts` would have walked it from
nowhere, so it gains the new barrel as an entry point of its own — otherwise
"nothing under `domain/shared/document` imports from Node" would be a comment
rather than a proof.

### 2. The sending decision, and the precedent it was taken on

`domain/billing/sending.ts` was already pure — the seam's types, `draftMessage`
and `whatsAppHandoff` — so it moved whole to `domain/shared/sending.ts`. Its
implementations were already the API's, in `app/api/billing/sending.ts`, and
`docs/SEAMS.md`'s own "Adding a seam", step 2, says both implementations of a
seam live under `app/api/_middleware/<seam>/`. Storage and routing both do.
**So they moved there too**, in the routing seam's shape:
`app/api/_middleware/sending/index.ts` chooses from the environment,
`share-sheet.ts` is the one implementation there is, and `seam.test.ts` is the
forced-fallback proof beside them. The pure half of the old test stayed with
the pure half of the seam, in `domain/shared/sending.test.ts`.

One difference from the storage and routing seams is deliberate and now says so
in the code: an unset `DOCUMENT_EMAIL_VENDOR` falls back everywhere, not only
on a laptop, because there is no second implementation a deployment could have
meant instead.

### 3. The Arabic-copy defect, closed

`docs/PLAN/pieces-seven-to-nine.md` folded one defect into this round:
"Arabic copied out of a rendered PDF comes back as unreadable glyphs", written
up in `docs/CHANGE-REQUESTS/billing-04.md`. It is fixed. The writer shapes each
letter into the form it takes in its word and reverses the run before drawing
it, and the `/ToUnicode` map beside each face was built from the glyphs drawn —
so a family copying the Arabic off their invoice got the Presentation Forms-B
block in visual order, unusable on the clipboard and unfindable by a search.
The shaper now carries the characters each glyph was made from along beside it
and the map is written from those, ligature and mirrored bracket included. The
run still comes off the page in drawing order, which is what a reader's
bidirectional algorithm expects to be handed and can only turn round correctly
when it is holding real letters.

### 4. What the streams should know

**Who.** `reports`, `assessment`, and `billing`.

Import the writer from `domain/shared/document` and the sending seam from
`domain/shared/sending`; call `documentSender()` from
`app/api/_middleware/sending`. Nothing that reads or writes a `document` row
changed, and nothing about a filed document changed: the same fixture invoice
and receipt rendered to the same bytes across the move, hash for hash. They
differ by eight, four and twelve bytes after the defect fix, all of it inside
the `/ToUnicode` streams; every figure, word and rule on the page is untouched.

**Still open, and not this round's.** `docs/SPEC/reports-v1.md` says a report is
bilingual and that the practitioner's own narrative renders in the locale
chosen at issue. A narrative is a paragraph rather than a short label, and the
Arabic in `arabic.ts` is deliberately "not a full bidirectional algorithm and
does not pretend to be one" — the subset a bilingual invoice needs. Whoever
builds the report's layout should say plainly whether that subset is enough for
a paragraph, and ask for a real implementation if it is not, rather than
widening this one quietly.

---

## Round 30, 2026-09-06 (the audit trail mistook identifiers for telephone numbers)

One defect, raised by the assessment stream as items 3 and 4 of
`docs/CHANGE-REQUESTS/assessment-01.md`. It is the trunk's file, so it was a
request rather than a fix, and this is the fix.

### 1. What was wrong

`refuseContactDetails` in `app/api/_middleware/audit.ts` keeps a way of
reaching a family out of the audit trail: no value passed to `logAction` may
read as a telephone number, because the trail is kept five years and read by
people who have no business knowing how to ring anybody
(`docs/SPEC/audit.md` section 8).

It found those numbers by breaking a value into runs of digits — with the
spaces, hyphens and brackets a person types allowed inside a run — and
refusing any run of nine to twelve digits beginning with a nought. That is
sound for a number and wrong for an identifier. A uuid is thirty-two
hexadecimal characters in five hyphenated groups, and its **letters cut the
digits into shorter runs**; some of those runs are nine to twelve digits
beginning with a nought. `eea04325-2317-4f6b-ada3-dd3a345ade00` was refused on
the run `04325-2317-4`.

The file's own comment reasoned about a seeded id,
`00000000-0000-4000-8000-0000000000e6`, whose characters are all digits and
make one run far too long to be a telephone number. It was right about that
one and wrong about every random one. Measured here over 300,000 values from
`randomUUID()`, **1.25 per cent were refused** — the stream measured 1.21 per
cent over 100,000.

The consequence was not cosmetic. `logAction` throws rather than dropping the
value, and the throw rolls the whole request back. So any route passing a
fresh document id through the details failed about one call in eighty:
`PUT /api/sessions/:id/photo` (`app/api/sessions/photo.ts`, which passes
`{ documentId }`) answered 500, filed nothing, and a device retrying with the
same digest filed afresh rather than being handed the first one. In production
that is a practitioner's setup photograph failing to file, at random, with no
reason anyone can act on.

### 2. What the check now says

A telephone number is a run of digits with the separators a person types,
**standing on its own**. Two rules hold that, and neither is the other's
spare:

- **A uuid anywhere in a value is set aside before the value is read.** Set
  aside, not skipped: a value may be a sentence with an id inside it and a
  number beside that, so each id is replaced by a space and the number is
  still refused. The id is recognised by its own shape — eight hexadecimal
  characters, three groups of four, then twelve — with no further hexadecimal
  character crowding either end, so it cannot swallow half of something
  longer.
- **A run counts only where it stands on its own**, with no letter or digit
  pressed against either end, and it ends on a digit rather than on a trailing
  separator. This is what catches a hexadecimal-looking token that is not
  quite a uuid.

Each rule leaves a hole the other closes. Setting the uuid aside alone would
miss an id glued into a longer token; standing on its own alone would still
refuse `abcdefab-0234-4567-8901-abcdefabcdef`, whose twelve digits sit between
two hyphens with no letter beside them at all.

Nothing else moved. `readsAsTelephone` is untouched — the same two shapes,
international with a plus and local or bare with `971` or a nought — and the
refusal's message and its wording are exactly what they were, so a route
author reading a stack trace sees the sentence they saw before.

Proved in `app/api/_middleware/audit.test.ts`: the ten ids the measurement
turned up, including the change request's own; an id alone, in a sentence,
after an underscore, in capitals and beside another; ten thousand seeded ids
of the shape the platform writes; and every id in the reserved shapes
`0000000K-0000-4000-8000-*` and `000000KK-0000-4000-8000-*`. Beside them,
every telephone shape the rule names is asserted still refused rather than
assumed, from the reserved fake range only.

### 3. One thing found while writing that test: the Emirates ID

The rule names three things that may not reach an audit detail — a telephone
number, an Emirates ID and a name (`.claude/rules/compliance.md`,
`docs/SPEC/audit.md` section 8). Only the first was ever checked, and an
Emirates ID is fifteen digits, which is longer than any telephone shape the
helper knows, so `784-1900-1234567-1` passed straight through it. It is the
one value the rest of the platform refuses to hold in clear at all
(`domain/shared/identity.ts` seals it; `domain/shared/emirates-id.ts` is where
its shape is defined).

It is now refused too, in the same loop and in the same sentence shape,
naming the key and never the number. The check is narrow — fifteen digits
beginning 784, and a leading plus rules it out — so a tax registration number
and a money figure are left alone. A name is not attempted: it cannot be
recognised from its characters, and pretending otherwise would be worse than
saying so.

### 4. What the streams should know

**Who.** `session-capture` above all, whose
`tests/session/db/photo_and_routing.test.ts` has been intermittently red on
exactly this — "is idempotent on the same digest and refuses a different one"
seeing the second `PUT` answer 201 where it expects 200. Item 4 of
`assessment-01.md` is closed with item 3; the test is untouched, because there
was never anything wrong with it.

Also `assessment`, whose file door works around the fault by not passing the
document id at all (`app/api/assessments/file.ts`). Nothing obliges that
route to keep the workaround now, and the `assessment_document` row it writes
is audited either way, so the choice is the stream's.

Everyone else: `logAction` may now be passed a document id, a client id or any
other uuid without ceremony, in a value of its own or inside a sentence. What
it still refuses is a telephone number, an Emirates ID and an email address.
The details a sensitive action records are the contact's **id** and the
channel.

---

## Round 31, 2026-09-06 (what the streams owed the trunk, and the plan's small things)

Nine items in one round: the five things pieces nine and ten left at the
trunk's door, and four of the small things
`docs/PLAN/pieces-seven-to-nine.md` folded into "the shared rounds". The
round is wider than a trunk round usually is — it edits five streams' paths —
so every one of those files is listed here by name and a widening note beside
it in `docs/SPEC/OWNERSHIP.md`.

### 1. A measurement can name the visit it was taken at

Request 2 of `docs/CHANGE-REQUESTS/assessment-01.md`, and section 6 of
`docs/SPEC/assessment.md`. **Closed.**

Migration `951_assessment_session.sql` gives `assessment` a nullable
`session_id`. The 500 range could not write it: `session` is in the 300s,
apply order across ranges is not fixed, and `checkNeeds` rightly refuses a
`-- Needs:` naming a higher number. The trunk's `950-999` half exists for
exactly this.

It binds to the client as well as to the visit. `session` carried
`unique (id, tenant_id, client_id, practitioner_id)` — four columns, in that
order — which no three-column foreign key can point at, so 951 adds
`session_tenant_id_client_key` in the shape every other table uses and binds
`(tenant_id, session_id, client_id)` to it. A measurement can therefore never
name another household's visit. Null is ordinary and stays ordinary: a
questionnaire filled in at home, an outside provider's export, and everything
recorded before this migration name no visit.

The drawer offers the household's completed visits from a route of the
stream's own, `GET /api/assessments/visits`, and the tab names the visit
beside each measurement. A correction carries the visit forward rather than
asking again.

### 2. `bytesMatchMimeType` moves to `domain/shared`

Request 1 of `docs/CHANGE-REQUESTS/assessment-01.md`. **Closed.**

`domain/client/fileSignature.ts` becomes `domain/shared/fileSignature.ts`,
with its test. Three streams needed the same question and rule 3 let only one
of them import it: `app/api/sessions/photo.ts` and
`app/api/appointments/create.ts` wrote the note, and the assessment stream
wrote its own five-byte copy of the PDF signature. That copy is gone —
`bytesAreAPdf` asks the shared question — and what is left in
`domain/assessment/fileType.ts` is the practice's own decision about which
media type an export may be.

`domain/client` re-exports it, so **no caller moved**: the same shape
`domain/billing/money.ts` uses for `formatFils`.

### 3. A document names its own client, said as a key

The note on the composite key in `docs/CHANGE-REQUESTS/assessment-01.md`
(default 5). **Closed.**

Migration `911_document_client_key.sql` gives `document` the client-scoped
unique key every other core table already has, and
`502_assessment_document_key.sql` replaces migration 501's guard trigger with
a foreign key onto it. 501 is not edited. The deny case is unchanged, SQLSTATE
and all, so `tests/assessment/db/rls.test.ts` reads the answer it always did.

**The key is created in both files, under the same guard, and here is why.**
The runner applies pending files in numeric order, so on a fresh database 502
is reached before any `9xx`: without the guard the foreign key would fail
outright. This is the wall migration 601 hit with
`contact_tenant_id_client_key` (`reports-01.md` item 9), answered the other
way about — there the key stayed in the stream's file, here it has a home in
the trunk's and 502 only makes sure it exists in time. A database carrying the
trunk's range and not the assessment stream's still gets the key, from 911,
which is why 911 exists at all.

### 4. The race in `tests/portal/db/invite.test.ts`

The note posted on pull request 83. **Fixed**, in one line, exactly as that
note proposed: the losing redemption's rejection is parked as a value before
the `commit` that releases the lock, rather than left for an expectation two
lines later. Node reported an unhandled rejection for that gap and vitest
failed the whole run for it, with all 902 tests passing. The file was run ten
times after the change, all green.

### 5. The three cosmetic notes from pull request 83's re-check

- The widening note counted **four** report actions where `actor.ts` carries
  five. Corrected.
- A retired name survived in a comment in `tests/reports/document.test.ts`.
  The comment now says what happened without naming anybody.
- The whitespace-only edit in `domain/shared/audit-narrative.test.ts` needed
  **nothing**: it was a stray second blank line, and commit `e2fda42` in the
  same pull request had already removed it. Nothing whitespace-only survives
  anywhere between `ad4428d` and main, checked by comparing the plain and
  `-w` diffs over the whole range.

### 6. The month's takings are the same figure whoever asks

The first of the plan's small things. **Done.**

Read as the caller, `payment` and `entitlement` pass through
`app.client_erasure_gate` (`db/policies/billing/ledger.sql`), so in any month
holding an erased household finance was shown a smaller total than the owner,
with nothing on the screen to say why. That is right for a household's own
money and wrong for the practice's month: the rows are kept five years because
tax law asks it of the business.

Migration `952_practice_money_ledger.sql` adds `app.practice_money_ledger()`,
which reads the ledger whole and **names nobody** — an amount and a day, no
client, no invoice — and `GET /api/billing/summary` reads it instead of the
two tables. What an erasure protects is whose money it was, not what the
practice took.

The arithmetic does not move. `monthlyMoney` still does the recognition and
the deferral, because restating those rules in SQL would be a second
implementation that disagrees with the first the day either changes
(CLAUDE.md rule 4). The function is `security definer` and checks its
caller's role itself.

### 7. The VAT threshold watch

The second of the plan's small things. **Done.**

Migration `953_vat_taxable_supplies.sql` adds
`app.vat_taxable_supplies_fils(as_of)`: what the practice supplied, net of
VAT, over the twelve months ending on the day given, counted from the invoice
book. `security definer` for the reason 952 is — `invoice` passes through the
erasure gate too, and a practice's own tax position must not move with who is
looking at it. The day is an argument, so no clock is read inside the
database.

`domain/shared/vat-threshold.ts` holds the Federal Tax Authority's two marks —
AED 187,500, where registering becomes a choice, and AED 375,000, where it
becomes a duty within thirty days — and says which side of them a figure
falls. Settings › Practice shows the figure beside both marks, says
registering has become a choice past the first, and says on **every** visit
past the second that it is a duty, until the switch is on.

**The switch stays a hand's act.** Nothing here registers anything: an invoice
may not carry VAT until the authority has issued the number the row requires
(migration 905), and the thirty-day forward test cannot be computed from a
ledger.

### 8. The activity feed and the per-client access report

The third of the plan's small things, and `docs/SPEC/audit.md` section 9,
views 2 and 4 — which the data has supported since pull request 6 and nothing
has shown. **Done.**

- `GET /api/audit/activity` — the practice's whole trail as sentences, newest
  first, narrowable by who acted, kind of row, action, days and household.
- `GET /api/audit/filters` — the practice's own people, and the words the
  trail actually uses over the last ninety days.
- `GET /api/audit/access-report?clientId=` — everyone who has opened one
  record, ever, with how often and when.

`app/admin/audit/AuditPage.tsx` is the screen, and the Audit rail item stops
saying "Arriving".

What the rules keep. The sentences come from the same catalogue the record
timeline uses, so **no line carries anything the trail does not already hold**
and no JSON reaches a browser. A record is named by its number, never by a
name. An erased household stays with the owner and the lead practitioner:
`audit_log`'s own policies are tenant-wide, so without asking
`app.client_erasure_gate` the feed would be a way round the record's own
screens, and the access report holds the timeline's own door — a 404 for an
admin, and a typed reason for the owner. Reading the trail is itself
recorded, once per request.

`domain/shared/actor.ts` gains one action, `audit.activity`: the three
oversight roles, and finance none of it, because finance reads money and not
the trail.

### 9. The dead `invoice.document_id` column

The last of the plan's small things, `billing-04.md` request 5, and round 24
of this file. **Done.**

402 declared the column as "the rendered PDF, written by nothing in this pull
request". Nothing has written it since and nothing can: `invoice` grants no
update, so it could only be filled at insert time and the PDF does not exist
then. Billing answered the real need with `billing_document` (407).

Round 24 recorded what had to happen first — something still read it. Three
things did, and all three moved in the same commit:

1. `app.erase_client`, arm (b) of its kept-documents question. It caught
   nothing by construction, and arm (c) over `billing_document` catches what
   it was there to catch. `954_drop_invoice_document_id.sql` replaces the
   function whole — 107's body with that arm removed and its comment rewritten
   to say where it went, everything else untouched. **A future stream
   extending `app.erase_client` copies 954's body, not 107's.**
2. `tests/billing/db/packages.test.ts` asserted the column stayed null, which
   is a test that a dead column is dead. It now asserts what actually holds.
3. `tests/client/db/erasure_act.test.ts` wrote the column in a fixture and
   read it back in one assertion. Both go; that file's own "a rendered tax
   document" case already proves the link-table path.

---

### Every file this round touched outside the trunk's own paths

Listed by name, as a widening requires. Each is a change the item above it
could not be made without.

**assessment** (items 1, 2 and 3)
`app/api/assessments/routes.ts`, `rows.ts`, `schema.ts`, `file.ts`;
`app/admin/assessments/RecordDrawer.tsx`, `AssessmentsTab.tsx`,
`AssessmentsTab.test.tsx`; `domain/assessment/fileType.ts` and its test;
`db/migrations/502_assessment_document_key.sql`.

**client-record** (item 2)
`domain/client/index.ts` (the re-export), and `domain/client/fileSignature.ts`
with its test, which moved to `domain/shared`.

**client-portal** (item 4)
`tests/portal/db/invite.test.ts`.

**reports** (item 5)
`tests/reports/document.test.ts`.

**billing** (items 6 and 9)
`app/api/billing/summary.ts`; `tests/billing/db/packages.test.ts`.

**client-record** (item 9)
`tests/client/db/erasure_act.test.ts`.

**audit-ui** (item 8)
`app/api/audit/activity.ts`, `app/api/audit/schema.ts`;
`app/admin/audit/AuditPage.tsx`, `AuditPage.test.tsx`, `audit.css`.

Everything else is the shared zone or the trunk's own: `domain/shared/**`,
`app/shell/**`, `app/admin/settings/**`, `app/api/practice/**`,
`app/api/create-api.ts`, `db/migrations` 9xx, `tests/db/**` and
`docs/SPEC/OWNERSHIP.md`.

### Every default taken

Nineteen, all the builder's. Each is here because a reader of this round
should not have to find it in a diff.

1. **The key on `document` is created twice**, in 911 and in 502, each under
   the same guard, because on a fresh database the runner reaches 502 first.
   Item 3 says why at length.
2. **`domain/client` re-exports the file signature** rather than every caller
   moving to `domain/shared`. The `formatFils` precedent, and it keeps the
   client-record stream out of a round that has no other business there.
3. **A three-column key on `session`.** Without it the visit link could bind
   only to a visit id, and a measurement could have named any visit in the
   practice.
4. **The visits picker got its own route** in the assessment group rather than
   reading the reports stream's `GET /api/reports/visits`: a route in another
   stream's group is a dependency across a boundary rule 3 draws, and the
   query is eight lines.
5. **A correction carries the visit forward** rather than asking for it again:
   a correction is a new reading of the same measurement, taken at the same
   visit, and a picker on that form would be a way to move a measurement onto
   another day's visit by accident.
6. **The recording route asks whether the visit is this client's** before
   inserting. The key is still the boundary; the question is so that a caller
   naming another household's visit is told so rather than handed the 500 a
   foreign-key violation would otherwise become.
7. **`app.practice_money_ledger` returns rows, not totals.** The plan says
   "one database function adds up the ledger whole"; adding up recognition and
   deferral in SQL would restate `monthlyMoney`, so the function reads the
   ledger whole and the arithmetic stays in `domain/billing`.
8. **The takings are proved at the database and at the route**, with a
   finance-only account created inside the test rather than added to the seed:
   the seed's own owner holds finance alongside three other roles, and adding
   a fifth seeded person would move counts several other tests assert.
9. **Every kind of invoice counts towards the VAT threshold.** Nothing writes
   a `statement` today; over-counting brings a warning early and
   under-counting brings it late, and late is the one that costs a penalty.
10. **`domain/shared/vat-threshold.ts`, not `domain/billing`.** It is not
    invoice arithmetic — that is `resolveVat`'s, and CLAUDE.md rule 6 keeps it
    there. This says where the practice's own registration duty stands, and
    `domain/billing/**` is another stream's path besides.
11. **The threshold function takes the day as an argument**, so the figure is
    testable and the practice's time zone is decided in one place.
12. **The threshold figure's audience is the owner, an admin and finance** in
    the function, and the owner and an admin on the screen, which is the
    settings audience. Finance is admitted because the figure is a
    bookkeeper's question even though the screen is not theirs.
13. **A new `audit.activity` action** rather than reusing `audit.read` with an
    invented client id: the whole practice's trail names no one record.
14. **The activity feed asks `app.client_erasure_gate`.** `audit_log`'s own
    policies are tenant-wide, so without it an administrator would reach an
    erased household through the feed that the record's own screens refuse
    them.
15. **Reading the feed is audited once per request**, not once per line: a row
    per line would double the trail every time somebody scrolled it, and the
    filters are recorded with it.
16. **The access report is reached from a line of the feed**, not from a
    picker of every household: a line already names the record it touched, and
    a page about oversight should not open with a list of families.
17. **The whitespace note needed no edit**, and saying so is the answer rather
    than making one.
18. **New tests live in `tests/db/`**, the trunk's own path, except where a
    stream's own fixture had to change (items 4, 5 and 9). The alternative was
    editing three streams' suites to hold tests about the trunk's migrations.
19. **`app.erase_client` is replaced whole** rather than patched, because
    `create or replace` has no patch form. The body is 107's verbatim minus
    one arm.

### What the streams should know

**assessment.** `session_id` is on the row and on the wire, and the file
signature question is `domain/shared`'s now — `domain/assessment/fileType.ts`
keeps only the media-type decision. The guard trigger on
`assessment_document` is gone; the foreign key says the same thing.
`app/api/assessments/file.ts` still works around round 30's audit fault by not
passing the document id; nothing obliges it to any more.

**billing.** `invoice.document_id` is gone, with `invoice_document_idx`.
`GET /api/billing/summary` reads `app.practice_money_ledger()`. Two functions
are available to any route that needs them: `app.practice_money_ledger()` and
`app.vat_taxable_supplies_fils(date)`.

**client-record.** `domain/client` still exports `bytesMatchMimeType` and its
neighbours; the file behind them moved. One stale path is left for that stream
to correct when it is next in the file: `app/api/clients/document-store.ts`
line 68 names `domain/client/fileSignature.ts` in a comment. It is a comment
and this round did not edit that file for it.

**audit-ui.** The stream's paths now hold `app/api/audit/activity.ts` and
`app/admin/audit/AuditPage.tsx`, built by the trunk under this round's
widening and the stream's from here.

**Everyone.** A future migration that extends `app.erase_client` starts from
`954_drop_invoice_document_id.sql`'s body, which is the current one.

---

## Round 31, the fix round, 2026-09-06

The combined review of pull request 87 failed the round on security with one
gap and found eight more; the integrator decided each, and added three items
taken after the round had started. Thirteen commits, one per item and one for the reports suite's fixtures.

### 1. The security gap, and why it was one

**The activity feed opened an erased household's history with nothing typed.**
`docs/SPEC/client-record.md` section 8 step 3 makes opening an erased record a
sensitive action, and everything else in the building holds that door: the
record's own timeline refuses without `X-Reason`, and so does the access report
in the very file the feed was written into. The feed did not, and its own test
proved it — a request naming an erased record was answered 200 with no header
at all. Round 31's default 14 said the feed asks `app.client_erasure_gate`,
which is true and was only half the rule: the gate admits the owner and the
lead practitioner **whatever their reason**, so the two people the erased
record belongs to could read its whole history by scrolling.

Fixed in three places. Narrowed to one record the feed now holds the
timeline's door exactly — 404 for a record the caller may not see, 400
`reason_required` for an erased one with nothing typed, 200 with a reason. The
unfiltered feed withholds an erased household's rows until a reason is on the
request, which needed more than the `$9` short-circuit the review proposed:
`client_erasure_gate` on its own would still have let them through, so the
clause now asks the status directly as well. Both cases are tested, deny and
allow.

The lesson worth keeping is not about this route. **A gate that answers "who"
is not a gate that answers "why"**, and a screen that reaches records sideways
— a feed, an export, a report about reports — has to be checked against the
record's own door rather than against the table's policies, which are
tenant-wide by design.

### 2. The other eight, in one line each

2. **A feed narrowed to one record writes a `read` row for it.** The access
   report counts `read` and `list`, so without it the one screen whose subject
   is who has looked never counted its own looking.
3. **`(audit_log, audit.activity)` has a sentence**, in both languages and
   counted as a read, and the page is cut *after* narration rather than
   before — a batch of housekeeping rows used to come back shorter than the
   limit asked for, or empty with `hasMore` still true, which the screen reads
   as "nothing matches".
4. **The VAT watch says the duty and nothing after it.** The voluntary-mark
   notice is gone (the mark stays in the list) and the duty notice is the
   plan's sentence. A notice at a mark that changes nothing the practice must
   do is a notice that repeats itself for no consequence.
5. **`docs/SPEC/00-data-model.md`'s `assessment` sketch** names `session_id`
   and reaches its files through `assessment_document`, each amendment marked.
   `assessment-01.md` says so too rather than still calling them unapplied.
6. **Both apply orders of the document key are proved.** The new case in
   `tests/db/constraints.test.ts` runs each migration's own guarded block,
   read from the file so a change to either changes what is proved, 911 first,
   against a throwaway table in a schema of its own — a unique constraint is
   backed by an index and an index name is unique per schema, which is why the
   scratch table cannot live in `public`.
7. **911's `Needs:` line names 060 alone.** 099 is the precedent, beside 402
   and 601, and nothing in the file depends on it.
8. **`app/api/practice/logo.ts` imports `bytesMatchMimeType`** and its two
   local signatures are gone, with the paragraph that justified them under
   OWNERSHIP rule 3 — both of whose claims this round's own move made false.
9. **"An outside provider's export"**, in the four places that said clinic.
   The word left the platform's vocabulary in the re-baseline of 2 September.

### 3. Default 16 stands, and what it still owes

The review let default 16 stand — the access report is reached from a line of
the feed rather than from a picker of every household — and noted that it falls
short of the plan's "one press" for a record with no line in the loaded pages.
It does. **The press belongs on the client drawer, beside the record
timeline**, where somebody already looking at a household can ask who else has
been. That is `app/admin/clients/**` and `audit-ui`'s to add, not this round's:
the trunk's widening covered the audit screens, and a tab on the client drawer
is a different stream's surface. Recorded here so that stream finds it.

### 4. Two operator decisions of 06:15, carried by this round

**A report about a young person is the guardian's to read.** Default 4 of pull
request 83 showed the portal's Reports screen to every contact on the record,
including a minor's own login, and named the reading as the operator's to say
yes to. She said no. Migration 955 adds `app.actor_may_read_reports_of` — a
legal guardian, or the person themselves once they are an adult, with the age
decided in the practice's own time zone as migration 702 decides it — and the
`report` read policy asks it in place of `app.actor_is_contact_of`. So the row
is refused and not a line a screen leaves out. `reportsVisibleTo` states the
same rule in `domain/portal` and the portal's Reports route narrows the
household by it. It is deliberately narrower than the money rule beside it,
which admits every contact who is not a minor's own login: the household pays,
so whoever settles an invoice has business with a balance, and a report is not
the same kind of thing. `docs/SPEC/reports-v1.md` section 7.3 is amended and
`reports-01.md` records the reversal.

**The platform's own hosted project exists.** The operator created it at 06:22
that morning, and `PLATFORM_PRODUCTION_PROJECT_REF` in
`.claude/hooks/no-prod-in-dev.sh` is filled in. Every sentence in
`docs/SPEC/hosting.md` and `docs/RUNBOOK/restore.md` that spoke of the day it
would be created now says the day has come, each marked, and the restore
rehearsal waits on nothing but a first dump worth restoring. The reference is
the twenty characters of a URL and not a credential: the keys and every
runtime setting stay in the host's secret store and never enter this
repository. The migration guard in `db/runner/plan.ts` is unchanged, which was
the point of writing it from the local end.

The GitHub `production` Environment is a separate thing and **still does not
exist**: creating it changes the repository's settings, which the permission
layer refuses a session unattended. `docs/RUNBOOK/restore.md` section 3 keeps
that sentence, and the operator's pack carries the command.

### 5. Every file this fix round touched outside the trunk's own paths

**reports** (item 10)
`db/policies/reports/reports.sql`; `tests/reports/db/portal.test.ts`, `tests/reports/db/rls.test.ts`.

**client-portal** (item 10)
`app/api/portal/reports.ts`, `app/api/portal/household.ts`;
`domain/portal/index.ts`, `domain/portal/reports.ts` and its test.

**assessment** (item 9)
`app/admin/assessments/RecordDrawer.tsx`, `AssessmentsTab.tsx`,
`app/api/assessments/schema.ts` — one word in a comment in each.

**audit-ui** (items 1, 2 and 3)
`app/api/audit/activity.ts`, already listed in the round's own widening.

Everything else is the shared zone or the trunk's own: `domain/shared/**`,
`app/admin/settings/**`, `app/api/practice/**`, `db/migrations` 9xx,
`db/runner/**`, `tests/db/**`, `.claude/hooks/**` and `docs/**`.

### 6. The defaults this fix round took

1. **The erasure clause asks the status as well as the gate.** The review
   proposed short-circuiting `$9` to "owner-or-lead and reason-present", which
   on its own changes nothing: `client_erasure_gate` admits the owner and the
   lead practitioner regardless. The clause therefore asks
   `app.client_status_for(...) is distinct from 'erased'` beside it. `is
   distinct from` and not `<>`, so a row whose client cannot be read at all
   behaves exactly as it did before.
2. **A feed narrowed to an erased record is a 404 for an admin**, where it used
   to be a 200 with an empty list. That is the timeline's answer to the same
   question, and "exactly as the timeline does" is what the fix asked for.
3. **The page is cut after narration and `hasMore` follows the narrated
   count.** A batch that narrates to nothing therefore ends the scroll rather
   than promising more it cannot show. That is the smaller of the two wrongs
   and it is the shape the fix names; the rows that can still be dropped are
   `update` rows whose only changed column was `updated_at`.
4. **`app.actor_may_read_reports_of` is a trunk migration (955)**, not a `6xx`
   in the reports stream's range. The policy file it serves is that stream's,
   but this is an operator decision taken during the trunk's round and applied
   in the trunk's pull request, and a stream's range is not the trunk's to
   write in.
5. **A client with no date of birth reads as an adult**, in the new rule as in
   migration 702's: the column is optional, and inventing a birthday to
   withhold a document from an adult is the worse mistake.
6. **A minor's own login sees an empty Reports screen** rather than a refusal.
   `forReports` narrows the household to nobody, so the screen's own empty
   state answers; a 403 would say that a document exists and is being withheld,
   which is the thing a 404 exists to avoid everywhere else in this repository.
7. **`reportsVisible` sits on `HouseholdClient` beside `moneyVisible`.** The
   portal already carries one per-client visibility answer resolved once, in
   the database, from the actor stamp; a second rule answered anywhere else
   would be the beginning of two places to look.
8. **The tests for item 10 live in `tests/reports/db/portal.test.ts`**, against
   round 31's own default 18, because the harness that issues a report and
   signs a portal request is there and rebuilding it under `tests/db/` would
   prove less.

## Round 32, 2026-09-06 (the first practice, and what a fresh database is missing)

One item. `docs/PRODUCTION.md` records a production project holding the whole
schema and nothing else — zero rows in `tenant`, `app_user` and `client` — and
the only thing in this repository that has ever written a practice is
`db/seed/apply.ts`, which writes a synthetic one and refuses to run anywhere
but a laptop or staging. So there was no supported way to open the product and
the founder could not sign in. Migration `956_bootstrap_practice.sql` is that
way, `tests/db/bootstrap-practice.test.ts` is what holds it to its promise, and
`docs/PRODUCTION.md` gains the section "The first practice" written for the
operator rather than for a developer.

### What a practice must start with, and where each default comes from

The round began by reading every migration that writes a per-practice default
(`grep -ln "from tenant" db/migrations` gives eight files; two of them, 702 and
950, are the phrase appearing in prose and are not data steps). Six real ones
remain, and the finding that shaped the whole round is that **every one of
them writes its default twice**: a data step at the end of the migration, for
a practice that already existed when it ran, and an after-insert trigger on
`tenant` for every practice created from then on.

| Table | Rows | From | The trigger that gives a new practice its own |
|---|---|---|---|
| `goal_category` | 6 | `100_client_record.sql` | `seed_goal_categories` |
| `scheduling_setting` | 1 | `202_scheduling_setting.sql` | `default_scheduling_setting` |
| `vat_setting` | 1 | `400_billing_catalogue.sql` | `default_vat_setting` |
| `invoice_number_series` | 1 | `402_billing_document.sql` | `default_invoice_number_series` |
| `payment_receipt_series` | 1 | `405_billing_receipt.sql` | `default_receipt_series` |
| `report_number_series` | 1 | `600_report.sql` | `default_report_number_series` |

The routing factors the brief asked after are not a table of their own: they
are `drive_road_factor` and `drive_peak_multiplier`, two columns
`204_drive_estimate.sql` added to the `scheduling_setting` row, and they arrive
with it. The practice identity placeholders are columns on `tenant` itself
(`905_practice_identity.sql`), not rows, and decision 5 below is what the
function does about them.

### The decisions

1. **The defaults are not copied. The triggers do the work.** The brief
   offered two shapes — factor each data step into a function both callers
   use, or copy each `insert ... select` with a comment naming its migration —
   and reading the migrations showed a third that is better than either: the
   triggers already exist, they were written for exactly this case, and
   `app.bootstrap_practice` inserts the tenant and lets them run. A copy is a
   second implementation that drifts the first time either side changes; there
   is nothing here to drift. What the function adds is a **check**: after the
   insert it asks each of the six tables whether the new practice has any rows
   at all, and refuses with the table's name and its migration's if one is
   empty. A future migration that adds a per-practice default and forgets its
   trigger is then refused loudly at the one moment it matters, instead of
   leaving a practice quietly short of a row nobody thinks about until an
   invoice cannot be numbered.

2. **The check reads `to_regclass` and skips what is absent.** Apply order
   across the ranges is not fixed (`docs/SPEC/OWNERSHIP.md`): a database may
   carry the trunk's migrations and one stream's and not another's. A table
   that is not on this database is not a missing default. This is the guard
   `app.erase_client` already uses when it reaches into a stream's tables, and
   it is why the `-- Needs:` line names only 010 and 020: the function must be
   creatable on any database, whichever streams that database has seen.

3. **The `950–999` half, not `900–949`.** The completeness check names tables
   the streams own, so the file must sort after them. The brief said the same;
   the reasoning is recorded here because the two halves are easy to confuse.

4. **The arguments are the brief's six, and nothing more.** Legal name,
   Arabic legal name, the Supabase Auth user id, the owner's display name, the
   owner's email, and the time zone with `Asia/Dubai` as its default. No
   phone, no emirate, no licence: `tenant.default_emirate` already defaults to
   `DXB`, and everything else is a fact only the owner holds.

5. **What it deliberately leaves null**: the corporate-tax registration
   number, the trade licence with its authority and expiry, the VAT
   registration, and the practice's own address. Every one of them is editable
   in Settings (`app/api/practice/routes.ts`, migration 905), and a
   placeholder that later reads as a fact is worse than a gap — a printed
   invoice is the thing at the end of that mistake. The address in particular
   is a `location` row that the settings screen creates on the first save;
   until then an invoice carries a blank supplier address, which is true
   rather than wrong.

6. **`created_by` stays null on the tenant, the owner and the role**, and so
   does `user_role.granted_by`. `tenant.created_by` could not be anything else
   — the user it references does not exist at that instant — and writing the
   owner into the other two would say she granted herself ownership. Nobody
   granted it; the bootstrap did, and the audit rows say `system` with this
   file as the reason.

7. **The arguments are checked before the state.** A blank name is then
   reported as a blank name whether or not a practice already stands, which is
   the more useful message of the two, and it lets every refusal be proved on
   one database in the test rather than on a rebuilt one per case. The owner's
   Auth id is checked twice in that spirit, the second added in the fix round:
   null first, and then — where the database carries Supabase's own
   `auth.users`, read through the same `to_regclass` guard as the defaults —
   that the id names an account really there. A mistyped or wrong-project User
   UID would otherwise make a practice nobody can sign in to, and every attempt
   to put that right is refused as a second practice; the way back from it is
   the one `update` in `docs/PRODUCTION.md`'s first refusal, which is written
   out there in full.

8. **The SQLSTATEs**: `22023` (`invalid_parameter_value`) for anything the
   caller typed, `23505` (`unique_violation`) for a second practice — the
   platform holds one, and that is what the code means — and `P0002`
   (`no_data_found`) for a default that did not arrive, which is the one
   refusal that is not about the caller at all. The API role's refusal is
   Postgres's own `42501`.

9. **Execute is revoked from `public` and from `app_role`.** The second is
   redundant against the first and is written anyway, because "the API cannot
   reach this" is the claim being made and a reader should not have to reason
   about role membership to check it. Supabase's `service_role` is granted
   execute **only where that role exists**, inside a `do` block: a laptop has
   no such role and an unconditional grant would fail every local migration
   run. The function is `security definer` with a pinned search path, in the
   pattern every function in this schema uses, so it writes as the table owner
   however it was reached.

10. **The audit context is the runner's own shape**: `app.reason` naming the
    file, a fresh `app.request_id`, and — from the fix round — the actor and
    its roles cleared rather than left as the connection had them, all four
    transaction-local. Every row the function makes is therefore logged as a
    system action under one reason, the way a data migration's rows are. Nobody
    was signed in when the practice was created; the SQL editor stamps no
    actor, but a connection that had run something else first would, and that
    person did not create the practice.

11. **The test compares against a seeded practice over every tenant-scoped
    table in the schema, not a list written by hand.** It builds a seeded
    database, snapshots what the synthetic practice holds in all 41 tables that
    carry a `tenant_id`, discards it, rebuilds, bootstraps, and snapshots
    again; the two must agree table by table and row by row once the seed's own
    synthetic people, catalogue and money are set aside. That exclusion list is
    `tests/db/seed.test.ts`'s own `SEED_TABLES`, which already exists and
    already means exactly this. What that comparison catches is a seventh
    *trigger-fed* default missing from the function's hand-written list: both
    practices in it are made after every migration has run, so a data step
    fires for neither, and a default written as a data step with no trigger is
    absent from both sides and passes unseen. That case is the second test's,
    added in the fix round: it scans `db/migrations/*.sql` for every table an
    `insert ... from tenant` data step writes, reads the function's own list
    back out of the database with `pg_get_functiondef`, and requires the two to
    be the same set — so between them the pair is what keeps decision 1 honest
    over time. The two practices cannot share a database — a second practice is
    what the function refuses — so the file pays for two builds, and takes
    about two seconds.

12. **`docs/STAGING.md` is untouched.** Its section 7 is the exit test and
    names no first-owner step: staging's practice comes from the seed and its
    section 4 links the seeded people to dashboard accounts by hand. Nothing
    there is made wrong by this round.

### Deliberately not built

No route, no screen and no command-line wrapper: this is run once, by the
operator, in the project's own SQL editor, and every extra door is another
thing that has to be kept out of the API's reach. Nothing that makes a second
practice — a multi-practice platform is a decision nobody has taken. And
nothing that repoints an existing owner at a new Auth user id, which is the
other thing an operator locked out might want; it is one `update`, it is
described in `docs/PRODUCTION.md`'s first refusal, and inventing a function
for it would be inventing a door before anyone has asked to walk through it.

### A test that read the clock in the wrong calendar

`tests/scheduling/db/move_and_cancel.test.ts` named the day 300 hours out in
UTC while `GET /api/appointments` reads its `date` as a day in Asia/Dubai, so
the confirm test failed on every run started between 08:00 and 12:00 UTC; the
day is now taken in the practice's own zone, the same slip is put right in
`tests/portal/db/support.ts` and `tests/session/db/photo_and_routing.test.ts`,
and all three are scheduling's, the client portal's and session-capture's test
files edited under this round's widening and nothing of the trunk's beyond it.

---

## Round 33, 2026-09-06 (what a forgiven fee still said, and the recording's own signature)

Seven items in one round: the five things the fee round left at the trunk's
door (`docs/CHANGE-REQUESTS/billing-06.md`) and the two the assessment stream's
file door left (`docs/CHANGE-REQUESTS/assessment-02.md`, requests 2 and 3).
Three of the seven are outside the trunk's own paths, so — as rounds 31 and 32
did, and by the integrator's widening for one round — one branch answers all
seven rather than three branches answering pieces of it. Every file outside the
trunk's own paths is listed below by name, and a widening note stands beside it
in `docs/SPEC/OWNERSHIP.md`.

### 1. A waived fee is not a taxable supply

`billing-06.md` request 2. **Closed.**

Migration `957_vat_taxable_supplies_excludes_waived.sql` replaces
`app.vat_taxable_supplies_fils(date)` whole with 953's body and one clause
more, `and i.waived_at is null`. 953 is merged and `create or replace` has no
patch form, so the rollback carries 953's body verbatim — the way 408 carries
404's. A future migration that changes this function starts from **957's**
body.

Why the clause. The function sums `invoice.net_fils` over twelve months to say
how close the practice is to the AED 375,000 registration threshold. A
call-out fee the practice forgave is money nobody owes and nobody will pay:
`app.billing_ledger` has already stopped counting it and the invoice book shows
it as waived. Counting it here would push the practice into registering earlier
than the law asks, on the strength of charges it decided not to make. Round
31's default 9 — that over-counting is the safe way round for a warning — holds
for a charge that stands unpaid and not for one the practice has forgiven,
because forgiving it is the practice saying no supply was charged for.

It moves nothing else: `waived_at` can only ever be set on a `call_out_fee`
invoice (`invoice_only_a_fee_is_waived`, 408), so the clause is false for every
session, package and statement invoice there has ever been. And it is not the
mechanism once the practice registers: a taxable supply is then undone by a
credit note with its own number, never by a flag (`docs/SPEC/billing.md`
section 4.3).

`tests/db/vat-threshold.test.ts` proves it both ways round — the same fee left
out while it is waived and counted with the waiver lifted, inside one
transaction that is rolled back, so the only difference between the two figures
is the three waiver columns. Nothing about the window or the erasure gate
moved.

### 2. The EDF signature belongs beside the other four

`assessment-02.md` request 2. **Closed.**

`domain/shared/fileSignature.ts` gains a named export `bytesAreAnEdf(bytes)`
beside `bytesMatchMimeType`. The European Data Format has no registered media
type to key a case on, so `KNOWN_MIME_TYPES` stays at four and the switch is
untouched: a caller declares a recording `application/octet-stream` and asks
this question separately. The eight-byte version field — an ASCII `0` then
seven spaces — is the whole check, and the doc comment says what comes next
(an eighty-byte field naming the person the recording was made of) and that
this module never reaches it.

`domain/assessment/fileType.ts` drops its own `EDF_VERSION`, its local
`startsWith` and its local `bytesAreAnEdf`, and re-exports the shared one under
the same name, so **no caller moved** — exactly what round 31 did for the PDF's
own five bytes. Its doc comment's paragraph about checking the signature
locally is now one sentence saying the trunk answered it in round 33, and its
test still asserts the behaviour through `classifyAssessmentFile`, with one
case reading the re-export itself so the re-export cannot silently rot.
`docs/SPEC/assessment.md` decision 3's last sentence is amended in place.

### 3. The fixture that still said `raw`

`assessment-02.md` request 3. **Closed.** One object in
`domain/shared/audit-narrative.test.ts` filed a document with `role: 'raw'`, a
word migration 503 renamed to `raw_recording`. It says the new one. Nothing
else in the file: the sentence the test asserts never read the role at all,
which is why this was a word and not a fault.

### 4. The column comment on the fee

`billing-06.md` request 4. **Closed.**

Migration `205_unfit_fee_is_the_call_out_fee.sql`, in the scheduling range,
replaces 202's comment on `scheduling_setting.unfit_fee_fils`. 202 said
"Recorded here; nothing charges it yet", which was true when it was written and
stopped being true when 408 began posting the fee. The comment now says what
the column pays for: the practice's call-out fee, net of VAT, snapshotted by
`app.billing_on_appointment_charged` (migration 408) onto a `call_out_fee`
invoice on a late cancellation, on a visit unfit at the door and on a no-show —
the no-show being Claude's default of 2026-09-06 for the founder to overrule
(`billing-05.md`). 202 is merged and is not edited; the rollback restores its
words exactly.

**`Needs: 202` only, though the comment names 408.** `checkNeeds` refuses a
`Needs` at or above the file's own number, and rightly: apply order across the
ranges is not fixed and a later number is no proof a later file is on this
database. Nothing here depends on 408 — a comment describes, it does not
reference — so the file needs the column to exist and nothing else, and the
header says so.

### 5. The route comment that taught the old rule

`billing-06.md` request 5. **Closed.** The doc comment above
`app/api/appointments/settings.ts` quoted the consequence a cancel confirmation
must name as "this is inside the practice's twenty-four hours and uses one of
the client's sessions". Nothing takes a session any more. It now reads
"…carries the practice's call-out fee". Comment only; the route's behaviour is
untouched.

### 6. A waived fee in the household's own screen

`billing-06.md` request 1. **Closed.**

`PortalInvoice` gains `waivedOn`, a nullable day; `INVOICES_SQL` selects
`to_char(i.waived_at at time zone $2, 'YYYY-MM-DD')`; and the money screen's
invoice row shows "Waived" with the day, in both languages, on a row that
carries one. The figure stays on the row, because a waiver forgives a charge
and does not rewrite what happened.

Why it mattered. 408 posts the fee as an ordinary invoice and a waiver marks
the row rather than deleting it, so the balance stops counting it while the
list goes on showing it. The practice's own invoice book already says "Waived"
with the date and the rendered PDF carries `waivedNotice` in both languages;
the household's screen was the one place left presenting the charge as live.

`tests/portal/db/routes.test.ts` waives a real `call_out_fee` invoice through
`app.waive_call_out_fee` — the practice's own door — and asserts the day the
route answers is the day the database wrote, in the practice's own zone;
`tests/portal/screens.test.tsx` reads the word and the day in English and in
Arabic and proves an ordinary row says nothing of the kind.
`docs/SPEC/client-portal.md`'s money screen gains one sentence.

### 7. The fee is stated net of VAT on the page a household signs

`billing-06.md` request 3. **Closed.**

`docs/CONSENT/simple/bookings-and-packages.md` says AED 150 twice, and both now
carry the same short clause: "plus VAT once the practice is registered for it".
Every price this platform publishes is net — 408 snapshots
`scheduling_setting.unfit_fee_fils` as the net figure and 406 adds VAT on top
at write time once the practice is registered — so the day the practice
registers, a page a household signed saying AED 150 becomes a charge of
AED 157.50, which is exactly the sort of thing a family reads as the practice
moving the price. The page is accurate today and this was cheap to fix now.
`docs/CONSENT/simple/README.md` records the amendment under the founder's
review.

**The founder should see this.** Her review copy outside the repository was
refreshed to match and its PDF rebuilt, and the pull-request body says under
its own heading that this is a wording change to a page she approved on
4 September.

---

### Every file this round touched outside the trunk's own paths

Listed by name, as a widening requires. Each is a change the item above it
could not be made without.

**client-portal** (item 6)
`app/api/portal/schema.ts`, `app/api/portal/money.ts`;
`app/client/MoneyScreen.tsx`, `app/client/i18n/dictionary.ts`;
`tests/portal/fixtures.ts`, `tests/portal/screens.test.tsx`,
`tests/portal/dictionary.test.ts`, `tests/portal/db/routes.test.ts`.

**assessment** (item 2)
`domain/assessment/fileType.ts` and its test.

**scheduling** (items 4 and 5)
`db/migrations/205_unfit_fee_is_the_call_out_fee.sql` (new, in the stream's own
range); `app/api/appointments/settings.ts`.

Everything else is the shared zone or the trunk's own:
`domain/shared/fileSignature.ts` with its test, `domain/shared/index.ts` and
`domain/shared/audit-narrative.test.ts`; `db/migrations/957`; `tests/db/`;
`docs/SPEC/`, `docs/CONSENT/` and `docs/CHANGE-REQUESTS/`. Nothing in the
stream paths above is the trunk's beyond this round.

### Every default taken

Ten, all the builder's. Each is here because a reader of this round should not
have to find it in a diff.

1. **The portal field is `waivedOn`, not `waivedAt`.** The request wrote
   `waivedAt`. What is on the wire is a day, `YYYY-MM-DD`, and it sits beside
   `issuedOn` on the same object and `receivedOn` on the payment next to it;
   `app/api/billing/document-source.ts` already calls the same thing `waivedOn`
   on the invoice model the PDF renders. A name ending `At` that carries no
   time is a small lie a reader has to check.
2. **The day is taken in the practice's zone through the `$2` parameter
   `PAYMENTS_SQL` already uses**, not the literal `Asia/Dubai` the request
   wrote. The file's own pattern is the parameter, the zone comes off the
   tenant row, and a second literal is a second place to change it.
3. **The word is a phrase function, `PHRASES.waivedOn(day)`, not a bare word
   beside a date.** The dictionary's own rule is that anything carrying a value
   is a function, because Arabic puts the pieces in a different order; the
   Arabic verb and its connective are `waivedNotice`'s from
   `domain/billing/document/strings.ts`, so the household's screen and the
   rendered invoice say the same word.

   **The shortened Arabic form wants the operator's eye.** The row says
   `أُعفي بتاريخ …`; the document's own line says `أُعفي هذا المبلغ بتاريخ …`
   and then that nothing is owed. A table row is not a document's line — the
   row already carries the invoice's number and its figure, which that
   sentence would only repeat — so the phrase was shortened to the verb, the
   connective and the day. Every word of it is `waivedNotice`'s, and the
   passive verb with its connective is grammatical, but the short form is not
   a string this repository holds verbatim. It therefore goes to the operator
   for approval, as every Arabic string does.
4. **`bytesAreAnEdf` is a named export beside the switch**, which is the shape
   the request left to the trunk. The alternative it offered — an agreed
   internal type string keyed into `bytesMatchMimeType` — would put a thing
   that is not a media type into a table of media types, and every caller of
   that function would then have to know which of its keys were real.
5. **It joins `domain/shared/index.ts`** beside its three neighbours. The
   barrel is what the module offers; a named export reachable only by its file
   path would be the odd one out.
6. **The test for migration 205's comment lives in `tests/db/`**, the trunk's
   own path, not `tests/scheduling/db/`. The migration is in the scheduling
   range but the trunk wrote it under this round's widening, and round 31's
   default 18 already settled the shape: a trunk test dropped into a stream's
   suite becomes that stream's the moment it lands.
7. **Both call-out-fee fixtures write the invoice rather than provoking it.**
   `app.billing_on_appointment_charged` posts a fee when a visit's status
   changes, so a fixture that called a visit off would also add a row to the
   Visits screen and burn an invoice number the suite's own fixtures had
   written by hand. Each fixture leaves the visit proposed — shown nowhere —
   and writes the row it wants to ask about.

   **The two part company over the waiver itself.**
   `tests/portal/db/routes.test.ts` goes through the practice's own door,
   `app.waive_call_out_fee`, with the practice, the actor and the reason in
   context, because that route's test is about what a household is shown after
   a real waiver. `tests/db/vat-threshold.test.ts` writes `waived_at`,
   `waived_by` and `waiver_reason` by hand as the database owner, and lifts
   them by hand again, because that test has to read the figure with the same
   invoice waived and then unwaived inside one rolled-back transaction, and
   nothing in the schema un-waives a fee: the door is one way, by design.
8. **957 does not restate 953's `revoke` and `grant`.** `create or replace`
   keeps the privileges a function already has, and 954 set that precedent: it
   restated neither when it replaced `app.erase_client`. It is no precedent for
   the other half, though — 954's rollback names `107_erase_report.sql` rather
   than writing 107's body out, and 408, which carries 404's version in full,
   is the one this rollback follows. The header says both, so a reader does not
   have to reason about either.
9. **The consent page repeats one clause twice** rather than carrying a
   sentence at the foot of the page, which the request offered as the
   alternative. A household reads the paragraph that applies to it and not the
   whole page, and a foot-of-page qualifier is the beginning of small print,
   which is the one thing the simple wording exists to avoid.
10. **The README's amendment line is a new paragraph under the founder's
    review**, not a change to the review's own paragraph. What she approved on
    4 September stands as written; what came after it is dated separately.

### What the streams should know

**billing.** `app.vat_taxable_supplies_fils(date)` now leaves a waived fee out.
Nothing else about the function moved, and a future migration that changes it
starts from 957's body. All five of `billing-06.md` are closed.

**And one line for billing's next round.** The portal's waived-fee day is now
in a `numeric` span, for the tabular figures `docs/DESIGN-BRIEF.md` section 4.4
asks of every date. `app/admin/billing/InvoicesSection.tsx` renders the same
"Waived" and day in a `small muted` span without it, so the admin's figures do
not align down the column. It is billing's file and this round did not touch
it.

**client-portal.** `PortalInvoice` carries `waivedOn`, a nullable day, and the
money screen renders it; `INVOICES_SQL` now takes the practice's time zone as
`$2`, as `PAYMENTS_SQL` already did. `PHRASES.waivedOn` is in the dictionary.
The stream owns all of it from here.

**assessment.** `bytesAreAnEdf` is `domain/shared`'s, re-exported by
`domain/assessment/fileType.ts` under the same name, so nothing that imports it
moved. Both requests of `assessment-02.md` that were written and not applied
are closed. `domain/assessment/fileType.ts` now holds only the practice's own
decisions: which media type an export may be, and how the amplifier software's
own recording is recognised.

**scheduling.** `scheduling_setting.unfit_fee_fils` has a new comment, in
migration 205 in your own range. 202 is untouched. `tests/db/`, not
`tests/scheduling/db/`, holds the test that reads it back, for the reason
default 6 gives; move it if you would rather own it.

**Everyone.** A migration that only comments another stream's column is a
migration in **that stream's** range with a `Needs` naming only what it needs
to exist. A comment describes; it does not depend.

## Round 34, 2026-09-06 (the bands in both languages and in colour, one press to the access report, and who reads what)

Five items in one round: four requests already written — `qa-01.md`'s Arabic
band vocabulary, `reports-01.md`'s R3 and R4, and the "one press" round 31's
fix round left at the audit stream's door — and one that closes with a reading
and builds nothing. Four of the five reach outside the trunk's own paths, so —
as rounds 31, 32 and 33 did, and by the integrator's widening for one round —
one branch answers all five rather than four branches answering pieces of it.
Every file outside the trunk's own paths is listed below by name, and a
widening note stands beside it in `docs/SPEC/OWNERSHIP.md`.

This round **stacks on round 33** (pull request 103, reviewed and waiting on a
GitHub billing block): both edit the same record files, so its pull request is
opened against `trunk-round-33` and the integrator rebases it onto `main` once
103 merges.

### 1. The five bands have one home

`qa-01.md`, "Requested: an Arabic vocabulary for the five bands". **Closed.**

`domain/shared/bands.ts` is that home: `BANDS` and `Band` (the five keys, slow
to fast, which is the hue ramp's order), `BAND_NAMES` with an English and an
Arabic word each, `UNITS`, `UNIT_NAMES`, and `BAND_RGB` — the design brief's
five hexes as the 0-to-1 triples a printed page can carry.

Why it had to be here rather than in either stream. The names existed twice, in
English only: `BAND_LABELS` in `app/admin/assessments/copy.ts`, which the
comparison screen renders, and `BAND_WORDS` in `app/api/reports/gather.ts`,
which quoted it rather than importing it because rule 3 holds a route out of
another stream's folder. Neither was the place to invent an Arabic half:
whichever added it first, the other would copy it, and two copies of a
vocabulary drift. The precedent is round 31's `fileSignature` and round 33's
`bytesAreAnEdf`.

**The five Arabic words want the operator's approval**, and are marked as such
here and under their own heading in the pull-request body. They are the plain
transliterations of the Greek letters — دلتا، ثيتا، ألفا، بيتا، غاما — which is
what the bands are called in Arabic-language writing, but they are not strings
this repository already held. They are in one file, so approving them or
replacing them changes one place.

What moved, and what did not. `domain/assessment/types.ts` re-exports `BANDS`,
`Band`, `UNITS` and `Unit` from shared under the names it already used;
`domain/reports/types.ts` re-exports the same five as `BAND_KEYS` and
`BandKey`. **No caller moved** — `z.enum(BAND_KEYS)` in the progress shape,
`RibbonSlice.band`, `validateDerived`'s `unknown_band` refusal and
`dominantBand`'s tie-breaking order are all untouched, and a test in each
module reads the re-export itself so it cannot silently rot into a copy.
`BAND_LABELS` and `UNIT_SHORT` are derived from the shared vocabulary and keep
their export names. `gather.ts` drops both its local tables and fills `labelAr`
as `${site} ${BAND_NAMES[band].ar}`: the site does not turn over, because an
electrode site is written in the international 10-20 system in every language,
so the Arabic half is the same pair said twice rather than a translation. The
null-`labelAr` fixture in `tests/reports/document.test.ts` stays, because a
report already filed may carry one and the renderer's fallback is still a
branch worth proving.

`domain/shared/bands.test.ts` reads `app/shell/tokens.css` and proves the five
triples are the five `--<band>-base` declarations, so the paper and the screen
cannot drift apart. That test is the reason no component needed a hex literal.

**One home means one, so the other two copies went as well.** The request named
two, but a search for the five keys found four: `domain/session/events.ts`'s
`BAND_KEYS`, which is what a telemetry chunk's per-band amplitudes are checked
against, and `MAP_BANDS` in `db/seed/generate.ts`, which is what every brain-map
fixture in the seed is built from. `events.ts` now re-exports the shared list
under the two names it already exported, the way `domain/reports/types.ts`
does, and its test reads the re-export and checks that `BandAmplitudes` accepts
exactly those five keys in that order. `generate.ts` imports `BANDS` — it
already imported `domain/shared/dates` and `domain/shared/storage`, so it was
one import — and the local list went; a fixture whose bands could drift from
the software's would prove nothing about the screens and reports it exists to
fill. `grep "'delta'"` over the repository now finds `domain/shared/bands.ts`
and nothing else. `events.ts` is `session-capture`'s path and is named in the
file list below and in the widening note.

### 2. Colour reaches paper

`reports-01.md` R3. **Closed.**

`domain/shared/document/pdf.ts` gains an optional `rgb` on `Style` and on the
rule op, written as `r g b rg` for a fill and `r g b RG` for a stroke beside
the existing `g` and `G`, each value clamped to 0 to 1 and written by the same
`num` as every other number in the file.

**When it is absent the grey path is taken unchanged, and that is proved rather
than asserted.** `pdf.test.ts` holds `GREY_STREAM_BEFORE_COLOUR`: the content
stream the writer produced for a page of text and rules, captured from the
running writer *before* the emitter was touched and kept verbatim as the
expectation. A page with no colour on it renders to exactly that text, contains
no `rg` and no `RG`, and still says a grey once for two ops that share it. If a
later change makes that test fail, the change moved a document somebody has
already been handed.

The writer keeps **one** fill state for both paths, and that is the point: a
colour set with `rg` has to be undone by the grey after it and a grey by the
colour after it, and two counters — one tracking a number, one a triple — would
each think the other's op had left the fill where it wanted it, so a line would
come out in the colour of the line before it. A rule's stroke stays inside its
own `q`/`Q`, exactly as it always has, so nothing after it inherits one.

Then `Sheet.ruleAt` takes an optional colour and is the only primitive on a
report's sheet that offers one, and `ribbonFigure` draws each slice in
`BAND_RGB[slice.band]`. Three things on the strip deliberately carry no hue: a
hairline marks a brain map, which is a day rather than a band; an empty slice
is a session not yet delivered, which has trained nothing; and a slice whose
visit recorded no band is ink, because a colour chosen for it would say a band
was trained that was not. The two comment blocks that explained why the strip
was ink-only say what is now true. `tests/reports/document.test.ts` proves each
slice's triple, the ink slice, and — the design brief's own claim — that no
other op on either page of a report carries a colour at all.

### 3. One press to the access report

`trunk-notes.md` round 31's fix round, section 3. **Closed.**

`app/admin/audit/RecordTimeline.tsx` gains a link at its head, "Who has opened
this record", to `/admin/audit` with the record named — which is the prefix
`app/shell/App.tsx` mounts the screen under. It is shown only when
`canActor(actor, { type: 'audit.read', clientId })` holds, so finance, who sees
this tab and reads money rather than the trail, is not offered a link the route
would refuse. It stands at the head whatever the feed below it is doing,
including a record nothing has touched and one whose timeline would not load:
who has opened a record is a different question from what the record's own feed
says.

`app/admin/audit/AuditPage.tsx` reads that parameter on its first render and
opens the report as if the line's own button had been pressed, then clears it
from the address — with `replace`, so the address the link came from is not one
press of Back away from re-opening what was just closed. The report is a state
of the screen from that moment on, so closing it closes it and a reload opens
the feed.

**`app/admin/clients/ClientDrawer.tsx` is not edited.** The link lives in the
component the drawer already mounts, which is where round 31's fix round said
the press belonged. Its *test* is in the list below, because the component now
renders a `Link` and a `Link` needs a router above it.

`docs/SPEC/audit.md` section 9, view 4 carries one sentence saying where the
one click now is and who is offered it, marked "Amended 2026-09-06".

### 4. Who reads what

`reports-01.md` R4. **Closed.**

`docs/SECURITY.md` gains "Who may read what" after "The layers": a row per
client-scoped group of tables — the record with its contacts, consents,
locations and documents; visits; sessions; money; measurements and their files;
reports; portal invitations and requests; the audit trail with the activity
feed and the access report — a column per role in `ROLES`, and every cell read
off `db/policies/**` and `domain/shared/actor.ts` with its policy file named
beside it.

Three cells were widened or corrected in the fix round, and none of them
changed a policy. The **portal row** is new: `portal_invite` and
`portal_request` are client-scoped and personal and were outside the request's
own list of groups, so a page claiming to say who reads what had a hole in it —
invitations are the owner's and an admin's alone, requests add the lead
practitioner and the household's own, both erasure-gated, and a practitioner
and a finance account read neither. The **reports** row's household cell now
names the superseded version the household was actually sent
(`app.report_was_delivered`), which `report_readers` grants and the cell's
"issued reports" alone did not. And the **money** row's `catalogue_readers`
citation now says what it is: the catalogue itself — `package`,
`package_component`, `package_price` — is the four office roles' alone and is
neither a practitioner's nor a household's, which a row whose cells read "own
schedule" and "own record" would otherwise have been read as granting.

**Where a policy and the actor rule disagree the row says so.** There are six
worth a reader knowing about, and they all run the same way — the database is
the boundary and the API rule is the courtesy — but not all in the same
direction. `client.read` admits a practitioner the row policy scopes to their
own schedule, and knows nothing of the erasure gate. `billing.invoice.read` is
narrower than `ledger_readers`, deliberately and by `actor.ts`'s own comment.
`report.list` admits any contact of the record where the policy asks for a
legal guardian, or the person themselves once adult, and for an issued
document. No `appointment.list` scope admits a household at all, where the
appointment policy does. There is **no session-read action** in `canActor`, so
the session routes use `hasRole` directly and one of them lists finance as a
reader where the `document` policy does not. And on the audit trail the role
lists agree exactly, while the erasure gate, the reason a sensitive read must
carry and the 404 for a record the caller may not name all live in the routes
and not in the policy.

Beneath the table the two absences the request named stand as decisions with
their sources: finance reads no report (`docs/SPEC/reports-v1.md` 7.1,
`db/policies/reports/reports.sql`) and finance reads no audit trail
(`domain/shared/actor.ts`, `audit.activity`). And the section says that it is
rewritten in the same pull request as any policy that changes it — a page
describing row level security that is updated a round later is a page that has
been wrong for a round.

### 5. The household's own step in confirming a booking

Owed to a later round by `docs/HANDOVER.md` section 10 step 3, conditionally:
"if the scheduling spec names one". **Closed with a reading; nothing built.**

It names none. `docs/SPEC/scheduling-manual.md` section 3 defines `confirmed`
as "client informed (manual toggle in Phase 1; WhatsApp in Phase 2)" — an act
the practice performs and records, not one it asks the household to perform.
Section 4.3's "New appointment" gives the household no part either.
`docs/SPEC/client-portal.md` section 3.2 does not show a household a `proposed`
visit at all — "the practice has not told the household yet" — so there is
nothing on any household screen for a family to accept.

The qa-fixes-1 round reached the same reading when it built the confirm toggle
and wrote it into `qa-01.md` item 1: "No household step exists to build."
This closes it in the record so a later round does not go looking again. If the
founder wants a household to accept a proposed visit, that is a new decision
about the lifecycle rather than a gap in the build, and it starts with a change
to section 3.

---

### Every file this round touched outside the trunk's own paths

Listed by name, as a widening requires. Each is a change the item above it
could not be made without.

**assessment** (item 1)
`domain/assessment/types.ts` and `domain/assessment/validateDerived.test.ts`;
`app/admin/assessments/copy.ts` and `copy.test.ts` (new).

**reports** (items 1 and 2)
`domain/reports/types.ts` and `domain/reports/gatherProgress.test.ts`;
`domain/reports/document/sheet.ts` and `render.ts`;
`app/api/reports/gather.ts`;
`tests/reports/document.test.ts` and `tests/reports/db/reports.test.ts`.

**audit-ui** (item 3)
`app/admin/audit/RecordTimeline.tsx` and `RecordTimeline.test.tsx`;
`app/admin/audit/AuditPage.tsx` and `AuditPage.test.tsx`.

**client-record** (item 3)
`app/admin/clients/ClientDrawer.test.tsx` — a `MemoryRouter` around its three
renders and nothing else. `ClientDrawer.tsx` itself is untouched.

**session-capture** (item 1)
`domain/session/events.ts` and `domain/session/events.test.ts` — the fourth
copy of the five band keys, replaced by a re-export of the shared list under
the two names this folder already exported. No caller in that stream moved.

Everything else is the shared zone or the trunk's own: `domain/shared/bands.ts`
with its test, `domain/shared/index.ts`, `domain/shared/document/pdf.ts` with
its test; `db/seed/generate.ts`, whose `MAP_BANDS` was a fifth copy of the five
and now imports `BANDS`; `app/shell/shell.css`; `tests/security/xss.test.tsx`;
`docs/SPEC/`, `docs/SECURITY.md` and `docs/CHANGE-REQUESTS/`. No migration and no policy
file: nothing this round decided is a database's to enforce, and the one page
that describes what the database enforces is documentation of policies that did
not change. `docs/SPEC/00-data-model.md` is deliberately **not** edited: it
lists neither a vocabulary module nor a content-stream operator. Nothing in the
stream paths above is the trunk's beyond this round.

### Every default taken

Fifteen, all the builder's. Each is here because a reader of this round should
not have to find it in a diff.

1. **The five Arabic band names are the plain transliterations**, and they are
   marked for the operator's approval here and in the pull-request body rather
   than shipped as settled. The repository held no Arabic vocabulary for the
   bands, and the alternative — leaving `labelAr` null for another round — is
   the state `qa-01.md` filed as a defect. They are in one file, so replacing
   any of them is one edit.
2. **`UNIT_NAMES` is one string per unit, not an English and an Arabic half.**
   `µV²` and `%` are symbols in every language, and `ComparisonLine` carries a
   single `unit` with no Arabic twin to fill, so a bilingual table would have
   put three more strings in front of the operator that nothing on any page
   would print. The band names got the pair because a band name is the one
   thing on that line that changes language.
3. **`UNITS` and `Unit` moved to shared beside the bands**, though the request
   and the round's own brief named only the bands. The units stand beside the
   bands in the vocabulary `qa-01.md` asked for; leaving a second list of the
   same five words one file away is the drift the request exists to end. What
   each unit *means* — the paragraph the assessment specification wrote — stays
   in `domain/assessment/types.ts`, because that is a definition and not a name.
4. **`UNIT_SHORT` is derived as well as `BAND_LABELS`**, for the same reason.
   `UNIT_LABELS`, the long English sentences the screen sets beside a table,
   stays the screen's own: that is prose.
5. **`BAND_RGB` is written as `0x3b / 255`** rather than as decimals. It is a
   domain module and not a component, so the colour rule's ban on hex literals
   does not reach it, and writing the token's own bytes makes the
   correspondence readable at a glance. The test against `tokens.css` is what
   proves it either way.
6. **The round's own brief named `tests/audit/` for the step-3 tests, and the
   tests were put beside the components instead** — in
   `app/admin/audit/AuditPage.test.tsx` and `RecordTimeline.test.tsx`, which is
   not where the brief said to put them. The reasons, stated plainly because
   the brief's letter was not followed. Both paths are `audit-ui`'s, so nothing
   about ownership turns on the choice. Those two files already carry the
   harness — the auth boundary, the fetch stub, the fixtures — that a new
   folder would have had to duplicate. The precedent is the trunk's own: round
   31 created `AuditPage.test.tsx` beside the screen it wrote, for these same
   two components. And `docs/SPEC/OWNERSHIP.md` rule 4, the one rule that fixes
   where a test lives, governs **database tests only** — `tests/<worktree>/db/`
   is the only path the database runner scans — and neither of these touches a
   database. `tests/audit/` still does not exist, and this round did not create
   it for two tests.
7. **The link is a react-router `Link`, not a plain anchor.** An anchor would
   have needed no router above the component and would have cost two test files
   nothing — and it would also have reloaded the whole console, re-authenticated
   and re-fetched, to reach a screen already in the bundle.
8. **The parameter is cleared with `replace`.** Pushing a second entry would
   leave the address one press of Back away from re-opening a report somebody
   had just closed.
9. **`reportFor` is seeded in the `useState` initialiser**, not in an effect.
   The report is open on the first paint rather than after one, which is what
   "as if the line's own button had been pressed" means; the effect that clears
   the address is separate and runs after.
10. **The link is rendered above every state of the timeline**, which meant
    wrapping three early returns rather than adding it to the ready case. A
    record nothing has touched is exactly a record somebody might want the
    access report for.
11. **~~`domain/session/events.ts` keeps its own `BAND_KEYS`.~~ Reversed in the
    fix round.** It was left standing as `session-capture`'s path, written up
    for that stream rather than closed here. The review's reading is the right
    one: while a fourth copy stood — and a fifth, `MAP_BANDS` in
    `db/seed/generate.ts`, which is the trunk's own path and was named nowhere
    — "the five bands have one home" was a claim this round could not make, in
    `bands.ts`, in `qa-01.md` or in item 1 above. Both are closed: `events.ts`
    re-exports the shared list under `BAND_KEYS` and `BandKey`, `generate.ts`
    imports `BANDS`, and the widening was extended to name `events.ts` and its
    test. The alternative — leaving them and rewriting the claim to say which
    copies stand and why — would have left the request half answered for the
    sake of a boundary that a one-line re-export does not strain.
12. **`rgb` sits beside `grey` rather than replacing it.** A caller that passes
    both gets the colour; every caller that passes neither is exactly where it
    was, which is the whole promise of the item.
13. **A non-finite colour component clamps to 0**, not to an error. This is on
    the path that files a household's most personal document, and a rendered
    black rule is a smaller fault than a refusal to render at all; the values
    come from a table proved against `tokens.css`, so nothing reachable can
    send one. The default stands; the branch is no longer untested — the fix
    round added a triple with `NaN` in it and asserts the component reaches the
    stream as `0` and that the word never does.
14. **The rule's stroke is not tracked in the fill state.** It has always sat
    inside its own `q`/`Q`, so what it sets is discarded at the `Q` and the fill
    state genuinely does not need to know a rule happened. Tracking it would
    have been a second thing to keep honest for no benefit.
15. **The SECURITY table uses a five-word legend** — all, own schedule, own
    rows, own record, and a dash — rather than spelling the narrowing into
    forty-two cells. Six columns of prose is a table nobody reads; the
    narrowing each word stands for names its own helper function above the
    table.

### What the streams should know

**assessment.** `BANDS`, `Band`, `UNITS` and `Unit` are `domain/shared`'s,
re-exported by `domain/assessment/types.ts` under the same names, so nothing
that imports them moved. `BAND_LABELS` and `UNIT_SHORT` in
`app/admin/assessments/copy.ts` are derived from the shared vocabulary and keep
their export names; `copy.test.ts` is new and proves the derivation. If the
operator changes an Arabic band word, nothing in this stream changes.

**reports.** `BAND_KEYS` and `BandKey` are `domain/shared`'s under this
folder's own names. `app/api/reports/gather.ts` now fills `labelAr`, so an
Arabic progress report names a band in Arabic; the renderer already preferred
that half on a right-to-left page and did not change. `Sheet.ruleAt` takes an
optional colour and `ribbonFigure` uses it — **the printed ribbon now carries
the band's hue**, which closes R3, and it is still the only thing on either
page of a report that carries any. `reports-01.md` has no open item left.

**audit-ui.** The Audit screen reads a `report` query parameter and the record
timeline carries the link that sets it; both files are yours from here, as
round 31's widening already said. `docs/SPEC/audit.md` section 9 view 4 records
the amendment.

**client-record.** `app/admin/clients/ClientDrawer.test.tsx` gained a
`MemoryRouter` around its three renders. The component is untouched. Any new
test that mounts the drawer, or the record timeline on its own, needs the same
wrapper.

**session-capture.** `domain/session/events.ts`'s `BAND_KEYS` and `BandKey` are
`domain/shared/bands.ts`'s now, re-exported under the two names this folder
already exported, the way `domain/reports/types.ts` does. **Nothing that
imports them moved** — `domain/session/index.ts` re-exports the same two names,
and `BandAmplitudes` still declares the same five optional keys, which
`events.test.ts` now checks against the shared list rather than against a
second copy written beside it. The file was left alone in the round itself and
closed in the fix round, so it is named in the widening note; that is the whole
of the trunk's reach into this path.

**Everyone.** A colour on a document is `Style.rgb` and the rule op's `rgb`,
each a triple from `domain/shared/bands.ts` and nowhere else — no hex literal,
no colour typed at a call site. The design brief allows a hue on the session
ribbon and on nothing else in a document, and a test in
`tests/reports/document.test.ts` now enforces that for a report rather than
leaving it to a comment. And `docs/SECURITY.md`'s "Who may read what" is
rewritten in the same pull request as any policy that changes it.

## Round 35, 2026-09-07 (the console is English only)

**The decision.** The operator, 7 September 2026 at 19:37 Dubai: "everything in
app.mcwellnessuae.com should be English only, no need to show the Arabic
fields; Arabic is made only to communicate with clients. Anything facing the
client can be bilingual, but the admin and staff side of the business will be
English only." That closes item 4 of `docs/DESIGN-BRIEF.md` section 10, "Arabic
scope for v1", which had stood open since the brief was written: an English
product for staff, with every client-facing surface bilingual.

**What changed.** Every Arabic display and every Arabic input on the staff
screens — `app/admin/**` and `app/therapist/**` — is gone. Nothing else is.
The API still serves the Arabic columns, the portal and the documents still
render them, and production's Arabic legal name, one client's Arabic name,
three package names and five service names sit exactly where they were.
`tests/lint/console-is-english.test.ts` walks both directories and fails on
`lang="ar"` or `dir="rtl"`, with one allowlisted file —
`app/admin/clients/RecordConsentForm.tsx`, because the consent wording is the
household's own text, read and signed in its own language on the practice's
screen. **No migration and no policy file**, and no schema, seed or data
change: this round is a rendering decision and nothing a database enforces.
Six test files under `tests/` proved the rendering that is gone and now prove
its absence; every fixture keeps its Arabic name, because a fixture carrying
one is the proof that Arabic data on the wire breaks nothing.

Two consequences worth naming, because they are losses of an ability and not
of a display. The Arabic **legal name** and a package's Arabic **name** can no
longer be typed in the app. Both are still stored, still printed on invoices
and still editable by an audited data step; a screen that needs to edit one
again is a small addition, not a repair.

### Every file this round touched outside the trunk's own paths

**client-record.** `app/admin/clients/ClientDrawer.tsx`, `ClientsPage.tsx`,
`ContactsTab.tsx`, `contactName.tsx` (which loses `contactNameAr` and
`ContactNameAr`; the contacts tab was their only importer), `ContactForm.tsx`
and `ContactForm.test.tsx`, `EnrolmentWizard.tsx` and `EnrolmentWizard.test.tsx`.

**scheduling.** `app/admin/schedule/SchedulePage.tsx`, `WeekPage.tsx` and
`ScheduleClientDrawer.tsx`; `app/therapist/today/TodayPage.tsx` and `today.css`;
`tests/scheduling/SchedulePage.test.tsx`, `WeekPage.test.tsx` and
`TodayPage.test.tsx`.

**billing.** `app/admin/billing/BillingPage.tsx`, `BalancesSection.tsx`,
`PackagesSection.tsx` and `PackageDrawer.tsx`;
`tests/billing/BillingPage.test.tsx` and `PackagesSection.test.tsx`.

**assessment.** `app/admin/assessments/Comparison.tsx`, `copy.ts` (its doc
comment only — the `ar` half of `NOT_A_DIAGNOSIS` is unchanged) and
`AssessmentsTab.test.tsx`.

**session-capture.** `app/therapist/session/CheckInPage.tsx`,
`PreflightStep.tsx`, `Slider.tsx`, `SummaryStep.tsx` and `SessionRunner.css`;
`tests/session/CheckInPage.test.tsx`.

**Practice settings**, which no stream's row owns:
`app/admin/settings/PracticePage.tsx`, `PracticeDrawer.tsx` and
`PracticePage.test.tsx`.

The trunk's own half is `tests/lint/console-is-english.test.ts`,
`docs/DESIGN-BRIEF.md`, `docs/SPEC/assessment.md`, `docs/HANDOVER.md` and this
file. Nothing in the stream paths above is the trunk's beyond this round.

### What the streams should know

**client-record.** The Arabic columns and the API contract are unchanged. The
enrolment wizard's POST omits `givenNameAr` and `familyNameAr`, which the
create body already treated as optional, and the contact form's PATCH never
mentions them — `app/api/clients/contacts.ts` guards each with
`if (d.givenNameAr !== undefined)`, so an Arabic name already on a contact
survives an edit made from the form. Both tests now assert the body's shape.
The fixtures that carry Arabic names stay: they prove Arabic data on the wire
breaks nothing.

**scheduling.** `AppointmentRow.client` still carries the Arabic name; the day
table, the week grid, the schedule's drawer and the practitioner's day sheet
simply do not render it.

**billing.** `CreatePackageInput.nameAr` is `.nullable().optional()`, so the
package drawer omits the key rather than sending null, and the route's
`input.nameAr ?? null` makes those the same insert. `serviceTypeNameAr` is
still on every price and balance row.

**assessment.** `NOT_A_DIAGNOSIS` keeps both halves, byte for byte. The screen
renders the English one; `tests/reports/document.test.ts` still proves a
printed document carries the pair.

**session-capture.** `RatingQuestion.labelAr`, the checklist's `labelAr` and
the catalogue's `nameAr` are all still on the wire and still typed. The runner
does not render them.

**Everyone.** A screen that wants to show Arabic again is a decision for the
operator, not a fix — and the guard test will fail until the allowlist beside
it says why.

---

## Piece nineteen, 2026-09-08 (the console on any screen)

`docs/SPEC/responsive-console.md`, branch `responsive-console`. The piece is
almost entirely inside the shared zone the trunk owns, `app/shell/**`. Six
files outside it were edited, each because the change is the same change and
splitting it across six branches would leave the console folding at four
different widths in the meantime. Each is listed here as a request.

### 1. Three module stylesheets join the shell's tiers

**Who.** `scheduling`, the trunk (settings), `audit-ui`.

**What.** `app/admin/schedule/schedule.css` folded the week at 640px,
`app/admin/settings/settings.css` folded its facts at 40rem and
`app/admin/audit/audit.css` narrowed its event grid at 48rem. All three are now
the compact tier's own boundary, 767px. The week's second rule, at 1100px, and
the consent's height rule in `app/admin/clients/clients.css` both stay: each
asks a question the tiers cannot, and each now says so in a comment beside it,
which `tests/lint/one-set-of-breakpoints.test.ts` requires.

### 2. The week's own test reads the tier

**Who.** `scheduling`.

**What.** `tests/scheduling/WeekPage.test.tsx` read the fold out of the
stylesheet and asserted it was at or below 640px. It now asserts there is
exactly one fold and that it is the tier's 767px.

### 3. The clients page's autofocus joins the tiers

**Who.** `client-record`.

**What.** `app/admin/clients/ClientsPage.tsx` autofocused the search field at
`(min-width: 720px)`, a sixth breakpoint written in TypeScript rather than CSS.
It is now the tablet tier's 768px. The guard test was widened to read `.ts` and
`.tsx` as well as `.css`, because a width drifts as easily in one as the other,
and this is the one it caught.

### 4. The household's portal records why it keeps its own width

**Who.** `client-portal`.

**What.** `app/client/portal.css` keeps its 720px phone layout, by the
operator's decision that the household's screens reflow rather than being shown
zoomed out. It had no comment saying so, and the guard test requires every
exception to state itself, so one was added. No rule changed.

---

## Round 36, 2026-09-08 (a practitioner records their own home base)

Branch `practitioner-base`. The operator, at 03:16 Dubai, answering where the
founder's driving day starts: *"This is Shauna's home, every practioner can
add their own address."* The first half was already done — her practitioner
record and her base are on production, written by an audited data step. This
round is the second half: a practitioner sets their own base in the app, and
the office sets anybody's. It overturns `docs/SPEC/route-planning.md`
decision 14, which said the field would only ever be filled by a data step.

Almost all of it is inside the shared zone. Every file the round touched is
named below; two of them are outside the trunk's own paths and are recorded
as requests.

### The trunk's own files

- `domain/shared/actor.ts` and its test: the new action
  `practitioner.base.write`.
- `db/migrations/913_practitioner_base.sql`: `app.own_practitioner_id()`, one
  narrow arm on `app.guard_location_notes()`, and `app.set_practitioner_base()`.
- `db/migrations/914_audit_redact_location_points.sql`: `entrance_point`,
  `parking_point` and `community_gate` join the keys `app.audit_redact` drops
  outright, so a `location` keeps no coordinate in the audit trail — see below.
- `tests/db/audit.test.ts`: the three keys, and a location write proving the
  trail names the column and not the point.
- `db/policies/core/practitioner_base.sql`: who may write a `practitioner`
  row, and who may read a practitioner-owned `location`.
- `app/api/practitioners/routes.ts` and `schema.ts`, mounted in
  `app/api/create-api.ts`.
- `app/shell/adminAccess.ts`: `canOpenPractitioners` and `settingsHomeFor`.
- `app/shell/App.tsx`: the route `settings/practitioners`.
- `app/shell/AdminLayout.tsx` and `app/shell/components/Rail.tsx`: the rail's
  Settings entry, shown to anyone who may open either settings screen and
  landing on the first one they may open.
- `app/therapist/today/TodayPage.tsx` and `app/therapist/TodayLanding.tsx`,
  with their tests: "Your home base", the door from the practitioner's own face.
- `app/shell/components/CoordinateFields.tsx`, its test and
  `app/shell/components/geolocation.ts`, moved here from
  `app/admin/clients/` (see request 1), with the component's own styles added
  to `app/shell/shell.css`.
- `app/shell/App.test.tsx`: the new screen's route cases.
- `app/admin/settings/PractitionersPage.tsx` and its test,
  `PractitionerBaseDrawer.tsx`, `SettingsNav.tsx`, `settings.css`, and
  `PracticePage.tsx` and its test, which gain the strip of links.
- `tests/db/practitioners.test.ts`.
- `docs/SPEC/route-planning.md` (section 5.4, decision 14 and section 16),
  `docs/SPEC/audit.md` section 8, `docs/SPEC/OWNERSHIP.md`, and this file.

### What the database turned out to need, and what it did not

Checked against the running database before anything was written, and the
result is worth recording because three of the four findings were not what a
reading of the schema would suggest.

- **No grant was missing.** `app_role` already holds `select, insert, update`
  on both `practitioner` and `location` (090).
- **`location`'s insert was refused outright.** `client_record_writers`
  (`db/policies/client/writers.sql`) is restrictive and admits an insert only
  to an owner, an admin or the lead practitioner: a practitioner creating
  their own base row got SQLSTATE 42501.
- **`location`'s update was worse than refused.** Its update twin admits a
  practitioner only where `owner_type = 'client'`, so a practitioner moving
  their own base updated no rows and was told nothing. On top of that,
  `app.guard_location_notes` (100) narrows any non-office update to
  `access_notes` alone.
- **`practitioner` had nothing in front of it at all.** The table carried the
  permissive `tenant_isolation` policy and no other, so every role in the
  practice — finance and a client contact included — could update every
  practitioner row.

A restrictive policy can only narrow, so admitting a practitioner to their
own base through the ordinary path would have meant editing the
client-record stream's own policy file, which the trunk does not do. The act
instead takes the shape `app.erase_client()` already has for a write the
ordinary policies deliberately refuse: one security definer function that
states the rule and writes exactly two rows, with one narrow arm added to
`app.guard_location_notes` so its own update reaches the row. That arm is
unreachable from outside the function, because the policies above still
refuse a practitioner's direct update.

### The fix round, 8 September 2026

The combined review of pull request 126 said do not merge. Two blocking
findings and five smaller ones, all addressed on this branch before it merged;
the security definer function itself was not one of them — the review went at it
seriously and could not reach another practitioner's base, another practice's
rows, the studio or a household's home through it, and it is unchanged.

1. **A practitioner could not reach the screen the round exists for.** The
   rail's single Settings entry was gated on `practice.settings.write` and
   pointed at Practice, so the only people who could navigate to
   `/admin/settings/practitioners` were the owner and an admin — the two who
   could always have had the office set anybody's base. `settingsHomeFor`
   (`app/shell/adminAccess.ts`) answers the first settings screen a person may
   open, and `AdminLayout.visibleSections` shows the entry when that is not null
   and replaces its destination with it. The round's own test said "the rail
   never offers it to them"; it now pins the promise instead.
2. **The policy floor had no test.** Every database test went through the route,
   which refuses what the policies refuse, so `db/policies/core/practitioner_base.sql`
   could be deleted and the whole file went on passing. Fourteen cases in
   `tests/db/practitioners.test.ts` now drive `app_role` directly; six of them
   fail with the file removed, which was checked before they were kept.
3. **`practitioner_row_update_writers` was wider than its own comment.** An
   `update` policy cannot name a column, so the arm admitting a practitioner to
   their own row granted `status`, `vehicle` and the rest with it. Nothing used
   it — the definer function bypasses row security and no route writes
   `practitioner` through `app_role` — so it is gone and the function is the only
   path.
4. **913's rollback block did not run**, the policies holding a catalogue
   dependency on `app.own_practitioner_id()`. The policy drops are in the block
   now, before the function drops, and the prior body of
   `app.guard_location_notes()` is restated verbatim rather than pointed at.
   Both orders were run against a database with the migration applied.
5. **The coordinate reached the audit trail** — item 3 below.
6. **"Open in Google Maps" is not offered on a base.** `CoordinateFields` gains
   `offerMapLink`, true by default; the base drawer passes false. The vendor row
   in `docs/COMPLIANCE/approved-vendors.md` is written entirely about
   households, and a member of staff's home is a category it does not describe.
   The review offered a sentence in the vendors table or dropping the link; the
   link was dropped, and the table is unchanged.
7. **One comment in 913 overstated what the guard refuses.**
   `app.guard_location_notes()` returns `new` unconditionally for the office, so
   an address on a base row is refused for a practitioner and not for an owner,
   an admin or the lead practitioner. What keeps it off the row from the office
   is the route, and the comment says so.

**And the other half of that door, on the practitioner's own face.** The rail
entry above serves a lead practitioner and anyone already standing in the
console; a practitioner whose only screen is `/today` still had no way across,
`homeFor` sending them there and nothing under `app/therapist/**` linking to
`/admin`. That was left as a question for the operator and then decided: it is
not a new decision about what the phone face carries, it is the original
one-sentence instruction still unmet. **"Your home base"** now sits beside
"Sign out" in the account controls of `app/therapist/today/TodayPage.tsx` and
`app/therapist/TodayLanding.tsx` and goes to `/admin/settings/practitioners`.

It is a second control, not a widening of "Admin console": that button means the
console is your workplace and goes on meaning it, while this one means "set
where your day starts". It is shown to whoever `canOpenPractitioners` admits and
who does **not** already have the console button, so nobody is offered two doors
to one place — an owner, an admin and a lead practitioner see the console button
alone and reach the screen through the rail. Six cases cover it; three fail with
the control removed and three fail if the gate is widened to drop that second
condition.

Sending a practitioner into the console is reasonable on two counts, and both
are why this is acceptable rather than a jolt: the console lays out at phone
widths (`docs/SPEC/responsive-console.md`, piece nineteen), so a practitioner
tapping it on a phone gets a usable screen and not a desk one; and a home base
is one field a person sets once, not a flow they live in.

### 1. `CoordinateFields` has moved to the shell

**Who.** `client-record`.

**What.** `app/admin/clients/CoordinateFields.tsx`, its test and
`app/admin/clients/geolocation.ts` are now
`app/shell/components/CoordinateFields.tsx`, `CoordinateFields.test.tsx` and
`geolocation.ts`. `LocationForm.tsx` and `VerifyPinForm.tsx` import it from
there; nothing else about either file changed, and the component and its test
moved unaltered.

**Why.** Two modules need it now — the client record's verify-pin form and a
practitioner setting their own home base — which is `docs/SPEC/OWNERSHIP.md`'s
own rule for a thing two modules share. Forking it was the alternative, and a
coordinate box is not a thing to have two opinions about.

**What is left for that stream, and it is optional.** The component's styles
were added to `app/shell/shell.css`, scoped to `.coordinate-fields`, so
`app/admin/clients/clients.css` was not touched: its `.field-row` is still
used by `ContactForm.tsx` and `FormAtoms.tsx` and must stay, and its
`.coordinate-fields` and `.coordinate-fields__actions` rules are now dead.
They are identical to the shell's, so nothing renders differently either way;
delete them whenever that stream is next in the file. Same reasoning as
`app/shell/components/useDrawer.ts`, which left billing's copy where it was.

### 2. A practitioner's base is no longer readable by every practitioner

**Who.** `client-record`, for its own record rather than for an action.

**What.** `db/policies/client/readers.sql` says of `location` that "a tenant-
or practitioner-owned location (the studio, a home base) is operational, not
client-sensitive", and gives every non-client location to all four staff
roles. That is true of the studio and false of a home base: it is the
coordinate of a colleague's front door. `practitioner_base_is_private` in
`db/policies/core/practitioner_base.sql` narrows **only** `owner_type =
'practitioner'` rows — the office reads all, a practitioner reads their own —
and answers `true` for every other owner type, so `client_record_readers`
still decides the studio's and every household's exactly as it did. Nothing
in that file needs to change; the comment there is now half true and the
narrowing lives beside it rather than in it.


### 3. The audit trail keeps no coordinate for a `location`

**Who.** The trunk's own decision, recorded here because it changes what the
trail holds for every stream that writes a `location`, the client record's
above all.

**What.** `app.audit_redact` (the list lives in the trunk's migration range,
`docs/SPEC/audit.md` section 8) now drops `entrance_point`, `parking_point` and
`community_gate` as well, in `db/migrations/914_audit_redact_location_points.sql`.

**Why, and why it is this round's.** This round is the first thing in the
platform that sends a member of staff's home coordinate down that path from the
application, and the round's own header claimed the practice holds the
coordinate "in four places rather than remembered in one" while a fifth quietly
kept it — `audit_log`, which is append-only, kept for five years, and has no
erasure path for staff at all, erasure being `app.erase_client()`'s. Every move
of a base would have recorded the previous home in `old_values` beside the new
one in `new_values`: a history of every address a practitioner has ever had.

The narrowing is not confined to a practitioner's base, because the same was
already true of a household's: the erasure act clears `parking_point` and
`community_gate` and moves `entrance_point` to its emirate's centre, and the
trail was keeping the real one from before it — exactly the retention those
statements exist to end, and exactly what section 8 already said of
`checked_in_point`. What the trail still records is that a location changed, by
whom, when, with what reason, and which column moved: `changed_fields` is
computed from the raw rows before the redaction runs. The row itself holds
where, under the rules that decide who may read it.

No existing test asserted a coordinate in the trail; three assert its absence
(`tests/session/db/run.test.ts`, `tests/session/db/photo_and_routing.test.ts`),
and those still pass.

`docs/SPEC/00-data-model.md` is deliberately **not** edited: no table, column
or enum changes. Section 2 already describes `practitioner.home_base_location_id`
as "where their day starts" and `location`'s `'base'` label as "a practitioner's
home base"; migration 913 adds two functions and one trigger arm, and that
document lists neither.


### Round 36, owed onward: the three location columns the trail still keeps

Migration 914 stops `app.audit_redact` recording `location`'s three coordinate
columns, on the argument that the erasure act clears them from the row and the
immutable trail must not outlive an erasure (`docs/SPEC/audit.md` section 8).

The re-check of pull request 126 found that argument incomplete. The same
erasure statement clears `makani_number`, `display_address` and `access_notes`
(migrations 100, 102, 105, 107), the trail keeps all three from before it, and
a Makani number resolves a door to a few metres — so a household's address
survives an erasure in the log in every way but the geometry.

**Not taken in round 36, deliberately.** These are the client record's own
columns; dropping them changes what the trail says about households rather
than about a member of staff, and the round that found it was closing a
practitioner's base. It wants its own round, its own review and a word from
the operator on whether an address written into the trail before an erasure is
something the practice means to keep.

**What a later round would do:** add the three keys to `app.audit_redact`'s
drop list in a trunk migration of the `900–949` half, confirm `changed_fields`
still names each column, and amend `docs/SPEC/audit.md` and 914's own header,
both of which now carry a paragraph saying this is outstanding.

---

## Round 37 — the approved wording (2026-09-09)

The practice's legal advisor returned four recommendations: remove every
reference to photographs, tell general and sensitive data apart, take a
specific consent for neurofeedback and QEEG data, and say how the data will
not be used. The wording in `docs/CONSENT` becomes version 1.0 approved in
both languages, `health_data` becomes a consent purpose that gates both
activation and check-in, and the setup photograph is retired.

**Why one branch answered all four.** The photograph is the reason. The
consent is what authorised the camera at runtime
(`app.session_consent_active($1, 'photo_video')` at the door, and the
`photo_captured` event refused without it), so deleting the wording without
the capability would have left a live way to store photographs of clients
with nothing signed to permit it — the worst of the two states, and one that
would have existed for as long as the two halves were apart. As rounds 31–36
did, and by the integrator's widening for one round, the wording and the
capability move together.

**Every file this round touched outside the trunk's own paths**, grouped by
stream:

- `session-capture` — deleted: `app/api/sessions/photo.ts`, `photo-link.ts`,
  `photo-availability.ts`, `app/therapist/session/photo.ts` and
  `tests/session/db/setup_photo.test.ts`; renamed:
  `tests/session/db/photo_and_routing.test.ts` to `routing.test.ts`, having
  lost the half about a capability that no longer exists; edited:
  `app/api/sessions/checkin.ts`, `close.ts`, `events.ts`, `open.ts`,
  `schema.ts`, `session-row.ts`, `app/therapist/session/CheckInPage.tsx`,
  `PostStep.tsx`, `PreflightStep.tsx`, `SessionRunner.tsx`, `steps.ts`,
  `domain/session/types.ts`, `canCheckIn.ts` with its test,
  `tests/session/SessionRunner.test.tsx`, `tests/session/db/checkin.test.ts`
  and `run.test.ts`; and the stream's own spec `docs/SPEC/practitioner-phone.md`,
  whose section 4 is marked retired rather than deleted, because it is the
  record of what was built.
- `client-record` — `app/admin/clients/ConsentTab.tsx`,
  `RecordConsentForm.tsx`, `activation.ts`, `EnrolmentWizard.test.tsx`,
  `RecordTabs.test.tsx`, `ClientDrawer.test.tsx`, `ConsentText.test.tsx`,
  and `tests/client/db/consent_documents.test.ts`.
- `reports` — `domain/reports/document/strings.ts` and
  `tests/reports/document.test.ts`, `tests/reports/db/reports.test.ts`: the
  draft line off, and both standing sentences re-pointed at the approved
  agreement they are quoted from.
- `client-portal` — `app/client/i18n/dictionary.ts` and
  `tests/portal/fixtures.ts`.
- `assessment` — `tests/assessment/request-timeout.test.ts` alone, which
  asserted the photograph's body limit.

**The trunk's own half** is `db/migrations/915_health_data_consent.sql`,
`960_retire_the_setup_photograph.sql` and
`961_checkin_reads_health_data.sql`; `domain/client/**`;
`domain/shared/audit-narrative.ts`; `db/seed/**`; `docs/CONSENT/**`;
`docs/COMPLIANCE/approved-vendors.md`; `docs/SPEC/00-data-model.md`;
`docs/STAGING.md`; `docs/PRODUCTION.md`; and `.claude/rules/data-model.md`.

**Two migrations reach into a stream's objects, and both sit in the `950–999`
half for it**, as `954_drop_invoice_document_id.sql` set the precedent: 960
drops the four setup-photo functions and the filing marker created by 306 and
replaces the closed-visit guard created by 302; 961 replaces
`app.checkin_context` from 301 so the door can see a withdrawn health-data
consent. 915 is in the `900–949` half because `consent` is a core table.

**Nothing in those paths is the trunk's beyond this round.**

## Round 38 — the enquiries (2026-09-10)

The website's two forms — the enquiry and the discovery call — posted to
`lodge_enquiry`, an edge function in the Flutter project that is being
retired. This round gives them a home in the app
(`docs/superpowers/specs/2026-09-09-enquiries-design.md`): a quarantine table
`enquiry` (migration 916), a public door `POST /api/enquiries` mounted ahead
of the fence, three routes for the office, and a screen at `/admin/enquiries`
for the owner, an admin and the lead practitioner. The operator's decisions of
9 September, taken whole: an enquiry becomes a lead; those three roles see it;
it is kept in the system until it is actioned.

**What an enquiry is, and is not.** It is not a client record. It is what a
stranger typed into a form, held until somebody in the office decides. So it
is the one table in the schema that the audit trigger does not watch — the
operator's Option B, recorded in `.claude/rules/data-model.md`: a public write
has no actor to name, the route logs every read under the person reading
(`logReads`, entity `enquiry`) and writes an audit row for each conversion and
dismissal under the person acting (`logAction`), and the client a conversion
creates is audited from its first byte, because it is created by `createLead`
— the same path `POST /api/clients` takes. Once actioned, the row keeps
nothing personal: `enquiry_actioned_is_scrubbed` refuses a converted or
dismissed row that still carries a name, a number, an address, a message, the
tick or the address hash, and what stays is the record of what happened, when,
by whom, and for a conversion which client it became. The dismissal's reason
is the one free text that survives, so the route refuses a reason that carries
a number or an address (`refuseContactDetails`, the audit trail's own guard).
Every personal column states its need as a comment on the column.

**The door, ahead of the fence.** Form or JSON, the sender need not care. The
honeypot answers `200 {ok:true}` and keeps nothing. A missing name or number
is a 400; a refusing database a 503. CORS admits the apex and `www` by default
and `ENQUIRY_ORIGINS` overrides them. Two throttles, neither of which keeps an
address: the middleware's limiter admits ten posts a minute per address
(`enquiryDoorPerMinute`, `RATE_LIMIT_ENQUIRY_DOOR_PER_MINUTE`) and is wrapped
so it counts `POST` alone — a preflight is never refused; and
`app.lodge_enquiry` refuses the sixth lodge in ten minutes from the same
`ip_hash`, a SHA-256 of the address under a fixed prefix, with a random bucket
when no address is known so that nothing shares a null key. The definer
inserts only when the database holds exactly one tenant, which is what a
public door with no tenant in the request can honestly do.

**Nothing notifies anyone yet.** The screen is the inbox; it sorts new first
and offers, on a new row only, *Convert to lead* and *Dismiss* with a reason.
A converted row links to the client it became.

**Every file this round touched outside the trunk's own paths:**

- `client-record` — `app/api/clients/create-lead.ts` (new) and
  `app/api/clients/record.ts`. The lead-creation half of `record.ts` — next
  MRN, the `client` row as a lead, the primary contact, the Emirates ID sealed
  and hashed — is lifted out as `createLead(db, tenantId, input)` so that the
  enquiry route makes a lead by the one path rather than a second one.
  `record.ts` calls it and behaves as before; its tests are untouched and
  green. The stream owns `create-lead.ts` from here.
- `app/api/create-api.ts` — the composition root: the door and the routes
  mounted, the raw-upload exemption widened to the door so the JSON-only
  fence does not refuse a form post, and the POST-only limiter.

**The trunk's own half** is `domain/enquiry/**` (new: `parseEnquiry`,
`toE164`, `leadFromEnquiry`, pure and tested); `domain/shared/actor.ts` with
its test (`enquiry.list`, `enquiry.action`);
`db/migrations/916_enquiry.sql`, in the `900–949` half because it creates a
table of the trunk's own and builds on no stream's; `db/policies/enquiry/**`
(new, the trunk's); `app/api/enquiries/**` (new);
`app/api/_middleware/rate-limit.ts`; `app/shell/adminAccess.ts`,
`AdminLayout.tsx`, `App.tsx`, `components/Rail.tsx` and `components/Icons.tsx`;
`app/admin/enquiries/**` (new); `tests/db/enquiries.test.ts`,
`enquiries-door.test.ts` and `enquiries-routes.test.ts`;
`.claude/rules/data-model.md`; `docs/SPEC/00-data-model.md`;
`docs/SPEC/OWNERSHIP.md`, which names the four new folders; and
`docs/superpowers/**`.

**Reviewed** on 10 September by the three briefs, security (PASS), compliance
and schema (both FAIL, both closed before merge). What they changed: the
Supabase default-privilege revoke every table since 070 carries; `actioned_by`
and `client_id` as composite keys on `(tenant_id, …)`; the throttle's index
predicate made one the planner can use, an advisory lock per address so a
burst cannot all pass the count, and the definer bounded on its input's size;
`for update` on the row a conversion reads; ids that are not uuids answered as
not found rather than as a database error; a strict request id at the door and
a JSON body accepted only when it is an object; the number and the address
shaped at the door to what a client record can hold, so a conversion cannot
fail on the contact table's own check; audit rows for the conversion (with its
one read logged) and the dismissal; the reason guarded against a number or an
address; the tick scrubbed with the rest; every personal column's need stated
as a comment, the four the screen did not show now shown; the `Needs` header
corrected; indexes on both foreign keys; the cross-status constraints and the
reason's length; `search_path` pinned to `pg_catalog, pg_temp`; a restrictive
insert policy saying in the policy's own terms what the absent grant says; and
four fixtures off the reserved ranges — written through the shell, which the
repository's identifier hook does not see, so the diff was swept by hand with
the hook's own patterns. Accepted as they stand: the address hash is unkeyed
(pseudonymous, ten minutes' purpose, nulled on action), and the message is not
carried to the lead — the client record has no notes field, the office reads
it before pressing, and keeping it is a later round's question.

**Open, for the operator — the enquiry nobody actions.** "Kept until
actioned" answers the one that becomes a lead or is set aside. It does not
answer the duplicate, the mistake, or the person who changed their mind: under
that rule such a row holds a name and a number for as long as nobody presses a
button, which sits awkwardly beside rule 8's minimisation and what the privacy
notice says. Not built here, because nothing in this system deletes on a timer
without the operator saying so; the two shapes are a stated period after which
the screen shows the office what is older than it, to dismiss by hand, or a
rule that dismisses them with a fixed reason (which scrubs). Either is a
calm migration later. Raised by the peer session on 10 September.

**What follows the merge**, in order: the website's pages point their
`ENDPOINT` at the new door; migration 916 is applied to production with its
ledger row; the app is rebuilt; one enquiry is lodged against the live door,
seen in the screen, converted, and the lead erased; and only then is the old
project safe to pause — the operator's call.

**Nothing in those paths is the trunk's beyond this round.**

## Round 39 — the completeness audit's fixes (2026-09-10)

The operator asked for an audit of everything planned, built or deferred,
then said "fix those" of its first ten items. This round is the code half;
the live acts are recorded in `docs/PRODUCTION.md` under the same date.

**What the round builds.** Settings › Team (`app/api/team/**`,
`app/admin/settings/TeamPage.tsx`): the owner and an admin add a colleague
with a temporary password shown once — the operator's decision of 10
September, over an emailed invitation, because the app has no password-reset
screen yet — grant the four working roles and suspend or reactivate a sign-in.
Ownership is offered to nobody; `db/policies/core/role_guard.sql` already
said so beneath, and `staff.manage` (domain/shared/actor.ts) says it above.
The three contact details printed in every document's footer are on
Settings › Practice (closing `billing-09.md` item 6). The two jobs run from
inside the process (`app/api/scheduler.ts`, migration 917's one definer for
the practice ids) rather than from a cron entry the host never had, with the
owner's connection string nowhere. And `.github/workflows/uptime.yml` probes
both health routes every five minutes and opens an issue when they fail.

**What the audit also found and the round records.** The website posts every
enquiry to Web3Forms as well as to the app, and had done since before the
app existed; the operator chose to keep it and it is on the register. The
website's own admin talks to a database project that no longer exists. The
content security policy was already inside every document since 8
September; the note that said otherwise was stale. The two founder secrets in
the host's environment were the go-live script's, and are gone.

**Every file this round touched is the trunk's**: `domain/shared/staff.ts`
with its test, `actor.ts` with its test and the barrel; `app/api/team/**`,
`app/api/scheduler.ts` with its test, `app/api/server.ts`,
`app/api/create-api.ts`; `app/shell/adminAccess.ts`, `App.tsx`;
`app/admin/settings/**`; `db/migrations/917_scheduled_tenants.sql` in the
`900–949` half (it reads a core table) and `962_erasure_guard_admits_the_sweep.sql`
in the `950–999` half (it replaces a function the client-record stream
created); `tests/db/team.test.ts`,
`tests/db/scheduler.test.ts`; `.github/workflows/uptime.yml`; `.env.example`;
`docs/COMPLIANCE/approved-vendors.md`, `docs/SPEC/hosting.md`,
`docs/SPEC/OWNERSHIP.md`, `docs/PRODUCTION.md`. No stream's path was edited.

**Reviewed** by the three briefs. Schema (PASS) had 917's header name only
what it depends on, both `user_role` inserts set `created_by`, and the test
prove an admin cannot suspend the owner through the route. Security (PASS)
closed six: nobody widens their own roles (`canGrantTo`), `archived` is the
end of a sign-in at the API and not only on the screen, each scheduled job
carries the least role that opens what it touches (finance for the books,
admin for the sweep) rather than the owner's, the scheduler starts only in
production unless asked, the uptime workflow reads its outputs through the
environment, and a lost temporary password is replaced by
`POST /api/team/:id/password`, logged as an act and never as a value.
Compliance (FAIL, closed) found the one real defect: under the API role the
erasure sweep's own bookkeeping was refused by the guard from migration 105,
which admits nothing after the act but the letter — the CLI job had run on
the owner's connection, where the guard steps aside. Migration 962 teaches the
guard the sweep's three columns, each of which moves one way, and the
scheduler's test now performs an erasure with a pending key and watches it
cleared. It also put the backups project on the vendor register, completed
the Web3Forms row, moved one telephone fixture onto the reserved range, and
had the scheduler log an error's name and code and never its message.

**Open, for the operator:** the kit register and the Google keys' restriction
and caps, neither of which code can do; the "change my password" screen that
the temporary-password choice owes; and whether the website keeps its dead
admin.

## Round 40 — change your password (2026-09-10)

Round 39's Settings › Team hands a colleague a temporary password shown once,
and owed them a way to replace it. This is it: `/account/password`, for
whoever is signed in — a member of staff from the console's rail or the
phone's Today screen, and a household from the same address, since the
session itself is the proof of who is asking. It asks for the new password
twice and nothing else. The rule for what a password may be is the
practice's own (`domain/shared/password.ts`: twelve characters, four kinds,
no space at either end; Supabase Auth keeps a lower floor beneath it), and
the change goes through the sign-in provider's one new method,
`updatePassword`, which the development door does not have — the page says
so rather than pretending.

**What the two reviews changed.** Security found the page took only the new
password, so a session on an unattended device — and sessions are kept on
the device by default — could set a new one and lock the real person out of
every device at once; and that the practice's twelve-character rule lived
only in the browser while both projects' own floor was six with
leaked-password protection off. So: the page now asks for the current
password too and the projects require it
(`security_update_password_require_current_password`), both projects hold the
floor of twelve and refuse a leaked password, the account holder is emailed
when their password changes, production's `site_url` is its real address
rather than `localhost`, and the portal's own floor is now imported from the
one rule rather than declared twice (`docs/SECURITY.md`, "Switched on").
The provider reads only an error's code and holds one sentence for each —
leaked or short, the same as before, the current one wrong, the session gone
(which signs the person out) — never Supabase's message. A hidden username
field lets a password manager file the change against the right account.
Compliance found the round note implying Supabase keeps a durable record of
a self-service change; it does not (its log lasts days), so the page now
records the act through `POST /api/me/password-changed` — one row in the
practice's trail under the person's own id, no values — where round 39's
office reset already sat. A trigger on Supabase's `auth.users` was weighed
and declined: a vendor's table, a failure in which would block every change.
Two smaller notes: a household contact who types the address reaches this
page in English, since it sits in the console's shell rather than the
portal's, and the portal offers no link to it yet; and
`app/shell/App.test.tsx` carries three names from before the seed list
existed, for a later tidy.

**Every file is the trunk's**: `domain/shared/password.ts` with its test and
the barrel; `app/shell/auth/types.ts`, `supabase-auth.ts`;
`app/shell/pages/PasswordPage.tsx` with its test; `app/shell/App.tsx`,
`components/Icons.tsx`, `components/Rail.tsx`; `app/therapist/today/TodayPage.tsx`
(one button beside Sign out); `app/admin/settings/TeamPage.tsx` (one clause
in the note that shows the temporary password). No migration, no policy, no
API route: the password lives with the sign-in provider and never touches
the practice's own tables.

## Round 41 — the loose ends (2026-09-10)

The completeness audit of 10 September (session mcwellness-93) listed twelve
decisions only the operator or the founder can take, nine roadmap areas each
needing its own plan, and nine small loose ends. The operator chose the loose
ends first, then the decisions as a sheet, then piece twelve's plan; and took
two design choices on the way — the rail's Sessions entry is removed rather
than given a page, and a household changes their password on a bilingual
portal screen rather than through a link to the console's English one. This
round is the loose ends that were code or record; the operator-only ones are
on the sheet.

**What the round builds.** The rail lists only sections it can open:
`Sessions` had no page since the first build of the shell, and with it gone
`RailSection.to` is required, the "Arriving" branch and its style and icon are
deleted. The website's enquiry door answers with
`Cross-Origin-Resource-Policy: cross-origin` on its preflight and its post,
so the browser completes the site's beacon reply quietly instead of discarding
it and logging it as blocked (nothing new becomes readable: a fetch in CORS
mode is governed by the CORS answer, and a beacon's reply is never exposed to
the page); the exception lives in `securityHeaders` as an option the API
factory sets for that one path, because `hono/secure-headers` writes after the
handler and would overwrite a header the door set itself, and a GET on the
path is the fence's refusal and stays `same-origin`. The form that changes a
password moves out of `PasswordPage` into one `PasswordForm` that takes its
words from the page; the console keeps its English page at `/account/password`
and the household gets `/portal/password`, every word from the dictionary, the
rule's four sentences by key (`passwordProblemKey` beside `passwordProblem`)
and the provider's refusals by reason, with a link in the sidebar's foot
beside the person's name and the way out (`docs/SPEC/client-portal.md`
section 3.9). Four fixture names from before the seed lists existed are now
pairs from `db/seed/names.ts`.

**What the round records.** The retention rule is stated once: three
documents and two rules still described a five-year deletion job, and
CLAUDE.md rule 8 governs (a minimum of five years, nothing deletes on a timer,
erasure on request). Pull request 116, three days behind `main`, is carried
rather than rebased: its fourth-live-pass record is in `docs/PRODUCTION.md`,
followed by live passes five to eleven written in UTC from the sessions' notes
(the restart-after-build lesson, the two-sessions hold, `SCHEDULER=off` on a
second instance, the IPv6 edge), `billing-07.md` item 2 is marked applied, and
116 closes with this round's merge. `docs/HANDOVER.md` opens with the state as of 10 September and
sections 2, 8 and 10 each say what moved. The twelve decisions are
`docs/OPERATOR/2026-09-10-decisions.md`, each with what it blocks, the default
in force, a recommendation and the line to reply with, then the four acts only
the operator can do and a draft to Hostinger.

**What the gates found, and the round fixed.** `tests/billing/db/call_out_fee.test.ts`
booked every visit on the literal day 2026-09-10, and migration 408 writes a
null supply day when the visit is the day of issue, so its supply-day case
failed everywhere — CI included — for the whole of 10 September in Dubai. The
suite passed at 03:56 on the operator's clock and failed from 04:27, when
Dubai's date rolled over; nothing merged that night touched it. The visit day
is now read from the database's clock as tomorrow in Dubai, which is never
today. Recorded here because it is the billing stream's file and a lesson for
every suite that pins a calendar day against a trigger reading `now()`.

**Every file this round touched.** The trunk's own: `domain/shared/password.ts`
with its test and the barrel; `app/shell/components/PasswordForm.tsx` (new),
`Rail.tsx` with its test, `Icons.tsx`, `app/shell/shell.css`,
`app/shell/pages/PasswordPage.tsx`, `app/shell/App.tsx` and `App.test.tsx`;
`app/api/_middleware/security.ts`, `app/api/create-api.ts`,
`app/api/enquiries/door.ts`, `tests/security/headers.test.ts`;
`app/admin/settings/PracticePage.test.tsx` (one fixture line);
`app/shell/AdminLayout.tsx` (one comment, the fix round);
`.claude/rules/compliance.md`, `.claude/skills/uae-compliance/SKILL.md`;
`docs/SPEC/audit.md`, `client-record.md`, `client-portal.md`, `OWNERSHIP.md`,
`docs/SEAMS.md`, `docs/SECURITY.md`, `docs/PRODUCTION.md`, `docs/HANDOVER.md`,
`docs/CHANGE-REQUESTS/billing-07.md`, this file,
`docs/OPERATOR/2026-09-10-decisions.md` (new), and — the fix round's retention
sweep — `PRODUCT.md`, `docs/CONSENT/README.md` and
`docs/ADR/0003-wellness-business-supabase-cloud.md`. Outside the trunk's paths, by
the integrator's widening for one round (`docs/SPEC/OWNERSHIP.md`):
`client-portal` — `app/client/PasswordScreen.tsx` (new), `PortalRoot.tsx`,
`portal.css`, `i18n/dictionary.ts`, and `tests/portal/harness.tsx`,
`shell.test.tsx`, `PasswordScreen.test.tsx` (new); `billing` —
`tests/billing/db/call_out_fee.test.ts`. **No migration, no policy file, no
API route, no schema change.**

**Gates on the branch head, in the round's own worktree** (`mcwellness-loose-ends`,
database on 5451): format, lint, typecheck, the secrets scan (1,477 files)
and the migration audit clean; 2,421 unit tests passed and 1 skipped across
210 files; 1,307 database tests passed across 94 files.

## Round 42 — three of the operator's answers (2026-09-10)

The operator answered the twelve decisions of `docs/OPERATOR/2026-09-10-decisions.md`
at 05:47 on their clock (21:47 UTC on 9 September). Three answers are small
enough to build in one trunk round without a plan of their own; the design
was put to the operator in one message and approved as written.

**What the round builds.** *Decision 5, confirmed visits only:* the check-in
gate (`domain/session/canCheckIn.ts`) gains `visit_not_confirmed`, refused when
the visit the practitioner is standing in front of is `proposed` — the
household was never told — and admitted when it is `confirmed` or already
open. The route (`app/api/sessions/checkin.ts`) resolves the visit before the
gate now rather than after it and hands the gate its status; no migration,
since the route already read the row. The phone says "This visit was not
confirmed with the household. Call the office." The check-in fixtures book
confirmed visits by default, the record-number case (which until now booked
a proposed visit and proved the check-in went ahead regardless) books a
confirmed one and expects it marked checked in, and a new case books a
proposed visit for a practitioner of its own and proves a 422 with nothing
written but the refusal's audit row. *Decision 3, thirty days:*
`domain/enquiry/waiting.ts` names the days an enquiry still `new` has waited
once thirty have passed; the Enquiries screen shows "Waiting 40 days" as an
attention chip beside the same Dismiss, and nothing dismisses itself.
*Decision 10, coming soon:* the record drawer lists "Questionnaire (coming
soon)" disabled, and the Assessments tab says the figures are typed from the
software until the equipment's export can be read; the mechanism and its
synthetic sample stay, and the case that proved them now says it proves what
sits behind the disabled choice.

**What the round records.** `docs/SPEC/session-capture.md` section 3.1 (the
eighth refusal), `docs/SPEC/assessment.md` section 10 decision 2 (the
amendment), and the enquiries design's "Not in this round" (the thirty-day
rule beside the "until actioned" decision it refines).

**Every file this round touched.** The trunk's own: `domain/enquiry/waiting.ts`
(new) with its test and the barrel; `app/admin/enquiries/EnquiriesPage.tsx`
with its test; `docs/SPEC/session-capture.md`, `docs/SPEC/assessment.md`,
`docs/superpowers/specs/2026-09-09-enquiries-design.md`, `docs/SPEC/OWNERSHIP.md`,
`docs/HANDOVER.md`, this file. Outside the trunk's paths, by the integrator's
widening for one round (`docs/SPEC/OWNERSHIP.md`): `session-capture` —
`domain/session/canCheckIn.ts` with its test, `app/api/sessions/checkin.ts`
and `schema.ts`, `app/therapist/session/CheckInPage.tsx`, and
`tests/session/CheckInPage.test.tsx` and `tests/session/db/checkin.test.ts`;
`assessment` — `app/admin/assessments/copy.ts`, `RecordDrawer.tsx`,
`AssessmentsTab.tsx` and `AssessmentsTab.test.tsx`. **No migration, no policy
file, no API route, no schema change, no data change.**

**Gates on the branch head, in the round's worktree** (`mcwellness-loose-ends`,
database on 5451): format, lint, typecheck, the secrets scan and the
migration audit clean; 2,428 unit tests passed across 211 files; 1,308
database tests passed across 94 files.

## Round 43 — the walk's fixes, part one (2026-09-10)

The console was driven in a browser as the practice owner through ten
everyday jobs, on the synthetic practice against main `58f08b6`
(`docs/superpowers/specs/2026-09-10-walk-fixes-design.md`). The day-to-day
jobs were easy; the client record and the schedule were not. This is the
first of four pull requests on branch `trunk-round-43`: everything the walk
found that needed no decision from the operator. The remaining three — a
map for the home pin, selling a single session up front, and one signature
covering every consent — wait on the operator's three decisions of the same
afternoon and are not in this round.

**What the round builds.** A self contact is shown under the client's own
name rather than "Unnamed contact — self": `contactDisplayName` falls back
to `clientHeadingName` when the contact has no name of its own, and
`clientHeadingName` also collapses the erasure placeholder so an erased
client reads "Erased client" once, not twice. Example values moved out of
`ContactForm.tsx`, `EnrolmentWizard.tsx` and `LocationForm.tsx`'s
placeholders and into their hints, where a person can still read them once
typing has started; `Field`, `PasswordField` and `Select`
(`app/shell/components/Controls.tsx`) now give their error text
`role="alert"`, so a screen reader announces it — and so does every other
screen that already builds a field from one of these three, the payment
drawer's reference-number refusal included, without a line of that screen
being touched this round. "Verify pin" is "Check the pin", saving one says
"Pin saved.", the activation checklist says "A location with its pin set",
and the pin panel's own line now reads "Move it to the door the
practitioner should knock on." The location table holds one entrance point
and no separate verified flag, so the screen stopped implying a second
step.

A client's given and family name, date of birth, sex at birth and referral
source can now be edited after the first wizard step
(`app/admin/clients/IdentityForm.tsx`), from an Edit button on the Overview
tab and from the wizard's Identity tab, which becomes a revisit once the
lead exists rather than a one-time, submit-only step. `PATCH
/api/clients/:id` had accepted every one of those fields since piece four;
no screen had ever offered them, so a lead enrolled with the wrong date of
birth had no way to be corrected short of erasing and re-enrolling. The
form carries no Arabic-name fields: the console is English only, the
operator's decision of 7 September (`tests/lint/console-is-english.test.ts`
enforces it), a rule this round's own design spec first missed and the
build corrected. The Overview's "Preferred language" row was briefly removed
in error, on the stated but false grounds that the client table had no such
column — it does (`db/migrations/060_client.sql`), and it decides the
language of a household's consent wording and erasure letter. It is
restored, read-only: no screen can change the setting yet.

`client.primary_location_id` is now written going forward, not only by the
seed. Creating or patching a location with `isPrimary` demotes every other
location of that client first and only then promotes this one — in that
order, never the reverse, and never as one statement spanning both rows,
because the new unique index below checks each row the moment it is
written, not once at the end of the statement
(`app/api/clients/locations.ts`, `makePrimary`). Unflagging the client's
current primary clears the link in the same request, so the flag and the
link can never disagree. Migration `963_backfill_primary_location.sql`
fills in the past, in order: a client with a flagged primary keeps it (the
newest one, by creation, where more than one had ever ended up flagged); a
client with exactly one location and no flag gets that one; a client with
several unflagged locations and no clear owner is left null, as today,
until the office marks one. The migration then makes every location's flag
agree with the link — including a client already linked before this file
ran, whose flag had drifted — and only once that agreement holds everywhere
does it add `location_one_primary_per_owner`, a plain, non-deferrable
unique index that from here on refuses a second flagged location for the
same owner. Until this round, every client the app enrolled — as opposed to
the seed — showed no emirate in the list, because only the seed had ever
written the link the list reads.

The booking panel now carries its own date, starting on the day the
schedule was showing when the panel opened. Changing the date clears the
chosen practitioner and asks the server again, because who is credentialed
and free can differ by day. An emptied date disables the button and says
"Choose a date." rather than letting a blank slip through to the request. A
rescheduled row on the schedule now says where the visit went:
`AppointmentRow.movedTo`, found by a join that follows a row's
`rescheduled_from_id` to whichever appointment replaced it, renders as
"Moved to Fri 11 Sept 10:00", a link to that day
(`app/api/appointments/list.ts`, `SchedulePage.tsx`). It shows only on the
practice-wide day view; a practitioner's own day never lists a superseded
row at all.

The timeline no longer says "recorded list on the appointment" nine times
for one booking. Looking at an appointment now narrates as "saw the
appointment in the schedule", and a reason is attached only when the
narration is of a change, never a read: `app.reason` is stamped on every
audit row a request writes, so a read made while, say, a move drawer opened
was carrying the move's own reason and implying the read explained itself.
Consecutive reads with the same sentence, by the same person, inside the
same minute, now fold into one entry carrying a count, printed as "(N
times)" — folded by the actor's own id, never by the display name a
fix-round review found two same-named people could share, and a row with no
actor at all never folds into another (`domain/shared/audit-narrative.ts`,
`app/api/audit/timeline.ts`, `TimelineEvent.count`).

The enrolment wizard now tells the list behind it what happened, rather
than making it wait for the drawer to close: `onCreated` fires once the
lead exists, so the table picks it up without a stale row sitting under it;
`onActivated(name)` fires with the client's name right before the drawer
closes on a successful Activate, and `ClientsPage` announces "<name> is now
active." in a status region, cleared as soon as the search box or the
status filter changes to something else.

**What the round records.** `docs/SPEC/client-record.md` line 42 (the
locations screen reads "check the pin", not "verify pin"; the map that
replaces the two number boxes is part two of the walk's fixes).
`docs/SPEC/scheduling-manual.md` section 4.1 (a rescheduled row's link to
where the visit went; the booking panel's own date). `docs/SPEC/audit.md`
section 9 (a read carries no reason; repeated reads by one person inside
one minute show once, with a count).

**Every file this round touched.** The trunk's own:
`app/shell/components/Controls.tsx` with its test;
`domain/shared/audit-narrative.ts` with its test; migration
`963_backfill_primary_location.sql`; `tests/db/helpers.ts` (seven more
fixture location ids), `primary-location-backfill.test.ts` (new) and
`timeline.test.ts` (its new fold-and-count cases);
`tests/security/xss.test.tsx` (one fixture line, the new `count` field);
`docs/superpowers/specs/2026-09-10-walk-fixes-design.md` and the four plans
beside it (`docs/superpowers/plans/2026-09-10-walk-fixes-1-plain.md`
through `-4-sign-all.md`); `docs/SPEC/client-record.md`,
`scheduling-manual.md`, `audit.md` and this file. Outside the trunk's own
paths, by the integrator's widening for one round (`docs/SPEC/OWNERSHIP.md`):
`client-record` — `app/admin/clients/ClientsPage.tsx`, `ContactForm.tsx`,
`EnrolmentWizard.tsx`, `IdentityForm.tsx` (new, with its test),
`LocationForm.tsx`, `LocationsTab.tsx` (with a new test),
`OverviewTab.tsx`, `RecordConsentForm.tsx`, `RecordTabs.test.tsx`,
`VerifyPinForm.tsx`, `activation.ts`, `contactName.tsx` (its new test
`contactName.test.ts`); `app/api/clients/locations.ts`;
`tests/client/db/primary_location.test.ts` (new); `scheduling` —
`app/admin/schedule/NewAppointmentDrawer.tsx`, `SchedulePage.tsx`,
`schedule.css`, `windows.ts`; `app/api/appointments/create.ts`, `list.ts`,
`move-one.ts`, `schema.ts`; `tests/scheduling/DayMapPage.test.tsx`,
`MoveAndCancelDrawers.test.tsx`, `NewAppointmentDrawer.test.tsx`,
`OptimiseDrawer.test.tsx`, `SchedulePage.test.tsx`, `WeekPage.test.tsx` and
`db/move_and_cancel.test.ts`; `audit-ui` —
`app/admin/audit/RecordTimeline.tsx` with its test, `app/api/audit/schema.ts`
and `timeline.ts`. **One migration, one new
index, no policy file**: `location_one_primary_per_owner` is the only
schema change, and it makes a rule the routes already kept the database's
own rule too. The payment drawer earns `role="alert"` the way every caller
of `Field`, `PasswordField` and `Select` does — the shared component
changed; `app/admin/billing/**` did not, and no billing file is touched
this round.

**Gates on the branch head, in this worktree** (`mcwellness-accounting`):
format, lint, typecheck, the secrets scan (1,509 tracked files) and the
migration audit (94 files checked against `origin/main`) clean; 2,520 unit
tests passed and 1 skipped across 217 files; 1,348 database tests passed
across 98 files.

## Round 43 — the walk's fixes, part two: the pin on a map (2026-09-10)

Part one (above) built everything the walk found that needed no decision
from the operator. This is the second of the remaining three pull requests,
and it needed one: since the browser walk of 10 September, a household's
entrance pin has been two text boxes, latitude and longitude, typed by
whoever books the visit. That is what the walk found unusable — a
coordinator does not carry a client's coordinates in their head, and typing
one wrong digit sends a practitioner to the wrong door. The operator's
decision the same day was to put the pin on a map.

**What the round builds.** The Maps loader (`app/shell/maps/googleMaps.ts`,
moved from the day map's own folder) now takes a list of libraries to ask
Google for, so two documents can share one loader without either asking
for more than it draws with. `mapStyle.ts` moved beside it for the same
reason: it is the basemap both the day map and the new picker draw on, and
a thing two modules share lives in the shell (`docs/SPEC/OWNERSHIP.md`).

**The pin picker is its own document, not a panel inside the console.**
Google's Maps JavaScript API needs a content security policy the console's
own strict policy refuses — no third-party script host, ever, anywhere
else — and that widening was built for piece seventeen's day map alone,
confined to that one page on purpose. Opening a panel for the pin inside an
ordinary console screen would have meant admitting Google's script on every
page that screen could appear on, which undoes the confinement rather than
keeping it. So the picker is a second page, `/admin/clients/pin`, admitted
by name in the same two places the day map already was:
`MAP_DOCUMENT_PATHS` (`app/api/_middleware/security.ts`) and
`WIDENED_DOCUMENTS` (`app/shell/sw.ts`, so the offline shell never caches it
as an ordinary page). The console opens it in a new tab. On it, a marker
drags or a tap places it, centred on the point it was handed, or the
client's emirate, or the UAE when neither is known; and Google's own
address search — `PlaceAutocompleteElement` from the Places library,
restricted to the UAE — moves the marker to whatever address is chosen and
shows it underneath.

**How the picker hands the pin back, and how it does not.** The chosen
point travels to the tab that opened it by `postMessage`, addressed to this
app's own origin and read only after the receiving side checks that origin
again — a message from anywhere else is not a pin, silently. The message's
shape, `{ type: 'mcwellness:pin', lat, lng, address }`, lives in its own
module, `app/shell/maps/pinMessage.ts`, imported by both sides: the picker
page pulls in the Places library, and if `CoordinateFields.tsx` — part of
the console's own bundle — imported the shape from the page itself, the
page and the library would ride along into every screen that renders a
coordinate box.

**The point itself never travels in a URL.** A new tab's address reaches
whatever serves it — this app's own access log — and `.claude/rules/ui.md`
line 10 forbids personal data in a URL or query string; a household's
entrance coordinate is exactly that, decision or no decision to make. The
plan called for the point to ride as the picker's own query string
(`?lat=&lng=&emirate=&label=`); the controller ruled against it once this
was noticed, mid-build. Instead, `CoordinateFields.openPicker` writes
`{ lat, lng, emirate, label }` to `sessionStorage` — private to this
browser, never sent to any server — under a fresh, random key, and opens
the picker on `/admin/clients/pin?k=<key>` carrying only that key. The
picker reads the item back by the same key and removes it at once, so it
does not linger once read. A browser blocking site data throws on the
write; the button reports that and does not open a tab it could not hand a
point back through. "Pick on the map" itself appears on every coordinate
box — the client's location form, "check the pin", and a practitioner's own
home base — only when the practice's browser key is set; without one, the
boxes work as they always have and a line says the map needs the practice's
key.

**The vendor register.** `docs/COMPLIANCE/approved-vendors.md`, the Google
Maps Platform row, already said coordinates only, never names or
identities. This round amends it, on the operator's decision of 10
September: from trunk round 43 the picker's search box sends the address
text a coordinator types — as it is typed, restricted to the UAE — to
Google's Places service. That is the one address that leaves the practice,
and it leaves only on the coordinator's own deliberate use of the search
box, never carrying a name, a record number, a location id or a Makani
number alongside it. A pin dragged or tapped into place by hand sends
Google nothing but the map viewport, and the point being picked — typed,
dragged or found by search — never reaches Google or this practice's own
server through a URL. The approval column now also dates the address
search itself: approved by the operator, 10 September 2026, for the pin
picker alone.

**What the round records.** `docs/COMPLIANCE/approved-vendors.md`, the
Google Maps Platform row (the address search, and its own dated approval).
`docs/SEAMS.md` (the picker named beside the day map's paragraph, sharing
its loader). `docs/SPEC/route-planning.md` section 8 (two widened
documents from trunk round 43, not one; `MAP_DOCUMENT_PATHS` lists both).
`docs/SPEC/client-record.md`'s locations line ("check the pin" opens the
picker in a new tab now; the coordinate boxes stay, for a coordinator who
already has the numbers).

**Every file this round touched.** The trunk's own, all under paths this
document's shared zone already names (`app/shell/**`,
`app/api/_middleware/**`, `app/admin/settings/**`):
`app/shell/maps/googleMaps.ts` and `mapStyle.ts` (moved from
`app/admin/schedule/map/`, with their tests moved to `tests/shell/`),
`app/shell/maps/pinMessage.ts` (new),
`app/shell/components/CoordinateFields.tsx` with its test, `app/api/_middleware/security.ts`,
`app/shell/sw.ts` with its test, `app/shell/App.tsx` with its test,
`tests/security/headers.test.ts`, and the
`app/admin/settings/PractitionerBaseDrawer.tsx` line that hands the base
drawer's own `mapPicker` prop through. Outside the trunk's own paths, by
the integrator's widening for one round (`docs/SPEC/OWNERSHIP.md`):
`client-record` — the new `app/admin/clients/pin/` (`PinPickerPage.tsx`
with its test, `emirates.ts`, `pin.css`), and one import line each in
`LocationForm.tsx` and `VerifyPinForm.tsx`; `scheduling` — the day map's
own import lines in `DayMap.tsx`, `DayMapPage.tsx` and `overlays.ts`,
unchanged otherwise. The documents: this file,
`docs/COMPLIANCE/approved-vendors.md`, `docs/SEAMS.md`,
`docs/SPEC/route-planning.md`, `docs/SPEC/client-record.md`. One
correction unrelated to the pin rode on this branch alongside it:
`docs/superpowers/plans/2026-09-10-walk-fixes-3-sell-session.md` and
`docs/superpowers/specs/2026-09-10-walk-fixes-design.md`, part three's own
plan, now read migration 411 rather than 410 — a concurrent piece of work
(package terms) took 410 first and merged to `main` while part three's plan
still named it. **No migration, no policy file, no API route, no schema
change**: nothing this round decided is a database's to enforce, and the
picker reads and writes nothing but `sessionStorage` and a message to its
own opener.

**Outside the repository, for the operator.** Two things this round cannot
do from inside it: enable the Places API on the browser key's Google Cloud
project — and add Places API (New) to that key's API restrictions, since
`app/shell/maps/googleMaps.ts` states the key is restricted to one product
and a key restricted to Maps JavaScript API alone loads the map and the
search box and then has every autocomplete request refused, with the search
box degrading silently and no explanation on screen (the whole-branch review
of trunk round 43, finding 6) — and confirm `VITE_GOOGLE_MAPS_BROWSER_KEY` is
set on the production build. Without either, "Pick on the map" does not
appear and the two boxes work exactly as they did before this round.

**Gates on the branch head, in this worktree** (`mcwellness-accounting`,
database 5443): format, lint, typecheck and the secrets scan (1,514 tracked
files) clean; 2,555 unit tests passed across 218 files; 1,351 database
tests passed across 98 files. The migration audit failed at the time this
note was first written, on one file neither this round nor that task
touched: `db/migrations/410_package_terms.sql`, which a different piece of
work (package terms, decision 9, pull request 151) merged to `main` at 16:22
on the operator's clock, after this stacked branch had already forked from
it. The audit compares a branch's `db/migrations/` directly against
`origin/main`'s, with no way to tell a long-lived stacked branch apart from
one that deleted a merged file, and it was not that task's place to merge
`main` into a branch stacked under an open pull request — so the failure was
recorded here rather than routed around.

**Resolved.** Part one merged `main` in (`824df9b`) and part two merged part
one (`dd77388`); `origin/main` is now a full ancestor of this head, migration
410 is present in `db/migrations/`, and the audit no longer has a file to
disagree about (the whole-branch review of trunk round 43, finding 7 — this
note had gone stale describing a commit no longer being merged). The audit is
green at this head: 95 migration files checked against `origin/main`, none
edited, deleted or renamed after merge.

## Round 43 — the walk's fixes, part four: one signature (2026-09-10)

The walk of 10 September (part one of this round, above) found nine actions
standing between a household and an activated client: three consents, each
with its own scroll to the end of its wording, its own drawn signature and
its own typed name. The operator's decision the same afternoon: one
signature should cover everything a client needs, in one sitting. This is
that decision, built.

**What the round builds.** `SignaturePad.tsx` takes an optional `caption`,
printed as a third, smaller line beneath the signed name and the date in
the filed PNG — the image says on its own face what it was signed for.
`POST /api/clients/:id/consents/bundle` (`app/api/clients/consents.ts`)
writes one consent row per purpose a client needs, each against that
purpose's own current approved wording, all sharing one filed signature, in
one transaction. It runs, per purpose, every check the single-consent route
already runs — the wording is current and in the client's own language, the
giver may give it, the evidence fits the method — before writing a single
row, so a refusal on the last purpose leaves no earlier ones; and it adds
two checks of its own, a purpose the client does not need and the same
purpose named twice in one signing. `domain/client` gains
`requiredConsentsFor`, the same question `requiredConsents` already
answered from a full client record, now answerable from a date of birth
alone — the bundle route and the Consent tab both need it before they have
anything else about the client to hand, and this keeps the two rules from
being able to drift apart.

`SignAllForm.tsx` is the screen: every wording the client needs, stacked
one after another under its own heading, the household reading the whole
stack before the pad unlocks — the same read-to-the-end gate
`RecordConsentForm.tsx` already used on one wording at a time, now judged
against the combined box. One signature is drawn, one bundle is sent, and
`ConsentTab.tsx` offers "Sign everything at once" above the per-consent
list only while something required is still missing; choosing it replaces
the list with the form, and the per-consent form underneath is untouched —
a re-consent, a withdrawal, a paper form and a verbal re-confirmation at
the door all still go through it exactly as before. The caption printed
into the filed image names each purpose in the same words its on-screen
heading uses: `wrapCaption.ts` breaks the combined names onto as many lines
as they need, measured against the real font, and the image grows downward
to hold whatever that produces. A first attempt shortened the labels
instead, to fit `fillText`'s single line — a fix round of 10 September 2026
reversed that, because the evidence's own footer is the practice's record
of what a household agreed to, and cannot say less than what it actually
read and signed against. Building the screen also found a real gap in
`tests/lint/console-is-english.test.ts`
(round 35's own guard, trunk-owned): its allowlist named only
`RecordConsentForm.tsx` as the one staff screen that may show the
household's consent wording in Arabic, and `SignAllForm.tsx` needed to
render the identical text for the identical reason. The allowlist now
names both.

**The compliance reading.** No wording changed, and no wording changed
version, for any of this. The screen shows each purpose's own current
approved text in full; a household reads every word of every consent it is
signing before the pad unlocks, exactly as it did signing one at a time.
What changed is only the evidence: one signature image, filed once, its
foot naming the purposes it covers, and every consent row it stands behind
still records the exact wording document it was read against — the same
fact a single consent has always recorded. A withdrawal stays the
withdrawal of one purpose, on that purpose's own row; it leaves the shared
image referenced by whichever of the other rows still stand, which is
honest rather than a gap, because the image is immutable and was never
about only one purpose, and the withdrawal row itself records which
purpose ended and why.

**What the round records.** `docs/SPEC/client-record.md` section 7 gains
"Signing everything at once": the route, its checks, the one image and its
caption, the refusals, and that a verbal re-confirmation and a withdrawal
both stay per consent. `docs/CONSENT/README.md` gains one paragraph saying
a signature may now cover several of these wordings, that each consent
still names its own, and that no version of any wording moved for it.

**Every file this round touched.** The trunk's own:
`docs/SPEC/client-record.md`, `docs/CONSENT/README.md`, this file. Outside
the trunk's own paths, by the integrator's widening for one round
(`docs/SPEC/OWNERSHIP.md`): `client-record` —
`app/admin/clients/SignaturePad.tsx` with its test,
`app/admin/clients/RecordConsentForm.tsx`,
`app/admin/clients/ConsentTab.tsx`, `app/admin/clients/SignAllForm.tsx`
(new) with its test, `app/admin/clients/consentPurposeLabels.ts` (new),
`app/admin/clients/wrapCaption.ts` (new) with its test,
`app/admin/clients/clients.css`,
`app/api/clients/consents.ts`, `app/api/clients/record-schema.ts`,
`domain/client/index.ts`, `domain/client/requiredConsents.ts` with its
test, and `tests/client/db/consent_bundle.test.ts` (new); plus
`tests/lint/console-is-english.test.ts`, which is the trunk's own guard and
is touched here only to add the one file this round's screen needed on its
allowlist. **No migration, no policy file, no schema change**: the bundle
route is a new endpoint over tables and columns that already existed, and
`consent.signature_document_id` was already nullable and already shared by
a `verbal_witnessed` row with none.

**Gates on the branch head, in this worktree** (`mcwellness-reports`,
database on port 5438): format, lint, typecheck and the secrets scan (1,512
tracked files) clean; 2,537 unit tests passed across 218 files; 1,356
database tests passed across 99 files. The migration audit did not read
clean earlier in this round, for a reason this round did not create: this
branch's base predated `db/migrations/410_package_terms.sql`, merged to
`origin/main` afterwards by the billing stream's own round, so the audit
read it as a file missing locally rather than one this branch never had
cause to carry. Merge `f527f36` brought that file, and the rest of that
round, in. The audit is green at this head — `pnpm audit:migrations`
reports 95 migration files checked against `origin/main`, none edited,
deleted or renamed after the merge — and `db/migrations/` remains untouched
by every commit this round makes of its own.

