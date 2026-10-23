# Reversing a payment recorded in error

**Date:** 23 October 2026. **Status:** the owner said "keep going" after the
finance plan listed this piece. Every decision below is Claude's call (*design*),
inside the existing rules. Streamlined process: per-task reviews, one combined
final review.

## Why

A payment is append-only (`payment` has `select, insert` only, migration 402).
Today a payment typed with the wrong amount, recorded twice, or against the
wrong client cannot be corrected by anyone. The finance guide and the payment
drawer both say "tell the owner", and the owner has no way to fix it either. A
credit note reduces an invoice, not a payment (credit-notes design, owner's
answer 3).

## Goals

- Owner, admin or finance can **reverse** one payment, in full, with a reason,
  from **Billing › Receipts**.
- The client's balance, the debtors list and statements, the books, and the
  "received this month" figure all follow. History stays true: the payment
  still shows on the day it was recorded, and the reversal on the day it was
  made.
- Then the right payment is recorded the usual way.

## Non-goals

- Partial reversal (record the right payment after a full reversal instead).
- A printable reversal document. A receipt is not a tax document, and the
  receipt book marks the reversal.
- Refund payouts (money going back to a client).
- The household's portal showing the reversal: its balance follows through the
  ledger view. Showing the line is a change request to client-portal.

## Decisions (*design*)

| Decision | Choice |
|---|---|
| Record | A new append-only table `payment_reversal`: one per payment (unique `payment_id`). It holds `reversed_on` (the practice's today), `reason` (≥ 8 characters) and `idempotency_key`. There is no number series. |
| Who | owner, admin, finance: the same people who record payments |
| Written by | one security definer function `app.reverse_payment(payment_id, reason, idempotency_key)`. `app_role` gets `select` only (the credit-note precedent). |
| Refusals | `already_reversed`; `client_erased` |
| Ledger | `app.billing_ledger` gains a fourth branch, `entry_kind 'reversal'`, of **+amount** on `reversed_on` with the payment's receipt reference. This is a `create or replace` view keeping the same columns. |
| Debtors / statements | A reversal cancels its payment for any as-at day on or after `reversed_on`. A statement shows both lines: the payment as paid, the reversal as charged. |
| Books | A second event on the same source: `source_table 'payment'`, `source_id` = the payment, `source_event 'payment.reversed'`, dated `reversed_on`. Dr receivable, Cr bank, cash or link clearing (by method). `app.unposted_money_events()` is replaced with **the same result columns**, so there is no drop (455's body plus one branch). |
| Received this month | `app.practice_money_ledger()` (952) subtracts reversals by `reversed_on`. It is replaced with `create or replace` and the same signature, in a trunk-range file (982). |
| Erasure | Keeps `reason`, as the credit-note and waiver reasons are kept. |

## Shape

- **Migration 419** (billing): the table (standard columns, `'audited: client'`,
  `audit_row enable always`, RLS, `select` to `app_role`), the function, and
  the view's fourth branch. Policy arrays in `db/policies/billing/ledger.sql`:
  `tenant_isolation`, `ledger_readers` and `ledger_writers` gain
  `payment_reversal`. `db/policies/core/helper_reach.sql` covers it on its own.
- **Domain:** `domain/billing/reversal.ts` `reversibleFor({ reversed,
  clientErased }) → ok | refusal`. `domain/billing/ageing.ts` gains a
  `LedgerEntry` kind `'reversal' { paymentId, amountFils }`:
  - `openItems` drops a reversed payment, together with its reversal;
  - `statementLines` shows the reversal in the charged column.
- **Routes:** `POST /api/billing/payments/:id/reversal` `{ reason,
  idempotencyKey }` → 201 `{ reversal: { id, reversedOn } }`.
  - Error mapping as for credit notes: 409 `reversal_refused` with a refusal,
    400, 403, 404.
  - The receipt rows (`ReceiptRow`) gain `reversedOn` and `reversalReason`.
  - `balance.ts`, `stop-balance.ts` and `ledger-entries.ts` handle `'reversal'`.
- **Migration 456** (accounting), `domain/accounting/posting.ts` and
  `app/api/accounting/poster.ts`: `payment.reversed`.
- **Migration 982** (trunk): `practice_money_ledger` net of reversals.
- **Screen:** Billing › Receipts gets a **Reverse payment** action and drawer:
  - the reason field, with the hint "Don't include names or health details.";
  - the sentence "This cancels the whole payment. Record the right one
    afterwards.";
  - a row that reads **Reversed <date>**.

  `PaymentDrawer`'s copy becomes "A payment can't be changed once recorded. If
  one was recorded in error, reverse it in Receipts and record the right one."

- **Docs:**
  - the finance guide's "A wrong payment" paragraph;
  - `docs/SPEC/billing.md`, `accounting.md` and `OWNERSHIP.md` (982);
  - a change request for the portal.

## Done when

- Reversing a payment raises the client's balance by its amount, and the
  debtors list as at today agrees with that balance.
- As at a day before the reversal, the payment still counts.
- The books post Dr receivable / Cr cash (or bank, or link clearing). The
  receivable and cash identities hold, and the poster run twice posts nothing
  new.
- "Received this month" drops by the amount in the month of the reversal.
- A second reversal of the same payment is refused (`already_reversed`), and a
  retry with the same key returns the first reversal.
- A practitioner gets 403, and the database refuses the role too.
- `app_role` cannot insert into `payment_reversal` directly.
- `pnpm verify` and `pnpm test:db` pass.

## Tasks (plan)

1. **Rules + migration 419 + policies:** `reversal.ts`, the table, function and
   view; DB tests (reverse, refuse twice, idempotent, role, no direct insert,
   ledger branch, audit coverage, row security).
2. **Routes and readers:** the reversal route; ReceiptRow fields; balance,
   stop-balance, ledger-entries and the `ageing.ts` reversal kind; tests,
   including debtors agreement and a past as-at day.
3. **Books and the monthly figure:** 456, posting, poster, 982; tests.
4. **Screen and docs:** ReceiptsSection action and drawer, PaymentDrawer copy,
   the guide and specs, the change request.
