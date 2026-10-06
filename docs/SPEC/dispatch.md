# SPEC — The dispatcher (pieces twenty-two to twenty-five)

*Worktree: a stream of its own, `dispatch`, migrations `210–249` carved from
the upper half of scheduling's range. Entities: `appointment` (reassignment),
and — in the later pieces — `day_change`, `practitioner_flag` and
`practitioner_position`. Part A is piece twenty-two; parts B, C and D are
listed in section 12 rather than specified. Approved with
`docs/PLAN/dispatch.md` on 10 September 2026 (decision 11 of
`docs/OPERATOR/2026-09-10-decisions.md`).*

## 1. Purpose

One screen on which the practice's whole day can be seen and steered: every
practitioner, every visit, how far each has got, what is going wrong, and the
ability to hand a visit from one practitioner to another. Then — in the later
pieces — a way to tell the practitioner, and a way for them to answer.

The operator's decisions of 8 September 2026, 14:10: all three ways of
telling; reassignment yes; live location yes, with the safeguards of the
plan's "The one that needs your signature"; and the practitioner may propose a
new time.

## 2. What exists on `main`, and what this adds

**Exists, and is read rather than rebuilt.** `appointment` with its full
lifecycle and its two exclusion constraints; `checkConflicts`, which already
answers whether a practitioner is free and certified on a date;
`POST /api/appointments/:id/move`, which is two rows and never an edit;
`app/api/appointments/reorder.ts`, which applies several moves in one
transaction and is the shape a reassignment follows; the day map and
`GET /api/routing/practice-day`, which already reads every practitioner's
stops and the drives between them; `session.checked_in_at`, `closed_at` and
`appointment.status`, which is where "how far have they got" already lives;
and the Schedule and Week screens.

**Adds, in this piece.** One migration for reassignment's own link; one route;
one board; one rule that decides whether a visit is reachable in time. **No
new personal data is collected by this piece at all** — it renders facts the
system already holds.

## 3. Who uses it

The owner, an admin and the lead practitioner: the three roles that may
already move a visit (`appointment.move`). Finance and a client contact reach
none of it. A practitioner sees their own day on Today and not the board
(decision 3 of the plan).

## Part A — piece twenty-two, the board

## 4. The board

**4.1 Where.** `/admin/schedule/board?date=`, reached from the Schedule
header beside "Open the day map" and "See the week". A router route inside the
console: unlike the day map it loads no third-party script, so it carries the
console's own strict content security policy and needs no document of its own.

**Amended in the build, 2026-09-10:** the Schedule header's link is the
board's only door, and the board itself carries no date control. The day
rides in the address as `?date=YYYY-MM-DD` and is validated as a calendar
date rather than as a shape — `2026-13-45` has the right shape and is not a
day — so an impossible date is answered 400 by the route and the screen falls
back to the practice's own today.

**4.2 The shape.** Practitioners down the inline start, one row each; the
practice's working hours across, in fifteen-minute columns as
`docs/SPEC/scheduling-manual.md` section 4.1 describes for the week grid. A
visit is a block spanning its arrival window plus its service's own length. A
row with nothing on it still shows, so an idle practitioner is visible.

**Amended in the build, 2026-09-10:** a block spans its window *plus* the
service that follows it, so a practitioner seeing a household every hour has
every block overlapping its neighbour. Blocks that overlap in time stack
within the lane, on the fewest rows that keep them apart: each takes the first
row free at its start — touching is not overlapping — and opens a new row only
when none is. A lane whose visits do not overlap is one row tall, and the
practitioner is still one row of the board.

**Amended in the build, 2026-09-10:** the rows are the practice's **active**
practitioners plus any practitioner with a stop that day, ordered by display
name and then by id. A practitioner who has left the practice but still has a
visit against their name on that day is shown, because the render loop is
driven by this list and a leaver dropped from it would take their
unreassigned visits off the board with them — a visit nobody can see is a
visit nobody drives to. A leaver with nothing that day is not listed.

Below about 1100px the grid becomes one column per practitioner in sequence,
as the week already does; below 640px it becomes the day list, because a
dispatch board on a phone is not a dispatch board.

