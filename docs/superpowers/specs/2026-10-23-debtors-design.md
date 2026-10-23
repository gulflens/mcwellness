# Who owes the practice: debtors list, ageing and statements of account

**Date:** 23 October 2026. **Status:** draft, for the owner's approval. The
owner asked for this piece ("go") after the finance review recommended it,
and has opted out of design questions on earlier pieces. Every choice below
marked *design* is Claude's call. Stacked on the credit-notes branch (PR 293),
because a credit note changes what a household owes.

## Why

Today a balance can be seen one household at a time (Billing › Balances,
client picker). Nobody can answer the bookkeeper's first month-end question,
"who owes us, and for how long?", without opening every client. There is no
ageing and no statement of account to send a household. The books' account
1200 says how much is owed in total, never by whom.

## Goals

- **A debtors list.** It shows every household with a balance that isn't
  zero, as at a chosen day (today by default). It gives the amount owed,
  split into **0–30, 31–60, 61–90 and over 90 days**, with households in
  credit shown as such. A total row sits at the top, and the list downloads
  as CSV.
- **A statement of account PDF** for one household over a period: the opening
  balance, each invoice, payment and credit note with a running balance, the
  closing balance and its ageing. It uses the household's own language.
- Both are reached from **Billing › Balances**, where the bookkeeper already
  looks.

## Non-goals

- Reminders and dunning (sending the statement by email or WhatsApp). The
  PDF is downloaded and handed over, as credit notes are.
- Payment terms or due dates. Age is counted from the invoice date, because
  invoices carry no due date.
- Changing how a payment is recorded (for example, splitting one payment
  across invoices).
- Write-offs and bad debt.

## Anti-goals

- No arithmetic on money in the browser (`BillingPage.tsx` header rule). The
  server sends every figure.
- No household's name in a URL or a log.
- No new tax document. A statement of account is a re-presentation of
  invoices already issued, not an invoice.

## Decisions

| Decision | Choice | By |
|---|---|---|
| How payments meet invoices (open items) | A credit note goes against **its own invoice**. A payment that **names an invoice** goes to that invoice first, and any remainder goes to the oldest open invoice. A payment that names none goes **oldest invoice first** (first in, first out). Anything left over is the household's credit. | design: the usual rule for a running-balance ledger; `payment.invoice_id` and `credit_note.invoice_id` already exist |
| Age | Days from the **invoice date** to the as-at day: 0–30, 31–60, 61–90, over 90 | design |
| Who sees the list and statements | owner, admin, lead practitioner, finance (`mayReadInvoices`) | the existing invoice-book audience |
| Erased households | **Left out** of the list for everyone, and no statement can be made for one. Their money stays in the books' totals. | design: row security shows them only to owner and lead practitioner, so totals would differ by role |
| Statement: filed or not | **Rendered on demand and not filed.** It holds nothing that isn't already on filed invoices and receipts. | design |
| Statement: the `statement` invoice kind in the accounting spec | **Not used.** `app.billing_ledger` would count such a row as a charge. The spec line is corrected. | design |
| Statement period | Defaults to the **last three calendar months to today**, and can be changed | design |
| Where | **Billing › Balances** opens on the debtors list. Choosing a household, from the list or the picker, shows today's single-household view, which gains a **Statement of account** button and a way back to the list. | design: no new tab |

## Shape

### Rules (`domain/billing/ageing.ts`, pure, tested)

`openItems(entries, asOf)` takes one household's ledger entries up to
`asOf`:
- charges with their invoice id and date;
- payments with their optional invoice id;
- credit notes with their invoice id.

It returns each invoice's open amount, and the household's credit left over,
using the allocation rule above.

**The allocation, exactly (design).** It is one pass over every entry dated
up to `asOf`, not a day-by-day replay. That way a payment made before its
invoice existed, which is the usual case for a package, pays that invoice.

1. Each invoice starts with its gross as its open amount.
2. **Credit notes** go against their own invoice, up to its open amount.
3. **Payments that name an invoice** go against that invoice, oldest
   payment first, up to its open amount.
4. **Everything not yet used** goes into one pool, in order:
   - unnamed payments;
   - the part of a named payment or credit note that was more than its
     invoice still owed;
   - a payment naming an invoice that isn't in the ledger (a waived fee).
