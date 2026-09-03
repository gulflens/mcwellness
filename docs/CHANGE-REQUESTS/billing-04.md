# billing-04: the constraint a 4xx migration cannot write, and four smaller things

Five requests from the billing stream's third pull request (VAT charged only
while the practice is registered, invoices and receipts as PDFs, sending them,
and the deferred-revenue figures). Every one sits outside
`docs/SPEC/OWNERSHIP.md`'s billing rows, so none is made on the branch.

Nothing in the pull request is blocked by any of them. Request 1 is the one
that matters: the rule it asks for **is already enforced**, by a guard trigger
that does the same job, and what is asked for is the check constraint beside
it — belt and braces on a rule whose failure is a false statement to the
Federal Tax Authority.

| # | Where | What | Blocks |
|---|---|---|---|
| 1 | a trunk `9xx` migration | The `vat_fils = 0` check constraint round 20 asked for | nothing — enforced by a trigger meanwhile |
| 2 | `docs/SPEC/billing.md` | Record the simplified-tax-invoice decision | nothing |
| 3 | `docs/SEAMS.md`, `docs/COMPLIANCE/approved-vendors.md` | The sending seam, and what it does *not* send | nothing |
| 4 | `app/api/_middleware/audit.ts` | A general `logAction`, so billing's copy can go | nothing |
| 5 | `app/admin/settings/**` (trunk) | The practice's logo as a document the owner can replace | nothing — the wordmark stands until then |
| 6 | `app/admin/settings/**` (trunk) | Relabel the corporate-tax number, as the document now does | nothing |
| 7 | `db/migrations/1xx` (client-record) | Erasure keeps a filed invoice: the rule, written down | nothing — pull request 51 already holds them back |
| 8 | this stream, a later round | Two things review found and this round did not fix | nothing; both stated below |

---

## 1. The check constraint, in a migration numbered above 905

**What.** Add to a trunk migration in the 900 range:

```sql
alter table invoice add constraint invoice_no_vat_unless_supplier_registered
  check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0);
```

**Why it is not in `406_billing_vat_registration.sql`, where round 20 asked for
it.** It cannot be. Migrations apply in numeric order (`db/runner/plan.ts`), and
`invoice.supplier_vat_registered` arrives in the trunk's **905**. Billing's range
is 400–499, so `406` runs *before* that column exists on a fresh database, and
the `alter table` fails outright. `checkNeeds` refuses a `-- Needs:` naming a
higher number for exactly this reason, and refused this file's first draft:

```
406_billing_vat_registration.sql names 905 in its "-- Needs:" comment, which is
not earlier than its own number (406). A migration may depend only on earlier
numbers.
```

**The general point, which is worth more than this one constraint.** The core
range was exhausted at 099 and the trunk's own migrations continue at 900
(`docs/SPEC/OWNERSHIP.md`). That range sorts *after* every stream's, so **no
stream can ever build a table-level constraint, a generated column or a foreign
key on anything the trunk adds from 900 onwards.** Function bodies are fine —
plpgsql resolves its columns when it runs, not when it is created, which is what
migration 406 leans on — but anything the parser checks at creation time is
closed to the streams for good. This is the first place it bites; it will not be
the last. Two ways out, neither this stream's to choose:

- **Reserve a range that sorts last** for the trunk's follow-on work — `990–999`
  is already the trunk's, so a rule that says "a trunk migration other streams
  must build on goes in 900–949, and one that builds on a stream's table goes in
  950–999" costs nothing and would have avoided this entirely; or
- **let a stream declare a dependency on the trunk's own range**, since the
  trunk's migrations are on every database by definition — `checkNeeds` would
  need to allow a `9xx` need and the runner would need to plan around it, which
  is a real change and not a small one.

