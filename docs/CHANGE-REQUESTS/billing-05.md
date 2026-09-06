# billing-05: one fee, never a session

The founder's change of 4 September 2026, built on 6 September. This round
spans the billing and scheduling streams, so it is written up here in full:
the founder's own words, the one default Claude took for her to overrule, the
files touched outside billing's own paths, and the four things this round
deliberately did not do.

---

## 1. What the founder decided, in her words

`docs/CONSENT/simple/README.md`, "The founder's review, 4 September 2026":

> Approved in full with two changes, both applied here: the health question
> asks about a head injury at any time, not only the last year; and the booking
> rule is now one fee, not a session. Moving or cancelling more than 24 hours
> ahead is free; within 24 hours a fee of AED 150 applies; a visit that cannot
> go ahead once the practitioner has arrived carries the same fee; a package's
> sessions are never taken for a cancellation. This is a rule change for the
> software as well as the wording: today the scheduling stream treats a late
> cancellation and an unfit visit as using a session, and only records the fee.
> The next scheduling and billing round keeps the session and posts the AED 150
> fee as a charge on the household's account (the figure already sits in
> `scheduling_setting.unfit_fee_fils`).

The wording a household signs has said the same since the approval
(`docs/CONSENT/simple/bookings-and-packages.md`). Until this round the software
said the opposite: `app.billing_on_appointment_charged` (migration 404) took one
of the family's prepaid credits for every `cancelled_late` and every `no_show`,
`CHARGING_OUTCOMES` in `domain/billing/lateCancellation.ts` named both, and the
AED 150 was charged by nothing at all. So a family that had signed a page
promising it would never lose a session for a cancellation lost one every time.

---

## 2. The default Claude took, for the founder to overrule

**A `no_show` carries the same AED 150 fee, and takes no session.**

The founder ruled on two of the three outcomes: a visit called off inside the
notice period, and a visit that cannot go ahead once the practitioner has
arrived. She did not name the third — the practitioner arrived and nobody was
there.

It was read as the same event. From the practice's side a no-show is a journey
made and no session delivered, which is exactly what the other two are; and
charging it differently would be charging a family for its manners rather than
for the practice's day. The alternative reading — that a no-show is worse than a
cancellation and should cost a whole session — is a policy the founder may well
prefer, and it is deliberately not assumed.

**To overrule it:** remove `'no_show'` from `CALL_OUT_FEE_OUTCOMES`
(`domain/billing/lateCancellation.ts`), and decide separately whether a no-show
should take a session instead — which would be a new rule, not the old one
restored, because nothing takes a session now.

Everything else in this round follows from the founder's own sentence.

---

## 3. What was built

| | Where |
|---|---|
| No appointment outcome takes a credit: `CHARGING_OUTCOMES` is empty | `domain/billing/lateCancellation.ts` |
| `callOutFeeFor(status, reason, setting)` — which outcomes carry the fee | same file, tested on every branch |
| The trigger writes one `call_out_fee` invoice instead of taking a credit | `db/migrations/408_billing_call_out_fee.sql` |
| The fee's waiver, and the ledger that stops counting a waived one | same migration, `app/api/billing/waivers.ts` |
| The words, on the cancel drawer, the policy screen and the invoice line | `app/admin/schedule/**`, `domain/billing/document/strings.ts`, migration 408 |

Four decisions inside that are worth naming.

**The fee is an invoice.** A `charge` on `app.billing_ledger` *is* an invoice
(migration 404 section 5): the view is invoices positive and payments negative,
and the balance is their sum. So the fee arrives the way every other charge
does, with one line a family can read, and every screen that shows what is owed
shows it without being told to. It carries the visit's date as the date of
supply, and its line reads "Call-out fee — visit on 2026-09-10" in English and
"رسوم الاستدعاء — زيارة بتاريخ 2026-09-10" in Arabic.

**The waiver is neither of the two the brief offered, and here is why.** The
brief asked for "the existing waiver door with a reason (or an `adjustment`,
whichever the ledger's shape already provides)". Neither reaches this charge.
`POST /api/billing/entitlements/:id/waiver` waives an *entitlement*, and there
is no entitlement here any more. And the ledger has no adjustment or
credit-note row at all: `invoice.net_fils >= 0` and `payment.amount_fils > 0`,
so nothing in it can carry a negative. What shipped is therefore the same act on
the row the ledger does provide — `POST /api/billing/invoices/:id/waiver`, in
`app/api/billing/waivers.ts` beside the credit waiver, asking the same
`mayWaive` permission and insisting on the same reason. The charge stays on the
record, marked as forgiven; `app.billing_ledger` stops counting it. It goes
through `app.waive_call_out_fee`, a security definer door, because `invoice`
grants update to nobody (402) and that stays true.

