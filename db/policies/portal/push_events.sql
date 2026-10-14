-- Who may read and write the event notifications' two tables (migration 708).
-- Declarative and idempotent: the runner re-applies this file on every
-- migrate.
--
-- Two layers, as in push.sql beside it. `tenant_isolation` is permissive and
-- says only "your own practice"; everything below is restrictive, so it
-- narrows that and never replaces it.
--
--   a member of staff who    reads and removes their own browsers and nobody
--   can see Enquiries        else's, and adds one only for themselves —
--                            normally through app.staff_subscribe_push (708),
--                            which also moves a shared browser from its last
--                            owner; the insert arm below is the same rule for
--                            a direct write.
--   the owner and an admin   read the record of every event notified; the
--                            delivery, stamped `admin` with no actor, writes
--                            it once and its outcome once. Nobody reads a
--                            colleague's browser: the delivery reaches the
--                            addresses through app.push_event_staff_targets.
--
-- Nobody else. A household adult's own devices are push.sql's.

------------------------------------------------------------------------------
-- 1. Tenant isolation, on both.
------------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.push_event;
create policy tenant_isolation on public.push_event for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.staff_push_subscription;
create policy tenant_isolation on public.staff_push_subscription for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

------------------------------------------------------------------------------
-- 2. A member of staff's own browsers.
------------------------------------------------------------------------------
drop policy if exists staff_push_subscription_own on public.staff_push_subscription;
create policy staff_push_subscription_own on public.staff_push_subscription
  as restrictive for select to app_role using (
    user_id = app.current_actor_id()
  );

drop policy if exists staff_push_subscription_add_own on public.staff_push_subscription;
create policy staff_push_subscription_add_own on public.staff_push_subscription
  as restrictive for insert to app_role with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin')
     or app.actor_has_role('lead_practitioner'))
    and user_id = app.current_actor_id()
    and created_by = app.current_actor_id()
  );

drop policy if exists staff_push_subscription_remove_own on public.staff_push_subscription;
create policy staff_push_subscription_remove_own on public.staff_push_subscription
  as restrictive for delete to app_role using (
    user_id = app.current_actor_id()
  );

------------------------------------------------------------------------------
-- 3. The record of events: the owner and an admin.
------------------------------------------------------------------------------
drop policy if exists push_event_readers on public.push_event;
create policy push_event_readers on public.push_event
  as restrictive for select to app_role using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
  );

drop policy if exists push_event_writers on public.push_event;
create policy push_event_writers on public.push_event
  as restrictive for insert to app_role with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin'))
    and created_by is not distinct from app.current_actor_id()
    and delivered_at is null
  );

-- The delivery's outcome, once (app.guard_push_event refuses anything else).
drop policy if exists push_event_delivery on public.push_event;
create policy push_event_delivery on public.push_event
  as restrictive for update to app_role
  using (app.actor_has_role('owner') or app.actor_has_role('admin'))
  with check (app.actor_has_role('owner') or app.actor_has_role('admin'));
