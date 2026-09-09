# McWellness Pieces Twenty-two to Twenty-five: the dispatcher

Written 8 September 2026 by Claude for the operator. **Approved by the operator on 10 September 2026** ("Build the dispatcher", decision 11 of `docs/OPERATOR/2026-09-10-decisions.md`), defaults standing; the board (piece twenty-two) is built first, and the live-location piece stays off by default until the practitioner's own consent page and the notice it needs exist.

At 14:06 the operator wrote: *"i need my admin to have control as a dispatcher
coordinating the sessions and communicating changes to the practioner on the
route."*

Every specification so far has stopped short of this on purpose. A dispatch
board, live tracking, telling a practitioner anything, and a practitioner
asking for a change are all listed as out of scope in
`docs/SPEC/scheduling-manual.md` section 10 and in the practitioner phone
specification's section 11. This is the piece that takes them on.

Four answers were given at 14:10, and the fullest option was chosen each time:

1. **How the practitioner hears: all three ways.** In the app with a
   confirmation the dispatcher can see; a push notification to the phone; and
   a WhatsApp message the dispatcher sends by hand.
2. **Reassigning a visit to another practitioner: yes.** The role table has
   always said an admin may; nothing was ever built.
3. **Live location: yes, on the map.** See "The one that needs your signature"
   below. This is the decision with consequences outside the software.
4. **The practitioner may propose a new time**, not merely confirm or flag.

That is four pieces. They are ordered so each is useful the day it lands:

| Piece | What it is | Size |
| --- | --- | --- |
| Twenty-two | **The board.** One screen showing the whole practice's day: every practitioner, every visit, and how far each has got — waiting, on the way, at the door, running late, finished. Reassign a visit from one practitioner to another. Every change written down with who made it and why | large |
| Twenty-three | **Telling them, and hearing back.** A change appears on the practitioner's own day with a band they tap to confirm, and the board turns green when they do. They can flag a problem — running late, cannot make it, nobody home — or propose a different time, and the dispatcher accepts or not. Plus the WhatsApp hand-off: one button drafts the message and opens your own WhatsApp | medium-large |
| Twenty-four | **The buzz.** A push notification to the practitioner's phone when the day changes, so they are not relying on looking | medium |
| Twenty-five | **Where they are.** The practitioner's live position on the board while they are on shift, with the consent, the shift window and the retention limit the law requires | medium, and see below |

This file is the plan for all four. The specification it approves is
`docs/SPEC/dispatch.md`, which covers piece twenty-two in full and lists what
the others add. Each of the later three gets its own short plan when its turn
comes.

## The one that needs your signature

You chose to show the practitioner's live position on the map. It is genuinely
useful — for dispatch, and for knowing a lone worker driving between houses at
night is where she should be. It is also employee monitoring, and in the UAE
that is not a thing an employer may simply switch on.

Under the Personal Data Protection Law, tracking an employee needs a **stated,
specific purpose**, a **lawful basis** — in practice their **written consent**,
freely given and revocable — a **retention limit**, and **transparency**: the
person must know when it is on. The practice's own privacy policy already
names the PDPL. Consent that is buried in a contract, or that an employee
cannot withdraw without consequence, is not consent.

So piece twenty-five is built to satisfy that rather than to assume it:

- **It is off until the practitioner turns it on**, in their own app, having
  read a plain page saying what is collected, who sees it, how long it is
  kept and how to stop. Nobody can turn it on for them, including the owner.
- **Only while working.** Position is sent between the start of their day and
  the end of it, never overnight, never on a day off. The app shows a band
  the whole time it is on, so it is never quietly running.
- **Kept for two days and then gone**, by a job that deletes it. Long enough
  to work out what happened yesterday, too short to build a history of
  somebody's movements. It is never used for anything but dispatch, and it
  never enters the audit trail — the same rule the practice already applies
  to where a client lives.
- **They can turn it off at any moment**, and the board says "sharing off"
  rather than pretending to know.

**What you have to do, and the software cannot do for you:** give the
practitioner a short written notice and take their signature on it, before
this is switched on for anybody. Claude will draft that page with the rest of
the piece so it says exactly what the software does. If you would rather not
have that conversation, say so and this piece stops — the other three are
useful without it, and piece twenty-two's progress view already tells you how
the day is going.

## What piece twenty-two is

