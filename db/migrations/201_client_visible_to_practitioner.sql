-- 201_client_visible_to_practitioner.sql
-- Needs: 000 (schema app, role app_role, app.current_tenant_id), 050
-- (practitioner, to resolve the caller's own row), 100
-- (app.client_visible_to_practitioner itself, app.current_actor_id), 200
-- (appointment).

-- Schedule-based client visibility. docs/SPEC/client-record.md section 2
-- gives a practitioner "the client brief for clients on their schedule
-- only", and section 11 requires that "a practitioner not on that client's
-- schedule cannot open the record; the attempt is audited". Until now no
-- schedule existed, so 100_client_record.sql left this function answering
-- false for everyone, with the note that "the scheduling worktree replaces
-- this body once appointments and assignment exist". They now do.
--
-- What flipping this stub opens, in full. Six restrictive read policies in
-- db/policies/client/readers.sql — client, contact, location, consent,
-- document and goal — call this function, and so does one write policy:
-- client_record_update_writers on public.location
-- (db/policies/client/writers.sql), which lets a practitioner whose schedule
-- reaches a client update that client's location. That write is narrowed to
-- a single column by app.guard_location_notes (100_client_record.sql): the
-- access notes, and nothing else on the row. Both are deliberate — section 2
-- grants a practitioner exactly "read the client brief for clients on their
-- schedule only; add access notes to a location" — and both are proved in
-- tests/scheduling/db/client_visibility.test.ts, the write included, so the
-- door this migration opens is the door that was described.
--
-- THE RULE (decided by the trunk session on 2026-09-03, on the reviewers'
-- recommendation; the operator was told and may change the numbers). A
-- client is on a practitioner's schedule when that practitioner holds an
-- appointment with them which:
--
--   1. really counts as a visit, meaning its status is one of
--      'confirmed', 'checked_in', 'completed', 'no_show' or 'rescheduled';
--      and
--   2. starts on a day between 90 days before today and 30 days after it,
--      counted in the practice's own zone.
--
-- The status list is written out as the five that grant, not as the three
-- that do not. A negative list would hand the door to any status added to
-- appointment_status later; this way a new status opens nothing until
-- somebody names it here on purpose.
--
-- 'proposed' is absent by intent: the client has not been told about that
-- visit yet (scheduling-manual.md section 3), so it is a plan, not a
-- schedule, and it opens no record until it is confirmed. Both cancelled
-- statuses are absent for the plainer reason that a visit called off, inside
-- the notice period or outside it, is a visit that is not happening. A
-- no-show is not a cancellation — the practitioner was genuinely sent to
-- that door — and a 'rescheduled' row records a visit that was really theirs
-- before it moved.
--
-- The practitioner row must itself be active. Without that clause an
-- employee marked inactive (active_status is 'active' or 'inactive',
-- 040_service_type.sql) whose user account still carries the practitioner
-- role would keep every client of their last 90 days open behind them.
-- Deactivating someone should close their doors on the day, not a quarter
-- later.
--
-- Dates, not intervals on an instant. The window is two Dubai calendar-day
-- boundaries turned into real instants, the idiom 301_checkin_context.sql
-- sets out and for the reason its comment gives: `now() - interval '90 days'`
-- asks Postgres to do calendar arithmetic on a timestamptz, which it resolves
-- through whichever zone the *session's* TimeZone setting names, not this
-- practice's. Doing the arithmetic on a date and only then converting,
-- explicitly in Asia/Dubai, never touches the session's zone at all. The
-- comparison is still against the plain window_start column, so it stays
-- sargable against appointment_client_window_idx (200_appointment.sql).
--
-- security definer, reading straight through row level security, for the
-- reason the comment above app.client_status_for (100_client_record.sql)
-- gives and app.checkin_context (301) follows. Under the caller's own row
-- security this would have to plan appointment's scheduling_read_scope policy
-- (db/policies/scheduling/appointment_access.sql), which subqueries
-- practitioner; practitioner carries nothing but tenant isolation, so that
-- chain stops rather than cycling back and no SQLSTATE 42P17 arises today.
-- It is security definer anyway, and for the same reason checkin_context is:
-- the rule written here is then the whole rule, rather than one that quietly
-- narrows or widens if appointment's own read policy is ever changed for some
-- unrelated reason.
--
-- Because it bypasses row security, the two tenant_id predicates below are
-- the only tenant isolation on this path. Nothing else is standing behind
-- them, which is why they are asserted directly in the tests rather than
-- assumed from the policies.
create or replace function app.client_visible_to_practitioner(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  with window_dubai as (
    select
      (d.today - 90)::timestamp at time zone 'Asia/Dubai' as opens,
      (d.today + 31)::timestamp at time zone 'Asia/Dubai' as closes
    from (select (date_trunc('day', now() at time zone 'Asia/Dubai'))::date as today) as d
  )
  select exists (
    select 1
      from public.appointment a
      join public.practitioner p on p.id = a.practitioner_id
      cross join window_dubai w
     where a.client_id = p_client_id
       and a.tenant_id = app.current_tenant_id()
       and p.tenant_id = app.current_tenant_id()
       and p.user_id = app.current_actor_id()
       and p.status = 'active'
       and a.status in ('confirmed', 'checked_in', 'completed', 'no_show', 'rescheduled')
       and a.window_start >= w.opens
       and a.window_start < w.closes
  )
$$;
revoke execute on function app.client_visible_to_practitioner(uuid) from public;
grant execute on function app.client_visible_to_practitioner(uuid) to app_role;

-- rollback:
--   -- Back to the stub 100_client_record.sql created. Not a drop: six read
--   -- policies in db/policies/client/readers.sql and one write policy in
--   -- db/policies/client/writers.sql call this function by name, and the
--   -- runner re-applies both files on every migrate.
--   create or replace function app.client_visible_to_practitioner(p_client_id uuid) returns boolean
--   language sql stable
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select false
--   $$;
--   revoke execute on function app.client_visible_to_practitioner(uuid) from public;
--   grant execute on function app.client_visible_to_practitioner(uuid) to app_role;