**Amended in the build, 2026-09-10, and a reduction against the sentence
above:** there are two shapes and one fold, not three shapes and two. The
time grid arrives at **1200px**, the console's own desk tier
(`docs/SPEC/responsive-console.md` section 9); below it every lane is a
column of blocks in time order, which is the day list. The repository's
breakpoint lint (`tests/lint/one-set-of-breakpoints.test.ts`) admits 767, 768
and 1200 and nothing else, so 1100 and 640 are widths this board may not
invent, and the two narrower shapes share one layout.

**4.3 What a block says.** The window in tabular figures, the client's name,
the service, the emirate. And its state, which is the point of the screen.

**4.4 The states, and where each comes from.** Read, never typed:

| State | How it is known |
|---|---|
| Waiting | `status = 'proposed'` — the household has not been told |
| Agreed | `status = 'confirmed'` |
| On the way | the previous visit is closed and this one's window has not opened |
| At the door | `status = 'checked_in'`, or an open `session` |
| Running late | section 5 |
| Finished | `status = 'completed'`, or a closed `session` |
| Missed | `status = 'no_show'` |
| Called off | `cancelled`, `cancelled_late` |
| Moved | `rescheduled` — shown greyed in place, so the day's history reads |

_Amended 2026-09-23 (trunk round 60):_ a `voided` visit — logged from the
practice's records in error and withdrawn — is **not on the board at all**. It
is not part of how the day went: it never happened and nobody expected it, so
it is not a call-off. The board's route reads every status but `voided`
(`app/api/appointments/board.ts`) and writes no list row for it, and "the
previous visit" of section 4.4 never lands on one. The schedule's day list
still shows it, as "Voided".

Hue is the practice's three status tones (`--ok`, `--attention`,
`--critical`) and nothing else: the design brief reserves colour for the EEG
bands and those three states, and a board that invents a palette per
practitioner breaks that rule for decoration. Practitioners are told apart by
their row, which is what a row is for.

**Amended in the build, 2026-09-10:** whether a block can be handed on
follows the **state** it shows and never the appointment's status beneath it.
Waiting, agreed, on the way and running late are the four a dispatcher may
move; every other state renders as a settled block with no control on it at
all.

## 5. Running late, decided rather than typed

`domain/scheduling/lateness.ts`, pure, no clock read inside:

```
type Progress = { stopId: string; windowStart: Date; windowEnd: Date;
                  durationMinutes: number; status: AppointmentStatus;
                  closedAt: Date | null; locationId: string };
lateness(day: readonly Progress[], drive: Matrix, now: Date, graceMinutes: number)
  -> Map<string, { late: boolean; byMinutes: number }>
```

The rule: take the last event that actually happened — a visit closed, or a
check-in — and walk forward through the remaining stops adding each service's
length and the drive between, using the same matrix the optimiser uses
(`fillMatrix`, `app/api/routing/estimates.ts`). A stop whose earliest possible
arrival is later than the end of its arrival window, by more than
`graceMinutes`, is late, and by how much. Ten minutes' grace is the plan's
default and arrives as an argument, never a constant.

Two things it must not do, each with its own test: it must not call a visit
late because the practitioner has not checked in yet when the window is still
open; and it must not cascade a single overrun into every later stop being
"late" when the gaps absorb it.

**Amended in the build, 2026-09-10:** the matrix prices only what the rule
can ask for. That is the anchor — the last stop, in window order, at which
something actually happened — and the unsettled stops after it, which
`drivenStops` in `domain/scheduling/lateness.ts` returns. There is no leg
from the home base, because the rule never asks for one, and no leg to or
from a cancelled, rescheduled or completed stop. With fewer than two such
stops no matrix is built at all: a lone door still ahead is reached from
wherever the practitioner is, which the rule prices as `now`.

**Amended in the build, 2026-09-10:** a deployment with no routing seam still
answers the board. `latenessAvailable` is false, no visit carries a figure,
the states are read from the facts exactly as before, and the screen says on
its face that running late cannot be worked out here. It is the one place the
board parts company with the day map: a map with no drives on it is nothing,
a board with no lateness on it is still the day.

