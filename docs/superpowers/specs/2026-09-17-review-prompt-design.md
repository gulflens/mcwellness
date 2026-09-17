# A review line on the household's portal

**Date:** 17 September 2026. **Status:** design settled by the owner on 16
September; building (trunk round 52).

## Why

The owner asked for the app to send a client to the practice's Google review
page "after brain mapping, or after a number of sessions or the end of a
package". `docs/SPEC/client-portal.md` section 4 says the portal carries "no
nudges", and that rule was right for everything the portal said until now: a
household's record is not a place to be sold to. The owner's decision of 16
September admits one exception, on her own terms: one quiet line, shown once
per milestone, dismissable, never repeated, and never a star widget inside the
app. The spec records that decision beside the rule it amends.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| Where | the portal home, beneath what is waiting on the household | owner, 16 September |
| What it does | opens the practice's own Google review page in a new tab, and nothing else | owner, 16 September |
| Tone | one sentence, two words for each answer, no heading, no colour, no animation, no emoji | the spec's section 4, kept |
| Sequence | its own pull request, after the expo's and the past sessions' | owner, 16 September |

## The four calls this design makes

**1. Two milestones, decided by a pure rule.** A brain map is a completed
visit whose service type carries the code `brain-map`, the code
`domain/accounting/posting.ts` already relies on and the seed's catalogue
uses. A finished package is an active purchase whose `packageProgress` reads
"used equals total, and total above nought". Neither is stored: the rule
(`domain/portal/reviewPrompt.ts`, `reviewMilestones`) reads the rows the
portal already reads and answers with at most one milestone per client.

**2. Ninety days.** A milestone counts only when it was reached within the
last ninety days of the practice's own today. Without this, the past-sessions
round (trunk round 51) would make every history the office logs raise a
review line for a visit from a year ago, and a household invited to the portal
late would be asked about a package that finished before they had a login.

**3. One line per client, the most recent milestone.** A household never sees
two review lines stacked, and a client with a brain map and a finished
package in the same quarter is asked once.

**4. Adults only.** The line is shown for a client only where the signed-in
person is shown that client's money (`moneyVisibleTo`), which is exactly "not
a young person's own login". A review is asked of an adult, and the
entitlement and purchase rows are refused to the minor by
`db/policies/portal/money.sql` in any case.

## The answer is a row, not a browser setting

Either answer, "Leave a review" or "Not now", writes one `portal_review_prompt`
row (migration 704): the client, the milestone by kind and id, who answered,
which way, and when. One row per milestone per client, whichever adult of the
household answered; a second answer is idempotent. The portal remembers the
language switch in the browser (spec section 12) and the practitioner's phone
remembers its install note the same way, and that was considered here and not
taken: the answer is a fact about the household, and a line that returned on
a second phone would be the nudge the spec forbids.

The office does not answer on a household's behalf. A coordinator who wants
the line gone clears the review link in Settings, which switches the whole
feature off.

## The link is a hand-off

`tenant.review_url` (migration 920, the shape of 912's website column) is the
practice's public review page. Opening it is a hand-off in the sending seam's
sense, like `wa.me` and Google Maps: nothing leaves this server, the
household's own browser opens the practice's public page on a deliberate
press, and the anchor carries `rel="noopener noreferrer"` so not even the
portal's address travels as a referrer. Google receives what any page visit
sends from that browser. `docs/COMPLIANCE/approved-vendors.md` gains a row
saying exactly that, so the register stays complete.

## Alternatives considered and not taken

- **Keying the brain-map milestone on an issued report.** A brain map is an
  assessment (`derived.kind = 'brain-map'`), not a report kind; the
  household's own event is the visit, and the owner said "after brain
  mapping". Switching later is one input to the same rule.
- **A star rating inside the app.** The owner refined the ask to the Google
  page: a rating the practice held itself would be a record of the
  household's opinion with nowhere to go and a retention question of its own.
- **A reminder, or a second line after a dismissal.** Never: once per
  milestone is the decision.
- **An office view of who answered.** The audit trail records each answer
  under the household; nothing else is built.

## Deliberately not done

No push, no email, no WhatsApp: the line waits for the household's next visit
to the portal. No prompt to a young person's own login. No prompt where the
practice has recorded no review link.
