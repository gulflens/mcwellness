-- Who may read and write the practice's phone notifications (the push memo's
-- decisions 2 and 3; migration 707). Declarative and idempotent: the runner
-- re-applies this file on every migrate.
--
-- Two layers, as in access.sql and announcement.sql beside it.
-- `tenant_isolation` is permissive and says only "your own practice";
-- everything below is restrictive, so it narrows that and never replaces it.
--
-- The audiences:
--
--   a household adult      reads and removes their own devices and nobody
--                          else's, and adds one only for themselves — never a
--                          young person's own login (decision 3, "never to a
--                          young person's own login, whatever the kind").
--                          Adding normally goes through
--                          app.portal_subscribe_push (707), which also moves
--                          a shared device from its last owner; the insert
--                          arm below is the same rule for a direct write.
--   the owner and an admin read no device at all: the practice learns how
--                          many, through app.push_audience (707), and never
--                          an address. They send messages and read the record
--                          of every one sent, recipients included.
--
-- Nobody else. A lead practitioner, a practitioner and finance have no part
-- in what the practice sends its households.

------------------------------------------------------------------------------
-- 1. Tenant isolation, on all three.
------------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.push_subscription;
create policy tenant_isolation on public.push_subscription for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.push_message;
create policy tenant_isolation on public.push_message for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.push_recipient;
create policy tenant_isolation on public.push_recipient for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

------------------------------------------------------------------------------
-- 2. A person's own devices.
------------------------------------------------------------------------------
drop policy if exists push_subscription_own on public.push_subscription;
create policy push_subscription_own on public.push_subscription
  as restrictive for select to app_role using (
    app.actor_has_role('client_contact') and user_id = app.current_actor_id()
  );

drop policy if exists push_subscription_add_own on public.push_subscription;
create policy push_subscription_add_own on public.push_subscription
  as restrictive for insert to app_role with check (
    app.actor_has_role('client_contact')
    and app.actor_reads_announcements()
    and user_id = app.current_actor_id()
    and created_by = app.current_actor_id()
  );

drop policy if exists push_subscription_remove_own on public.push_subscription;
create policy push_subscription_remove_own on public.push_subscription
  as restrictive for delete to app_role using (
    app.actor_has_role('client_contact') and user_id = app.current_actor_id()
  );

------------------------------------------------------------------------------
-- 3. The messages: the owner and an admin, as themselves.
------------------------------------------------------------------------------
drop policy if exists push_message_readers on public.push_message;
create policy push_message_readers on public.push_message
  as restrictive for select to app_role using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
  );

drop policy if exists push_message_senders on public.push_message;
create policy push_message_senders on public.push_message
  as restrictive for insert to app_role with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin'))
    and created_by = app.current_actor_id()
    and delivered_at is null
  );

-- The delivery's outcome, once (app.guard_push_message refuses anything else).
drop policy if exists push_message_delivery on public.push_message;
create policy push_message_delivery on public.push_message
  as restrictive for update to app_role
  using (app.actor_has_role('owner') or app.actor_has_role('admin'))
  with check (app.actor_has_role('owner') or app.actor_has_role('admin'));

------------------------------------------------------------------------------
-- 4. Who each went to: written with the message, read by the same two.
------------------------------------------------------------------------------
drop policy if exists push_recipient_readers on public.push_recipient;
create policy push_recipient_readers on public.push_recipient
  as restrictive for select to app_role using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
  );

drop policy if exists push_recipient_writers on public.push_recipient;
create policy push_recipient_writers on public.push_recipient
  as restrictive for insert to app_role with check (
    (app.actor_has_role('owner') or app.actor_has_role('admin'))
    and created_by = app.current_actor_id()
  );