**What holds the rule meanwhile.** Migration 406 adds
`app.guard_invoice_vat()`, a before-insert trigger that raises when
`supplier_vat_registered` is false and `vat_fils` is not zero. It fires after
`app.stamp_invoice_supplier` (trigger order is by name, hence the `zz_` prefix),
so it sees the stamped snapshot rather than the null a caller passed. `invoice`
grants neither update nor delete, so an insert is the only way a row arrives,
and the guarantee is therefore the one round 20 asked for: no invoice carries
VAT for a practice that was not registered when it was numbered.
`tests/billing/db/vat_registration.test.ts` proves it by hand-writing an invoice
with VAT and watching it be refused. The constraint should still be added: a
trigger can be disabled and a constraint cannot, and this is a rule whose
failure is a misstatement on a tax document.

---

## 2. Record the simplified-tax-invoice decision in `docs/SPEC/billing.md`

**What.** Add to section 5, after 5.3:

```markdown
### 5.4 What kind of invoice the practice issues

The practice bills households. A household is a private individual and not a
registered person, so what a registered supplier issues to one is a
**simplified tax invoice**, which need not carry the recipient's name and
address. That is the decision, and two things follow from it:

- **The recipient is deliberately not snapshotted.** `invoice` carries the
  supplier's identity and names the client by foreign key. A renamed or erased
  household therefore changes what an already-issued invoice renders as, and
  that is accepted rather than overlooked: a simplified tax invoice does not
  have to state the recipient at all, and the client's own record and the
  ledger both keep the link.
- **The document says so on its face.** The rendered invoice carries the basis
  in its footer, in both languages, so a reader checking it does not have to
  infer why the recipient block is as short as it is.

Take this to the tax advisor section 5.3 already names, at the same time as the
tax point on prepaid packages, and record the answer here.
```

(The existing 5.4 on e-invoicing becomes 5.5.)

**Why.** Round 20's second note asked for exactly one of two things: a recipient
snapshot, or the decision recorded in this file with a statement that the
recipient is deliberately not snapshotted. This is the second, and the renderer
already prints the basis (`domain/billing/document/strings.ts`,
`SIMPLIFIED_BASIS`). The note is right that it wants somebody's answer in
writing rather than a gap discovered at the first audit; recording it here is
what turns a silence into a decision that can be checked.

---

## 3. The sending seam, and the vendors it does not use

**What.** Two small additions.

To the seam table in `docs/SEAMS.md`:

```markdown
| Documents out | `domain/billing/sending.ts` | an email vendor, once one is approved | the message composed and the link handed back for the share sheet | `DOCUMENT_EMAIL_VENDOR` |
```

And to the WhatsApp row of `docs/COMPLIANCE/approved-vendors.md`:

```markdown
| WhatsApp Business API | Phase 2 | Phone, message text (no session content) | Meta | ❌ not yet — **and not needed for the hand-off**: the platform composes a `wa.me` link and the person presses send in their own WhatsApp, so nothing reaches Meta from this server. Approval is needed only for sending on the practice's behalf, which nothing does. |
```

**Why.** Both are true today and neither is written down. The sending seam
(`domain/billing/sending.ts`, `app/api/billing/sending.ts`) has two
implementations as CLAUDE.md's seam rule requires, and the forced-fallback proof
is `tests/billing/sending.test.ts` — but `docs/SEAMS.md` lists one seam and this
is the second. The WhatsApp row reads as a flat "not yet", which invites the
next person to conclude that WhatsApp cannot be used at all; the distinction
that matters is between a hand-off, which sends nothing, and the Business API,
which sends on the practice's behalf and does need approval.

There is deliberately **no email vendor row to add**: none is chosen, and
`documentSender` refuses at startup if the environment names one the platform
has no implementation for. When a vendor is chosen it is approved here first,
which is the rule and is why the branch was left unreachable rather than
half-written.

---

## 4. A general `logAction` in `app/api/_middleware/audit.ts`

**What.** Beside `logRead` and `logReads`:

