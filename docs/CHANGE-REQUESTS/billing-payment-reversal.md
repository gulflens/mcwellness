# billing-payment-reversal: what payment reversal needs from other streams

Payment reversal is built (2026-10-23; migrations 419, 456 and 982;
`docs/superpowers/specs/2026-10-23-payment-reversal-design.md`,
`docs/SPEC/billing.md` section 4.3a). Owner, admin and finance reverse a
payment from Billing › Receipts. The piece rides in its own pull request under
the integrator's widening for one round; the paths it touched outside billing
are listed in `docs/SPEC/OWNERSHIP.md`. This file asks for the two things it
could not do inside its own paths.

---

## 1. `client-portal`: show a reversal line

The household's balance already follows the reversal through `app.billing_ledger`
(the new `reversal` entry kind, +amount on `reversed_on`). The portal's list of
payments and its statement view do not yet show the line. Show a `reversal`
entry as "Payment reversed" with its day, beside the payment it cancels, and
never show the reason (it is kept out of every list deliberately).

## 2. `domain/shared/actor.ts` (trunk): the action `billing.payment.reversal.write`

Add `{ type: 'billing.payment.reversal.write' }` to the action union and let the
owner, admin and finance roles perform it, as `billing.payment.write` is
performed. Until it lands, `app/api/billing/access.ts` names the action through
a fallback to those roles, so nothing waits on the trunk; the fallback goes when
the action arrives.
