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
-- The rule: the acting practitioner holds an appointment with this client,
-- that appointment is not a cancellation, and its window starts within the
-- last 90 days or the next 30. Wide enough to cover a session just
-- delivered and the run-up to one about to happen; not wide enough to leave
-- a record open to someone who saw that client once, years ago, and never
-- since.
--
-- "Not a cancellation" is both cancelled statuses, not only the plain one:
-- a visit called off, late or otherwise, is a visit that never happened and
-- a client no longer on that practitioner's schedule, which is exactly what
-- section 11 turns away. A no-show is different — the practitioner was
-- genuinely sent to that door — and a 'rescheduled' row records a visit
-- that was really theirs before it moved, so neither is excluded here.
--
-- security definer, reading straight through row level security, for the
-- reason the comment above app.client_status_for (100_client_record.sql)
-- gives and app.checkin_context (301_checkin_context.sql) follows. This
-- function is called from the restrictive read policies on client, contact,
-- location, consent, document and goal (db/policies/client/readers.sql).
-- Under the caller's own row security it would instead have to plan
-- appointment's scheduling_read_scope policy
-- (db/policies/scheduling/appointment_access.sql), which subqueries
-- practitioner; practitioner carries nothing but tenant isolation, so that
-- chain stops rather than cycling back and no SQLSTATE 42P17 arises today.
-- It is security definer anyway, and for the same reason checkin_context
-- is: the window and status rule written here is then the whole rule,
-- rather than one that quietly narrows or widens if appointment's own read
-- policy is ever changed for some unrelated reason.
create or replace function app.client_visible_to_practitioner(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.appointment a
      join public.practitioner p on p.id = a.practitioner_id
     where a.client_id = p_client_id
       and a.tenant_id = app.current_tenant_id()
       and p.tenant_id = app.current_tenant_id()
       and p.user_id = app.current_actor_id()
       and a.status not in ('cancelled', 'cancelled_late')
       and a.window_start >= now() - interval '90 days'
       and a.window_start <= now() + interval '30 days'
  )
$$;
revoke execute on function app.client_visible_to_practitioner(uuid) from public;
grant execute on function app.client_visible_to_practitioner(uuid) to app_role;

-- rollback:
--   -- Back to the stub 100_client_record.sql created. Not a drop: every
--   -- restrictive read policy in db/policies/client/readers.sql calls this
--   -- function by name, and the runner re-applies that file on every migrate.
--   create or replace function app.client_visible_to_practitioner(p_client_id uuid) returns boolean
--   language sql stable
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select false
--   $$;
--   revoke execute on function app.client_visible_to_practitioner(uuid) from public;
--   grant execute on function app.client_visible_to_practitioner(uuid) to app_role;
