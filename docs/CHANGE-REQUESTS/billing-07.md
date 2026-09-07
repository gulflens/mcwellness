# billing-07: the VAT switch decides something, and the settings screen says so

Two sentences in the trunk's practice settings still describe the rule
migration 406 ended: that the VAT switch records a registration and changes
nothing about what an invoice charges. It has decided what every sale charges
since 406 landed. One of the two is fixed on this branch, under the widening
the round was given; the other is left here because it is in a file this round
does not own.

---

## 1. To the trunk: the switch's own help text (applied by the builder on the branch)

**What.** `app/admin/settings/PracticeDrawer.tsx`, the `small muted` sentence
under the "Registered for VAT" switch — the one the control names in its
`aria-describedby`, `#practice-vat-consequence` — read:

> This records the registration and the number it was issued under. Turning it
> off removes the number from the record. It does not change what an invoice
> charges: VAT is worked out from the practice's standard rate today,
> whichever way this is set.

It now reads:

> This records the registration and the number it was issued under. While it
> is off, invoices carry no VAT and show one figure; turning it on adds VAT at
> the practice's standard rate to every new sale. Turning it off removes the
> number from the record.

The surrounding markup is untouched: the same `label`, the same two spans, the
same id the switch is described by. `app/admin/settings/PracticePage.test.tsx`
asserts the new wording in the test that already read that sentence out of the
control's `aria-describedby`, and asserts the old clause is gone.

**Why.** Migration 406 made VAT follow the registration: an unregistered
practice's invoice carries no VAT, its gross is its net, and
`app.guard_invoice_vat` refuses any invoice that says otherwise. The old
sentence told the founder that the switch was bookkeeping — that VAT would be
worked out from the standard rate whichever way she set it — which is the
opposite of what turning it on now does. It is the only sentence on the screen
that says what the switch decides, and it is read out to anyone using a screen
reader on the control itself.

**Which spec.** `docs/SPEC/billing.md` section 5.1 (nobody types the rate; the
practice is not registered today) and migration
`db/migrations/406_billing_vat_registration.sql`'s own header.

**The file.** `app/admin/settings/PracticeDrawer.tsx` and its test
`app/admin/settings/PracticePage.test.tsx`, both the trunk's:
*applied by the builder on the branch*, under the shared-zone widening this
round was given for that one help text and its test.

---

## 2. To the trunk: the same claim, in the practice screen behind the drawer

**What.** `app/admin/settings/PracticePage.tsx`, the `small muted` paragraph
under the practice's tax facts, ends:

> Recording a VAT registration does not change what an invoice charges: VAT is
> worked out from the practice's standard rate today, whichever way the switch
> is set.

That clause wants to go, and the sentence before it — the one distinguishing
the corporate-tax number from a VAT registration — is worth keeping as it
stands. The shape to copy is the drawer's own new wording: while the switch is
off, invoices carry no VAT and show one figure; turning it on adds VAT at the
practice's standard rate to every new sale.

**Why.** The same reason as item 1, on the same screen: this is the paragraph
the founder reads before she opens the drawer. Leaving it would have the page
contradict the switch's own help text as soon as item 1 landed.

**Which spec.** `docs/SPEC/billing.md` section 5.1 and migration 406.

**The file.** `app/admin/settings/PracticePage.tsx`, the trunk's, and not this
round's to edit: the widening covered the switch's help text and its test, and
this is a different sentence in a different file. *Left for the trunk.*

---

**Neither blocks the round.** Item 1 is applied; item 2 is one paragraph, and
the screen reads correctly on the control itself in the meantime.
