# McWellness billing round: package terms

Written 10 September 2026 by Claude for the operator, from the operator's
answer to decision 9 of `docs/OPERATOR/2026-09-10-decisions.md`: "as
recommended but with 2 3 month extensions permitted". **Awaiting the
operator's go.** Nothing reaches the live site until the operator says so.

## What changes, in plain language

**A programme runs six months from the day it is bought.** Today every
programme runs twelve. The three programmes on the live site — Silver, Gold
and Platinum — become six-month programmes; anything already sold keeps the
term it was sold with, and nothing has been sold yet.

**Up to two extensions, of three months each, at no charge.** A household
that asks gets three more months, with the reason written down; a second
request gets three more; a third is refused with a plain sentence saying the
programme has had its two. Today an extension is one open-ended date typed by
the coordinator with a reason. From this round the length is fixed at three
months and the count at two, so a programme can run twelve months at most —
the same ceiling as today, reached only by asking.

**Said at the point of sale.** The Sell drawer says, above the button: "Runs
six months from today. Two extensions of three months each on request." The
invoice's package line carries "6 months" beside the programme's name, in both
languages. The website's terms defer to the app for the notice period and say
nothing about programmes, so this sentence is where a household first reads
the term.

**The notice period and the fee do not change.** Twenty-four hours and
AED 150 stand, as the operator confirmed; the website's terms already send the
reader to the app for them.

**What is not in this round.** Warnings sixty and thirty days before a
programme ends (a later round, once households are on programmes); charging
for an extension (the operator said none); a refund on expiry (a programme
that ends unused is spent, as the specification has always said, and the
refund quote for a programme stopped early is unchanged).

## The defaults, each Claude's until overruled

1. **Three months is fixed, not typed.** An extension is always exactly three
   months from the current end; the coordinator gives the reason and nothing
   else. A programme that needs something odder is a refund and a new sale.
2. **Two is counted per programme, for ever.** A refused third extension is
   refused for the owner too; the ceiling is the operator's decision, and a
   lever to lift it would be a decision nobody took.
3. **The three live programmes move to six months by a data step**, recorded
   in `docs/PRODUCTION.md`, and new programmes default to six. The Packages
   screen does not gain an edit for the term in this round; a fourth programme
   with a different term would be a change request.
4. **The sentence at the point of sale is the app's own words**, not the
   consent wording's: it states a term, and the client's own approval of the
   wording is final (the operator closed the lawyer track on 9 September).

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6: one billing migration
(`410`: the package term's new default, an `extension` table with its
two-per-programme guard, and `extended_to` kept in step for the readers that
already use it), the extension route taking a reason alone, the drawer
saying "1 of 2 used", the sale sentence and the invoice line, and the tests
for each. About 0.6 million tokens all in, one combined review and one
re-check. Nothing to buy.

## What approving this means

Approving this file approves the change as described and the four defaults.
The build follows in the `billing` worktree from an implementation plan
written from this file, and comes back for the operator's word before the
live site changes.