**A `practice_request` cancellation is late for the record and free for the
family.** The status still reads `cancelled_late`, because who was at fault
belongs in the reason rather than in the status
(`domain/scheduling/cancellation.ts` argued this when it was written, and this
round did not reopen it). The fee is what follows the fault. `consent_withdrawn`
is named beside it although it never reaches `cancelled_late` today, so the
answer does not depend on another stream's rule staying as it is.

**Nothing was backfilled.** The triggers still key on the transition, so a visit
already called off when 408 ran is neither charged a fee nor given its credit
back. The credits migration 404 took are facts about days that have passed;
giving one back is a decision for a person, through the credit waiver, which
still works and is still tested (`tests/billing/db/consumption.test.ts`).

---

## 4. The widening, and every file touched outside billing's paths

`docs/SPEC/OWNERSHIP.md` gives billing `domain/billing/**`,
`app/admin/billing/**`, `app/api/billing/**`, `db/policies/billing/**`,
`jobs/billing/**`, `tests/billing/**` and migrations `400–499`. The founder's
rule spans two streams — the scheduler decides a visit is cancelled, the ledger
decides what that costs — so, as trunk rounds 31 and 32 did and by the
integrator's widening for one round, one branch answered both rather than two
branches answering half each. The note is in `docs/SPEC/OWNERSHIP.md`; the files
are:

**scheduling** — `domain/scheduling/cancellation.ts` (comments only: the notes
that said a late cancellation consumes a credit);
`app/api/appointments/cancel.ts` and `app/api/appointments/schema.ts` (the
response says what was charged rather than what was consumed);
`app/admin/schedule/CancelAppointmentDrawer.tsx` and
`CancellationPolicyDrawer.tsx` (the words, and the waiver the drawer offers);
`tests/scheduling/db/move_and_cancel.test.ts`,
`tests/scheduling/MoveAndCancelDrawers.test.tsx` and
`tests/scheduling/CancellationPolicyDrawer.test.tsx`.

Plus `docs/SPEC/billing.md` section 4.3 and `docs/SPEC/scheduling-manual.md`
sections 3 and 6.4, each amended in one place and marked with the date and the
decision behind it.

Nothing in those paths is billing's beyond this round.

**One boundary was not crossed.** `docs/SPEC/OWNERSHIP.md` rule 3 —
never import another module's `domain/` — holds, and it shaped two things.
`app/api/appointments/cancel.ts` reports the fee by reading the charge back out
of the ledger rather than by importing `callOutFeeFor`, which is also the more
honest answer: it says what was charged, not what it thinks should have been.
And the cancel drawer, which genuinely needs the rule *before* the act, reaches
it through `app/admin/billing/money.ts`, which re-exports it for the same reason
it already re-exports `formatFils`.

---

## 5. Left standing, deliberately

**The fee is not on the client portal in words.** `app/api/portal/**` and
`app/client/**` are the client-portal stream's, and the portal already made a
deliberate decision not to name the fee on the visits screen: `cancelled_late`
reads as "Cancelled" and nothing more, because "the fee, if the practice charged
one, is the money screen's business and a second word here would be the portal
telling somebody off" (`app/client/VisitsScreen.tsx`). The money screen shows the
charge, by reference and amount, with the rendered invoice behind it — and that
invoice carries the bilingual line. Whether the portal should also list a
charge's description is a change request for that stream, not a fix this round
should have made.

**`unfit_fee_fils` keeps its name.** The column was born when the fee paid only
for a visit unfit at the door. What it pays for widened; the words widened with
it, on the settings screen and everywhere a person reads. Renaming a column
across a migration, an API schema and a settings route to match a label is churn
this round did not need, and the comment on the column now says both.

**The two dead enum values stay.** `entitlement_consumption`'s
`late_cancellation` and `no_show`, and `billing_exception_kind`'s
`uncovered_late_cancellation`, describe rows that exist on real ledgers.
Postgres has no `ALTER TYPE ... DROP VALUE` in any case.

**No pgTAP.** This round adds no policy and changes no policy file: the fee is
an `invoice` row and inherits `db/policies/billing/ledger.sql` exactly as every
other invoice does — a client reads their own household's, the office reads
everyone's, a practitioner reads only through
`app.client_visible_to_practitioner`. That is proved by the policies already in
place and by `tests/billing/db/ledger_rls.test.ts`, which needs no new case for
a new kind of the same row.