5. The pool pays the open invoices **oldest first** (by invoice date, then
   number).
6. Whatever the pool has left is the household's **credit**.

A household is therefore either owing (open invoices, no credit) or in
credit (no open invoices), never both. Its owed amount always equals its
balance in Billing › Balances, so the list and the single-household view
cannot disagree.

`ageing(openItems, asOf)` returns the four buckets and the total.

`statementLines(entries, from, to)` returns:
- the opening balance (everything before `from`);
- the lines in date order, each with a running balance;
- the closing balance.

Tests pin:
- first in, first out;
- a payment naming a later invoice;
- an overpayment becoming credit;
- a credit note on its own invoice;
- the bucket edges at days 30/31, 60/61 and 90/91;
- an as-at day before some entries;
- a household in credit.

### Data

There is **no migration**. One query reads `app.billing_ledger` together with
the invoice each payment or credit note names (`payment.invoice_id`,
`credit_note.invoice_id`, joined by `source_id`), for every client that is
not erased, up to `asOf`.

The practice is small (tens of households, hundreds of entries), so the
server computes the whole list in memory. If that stops being true, a
definer function can take over later.

### Routes (`app/api/billing/debtors.ts`)

- **`GET /api/billing/debtors?asOf=`**
  - Returns `{ asOf, totals: { owedFils, b0to30Fils, b31to60Fils, b61to90Fils, over90Fils, inCreditFils }, rows: [{ clientId, name, mrn, owedFils, buckets…, inCreditFils, oldestOpenOn }], truncated }`.
  - Rows are sorted by amount owed, largest first, then households in
    credit.
  - At most **50 rows**. This keeps the audited page size the operator set:
    each row shown writes one `list` audit row.
  - The totals cover every household and name nobody.
- **`GET /api/billing/debtors.csv?asOf=`**
  - Returns every row: one `list` audit row each, plus one `export` action,
    following the enquiries precedent.
  - Uses `domain/shared/csv.ts` with its formula escaping.
  - Columns: Client, Record number, Owed AED, 0–30, 31–60, 61–90, Over 90,
    In credit AED, Oldest open invoice.
- **`GET /api/billing/clients/:id/statement.pdf?from=&to=`**
  - Renders and streams the PDF. It writes one audited read for the client.
  - An erased client, or one the caller can't see, gets 404.
  - The name and MRN print as they do on invoices.

### Document

A `StatementDocument` (`kind: 'statement'`) in `domain/billing/document`. It
reuses the invoice layout's multi-page table:
- **Columns:** date, reference, what (invoice, payment, credit note),
  charged, paid or credited, balance.
- The opening and closing balance rows.
- An ageing strip at the foot.
- The heading **"Statement of account" / "كشف حساب"** and the period.

The language is the household's `client.preferred_locale`, read when the
statement is made. A statement isn't filed, so no language is stored with
it. It isn't a tax document, so it carries no "Tax" wording. New Arabic strings
are marked for the owner's review, as before.

### Screen

**Billing › Balances:**
- An **as-at date**, a **Download CSV** button, the **totals strip**, then
  the **table**: Client, Owed, 0–30, 31–60, 61–90, Over 90, Oldest open.
- Households in credit are marked "In credit".
- On a phone the table becomes a list, following the existing layouts.
- Choosing a row or using the client picker opens the existing
  single-household view. That view gains:
  - a **Statement of account** button, which opens a small drawer with
    From and To dates and a Download button;
  - **All households**, which goes back to the list.

## Done when

- Ageing and allocation rules are unit-tested as listed above.
- A DB test shows:
  - three households (one current, one 45 days old, one in credit) come out
    in the right buckets;
  - the practice total matches account 1200's identity (invoices − payments
    − waived − credit notes, all gross) for households that aren't erased;
  - an erased household is absent;
  - a practitioner gets 403;
  - each row shown writes one audit row.
- The statement PDF renders in English and Arabic, and its opening and
  closing balances and running balance agree with the ledger.
- `pnpm verify` and `pnpm test:db` pass. The security and compliance reviews
  pass. No migration means no schema review.

## Left to the builder

- Exact component split.
- Phone layout details within the design brief.
- Test file names.
