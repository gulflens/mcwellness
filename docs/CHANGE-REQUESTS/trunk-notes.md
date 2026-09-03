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
