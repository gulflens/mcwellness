# Credit notes: correcting an issued invoice

**Date:** 22 October 2026. **Status:** draft, for the owner's approval. The
owner asked for this piece ("take care of it") and opted out of design
questions; every choice below marked *design* is Claude's call, made inside
what the specifications already decide.

## Why

An issued invoice can never be edited (CLAUDE.md rule 7; `invoice` has only
`select, insert` grants, migration 402). So a wrong invoice cannot be
corrected inside the system at all. The only correction in place is the
call-out fee waiver (migration 408). The specifications say it is for the
unregistered period only: "once the practice is registered for VAT, a fee is
reversed by a credit note and not by this flag" (`docs/SPEC/billing.md`
§4.3). The accounting spec reserves the event `credit_note.issued`
(`docs/SPEC/accounting.md` §7, line 190). The finance guide currently tells
the bookkeeper "there are no credit notes yet".

A credit note is the Federal Tax Authority's own instrument for reducing or
cancelling a supply already invoiced. It has its own gapless number and
names the invoice it corrects. Building it before registration means the
practice has it on the day it registers, and meanwhile any wrong invoice can
be corrected properly instead of left standing.

## Goals

- Finance, an admin or the owner can issue a credit note against one issued
  invoice, with a reason, from Billing › Invoices.
- The credit note has its own gapless series (`CN-000001`), its own
  bilingual PDF, and it names the invoice and date it corrects.
- The client's balance, the session credits behind the invoice, the books and
  the VAT figures all follow, with no manual journal.

## Non-goals (this piece)

- **Paying money back.** A credited invoice that was already paid leaves the
  household in credit (a negative balance), which later sales draw on.
  Refund payouts wait for the lawyer's refund wording (`billing.md` §10
  item 2).
- **Crediting sessions already delivered from a package.** Only the unused
  part of a package is creditable. A delivered visit is not undone (§4.3).
- **More than one credit note per invoice**, or an arbitrary amount. See
  "What can be credited".
- **Statement invoices** (they post nothing and carry no supply).
- **Sending a credit note by email** (`domain/shared/sending.ts` is shared
  zone). It can be downloaded and handed over.
- **The household's portal listing credit notes.** The portal's balance
  follows automatically through `app.billing_ledger`. Showing the document
  there is a change request to the client-portal stream.
- **Electronic invoicing (PINT AE)**, due July 2027 (`billing.md` §5.5).

## Anti-goals

- No path that edits or deletes an invoice, a line, a credit or a journal
  entry. A credit note is a new record that points at the old one.
- No credit note that leaves the books out of balance, or that debits
  *sessions owed* (2400) for value that has already moved to income.
- No hand-typed VAT on a credit note (CLAUDE.md rule 6).

## Decisions

| Decision | Choice | By |
|---|---|---|
| Registered or not | Credit notes work **either way**. The heading follows the corrected invoice: **Tax Credit Note / إشعار دائن ضريبي** when that invoice was a tax invoice (`supplier_vat_registered`), otherwise **Credit Note / إشعار دائن** | design, on §4.3 |
| The fee waiver | Stays for **unregistered** invoices. `app.waive_call_out_fee` now **refuses an invoice issued while registered**, and the refusal tells the person to issue a credit note | spec §4.3 ("registering is the moment… rather than widen it") |
| How many per invoice | **One**, crediting everything still creditable. A unique index on `credit_note.invoice_id` | design: an invoice is either wrong or right; partial notes add allocation questions this piece does not need |
| Who may | owner, admin, finance (the three who may waive) | mirrors `billing.waiver.write` |
| Reason | required, at least 8 characters, into the audit trail (`docs/SPEC/audit.md` line 178) | spec |
| Money already paid | the household goes into credit; no payout | non-goal above |
| Credits behind the invoice | the unused ones take a **new status `credited`**, stamped with the credit note's id | design (see "Credits") |

## What can be credited

A pure function `creditableFor(invoice, lines, credits)` in
`domain/billing/creditNote.ts` decides, by invoice kind:

| Invoice kind | Creditable net | Where the net was sitting |
|---|---|---|
| `call_out_fee` | the whole invoice | call-out fee income (4300) |
| `session` (a delivered visit charged on the spot) | the whole invoice | session income, by the line's service, as `credit.consumed` maps it |
| `single_session` (a visit sold ahead) | the whole invoice if its credit is **available**; if consumed, the whole invoice as for `session` | sessions owed (2400), or income if consumed |
| `package` | the allocated net of the **available** credits only | sessions owed (2400) |
| `statement` | nothing | — |

