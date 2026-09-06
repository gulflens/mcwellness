# billing-06: what the call-out fee leaves for other streams

Five requests out of the fee round (`docs/CHANGE-REQUESTS/billing-05.md`,
migration 408, the founder's decision of 4 September). Each is a change to a
file this round does not own, found by the combined review of pull request 100
and left here rather than reached for.

Two of them matter to a family's money and should be taken before the practice
registers for VAT; the other three are words.

---

## 1. To `client-portal`: a waived fee, in the household's own screen

**What.** `PortalInvoice` (`app/api/portal/schema.ts`) gains `waivedAt`, a
nullable `YYYY-MM-DD`; `INVOICES_SQL` in `app/api/portal/money.ts` selects
`to_char(i.waived_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as waived_on`
beside the figures it already reads; and `InvoiceRow` in
`app/client/MoneyScreen.tsx` shows the word "Waived", with the day, on a row
that carries one — in both languages, through the screen's own `words`.

**Why.** Migration 408 posts the call-out fee as an ordinary invoice, and a
waiver marks the row rather than deleting it: the number, the line and the
figures stay, and `app.billing_ledger` stops counting it. The portal's balance
comes from that view and its invoice list comes from the `invoice` table
directly, so today a family whose fee has been forgiven opens the money screen
and sees INV-000012 for AED 150 beside a balance that does not include it, with
no word anywhere saying why. The practice's own invoice book now says "Waived"
with the date (`app/admin/billing/InvoicesSection.tsx`), and the rendered PDF
carries "Waived on 6 September 2026. Nothing is owed." in both languages
(`domain/billing/document/strings.ts`'s `waivedNotice`). The household's screen
is the one place left that still presents the charge as live.

**Which spec.** `docs/SPEC/billing.md` section 4.3: a waived fee "stays on the
record and stops counting in `app.billing_ledger`, so what happened is never
rewritten". A screen that shows the charge and not the waiver rewrites it by
omission.

---

## 2. To the trunk: a waived fee is not a taxable supply

**What.** `app.vat_taxable_supplies_fils(date)`, added by migration
`953_vat_taxable_supplies.sql`, excludes waived rows:

```sql
   where i.tenant_id = v_tenant_id
     and i.waived_at is null
     and i.issued_on > (p_as_of - interval '12 months')::date
     and i.issued_on <= p_as_of;
```

As a new migration in the `95x` range replacing the function whole, not an edit
to 953: it is merged, and `create or replace function` has no undo of its own,
so the replacement carries 953's body in its rollback the way 408 carries
404's.

**Why.** The function sums `invoice.net_fils` over twelve months to say how
close the practice is to the AED 375,000 VAT registration threshold. A call-out
fee the practice forgave is money nobody owes and nobody will pay; counting it
towards the threshold would have the practice register earlier than the law
asks, on the strength of charges it decided not to make. `waived_at` can only
ever be set on a `call_out_fee` invoice (`invoice_only_a_fee_is_waived`), so the
clause changes nothing about any other row.

**Which spec.** `docs/SPEC/billing.md` section 4.3 (the waiver) and the
registration threshold the function exists for. The column belongs to migration
408 in billing's own range; the function belongs to the trunk, which is why this
is a request rather than a commit.

---

## 3. To the consent set: AED 150, and VAT

**What.** `docs/CONSENT/simple/bookings-and-packages.md` says "a fee of AED 150
applies" twice. Before the practice registers for VAT, both want "plus VAT
where applicable" — or a sentence at the foot of the page saying that every
figure in it is net and VAT is added when the practice becomes registered.

**Why.** Every price this platform publishes is net, and the fee is no
exception: migration 408 snapshots `scheduling_setting.unfit_fee_fils` as the
net figure and adds VAT on top at write time when the practice is registered
(migration 406). So the day the practice registers, a page a household has
signed saying AED 150 becomes a charge of AED 157.50, and the difference is
exactly the sort of thing a family reads as the practice moving the price. The
practice is not registered today, so the page is accurate today and this is
cheap to fix now and awkward to fix later.

**Which spec.** `docs/SPEC/billing.md` section 4.3 and the founder's approval of
4 September, which named the figure and not the tax treatment. The consent set
is the founder's own wording and not this round's to amend.

---

## 4. To `scheduling`: the column comment on the fee

**What.** `scheduling_setting.unfit_fee_fils` (migration 202) is commented
"Recorded here; nothing charges it yet
(docs/CHANGE-REQUESTS/scheduling-04.md)". Migration 408 charges it. The comment
wants a new migration in the scheduling range saying what the column now pays
for: the practice's call-out fee, charged by
`app.billing_on_appointment_charged` on a late cancellation, a visit unfit at
the door and a no-show, net of VAT.

**Why.** `billing-05.md` claimed this had been done — "the comment on the column
now says both" — and it had not: 408 comments `invoice.appointment_id` and
`invoice.waived_at`, which are billing's own columns, and cannot comment another
stream's table without editing it. The claim is struck from `billing-05.md` in
the same commit as this request. A column comment saying nothing charges a
figure that is charged on every late cancellation is the kind of wrong that
reads as authoritative.

**Which spec.** `docs/SPEC/scheduling-manual.md` sections 3 and 6.4, amended
this round to say the fee is charged.

---

## 5. To `scheduling`: one sentence that still describes the old rule

**What.** `app/api/appointments/settings.ts`, the doc comment above the route,
says the cancel confirmation has to name the consequence — "this is inside the
practice's twenty-four hours and uses one of the client's sessions". Nothing
uses one of the client's sessions any more. The sentence wants to read "…and
carries the practice's call-out fee".

**Why.** It is the only place left in the two streams that still describes a
cancellation as taking a session. The screens, the specs, the ledger and the
drawer all say the new rule; this comment is what somebody reads next time they
open the route, and it would teach them the rule the founder ended.

**Which spec.** `docs/SPEC/scheduling-manual.md` section 6.4, as amended
2026-09-06.

---

**None of these blocks the round.** Requests 1 and 2 are the two that touch
money a family can see, and the shape of both is settled here so that whoever
takes them has nothing to decide.
