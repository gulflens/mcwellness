-- Who sees and writes a visit record: the oversight roles see and write
-- every session in the tenant; a practitioner is scoped to sessions
-- assigned to their own practitioner row. Restrictive, so it narrows
-- (never replaces) the permissive tenant_isolation policy above — the same
-- layering db/policies/core uses. Declarative and idempotent.

drop policy if exists practitioner_scope on public.session;
create policy practitioner_scope on public.session as restrictive for all to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or practitioner_id in (
      select id from public.practitioner
       where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
         and tenant_id = app.current_tenant_id()
    )
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or practitioner_id in (
      select id from public.practitioner
       where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
         and tenant_id = app.current_tenant_id()
    )
  );

drop policy if exists practitioner_scope on public.session_event;
create policy practitioner_scope on public.session_event as restrictive for all to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or practitioner_id in (
      select id from public.practitioner
       where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
         and tenant_id = app.current_tenant_id()
    )
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or practitioner_id in (
      select id from public.practitioner
       where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
         and tenant_id = app.current_tenant_id()
    )
  );