It refuses with a reason the screen can show:
- the invoice is a statement;
- the invoice was waived;
- the invoice already has a credit note;
- nothing is left to credit (for example, every package credit is used).

**VAT.** A whole-invoice credit copies the invoice's own `vat_fils` per line,
so the two cancel exactly. A partial (package) credit takes the line's VAT in
proportion, `line.vat_fils × credited_net ÷ line.net_fils`, rounded half away
from zero in integer fils, never more than the line's VAT. The rate and
`vat_setting_version` are the **corrected line's**, not today's, because the
credit note adjusts that supply. A test proves the TypeScript and SQL
arithmetic agree (the pattern of `tests/billing/db/vat_parity.test.ts`).

## Shape

### Data (billing range: 416, 417)

- **`credit_note_series`** and `app.next_credit_note_number(p_tenant_id)`,
  copied from the receipt series (migration 405): a per-practice counter, a
  row lock, a rollback giving the number back, granted to nobody, a tenant
  trigger and a backfill.
- **`credit_note`** (standard columns, `'audited: client'`, `select, insert`
  only):
  - `number` and `reference` generated as `'CN-' || lpad(number, 6, '0')`;
  - `invoice_id`, unique, with the composite key `(tenant_id, invoice_id,
    client_id)` to `invoice`;
  - `issued_on`;
  - `reason`, not blank;
  - `net_fils`, `vat_fils`, `gross_fils`, each `>= 0`, with gross = net + VAT;
  - `released_net_fils`, the part that comes off sessions owed rather than
    income;
  - a supplier snapshot copied from the **invoice** (legal names, TRN, VAT
    TRN, registration, address, contact), so the note states the same
    supplier the invoice did;
  - `locale`, copied from the invoice;
  - `idempotency_key`, unique.
- **`credit_note_line`**: one per credited invoice line, with `invoice_line_id`,
  the snapshotted descriptions, `net_fils`, `vat_rate_basis_points`,
  `vat_setting_version`, `vat_fils` and `gross_fils`. The deferred checks
  require the lines to sum to the header and each line to stay within its
  invoice line.
- **`entitlement_status` gains `credited`**, and `entitlement` gains
  `credited_by uuid` (references `credit_note`). A new enum value cannot be
  used in the transaction that adds it, so the checks that name it go in the
  next file (the 408 and 969 precedent).
- **Policies:** both tables join the `ledger_readers` and `ledger_writers`
  arrays in `db/policies/billing/ledger.sql`.

### Issuing (billing range: 417, and the route)

`POST /api/billing/invoices/:id/credit-note` with `{ reason, idempotencyKey }`
calls a definer function `app.issue_credit_note(invoice_id, reason)` that, in
one transaction:

1. re-checks the actor's role, as `app.waive_call_out_fee` does;
2. locks the invoice and its credits and recomputes what is creditable (the
   SQL mirrors `creditableFor`; a DB test compares the two over the seeded
   kinds);
3. takes the next `CN-` number and writes the note and its lines;
4. moves each credited **available** credit to `credited` with `credited_by`;
5. sets the package purchase to `cancelled` if nothing on it was ever
   consumed, otherwise `completed`.

`GET /api/billing/invoices/:id/credit-quote` returns what would be credited,
or why not, for the drawer to show before anyone confirms.

The route sets `app.reason`. Access is a new `mayIssueCreditNote` in
`app/api/billing/access.ts`, built on the `named()` probe with an explicit
owner/admin/finance fallback, as `mayDiscount` is. The action name in
`domain/shared/actor.ts` is a change request (shared zone).

### Credits

`credited` is a new status rather than `refunded`, because migration 454
already posts every `refunded` credit as `credit.refunded` (Dr sessions
owed, Cr refunds payable). Reusing it would debit sessions owed twice: once
there and once by the credit note.

The allocation check (migration 403) counts every credit that is not
`waived`, so a `credited` credit still counts and the package's allocation
still adds up. `domain/billing/balance.ts` `counts()` and deferred revenue
(`domain/billing/recognition.ts`) must treat `credited` as gone, exactly as
they treat `refunded`.

### Balance and VAT figures (billing range 417; trunk range 981)

- `app.billing_ledger` gains a third branch: `entry_kind 'credit'`,
  `reference` the CN number, `amount_fils = −gross_fils`, on `issued_on`.
  `app/api/billing/balance.ts` and `stop-balance.ts` learn the new kind. The
  portal's sum follows on its own.
