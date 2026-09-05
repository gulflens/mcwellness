-- Who may read and who may fill the drive cache
-- (db/migrations/204_drive_estimate.sql, docs/SPEC/practitioner-phone.md
-- section 8). Declarative and idempotent: the runner re-applies this file on
-- every migrate.

-- Tenant isolation, as every table in this schema carries it
-- (docs/SPEC/00-data-model.md section 1). Core's own tenant_isolation.sql
-- loops over the tables core created; this is a stream's table, so the stream
-- carries the policy for it.
drop policy if exists tenant_isolation on public.drive_estimate;
create policy tenant_isolation on public.drive_estimate for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- Reading is the four office roles and a practitioner. A row is two location
-- ids, an hour and a duration — it names nobody — and the person who most
-- needs it is the one driving. Finance is included for the same reason it
-- reads the price list: a drive is a cost of delivering a visit, and the
-- contribution margin is theirs to work out.
--
-- A client contact is refused: a household has no business reading how long
-- the practice thinks it takes to get from one address to another, and the
-- set of pairs in this table is itself a shape of the practice's day.
drop policy if exists drive_estimate_read on public.drive_estimate;
create policy drive_estimate_read on public.drive_estimate as restrictive for select to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('finance')
    or app.actor_has_role('practitioner')
  );

-- Filling it is the same audience minus finance, because the only thing that
-- writes here is the routing route serving a practitioner's own day
-- (app/api/routing/day.ts), which runs as whoever opened the day sheet. A
-- coordinator opening the console's own schedule is one of those people too.
--
-- Insert and update, never delete: 204 grants app_role no delete at all, so
-- there is no policy to write for it. A stale row is overwritten in place by
-- the next ask for that pair and hour, which is what the unique key on
-- (tenant_id, from, to, hour) is for.
drop policy if exists drive_estimate_write on public.drive_estimate;
create policy drive_estimate_write on public.drive_estimate as restrictive for insert to app_role
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('practitioner')
  );

drop policy if exists drive_estimate_refresh on public.drive_estimate;
create policy drive_estimate_refresh on public.drive_estimate as restrictive for update to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('practitioner')
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('practitioner')
  );