**The whole day, on one screen.** Every practitioner down the side, the hours
across, every visit in its place. Colour is not decoration here: a visit is
waiting, agreed, on the way, at the door, running late, finished or called
off, and the board says which at a glance. It reads what the app already
records — a practitioner checks in at a door and closes the visit when they
leave — so nothing new is asked of anybody for the board to be true.

**Running late is worked out, not typed.** The system knows the arrival
window, the drive between stops and when the last visit actually closed. A
visit that cannot be reached in time is flagged before anybody rings to
complain, which is the whole point of a dispatcher.

**Reassign.** Drag a visit from one practitioner to another, or use the
drawer. Both days are checked before it commits: the new practitioner must be
certified for that service on that date and free at that hour, and the
household keeps the window it was promised. The old visit is kept and marked,
never edited, as a move already is.

**Everything written down.** Who moved what, when and why, on the trail the
practice already keeps.

## What the other three add

**Twenty-three, telling them and hearing back.** A band at the top of the
practitioner's day: "Your 2 o'clock moved to 3", with "Got it". The board
shows it unacknowledged until they tap, so the dispatcher knows whether to
ring. A flag with a reason goes the other way. A proposed new time goes to the
dispatcher to accept or refuse, and until it is accepted nothing has changed.
And a WhatsApp button that drafts the message and opens your own WhatsApp — no
new vendor, no account, the way the practice already talks to people.

**Twenty-four, the buzz.** A push notification when the day changes. Worth
knowing before it is built: on an iPhone this works only if the app has been
added to the home screen, and there is no way around that. On Android it works
either way. It is a nudge, not the record — the confirmation in piece
twenty-three is still what tells you they saw it.

**Twenty-five, where they are.** Above.

## What it deliberately leaves out

Recurring bookings and a waiting list. Telling households anything — the
family is still told by a person, as the practice decided in September.
Anything automatic: the board proposes nothing and reassigns nobody by itself;
a dispatcher decides and the system checks. Turn-by-turn navigation, which
stays a hand-off to Google Maps. And any use of a practitioner's position
beyond the board — not for pay, not for hours, not for performance.

## Decisions only the operator can take

Two are taken above and recorded. Four remain, each with a default that stands
until overruled:

1. **Who dispatches.** Default: the owner, an admin and the lead practitioner
   — the three who may already move a visit. Finance never.
2. **What counts as running late.** Default: the practitioner cannot reach the
   next door by the end of its arrival window, using the drive estimate the
   day map already computes. Ten minutes' grace before it shows.
3. **Whether a practitioner sees the whole board or only their own day.**
   Default: their own day only. They are on the road; the board is a desk
   tool.
4. **How long a flagged problem stays on the board.** Default: until the
   dispatcher clears it or the visit is settled.

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6. Piece twenty-two: about
2.4 million tokens all in — the largest single piece so far, because a board
that is wrong is worse than no board. Twenty-three: about 1.8 million.
Twenty-four: about 1.2 million. Twenty-five: about 1.5 million, plus the
drafting of the notice you sign.

Nothing to buy for twenty-two, twenty-three or twenty-five. Piece twenty-four
adds no vendor either — a push goes through the browser maker's own service,
which needs no account — but it does add a key pair the deployment holds.

## Where this sits against what is already waiting

Three things are already in front of you, and this changes their order:

1. **The security policy the host is stripping** (found this afternoon:
   Hostinger's edge replaces the app's content security policy on every
   response, so it protects nothing in production). That is a live gap and
   Claude would do it first, before any of this.
2. **Pieces twenty and twenty-one**, the practitioner working on site
   (pull request 127, awaiting your approval). They overlap this plan in one
   place only — both add to the practitioner's own screen — and they should
   land first, because a dispatcher coordinating a practitioner who cannot yet
   enrol or take money is half a system.
3. **Shauna's certification**, which is data rather than code: until it is on
   file, nothing can be booked on the live system at all, and a dispatch board
   with nothing to dispatch is a screen with no rows.

## What approving this means

Approving this file approves `docs/SPEC/dispatch.md` as written for piece
twenty-two and the four defaults above. It approves piece twenty-five's
**shape** — consent first, on shift only, two days, revocable — but not its
switching on: that waits on the notice you sign with the practitioner.
Pieces twenty-three and twenty-four come back with plans of their own.