- `app.vat_taxable_supplies_fils` (migration 957, trunk range) subtracts the
  net of credit notes issued in the window. That replacement is migration 981.

### Books (accounting range: 455)

- The `journal_entry.source_table` check (migration 453) admits
  `credit_note`.
- `app.unposted_money_events()` gains a `credit_note.issued` branch carrying
  `net_fils`, `vat_fils`, `gross_fils`, `released_net_fils`, the invoice kind
  and the service code.
- `domain/accounting/posting.ts`: `credit_note.issued`, dated `issued_on`.
  - **Cr** receivable: gross.
  - **Dr** VAT payable: VAT.
  - **Dr** sessions owed (2400): `released_net_fils`.
  - **Dr** income, for the rest: call-out fee income for a fee, otherwise the
    session income the service maps to.
  - Plus the `MoneyEvent`, `SOURCE_TABLE`, `worthNothing` and poster
    `toEvent` entries.
- The identities in `docs/SPEC/accounting.md` §7 gain the credit-note term:
  - receivable = invoices − payments − waived − credit notes, all gross;
  - VAT payable = invoice VAT − waived VAT − credit-note VAT.

  The statements DB test asserts both.

### Documents

- **Filing:** `billing_document_kind` gains `credit_note`, and
  `billing_document` gains `credit_note_id`. The check, the one-per-source
  unique index and `app.file_billing_document` each learn the third source.
- **PDF:** a `CreditNoteDocument` in `domain/billing/document/model.ts`,
  rendered by a variant of the invoice layout:
  - the heading as decided above;
  - **"Credits invoice INV-000123 of 12 October 2026"**, shaped like the
    receipt's `settles`;
  - the reason;
  - the lines;
  - **"Total credited"**.

  It uses the client's language, as invoices do since migration 413. The
  Arabic strings need the owner's review before going live, as earlier
  Arabic copy did. Erasure already keeps `credit_note` documents
  (`domain/client/erasureKeeps.ts`).
- **Fields, to be confirmed by the tax adviser.** Nothing in the repo lists
  what the FTA requires on a tax credit note. This design carries the usual
  set:
  - the heading;
  - supplier name, address and TRN;
  - its own number and date;
  - the corrected invoice's number and date;
  - the amount and VAT credited;
  - the reason.

  Confirming them is added to `billing.md` §10.

### Screen

- **Billing › Invoices:** an **Issue credit note** action on each creditable
  row, for those who may, in all three layouts. It opens a right-side drawer
  (the `WithdrawPackageDrawer` pattern):
  - what will be credited, from the quote, with the package's used and
    unused credits shown;
  - the reason field;
  - the confirm button.
- **A credited invoice's row** says **Credited CN-000004** in place of the
  kind words, and offers the credit note's PDF beside the invoice's.
- **`PaymentDrawer.tsx`** wording ("Correcting one is a credit note") stays
  true. The finance guide's "there are no credit notes yet" paragraph is
  rewritten.

## Ownership

This piece spans billing (416–417, routes, screens), accounting (455,
posting), the trunk (981) and two shared files. It rides in one pull request
under a recorded widening, as earlier pieces did. Change requests:
- `domain/shared/actor.ts`: the action name;
- `docs/SPEC/00-data-model.md`: it says `credit_note` "was never built" and
  lists `version`/`supersedes_id` columns on `invoice` that do not exist;
- client-portal: showing the document to the household.

## Done when

- A credit note on each creditable kind posts a balanced journal entry. The
  trial balance, receivable and VAT payable identities hold.
- Nothing posts twice, and running the poster again posts nothing.
- A package with three of ten credits used credits exactly the seven unused
  ones. Its allocation check still passes and the session balance shows zero
  remaining.
- Two simultaneous issues against the same invoice produce one note. Two
  against different invoices produce consecutive numbers with no gap.
- A statement, waived, already-credited or fully-used invoice is refused with
  the reason shown.
- Practitioners and client contacts cannot issue one; the database refuses
  them too.
- The waiver refuses a registered invoice.
- The PDF files once and renders in both languages.
- `pnpm verify` and `pnpm test:db` pass. The security, compliance and schema
  reviewers pass.

## Left to the builder

- How the migrations split between 416 and 417.
- The drawer's exact layout within the design brief.
- Test file names.
- Whether `creditableFor` returns per-line detail or totals, as long as the
  SQL mirror is tested against it.
