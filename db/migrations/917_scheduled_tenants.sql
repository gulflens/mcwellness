-- 917_scheduled_tenants.sql
-- Needs: 000 (app_role), 010 (tenant), 090 (app_role's usage on public)
--
-- The in-process scheduler (app/api/scheduler.ts, trunk round 39, 2026-09-10)
-- runs the two jobs that until now needed the owner's connection and a cron
-- entry the host never had: the nightly posting of the books
-- (jobs/accounting/post-books.ts) and the hourly sweep of erasure files
-- (jobs/client/retry-erasure-deletions.ts). It runs as the API role, which
-- sees a practice only once app.tenant_id is set — and cannot list the
-- practices in order to set it. This definer answers the ids and nothing
-- else, so the scheduler can stamp each practice's context exactly as a
-- request does and let row security govern everything that follows.
--
-- Trunk core range (900–949): it reads a core table and builds on no stream's.
create function app.scheduled_tenants() returns setof uuid
language sql security definer stable
set search_path = pg_catalog, pg_temp
as $$
  select id from public.tenant order by created_at, id
$$;
revoke execute on function app.scheduled_tenants() from public;
grant execute on function app.scheduled_tenants() to app_role;

-- rollback:
--   drop function if exists app.scheduled_tenants();