**Amended in the build, 2026-09-10:** what an erased household does to the
walk depends on whose door it is. The gate is
`db/policies/client/readers.sql`: it hides an erased household's client row
**and the locations that household owns** from an admin, and hides neither
from the owner or the lead practitioner.

- **A home visit of an erased household, read by an admin.** The day's own
  read joins the place (`STOPS_SQL`, `app/api/routing/practice-day.ts`), and
  the place is not there, so the visit forms no row at all: nothing is drawn
  for it and it takes no place in the walk. The stops after it are timed as
  though it had never been arranged.
- **A visit of that household at a place the practice owns** — the studio, a
  home base — read by the same admin. That place is operational rather than
  client-sensitive, so the stop survives the read and keeps its place in the
  walk. What it loses is its facts: no names, no service, no check-in and no
  close, and with no facts no block is drawn for it. What it keeps is its
  **status**, and `checked_in` or `completed` still says something happened
  at that door — the board falls back to the window's own start or end where
  a session recorded nothing, so such a stop can be the anchor the walk
  leaves from, timed from its window, and "on the way" can follow it.
- **The owner and the lead practitioner** stand outside the gate and read the
  day whole, so neither case arises for them.

The gate is the erasure policy's and not this rule's; it is written down here
rather than worked around.

## 6. Reassignment

**6.1 The act.** `POST /api/appointments/:id/reassign`, body
`{ practitionerId, windowStart? }`, `X-Reason` required. It is a move that
also changes hands: the old row becomes `rescheduled` and keeps the window and
the practitioner the household was promised; a new row stands beside it
carrying `rescheduled_from_id` and the new practitioner. The window may move
at the same time or stay exactly as it was.

