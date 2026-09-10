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

**Amended in the build, 2026-09-10:** the row is written per visit shown and
nothing at all is written for an idle row, which is the shape the clients
list already keeps. The day map's own helper writes a `read` and could not
stand in for it.

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
