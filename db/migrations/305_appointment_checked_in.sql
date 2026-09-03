-- 305_appointment_checked_in.sql
-- Check-in marks the visit as checked in.
--
-- The defect this closes was found by the schema review of the scheduling
-- stream's pull request 52, and it is this stream's to fix: nothing in the
-- codebase ever writes appointment.status = 'checked_in'. The value has
-- existed in the enum since 200_appointment.sql and every reader already
-- honours it — db/policies/scheduling/appointment_access.sql,
-- 201_client_visible_to_practitioner.sql, app/api/appointments/list.ts,
-- domain/scheduling/status.ts's open list, the day sheet's own "Checked in"
-- label — but the one moment that ought to *set* it, a practitioner standing
-- at the household's door opening the visit, left the appointment exactly as
-- it found it. app.checkin_context (301) admits a 'confirmed' visit and a
-- 'confirmed' visit is what it stays.
--
-- What that costs, concretely, is not tidiness. Every guard the scheduling
-- and billing streams write in terms of "you cannot move or cancel a visit
-- that has been checked in" never fires, because no row ever reaches the
-- status those guards name. So a visit whose session is running right now
-- can still be:
--
--  * **moved**, which leaves the replacement appointment live for ever: the
--    running session still names the original row, and at close
--    app.complete_appointment_for_session (302) settles that one — the new
--    row nobody ever attends is never completed and never cancelled; or
--  * **cancelled late**, which consumes the credit twice: once for the late
--    cancellation and once again when the session that is still running
--    reaches its own completion (404_billing_consumption.sql).
--
-- The scheduling stream is adding a route-level refusal while an open session
-- exists, which is worth having and is not the durable fix: a refusal in one
-- route guards one door, whereas the status is a fact about the row that
-- every reader, policy and trigger can test. Both, then — see
-- docs/CHANGE-REQUESTS/session-capture-03.md, which also names billing's
-- entitlement_one_per_appointment (403) as the third layer under the same
-- money.
--
-- The shape is the one 301 and 302 already set: one narrow security definer
-- door, owned outside app_role, that can do exactly one thing. It takes no
-- status argument, so there is no second thing it could ever be asked to do,
-- and it is a *companion* to app.checkin_context rather than an extension of
-- it — that function is `stable` and answers a question, and a door that
-- writes has no business hiding inside one that reads (a caller may run a
-- stable function twice, or not at all, and the flip must happen exactly
-- once). The route calls the two in order, inside the same transaction that
-- creates the session: checkin_context admits the visit, the session and its
-- opening event are written, and then this marks the appointment.
--
-- Why the appointment must already be 'confirmed':
--
--  * a *replay* — the same device flushing its outbox twice, or a second
--    device attempting the same check-in — finds the row already at
--    'checked_in', matches nothing, and changes nothing. The flip happens
--    once by construction rather than by the caller remembering to ask
--    once.
--  * a **cancelled, no-show, rescheduled or completed** visit is not one a
--    check-in may resurrect. Writing 'checked_in' over 'cancelled' would put
--    a called-off visit back into the exclusion constraints' live set and
--    undo the practice's own decision.
--  * a **proposed** visit is left alone, deliberately and for the same
--    reason 302's own door completes only 'confirmed' and 'checked_in':
--    docs/CHANGE-REQUESTS/session-capture-02.md section 3b records that this
--    stream's two doors disagree about whether a proposed appointment counts,
--    and until the scheduling stream answers, narrow is the safe side. A
--    proposed visit still checks in — app.checkin_context admits it, and a
--    practitioner at the door is not made to wait on a coordinator's click —
--    its appointment simply keeps the status the coordinator gave it, and the
--    coordinator settles it from the calendar exactly as they do today.
--
-- A false answer is therefore an ordinary outcome, not a failure, and the
-- route ignores it: a check-in that has passed every gate is not undone
-- because the visit behind it was only proposed, or because there was no
-- appointment at all (a walk-up visit, which 302 already allows for by
-- making session.appointment_id nullable).
--
-- Needs: 050 (practitioner), 095 (app.current_actor_id), 200 (appointment,
-- and the 'checked_in' value of appointment_status), 300 (session), 301
-- (app.checkin_context, whose admission this stands immediately behind) and
-- 302 (session.appointment_id and session.closed_at, both added there).

create function app.mark_appointment_checked_in(p_session_id uuid) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_appointment_id  uuid;
  v_practitioner_id uuid;
  v_client_id       uuid;
  v_updated         integer;
begin
  -- The session must be this caller's own, still open, and in the caller's
  -- own tenant. Every one of those is checked here rather than trusted from
  -- the caller, because security definer means this body runs with the
  -- owner's privileges and row security is not going to check them for us —
  -- the same reasoning, and the same four conditions, as
  -- app.complete_appointment_for_session (302), with the closing test
  -- inverted: that door settles a visit that has finished, this one marks a
  -- visit that has just started.
  --
  -- `closed_at is null` is not decoration. Without it a stale outbox flush
  -- arriving after the visit was closed as a no-show could still flip the
  -- appointment to 'checked_in', which is a check-in that nobody attended
  -- being written into the record hours after the fact.
  select s.appointment_id, s.practitioner_id, s.client_id
    into v_appointment_id, v_practitioner_id, v_client_id
    from public.session s
    join public.practitioner p on p.id = s.practitioner_id
   where s.id = p_session_id
     and s.tenant_id = app.current_tenant_id()
     and p.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id()
     -- A practitioner the practice has made inactive is not who this door
     -- opens for, any more than they are who 302's own door opens for.
     and p.status = 'active'
     and s.closed_at is null;

  -- No such session for this caller, or a visit no appointment covers.
  if v_appointment_id is null then
    return false;
  end if;

  update public.appointment a
     set status = 'checked_in'
   where a.id = v_appointment_id
     and a.tenant_id = app.current_tenant_id()
     -- Pinned to the session's own practitioner as well as to the tenant.
     -- The check-in route only ever writes an appointment_id it read for
     -- this same practitioner, so this can only bite on a session written by
     -- some other path — and a door that flips another practitioner's
     -- appointment because a session row pointed at it is a door that trusts
     -- its own table more than it should.
     and a.practitioner_id = v_practitioner_id
     -- And to the session's own client, carried out of the same select. The
     -- three together are the whole of what "the appointment this session
     -- names" means: a row that agrees about the practice, the practitioner
     -- and the household. Nothing constrains session.appointment_id to name
     -- an appointment of the session's own client — the foreign key binds the
     -- tenant and no more — so without this a session written by any path but
     -- the check-in route could mark a visit belonging to another household
     -- entirely, and mark it in a way the household's own records would then
     -- disagree with.
     and a.client_id = v_client_id
     -- 'confirmed' alone, so a replay, a second device, and a visit the
     -- practice has since called off all change nothing (see the header).
     and a.status = 'confirmed';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end
$$;
revoke execute on function app.mark_appointment_checked_in(uuid) from public;
grant execute on function app.mark_appointment_checked_in(uuid) to app_role;

-- rollback:
--   drop function if exists app.mark_appointment_checked_in(uuid);
