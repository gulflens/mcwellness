# billing-credit-notes: what the credit note needs from the other streams

Credit notes are built (2026-10-22; migrations 416, 417, 418, 455 and 981;
`docs/superpowers/specs/2026-10-22-credit-notes-design.md`, `docs/SPEC/billing.md`
section 4.3). Finance, an admin or the owner issues one from Billing › Invoices.
The piece rides in its own pull request under the integrator's widening for one
round, by the cost rules of `docs/HANDOVER.md` section 6 and the precedent of
every widened round in `docs/SPEC/OWNERSHIP.md`; the paths it touched outside
billing are listed in the ownership note. This file asks the other streams, and
the trunk, for the eight things the piece could not do inside its own paths.

---

## 1. `domain/shared/actor.ts` (trunk): the action `billing.credit_note.write`

Add `{ type: 'billing.credit_note.write' }` to the action union and let the
owner, admin and finance roles perform it, as `billing.payment.write` is
performed. Until it lands, `app/api/billing/access.ts` names it through a
`named()` probe that falls back to the roles above, so nothing waits on the
trunk and the change is one line plus the rule when it arrives (the fallback
then goes).

## 2. `docs/SPEC/00-data-model.md` (trunk): two corrections

- Section 6 said `credit_note` "was never built". It is now (416, 417); the
  piece has already rewritten that sentence, and the trunk should keep it.
- The append-only paragraph in section 7 listed `invoice` among the records that
  carry `version`, `supersedes_id` and `amendment_reason`. `invoice` has none of
  those columns. The piece has already corrected the sentence: an invoice is
  never rewritten once issued, but it is not versioned, and a mistake on one is
  corrected by a credit note that points at it.

Both edits are in this pull request; the request is that the trunk accepts them
as its own.

## 3. client-portal: show the credit note to the household

The balance already follows, because `app.billing_ledger` has a `credit` branch.
What the household cannot see is the document. Ask: list a credit note beside
the invoice it corrects (its `CN-` number, date, amount and the PDF), reading
`billing_document` of kind `credit_note` (418) through the portal's existing
document route. The note is filed on issue; erasure keeps `credit_note`
documents with the other tax records.

## 4. scheduling: words for the waiver's two new refusals

`POST /api/billing/invoices/:id/waiver` (call-out fee) now answers 409 with two
new codes. `app/admin/schedule/CancelAppointmentDrawer.tsx` is scheduling's, so
it is asked for here and not edited:

- `vat_registered`: "This fee was charged while registered for VAT; issue a
  credit note from Billing › Invoices instead."
- `credited`: "This fee already has a credit note."

Until then the drawer shows its generic error text for a rare case.

## 5. session-capture: voiding a credited visit must not restore a credit

This is about a `session` or `single_session` invoice — a visit charged at the
door, or a session sold ahead of it. A package's credits never reach it: a
note on a package credits only the credits still unused, and a used package
credit stays consumed against a package whose note never credited it, so a
void of that visit gives back nothing a note already gave.

`app.void_recorded_session` (migration 969) gives a voided visit's credit back
by marking the consumed row `waived` and writing a replacement from the same
purchase. If the invoice behind that credit has since been credited (a credit
note exists), the household gets a free session on top of the refund of the
invoice. Ask: the void refuses (or does not write the replacement) when the
consumed credit's invoice has a credit note. Detection is
`exists (select 1 from credit_note where invoice_id = <the credit's invoice>)`.
A rare case; recorded in `docs/SPEC/billing.md` section 4.3 as a known gap.
The same path through billing's own credit waiver
(`POST /api/billing/entitlements/:id/waiver`) is closed in this piece: it
answers 409 `credited`.

## 6. sending (`domain/shared/sending.ts`, trunk): let a credit note be sent

`SendableDocument.kind` is `'invoice' | 'receipt'`. Allow `'credit_note'` and
give it its own subject and body ("Your credit note CN-000001 from the practice
is ready"), as the invoice has. Until then the send route answers 422
`not_sendable` for a credit note and the owner downloads the PDF and hands it
over. The route needs no other change.

## 7. reports: a credited credit is not a session the household is entitled to

`domain/reports/gatherProgress.ts` (line 254) counts `sessionsEntitled` as
every entitlement the client has (`input.entitlements.length`, read by
`app/api/reports/gather.ts`'s `ENTITLEMENTS_SQL` with no status filter). A
credit closed as `credited` by a credit note was taken back with the invoice,
so the progress report now overstates what the household is entitled to. Ask:
leave `credited` credits out of `sessionsEntitled`, as `refunded` ones should
be left out too (nothing writes `refunded` yet), and add `'credited'` to the
`status` union at line 55 so the type says what the column can hold.

## 8. accounting: the edits made to `docs/SPEC/accounting.md`

The piece edited accounting's spec under the widening, and asks the accounting
stream to accept the edits as its own:

- Section 7's table gains the `credit_note.issued` row (migration 455):
  Dr `contract_liability` the released net, Dr the income account the rest had
  become, Dr `vat_payable`, Cr `receivable` gross; memo "Credit note issued";
  `source_table` admits `credit_note`.
- The identity paragraph now nets credit notes out of `receivable` (gross) and
  `vat_payable` (VAT).
- The paragraph that said a tax credit note "will post here too" now says it
  does, and why the released part comes off `contract_liability`.

---

## Nothing else

No change is asked of the client record or the assessment stream.
