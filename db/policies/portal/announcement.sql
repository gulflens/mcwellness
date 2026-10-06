-- Who may read and write the practice's announcements
-- (docs/SPEC/client-portal.md section 6.5 as amended 2026-10-06; migration
-- 705). Declarative and idempotent: the runner re-applies this file on every
-- migrate.
--
-- Two layers, as in access.sql beside it. `tenant_isolation` is permissive and
-- says only "your own practice"; everything below is restrictive, so it
-- narrows that and never replaces it.
--
-- The audiences:
--
--   the owner and an admin   read every announcement, publish one, and
--                            withdraw one. The push memo's decision 3:
--                            "written by you or an admin, in Settings".
--   a household              reads the current ones and nothing else: not a
--                            withdrawn one, not one whose first day has not
--                            come or whose last day has gone, and none at all
--                            for a young person's own login (decision 3,
--                            "never to a young person's own login, whatever
--                            the kind"). app.announcement_is_current and
--                            app.actor_reads_announcements (705) decide both,
--                            and domain/portal/announcements.ts asks the same
--                            questions of the same rows before the route
--                            answers.
--
-- Nobody else. The lead practitioner, a practitioner and finance have no use
-- for the practice's news to its households as staff; a member of staff who
-- is also a household contact reads it as that household does, through the
-- household arm, because one person is several things at once
-- (docs/SPEC/00-data-model.md section 2).
--
-- What a withdrawal may change is app.guard_announcement's (705): the two
-- withdrawal columns, once. Delete is granted to nobody.

------------------------------------------------------------------------------
-- 1. Tenant isolation.
------------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.announcement;
create policy tenant_isolation on public.announcement for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

------------------------------------------------------------------------------
-- 2. Reading.
------------------------------------------------------------------------------
drop policy if exists announcement_readers on public.announcement;
create policy announcement_readers on public.announcement
  as restrictive for select to app_role using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or (
      app.actor_has_role('client_contact')
      and app.actor_reads_announcements()
      and app.announcement_is_current(created_at, withdrawn_at, visible_from, visible_until)
    )
  );

------------------------------------------------------------------------------
-- 3. Publishing — the owner and an admin, as themselves.
--
--    The row names who published it, and the trail attributes it to that
--    person, so `created_by` has to be the person signed in; and a row is born
--    standing, never already withdrawn.
------------------------------------------------------------------------------
drop policy if exists announcement_writers on public.announcement;
create policy announcement_writers on public.announcement
  as restrictive for insert to app_role with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin'))
    and created_by = app.current_actor_id()
    and withdrawn_at is null
  );

------------------------------------------------------------------------------
-- 4. Withdrawing — the owner and an admin, as themselves.
------------------------------------------------------------------------------
drop policy if exists announcement_withdrawers on public.announcement;
create policy announcement_withdrawers on public.announcement
  as restrictive for update to app_role
  using (app.actor_has_role('owner') or app.actor_has_role('admin'))
  with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin'))
    and withdrawn_by = app.current_actor_id()
  );
