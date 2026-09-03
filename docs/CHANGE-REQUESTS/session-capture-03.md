# Change requests — session-capture, pull request 3

Nothing here needs a shared-zone edit. This is a note to the scheduling and
billing streams about a status that now exists, so that guards written in
terms of it start biting, plus one honest gap the note would be dishonest
without.

The pull request itself is small and entirely inside this stream's own paths:
migration `305_appointment_checked_in.sql` adds the definer door
`app.mark_appointment_checked_in(p_session_id uuid)`, and
`app/api/sessions/checkin.ts` calls it in the same transaction that creates
the session, immediately after `app.checkin_context` has admitted the visit.

---

## 1. `appointment.status = 'checked_in'` is now written

**What changed.** Until now, nothing in the codebase ever set that status.
The value has been in the enum since `200_appointment.sql`, and every reader
already honours it — `db/policies/scheduling/appointment_access.sql`,
`201_client_visible_to_practitioner.sql`, `app/api/appointments/list.ts`'s own
status filter, `domain/scheduling/status.ts`'s open list, the day sheet's
"Checked in" label — but the one moment that ought to have set it left the
row exactly as it found it. A practitioner checked in, the visit ran, and the
appointment still read `confirmed` throughout.

The schema review of scheduling's pull request 52 found it. The consequence
was not tidiness: every guard phrased as "a visit that has been checked in
cannot be moved or cancelled" was written against a status no row ever
reached, so none of them ever fired. Concretely, a visit whose session was
running could still be

- **moved**, leaving the replacement appointment live for ever — the running
  session still names the original row, and at close
  `app.complete_appointment_for_session` (302) settles that one, so the new
  row nobody ever attends is never completed and never cancelled; or
- **cancelled late**, consuming the credit twice: once for the late
  cancellation, and again when the session that is still running reaches its
  own completion.

**What scheduling needs to know.** Those guards can now be written, or kept,
against a status that genuinely appears in the table. From this pull request
on, an appointment reads `checked_in` from the moment the practitioner opens
the visit until the close settles it to `completed` — a window of roughly one
visit, and the exact window in which moving or cancelling it is wrong.

**No policy was widened to do it.** `scheduling_update` still grants update on
`appointment` to the owner, the admin and the lead practitioner alone; a
practitioner still cannot change the calendar. The flip goes through one
narrow security definer door that takes no status argument, in the shape
`app.checkin_context` (301) and `app.complete_appointment_for_session` (302)
already set, and it refuses anything that is not the caller's own open
session with a `confirmed` appointment of their own practitioner row. As with
302: if scheduling would rather own this transition itself, this function is
the shape of what it needs to replace, and dropping it is a one-line
rollback.

**What it deliberately does not do.** It marks `confirmed` and nothing else.
A `cancelled`, `cancelled_late`, `no_show`, `rescheduled` or `completed`
appointment is never written over — a check-in must not resurrect a visit the
practice has called off, and a replayed outbox or a second device must not
flip anything a second time. See section 3 for the `proposed` case, which is
the gap.

---

## 2. The belt stays; this is only the brace

Three layers now stand under the same money, and none of them replaces
another:

1. **This status.** A fact about the row that any reader, policy or trigger
   can test, in the one place the visit actually starts.
2. **Scheduling's route-level refusal** while an open session exists (pull
   request 52). Worth keeping on its own merits: it refuses at the door the
   coordinator is actually standing at, with a message a person can read, and
   it covers the `proposed` gap in section 3 that the status does not.
3. **Billing's `entitlement_one_per_appointment`** (403), the unique index
   that makes a credit consumed twice for one appointment impossible at the
   database rather than merely unlikely.

Please do not remove 2 or 3 on the strength of 1. The status makes the guards
possible; the index is what makes the double consumption impossible.

---

## 3. The gap, named rather than left to be discovered

`app.checkin_context` admits a `proposed` appointment — a practitioner
standing at a door is not made to wait on a coordinator's click — but
`app.mark_appointment_checked_in` marks only `confirmed`. A visit checked in
against a still-proposed appointment therefore runs with the appointment at
`proposed`, and a guard written purely as "refuse if status = 'checked_in'"
does not cover it.

That narrowness is deliberate and is the same reading `302` already took, for
the reason recorded in `session-capture-02.md` section 3b: this stream's two
doors disagree about whether a proposed appointment counts, and while they
disagree, narrow is the safe side — writing `checked_in` over a status the
coordinator has not yet confirmed would settle that disagreement from the
wrong stream.

Two consequences worth stating plainly:

- The route-level refusal in section 2 is the layer that covers this case
  today, because it tests for an open session rather than for a status.
- If scheduling answers `session-capture-02.md` section 3b with "a proposed
  appointment counts", the one-line change here is widening this door's
  `and a.status = 'confirmed'` to `in ('proposed', 'confirmed')`, and `302`'s
  own completion clause alongside it. This stream will make that change on
  your word; it will not make it unilaterally.

---

## 4. Tests, so the next reader can see what is covered

All in `tests/session/db/`, all synthetic and inside the reserved ranges:

- `doors.test.ts` — the flip marks the caller's own open visit and marks it
  exactly once (the replay changes nothing and the row stays `checked_in`);
  a called-off visit is refused and stays called off; a closed visit is
  refused; a practitioner the practice has made inactive is refused; another
  practitioner's visit and another practice's are refused, in both
  directions; a proposed appointment is left where the coordinator put it.
  And, on the close's own door, that a visit marked `checked_in` still
  completes — `302` already admitted the status, and that clause is now held
  to by a test rather than by reading.
- `checkin.test.ts` — the route end to end: a check-in against a confirmed
  appointment leaves it `checked_in`, and a check-in against a proposed one
  succeeds and leaves it `proposed`.