```ts
export async function logAction(
  db: Db,
  action: string,
  entity: { type: string; id: string; clientId: string | null },
  details: Record<string, string>,
): Promise<void>;
```

The body is `app/api/billing/audit.ts`'s `logSensitiveAction` verbatim, which is
`logRead`'s own insert with `action` and `new_values` as parameters. When it
lands, `app/api/billing/audit.ts` is deleted and the one caller changes its
import.

**Why.** Sending a family their invoice is neither a read nor a row change, so
neither the middleware's helpers nor the row triggers record it — but it is
squarely what `docs/SPEC/audit.md` means by a sensitive action: the practice put
a client's financial document in front of somebody outside it. Billing needed
one and `app/api/_middleware/**` is the shared zone, so it was written in
billing's own folder with a comment saying it does not belong there. It is not
billing-specific and the next stream to need one should find it rather than
write a third copy.

**The rule it carries, which is the reason to keep the helper narrow.** The
details are the contact's **id** and the channel, never the telephone number and
never the address. The trail is kept five years and read by people who have no
business knowing how to reach a family (`docs/SPEC/audit.md` section 8), and an
id answers "who was it sent to" for anyone entitled to ask.

---

## 5. The practice's logo, as a document the owner can replace

**What.** On the Practice settings page (`app/admin/settings/**`, trunk-owned),
a place to upload the practice's logo, filed through the storage seam as a
practice document with `kind = 'practice_logo'` and `client_id` null. Then
`app/api/billing/document-source.ts` reads it onto the document model and the
renderer draws it where the wordmark is.

**Why.** The operator's decision of 2026-09-03 was that the invoice carries the
practice's logo at the top, with the wordmark "McWellness" set in the app's own
type standing in until a logo file is supplied, and that the logo should be a
practice document the settings page can replace rather than a file committed to
the repository. The wordmark is what ships
(`domain/billing/document/strings.ts`, `WORDMARK`), and it is a deliberate
placeholder rather than the finished design.

**What it will need from the renderer, so the shape is known now.**
`domain/billing/document/pdf.ts` draws text and rules and nothing else. An image
means an `/XObject` — a PNG's pixels, or a JPEG passed through as
`/DCTDecode` — which is perhaps forty lines and no new dependency, but it is not
written, because writing an image path with no image to draw is how untested
code ends up on the one page a tax authority reads.

**One related tidy, for whenever `invoice` is next touched.**
`invoice.document_id` (402) is dead: nothing has ever written it and nothing can,
since the table grants no update, which is why the rendered document hangs off
`billing_document` instead (407). It cannot be dropped from a billing migration
for request 1's reason — the column is on a table the trunk has since extended —
and a merged migration is never edited, so it is noted here rather than left for
somebody to wire up in good faith.

---

## 6. Relabel the corporate-tax number on the Practice screens

**What.** In `app/admin/settings/PracticePage.tsx` and
`app/admin/settings/PracticeDrawer.tsx`, and in `app/api/practice/schema.ts`'s
field label if it carries one:

```diff
-              <Fact label="Tax registration number">
+              <Fact label="Corporate tax registration number">
```

```diff
-            label="Tax registration number (optional)"
+            label="Corporate tax registration number (optional)"
-      errors.taxRegistrationNumber = 'A tax registration number is letters, digits and hyphens.';
+      errors.taxRegistrationNumber =
+        'A corporate tax registration number is letters, digits and hyphens.';
```

**Why.** "Tax registration number" is the exact phrase the Federal Tax Authority
uses for a **VAT** TRN. `tenant.trn` is the practice's corporate-tax
registration, and both `tenant.trn` and `invoice.supplier_trn` carry column
comments saying it must never be printed as a VAT number — which the label
undoes, on the one screen where the owner types it in and could reasonably
conclude she has just recorded her VAT registration. The rendered document was
fixed in this pull request (`domain/billing/document/strings.ts`,
`WORDS.corporateTaxNumber`); the screens are the trunk's.

