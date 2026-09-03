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
