-- 212_live_location_floor.sql
-- Fix round 1 of piece twenty-five (docs/SPEC/dispatch.md section 15.10):
-- the database floor under live location, tightened where the review of 6
-- October 2026 found it trusting the writer.
--
-- 1. **`recorded_at` is the server's.** The API's role holds insert on every
--    column of `practitioner_position`, so a writer could stamp a position in
--    the past (rewriting history) or in the future (escaping the two-day
--    delete and showing as "latest" indefinitely). A row written by the API's
--    role (`app_role`) now takes `now()`, whatever it sent. The table's owner
--    — a restore from a dump, a data step — keeps what it writes.
-- 2. **The purge also deletes any position stamped in the future**, so no row
--    can outlive the two days by its stamp, however it got there.
-- 3. **A consent counts only for the notice in force.** `staff_consent` names
--    the notice version a person agreed to; a consent to an earlier version
--    no longer makes `app.location_sharing_active` true, so a stale consent
--    neither writes a position nor shows the last one on the board.
--    `app.staff_location_notice_version()` is the database's copy of
--    `STAFF_LOCATION_NOTICE_VERSION` (domain/scheduling/locationSharing.ts),
--    and tests/dispatch/db/location.test.ts holds the two equal; a new notice
--    is a new migration replacing this function.
--
-- **Why the shift is checked in the route and not here.** What a shift is —
-- the visits that make one, the lead-in, the tail, the latest hour — is a
-- business rule, and rule 4 keeps those in domain/ as pure functions. Writing
-- it again in SQL would be a second copy free to drift from the first. The
-- route asks the domain rule for every position, and row security below it
-- still refuses anybody without a standing consent to the current notice and
-- their own switch on.
--
-- Needs: 211 (the tables and the functions replaced here)

create function app.staff_location_notice_version() returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$ select '1.1'::text $$;
revoke execute on function app.staff_location_notice_version() from public;
grant execute on function app.staff_location_notice_version() to app_role;

create or replace function app.location_sharing_active(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
      select 1 from public.staff_consent c
       where c.user_id = p_user_id
         and c.tenant_id = app.current_tenant_id()
         and c.purpose = 'location_sharing'::public.staff_consent_purpose
         and c.withdrawn_at is null
         and c.notice_version = app.staff_location_notice_version())
     and exists (
      select 1 from public.location_sharing s
       where s.user_id = p_user_id
         and s.tenant_id = app.current_tenant_id()
         and s.sharing_on)
$$;

create function app.stamp_position_recorded_at() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user = 'app_role' then
    new.recorded_at := now();
  end if;
  return new;
end
$$;
create trigger stamp_recorded_at before insert on public.practitioner_position
  for each row execute function app.stamp_position_recorded_at();

create or replace function app.purge_practitioner_positions(p_before timestamptz) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'only the office deletes positions'
      using errcode = 'insufficient_privilege';
  end if;
  if p_before is null or p_before > now() then
    raise exception 'a cutoff is in the past'
      using errcode = 'check_violation';
  end if;
  delete from public.practitioner_position
   where tenant_id = app.current_tenant_id()
     and (recorded_at < p_before or recorded_at > now() + interval '1 minute');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- rollback:
--   create or replace function app.purge_practitioner_positions(timestamptz) ... as in 211;
--   drop trigger if exists stamp_recorded_at on public.practitioner_position;
--   drop function if exists app.stamp_position_recorded_at();
--   create or replace function app.location_sharing_active(uuid) ... as in 211;
--   drop function if exists app.staff_location_notice_version();