The field name in the API payload (`taxRegistrationNumber`) can stay: renaming a
wire field is a change with no reader, and the two screens are where a person
reads anything.

---

## 7. An erasure keeps a filed invoice — the rule, written down

**The rule, which is what this request is for.** *A document named by
`billing_document` is a financial record. It is kept for five years from the day
it was filed, and an erasure does not delete it or the bytes behind it.* CLAUDE.md
rule 8 says financial records keep five years regardless; `docs/SPEC/00-data-model.md`
section 7 says an erasure "deletes documents from storage" and that "invoices keep
what tax law requires for their 5 years". Those two sentences meet on exactly
these rows, and until now nothing said which won.

**What it means for `app.erase_client`** (`db/migrations/100_client_record.sql`,
client-record's): a document with a `billing_document` row pointing at it is
skipped — not deleted, and its `storage_key` not added to
`storage_keys_to_delete`. Client-record's pull request 51 already holds them back
by reference, which is the same outcome; this records *why*, so that a later
round tidying the erasure does not remove the exemption as dead weight.

**And what it means for this stream's schema.** `billing_document`'s foreign key
to `document` deliberately carries no `on delete` clause. That is not an
oversight: an erasure that tried to delete such a document would abort on the
reference, which is a loud failure rather than a quiet loss of a tax record.
`on delete cascade` would be exactly wrong — it would make the erasure succeed
by taking the invoice with it.

**The test that proves it.** `tests/billing/db/erasure.test.ts` erases a client
who has a filed invoice and asserts the erasure succeeds and the document
survives. It is skipped until pull request 51 is on `main`, and says so where it
is skipped; unskipping it is one line.

---

## 8. Two things review found that this round did not fix

Both are stated here rather than left in a comment, because both are decisions
somebody should take rather than defects somebody forgot.

**The takings figure changes with who asks.** `GET /api/billing/summary` reads
`payment` and `entitlement` under row security, and `db/policies/billing/ledger.sql`
puts every client-scoped read behind `app.client_erasure_gate` — so an erased
client's money is visible to the owner and the lead practitioner and not to
finance or an admin. Cash collected, revenue recognised and the deferred balance
are therefore *smaller for finance than for the owner* on any month containing an
erased household.

**That is not intended, and it is the wrong answer for a takings figure.** What
the practice earned in a month is one number; a total that depends on who is
looking is not a total. The erasure gate is right for a *client's* row — an
erased household should not be listed to a coordinator — and wrong for an
aggregate that names nobody. The fix is a security-definer aggregate that reads
the ledger whole and answers three integers naming no client, which is what
CLAUDE.md rule 8 ("financial records keep five years regardless") points at
anyway. It is a migration and a route change, not a comment, so it is not
smuggled into a fix round.

**Copied Arabic comes back unusable.** The renderer shapes Arabic into
presentation forms and reverses it before writing (`domain/billing/document/arabic.ts`),
and the `/ToUnicode` map is built from the glyphs actually drawn — so text
selected out of an Arabic run arrives reversed and spelt in the FE70 block
rather than in the letters somebody would search for. The English half copies
correctly. The fix is to record, per drawn glyph, the logical character it came
from and map *that* into `/ToUnicode`, which is a change to the writer alone. It
is written up in `domain/billing/document/extract.ts` so nobody reads that
extractor as a promise about the clipboard.

**And one thing that is intended.** `invoice.supplied_on` (migration 406) exists
and nothing writes it. A single visit is supplied on the day it is invoiced, so
the column is correctly null there; a package sold in January and delivered
through May is the case that needs it, and **the tax point on a prepaid package
is the open question `docs/SPEC/billing.md` section 5.3 sends to the tax
adviser**. Writing a date before that answer exists would be inventing the
answer. The column is there so that the day the adviser replies is a route
change and not a migration on an append-only table.
