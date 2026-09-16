# A past session, logged from the practice's records

**Date:** 16 September 2026. **Status:** design settled by the owner; building (trunk round 51).

## Why

The practice has clients whose sessions happened before the app, on paper. The
owner asked, more than once, to "go back to previous dates on the calendar and
manually log sessions for my current client, so their full session history and
progress is accurately recorded". Today the only path that creates a `session`
is the practitioner's phone check-in, which refuses a past date three times
over: a fifteen-minute device-clock window, `app.checkin_context`'s "booked
today" in SQL, and the route's own today-clamped appointment lookup.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| Who logs one | owner, admin, lead practitioner, from the day schedule | owner, 16 September |
| Billing | a package credit if one is available; otherwise refuse, unless marked "settled before the app", which charges nothing | owner, 16 September |
| Never | an invoice at today's price for a visit from a day that has passed (migration 404's own header) | owner, 16 September |
| Sequence | its own pull request, after the expo's | owner, 16 September |

## The one design call this spec makes

**A past visit is one appointment and one session, as a live visit is.** The
day schedule lists appointments; the household's portal lists past
appointments; the report and assessment pickers list completed sessions. A
row in only one table would be invisible somewhere. So the route writes a
`completed` appointment for the visit's window and a `completed` session
linked to it, in one transaction, and everything that reads either sees it.

## Shape

**Migration `966_session_from_records.sql`**, trunk second half (it alters
`session`, a stream's table, and replaces billing's function), and one
restrictive insert policy in `db/policies/session/practitioner_scope.sql` so
a `records` row is the office's at the table as well as at the route:
`session.recorded_from text not null default 'device'` (`device` | `records`)
and `session.settled_outside_app boolean not null default false`, the second
only ever true on a `records` row. `app.billing_on_session_completed` gains one
branch ahead of its existing body: a `records` row marked settled outside
charges nothing; a `records` row not so marked takes the oldest credit valid
on the visit's own date, and if there is none the insert is refused with
`restrict_violation` — the route answers it, nothing is written. A `device`
row runs the existing body unchanged.

**Domain** (`domain/session/pastSession.ts`, pure, tested first): the floor
`2024-01-01` and the ceiling of today; the visit's instants from a day, a
start time and a length in the practice's zone; `canRecordPastSession`, the
gate — the actor holds a calendar role and the named practitioner held a
credential for the service on that date (`session.record_past` in
`domain/shared/actor.ts`, the shape of `appointment.create`), and the client's
consents are active now: participation, minor participation when the client
is under eighteen or has no date of birth, home visit for a home delivery,
health data always. Consent is judged now, not on the visit date: the
household is a current client whose consent covers their own record,
including its history. A current client is one whose record is active or
paused; a lead has no history with the practice yet, and a closed or erased
record takes nothing more.

**Route** `POST /api/sessions/from-records` (session-capture's paths, mounted
by `mountSessions`): body `clientId`, `practitionerId`, `serviceTypeId`,
`locationId`, `deliveryMode`, `on`, `startTime`, optional `durationMinutes`
(the service's own length otherwise), `billing` (`credit` |
`settled_outside`); `X-Reason` required. Refusals, each logged before the
answer against the visit's own id, naming the client only once the client is
known to exist: 400 `not_a_day`, `in_the_future`, `too_old`,
`reason_required`, the booking route's own not-found and mismatch codes; 403 for the wrong role or a practitioner
without the credential; 422 `blocked` with the gate's reasons, or
`no_credit_available`, or `practitioner_overlap` / `client_overlap` from the
appointment's exclusion constraints. Success 201 `{ sessionId, appointmentId,
billed }`, audited as the sensitive action `session_recorded_from_records`
under the reason given.

**Screen**: on the day schedule, for a day before today, "Log a past session"
opens a drawer: client search, service, location and practitioner from the
booking route's own options, start time, length, the billing choice, and why.
On success the day reloads and the visit stands in the list as completed.

## Not in this round

A note or ratings on a past session: the record is the date, the service, the
practitioner and the length; observations were the vendor software's, and the
report's own words are the report's. Amendments of a past session: a wrong
one is a new version by the amendment path section 4 already names, which is
still unbuilt. `visit_actuals` for a past visit: nothing was counted at the
door.

## Risks stated

- A credit consumed on a visit date months ago is judged by that date's
  expiry, so a package that has since expired still covers the visits it was
  bought for. That is the intended reading.
- A past visit's appointment occupies the practitioner's and the client's
  window under the calendar's own exclusion constraints, as a live one does;
  two past visits typed at the same hour are refused as an overlap.