**6.2 What is checked, in this order**, before anything is written: the actor
holds `appointment.reassign` (section 9); the visit is `proposed` or
`confirmed` and has no open session — the same two gates `move.ts` keeps; the
**new** practitioner holds a credential valid for that service on that date
(`canActor`'s `appointment.create`, which already asks exactly this); and
`checkConflicts` passes for the new practitioner and the client. The route
composes `move-one.ts`'s pieces, which pull request 121 extracted for exactly
this kind of second caller, and raises rather than returns after its first
write, for the reason `reorder.ts` records.

**Amended in the build, 2026-09-10:** the new practitioner is read **before**
the household's audited read, and the order is not incidental.
`app.audit_chain` (migration 070) serialises every audit insert on one row
for the life of the transaction, so a request that took its deciding reads
after that insert would queue there behind a rival, resume once the rival had
committed, and refuse on the conflict check instead of on the exclusion
constraint — and the race would never reach the raise-and-roll-back path
section 13 asks be proved. `move.ts` takes its deciding reads first for the
same reason, and so must any write route built after this one. The order has
a second effect, and it is the right one by `docs/SPEC/audit.md`'s rule that
a refused attempt writes no row: a reassignment naming a practitioner who is
not there refuses as `practitioner_not_found` before any household record is
read at all.

**Amended in the fix round, 2026-09-10:** and so does a reassignment naming
one who is not certified. The credential gate sits between the target's own
read and `readMoveContext`, judging the day as `isoDateIn(windowStart)` in the
practice's zone — the value `readMoveContext` computes for itself — so a 403
opens no household record either. Both of the reads the ordering above exists
for still happen before the audit insert, because the target's calendar comes
back with their credentials. `move.ts` keeps its own credential check where it
is: the credentials it judges arrive inside `readMoveContext`, so it has
nothing to move the check above.

**Amended in the build, 2026-09-10:** the target's id is compared to the
visit's own practitioner after lower-casing, so a UUID written in upper-case
hex cannot walk past `same_practitioner` and retire a live row in favour of
an identical one. A practitioner who has left the practice refuses as
`practitioner_not_found`; the drawer's list never offers one.

**6.3 The migration.** `appointment` gains
`reassigned_from_practitioner_id uuid references practitioner (id)` on the new
row, so the trail answers "who was it taken from" without walking the chain.
Nullable; set only by a reassignment. Migration `210` in the new stream's
range.

**Amended in the build, 2026-09-10:** the migration also carries the check
`appointment_reassigned_implies_rescheduled` —
`reassigned_from_practitioner_id is null or rescheduled_from_id is not null`
— so a reassignment is always also a reschedule and the promise the retired
row keeps is always recoverable. The check reads the reschedule **link**, not
the `rescheduled` **status**: the new row carries the column and the link and
stands as `confirmed`, and the row it retires is the one that carries the
status.

**6.4 On the board.** Drag a block from one row to another, or open the
drawer from it. A drag shows what will be checked before it commits and
refuses in place with the sentence the route would have given. The drawer is
the accessible path and the one that takes the reason; a drag opens it
prefilled rather than committing on drop, because a reassignment asks for a
reason and a drop cannot type one.

**Amended in the build, 2026-09-10:** the drawer says beside the target,
before anything is sent, what will be asked of whoever is picked — that they
must hold a valid credential for this service on that day. A fresh drawer is
made for each visit it is pointed at, so a reason typed against one visit can
never be posted against another. A refusal is rendered in the screen's own
words and never in the server's: the two overlap codes get sentences this
drawer can honour, because it has no time control and "choose a different
time" would be advice about a control that is not on the screen; every other
code keeps the scheduling module's shared sentence, which already names a
recovery this drawer does have.

## 7. Rules

`lateness` (section 5) is the only new one. Reassignment reuses
`checkConflicts` unchanged. Nothing else here decides anything.

## 8. Data

One column (6.3). No new table in this piece.

## 9. API

| Route | Who | Answers |
|---|---|---|
| `GET /api/appointments/board?date=` | owner, admin, lead | every practitioner with a row that day, their visits with the facts 4.3 names, and the lateness of each |
| `POST /api/appointments/:id/reassign` | owner, admin, lead; `X-Reason` | the new appointment and the one it replaced, in `MoveAppointmentResponse`'s own shape |

The board route reads client names, so it writes one `list` audit row per
visit shown, exactly as `GET /api/appointments` does — it is the same
disclosure on a different screen. `domain/shared/actor.ts` gains
`appointment.reassign` (owner, admin, lead practitioner) and
`appointment.board.read` (the same three).

**Amended in the build, 2026-09-10:** "exactly as `GET /api/appointments`
does" is the whole of it, and it fixes the row's shape as well as its number:
`entity_type` `appointment`, `entity_id` the visit, `client_id` the household
(`app/api/appointments/list.ts`). One row per visit shown, and nothing at all
for an idle row, which discloses nobody. Six rows naming one household would
say that the household was on somebody's screen and never which of its visits
were, and the day schedule and the board — the same disclosure — would leave
different trails. The day map's own helper writes a `read` and could not
stand in for either.

## 10. Permissions and row security

No policy change: `scheduling_read_scope` and `scheduling_write` already admit
exactly these three roles to every appointment of the practice, and a
reassignment is an insert and an update of rows they may already write. The
piece's tests prove a practitioner, finance and a client contact are refused
both routes, and that another practice reaches neither.

## 11. Audit, erasure, retention

A reassignment writes what a move writes, under its own reason, plus the new
column. `docs/SPEC/audit.md`'s narrative catalogue gains one sentence so the
trail reads "reassigned from X to Y" rather than as two unrelated rows.
Erasure and retention are untouched.

**Amended in the build, 2026-09-10:** the sentence the catalogue gained names
neither practitioner. It reads *"{actor} reassigned the appointment to another
practitioner"* — in Arabic, *"{actor} أعاد إسناد الموعد إلى ممارس آخر"* — so
the act is said as one act rather than as a bare addition beside an
unexplained move, which is what "rather than as two unrelated rows" was for.
Who it was taken from is answered by the row itself:
`reassigned_from_practitioner_id` (6.3) holds that practitioner, which is the
column's whole purpose, and the trail's reader reaches the name through it
rather than through the sentence.

## 12. What the later pieces add, so nothing here pre-builds them

**Twenty-three.** `day_change` (what changed, for whom, when, and whether it
has been acknowledged) and `practitioner_flag` (a problem raised, with a
reason from a fixed list and optional text, and a proposed new time). The
band on Today, the acknowledgement, the board's unacknowledged marker, the
dispatcher's accept-or-refuse of a proposed time, and the WhatsApp hand-off
built on `domain/shared/sending.ts`'s existing `wa.me` composer.

**Twenty-four.** Web push: a VAPID key pair in the deployment's settings, a
subscription per device, and a notification when a `day_change` is written.
No vendor and no account; the browser maker's own push service carries it. On
iOS it requires the app added to the home screen, which the piece says on the
screen rather than discovering in the field.

**Twenty-five.** `practitioner_position`, written only while a shift is open
and the practitioner has consented, deleted after two days by a job, never
audited, never read by anything but the board. Plus the consent itself —
which is **not** the client `consent` table, that being `client_id`-scoped by
its own schema — as a small `staff_consent` table with the same shape: the
wording shown, the version, when, and how to withdraw. The piece cannot be
switched on for anybody until the practitioner has consented in their own app.
**Built 6 October 2026: section 15.**

## 13. Seed, tests, done when

**Seed.** The planning day already gives three practitioners and five visits.
It gains one closed visit and one overrunning one, so the board opens with a
row that is finished and a row that is late, and the lateness rule has
something true to say on a fresh laptop.

**Tests.** `lateness` first, with fixed matrices and the two cases section 5
names it must not get wrong. The board route and the reassign route against a
real database: every role admitted and refused; a reassignment writing two
rows with the new column set; the new practitioner's credential and freedom
both enforced; a whole rollback when the second write fails. The board in
jsdom: the states rendering from the facts, an empty practitioner's row
present, the drag opening the drawer rather than committing, and the console's
English-only and token rules holding.

**Done when.** On the seeded laptop, the board shows three practitioners, the
day's visits in their states, one row late; a visit is reassigned with a
reason, both days redraw, the household's window is unchanged, and the trail
reads "reassigned from X to Y". `pnpm verify`, `pnpm test:db` and `pnpm build`
green.

**Amended in the build, 2026-09-10:** the trail reads *"{actor} reassigned the
appointment to another practitioner"*, with the reason beneath it, and the row
the act retired reads as a change of status under the same reason. The
practitioner it was taken from is on the row, not in the sentence (section
11). "Both days redraw" is both **rows**: the retired visit stays in the first
practitioner's lane, greyed and settled, as `rescheduled` does everywhere on
this board (4.4), and the new one stands in the second's at the same window.

The walk also opens two things no test sees, **added 2026-09-10**: a lane
holding two visits at the same time, which stacks them on the fewest rows that
keep them apart (4.2) rather than stepping each one down a row of its own; and
a day wider than the window, scrolled to its right end, where the hairlines
under the rows and under the hour heads run the width of the day rather than
stopping at the fold. Both were found by this walk and are what the board does
from 2026-09-10; the walk keeps them because neither is a thing a test sees.

## 14. Change requests to the shared zone

`docs/CHANGE-REQUESTS/dispatch-01.md`: the migration's range in
`docs/SPEC/OWNERSHIP.md`; `domain/shared/actor.ts`'s two actions; the route in
`app/shell/App.tsx`; the sentence in `domain/shared/audit-narrative.ts`; and
`docs/SPEC/scheduling-manual.md` sections 4 and 10, which say today that a
dispatch board is out of scope.

## Part D — piece twenty-five, where they are

## 15. Live location, consent-first

*Built 6 October 2026, on the operator's word of the same day switching the
piece on: the practice has one practitioner and family members who help, and
they are the people whose location would be shared. Branch
`round-73/live-location`, migration `211`.*

**15.1 What it is for.** Whoever coordinates the day sees, on today's board
and on the day map, where each person who chose to share was when their phone
last sent, and how long ago that was. For dispatch, and for knowing a person
driving alone between houses is where they should be. Never for pay, hours,
performance or any decision about the person; nothing reads a position but
the board and the day map.

**15.2 The notice.** `docs/CONSENT/staff/location.en.md`, version `1.1` (fix round 1, 15.10),
English only (staff screens are English only). Purpose, what is collected,
when, who sees it, two days, what it is never used for, and how to stop. The
operator's approval of 6 October 2026 stands as the practice's signature; the
person's own "I agree" in their own app is theirs. The file sits in a `staff/`
folder rather than at `docs/CONSENT/staff-location.en.md`, because the client
wording loader (`db/seed/consent-text.ts`) files every top-level `.md` there as
a client `consent_text` document whose purpose must be a client
`consent_purpose`, and a staff notice is neither. The screen shows the file
word for word: `app/therapist/location/notice.ts` holds it as a string (the
browser bundle's import walk resolves source files only, so a `?raw` import
of the markdown fails `tests/lint/no-node-imports-in-browser-bundle.test.ts`),
and a test compares that string with the file byte for byte, so the words
read are the words approved. Another test holds the file's version
to `STAFF_LOCATION_NOTICE_VERSION` and its promises about the working day to
the rule's own constants.

**15.3 The rule.** `domain/scheduling/locationSharing.ts`, pure.
`mayWritePosition` admits a position only when all three hold, and refuses
naming the first that does not, in the order the person would have to put
them right: `no_consent`, `notice_changed` (a consent to an earlier notice is
not a consent to this one), `sharing_off`, `off_shift`.

**What a shift is.** The practice has no clock-in, and none was invented.
`shiftWindow` reads the shift from the practitioner's own visits that day —
the statuses that are stops on their own day sheet: confirmed, checked in,
completed and nobody home. It opens 90 minutes before the first visit's
window opens (the drive to the first door) and closes 30 minutes after the
last visit closed, or, if nobody closed it, 30 minutes after it could at the
latest have ended (window end plus the service's length) — a forgotten
check-in included, since fix round 1 (15.10). It never runs past 21:00 in
Dubai (`SHIFT_LATEST_HOUR`) and never opens before midnight, and
a day with no such visit has no shift at all, so a day off shares nothing.
Both figures are named constants and the notice says them in words.

**15.4 Data** (migration `211`).

| Table | What | Audit |
|---|---|---|
| `staff_consent` | the person's consent: purpose (`staff_consent_purpose`, today only `location_sharing`), the notice version, given, withdrawn. One standing per person and purpose; a withdrawal stamps `withdrawn_at` once and nothing else on the row may change (`app.guard_staff_consent`); a later consent is a new row | `audited: no client` |
| `location_sharing` | the person's own switch | `audited: no client` |
| `practitioner_position` | practitioner, when, latitude, longitude, accuracy in metres | **none, by decision** |

`practitioner_position` carries no audit trigger and says so on itself
(`comment on table … 'unaudited by decision …'`); `tests/db/schema.test.ts`,
which fails any table in `public` without the trigger, admits it by that
comment exactly as it admits `enquiry`. The reason is the plan's: the trail
keeps a row's contents five years, and a two-day limit would mean nothing if
every position were also kept there. `tests/db/audit.test.ts` classifies only
tables that carry the trigger, so it needs nothing.

**Who reads and writes** (`db/policies/dispatch/location.sql`):

- the consent and the switch: a person writes only their own (`user_id` is the
  caller's), the owner included; a person reads their own, and the owner and an
  admin read everybody's, so the practice can answer who agreed to what;
- a position: written only for the caller's own working practitioner row while
  their consent stands and their switch is on (`app.position_writable`); the
  shift is the route's to check, because what a shift is is a business rule;
- read by the owner, an admin and the lead practitioner alone, only for
  somebody sharing now (`app.position_visible`), and only the last row
  (`app.latest_position_id`). A practitioner — the person themselves included —
  finance and a household read nothing.

Nobody holds `delete` on any of the three. Positions leave only through
`app.forget_own_positions` (the person's own, on withdrawal) and
`app.purge_practitioner_positions` (the office's, for the job).

**15.5 Routes.**

| Route | Who | Answers / refuses |
|---|---|---|
| `GET /api/location/me` | anybody signed in | `{ eligible, noticeVersion, consent, sharingOn, shiftOpen }`; `eligible: false` for somebody without a practitioner or lead role and a working practitioner row of their own |
| `POST /api/location/consent` `{ noticeVersion }` | the person | 204, consent recorded and sharing on; 409 `notice_changed`; 403 not eligible; 400 |
| `POST /api/location/consent/withdraw` | the person, whatever their role or practitioner row now is | 204: consent withdrawn, switch off, every position of theirs deleted at once; never refused (15.10) |
| `PUT /api/location/sharing` `{ on }` | the person | 204; turning on 409 `no_consent` / `notice_changed`, or 403 to somebody not eligible; off is never refused (15.10); 400 |
| `POST /api/location/positions` `{ latitude, longitude, accuracyMetres }` | the person | 204; 409 `position_refused` with `code` one of the four refusals; 403; 400 |
| `GET /api/location/positions` | owner, admin, lead (`appointment.board.read`) | the last position of everybody sharing now whose shift is open, sent since it opened (15.10), with its age in minutes; 403 otherwise |

No route takes a person's id. A consent, a withdrawal and every turn of the
switch are audited under the person with a reason of the route's own. The
board's read writes one `read` row per position shown, `entity_type`
`practitioner_position`, `client_id` null, no values: who looked, and at whose
last position, never where.

**15.6 The practitioner's app.** On Today, under the heading:
"Share my location while I work", a real switch (`role="switch"`), off until
the person turns it on. The first time, and whenever the notice has changed
since they agreed, turning it on shows the notice in full with "I agree, share
my location" and "Not now". While sharing is on a band stands at the top of
the day, says so, says whether anything is being sent ("Nothing is sent
outside your working day" when the shift is closed), and carries "Stop
sharing". Off is applied on the screen before the request leaves, so the
sender stops on that render. Once agreed, "Withdraw my agreement" is one press.

**Sending.** The phone's own position (`navigator.geolocation`, which sends
nothing to a vendor) is read and sent at once and then every two minutes,
only while sharing is on, the shift is open and the app is visible. A hidden
app sends nothing; there is no background tracking. A refusal from the server
makes the screen ask again where it stands. A phone that will not give its
position gets a calm note saying nothing is being sent.

**15.7 The board and the day map.** The board loads no third-party script
and keeps the console's strict policy (4.1), so it has no map of its own. On
today's board each row says "Location shared 4 min ago, within 12 m" with a
plain anchor to the day map, or "Not sharing now" rather than pretending to know;
another day's board asks for nothing. The day map draws the shown
practitioner's last position as a label of its own ("Last shared 4 min ago"),
never a numbered stop, drawn by the app like every other pin so the coordinate
is in no request Google receives, and never refits the map. Both read again
every two minutes while visible.

**Vendors.** The browser's geolocation sends nothing to a vendor. The day map's
Google Maps row in `docs/COMPLIANCE/approved-vendors.md` already says the pins
are drawn by the app and Google receives the viewport; a staff position is
handled the same way. The change request proposes one sentence making that
explicit for a staff position.

**15.8 The job.** `location-positions` in `app/api/scheduler.ts`, due on every
change of the hour like the erasure sweep, run as `admin` per practice through
`app.purge_practitioner_positions(positionsCutoff(now))`: everything recorded
more than 48 hours ago is deleted, nothing younger, and a second run in the
same hour deletes nothing. It is the one job that deletes on a timer, and it
concerns staff rather than a household; CLAUDE.md rule 8 is the household
record's retention floor and is untouched.

**15.9 Tests.** `domain/scheduling/locationSharing.test.ts` (the rule and the
shift); `tests/dispatch/db/location.test.ts` (nobody switches on for anybody,
the owner included; refused without consent; the board reads only the last;
a household, finance and the practitioners themselves read nothing; the job;
no audit row); `tests/dispatch/db/location-routes.test.ts` (every route and
refusal); `tests/dispatch/LocationSharing.test.tsx` (the switch, the notice,
the band, sending and stopping); `tests/dispatch/BoardPositions.test.tsx`,
`tests/dispatch/DayMapPosition.test.tsx`, `tests/dispatch/positions.test.ts`
and `tests/dispatch/narrative.test.ts`.

**15.10 Fix round 1, 6 October 2026** (the review of the same day).

- **Backups.** The weekly dump (`.github/workflows/backup.yml`, kept 90 days)
  carries `practitioner_position`'s shape and none of its rows
  (`--exclude-table-data=public.practitioner_position`), held there by
  `tests/dispatch/backup-leaves-positions-out.test.ts`. The database host's
  own daily snapshots still hold positions for the host's backup period; the
  notice says so.
- **The database floor** (migration `212`). A position written by `app_role`
  takes the server's clock, whatever it sent; the purge deletes anything
  stamped more than a minute in the future as well as anything over two days
  old; `app.location_sharing_active` counts a consent only for the notice in
  force (`app.staff_location_notice_version()`, held equal to the domain's
  constant by a test). The shift itself is checked in the route only: it is a
  business rule, and writing it again in SQL would be a second copy free to
  drift (rule 4).
- **A forgotten check-in** no longer holds the shift open to midnight: an open
  visit counts to the latest it could have ended, like any visit nobody
  closed, and no shift runs past 21:00 Dubai. A visit starting at or after
  21:00 makes no shift.
- **The board** shows a position only while that person's shift is open and
  only one sent since it opened; otherwise the row says "Not sharing now".
- **Withdrawal always works.** `POST /api/location/consent/withdraw` and
  `PUT /api/location/sharing {on:false}` are refused to nobody signed in,
  whatever their role or practitioner row now is, and withdrawal still
  deletes their positions at once. `GET /api/location/me` reports the consent
  and switch of somebody no longer eligible, and the screen offers them
  "Withdraw my agreement" on Today and on the landing screen.
- **A changed notice** pauses sharing: the band says so and offers the new
  notice, nothing is sent, and the board stops showing the old position.
- **The notice, version 1.1.** It drops "work out what happened yesterday"
  (nothing can read anything but the last position) and adds: the 21:00 cap
  and the forgotten check-in; that the first position can be home; that the
  audit record keeps the times of agreeing, withdrawing and switching for at
  least five years, and that they could show working hours; the host's daily
  copies and the weekly backup that leaves positions out; who to ask (the
  owner, or the practice's email in Settings › Practice); and that the owner
  could reset the password and sign in as the person, against which the date
  of agreement stands on the person's own band. Version 1.0 was never shown to
  anybody outside a laptop, so 1.1 replaces it in the same file.
- **Not this round:** family members who help can share only with a
  practitioner role and row, which also opens the client list (review finding
  8). It waits on the operator.

**15.11 Fix round 2, 6 October 2026** (the re-review of the same day).

- **Withdrawal from the console.** `LocationSharing` has a `withdrawOnly`
  mode, mounted once in the console layout (`app/shell/AdminLayout.tsx`): a
  person moved to an office role who still has a standing consent or an "on"
  switch sees only "Withdraw my agreement" above every console page. It
  renders nothing for anybody else, an eligible lead included, and never
  sends: positions leave only the person's own day.
- **The date of agreement** shows on the sharing screen whenever the
  agreement stands, with the switch on or off, as the notice says.
- **The notice** names the database host's daily backups, "kept for 7 days on
  the practice's plan" (the figure is to be confirmed with the operator before
  merge), and its lines are all hard-wrapped at 80, as a test now holds.
- **Migration 212's stamp** keys on the table's owner rather than on
  `app_role` by name: any role but the owner — the API's today, any role
  granted insert later — has `recorded_at` set to the server's clock. 212 was
  unmerged and is edited in place.
- **A late check-in** (noted by the re-review): the shift closes at the
  latest end the visit was planned for plus the tail, even if the
  practitioner is still at the door, so positions stop early rather than run
  on.
- **The uae-compliance skill** scopes "nothing deletes on a timer" and the
  audit log's "every read and write" to the records they concern, naming the
  staff-position exception.
