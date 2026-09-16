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

-- A visit logged from the practice's records (migration 966) is the office's
-- to write: `recorded_from = 'records'` is what admits `settled_outside_app`,
-- the no-charge path, so a practitioner's own-row scope above must not reach
-- it. The route already holds this line (app/api/sessions/from-records.ts);
-- this is the database saying the same, so a row that bypassed the route
-- could not claim it either.
drop policy if exists records_are_the_office on public.session;
create policy records_are_the_office on public.session as restrictive for insert to app_role
  with check (
    recorded_from = 'device'
    or app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
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

-- visit_actuals reaches its practitioner through the session it belongs to:
-- the row carries no practitioner_id of its own (it is a fact about one
-- visit, and the visit already names who ran it), so the scope is read from
-- the parent. Same three oversight roles, same own-row rule.
drop policy if exists practitioner_scope on public.visit_actuals;
create policy practitioner_scope on public.visit_actuals as restrictive for all to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or exists (
      select 1 from public.session s
       where s.id = visit_actuals.session_id
         and s.tenant_id = app.current_tenant_id()
         and s.practitioner_id in (
           select id from public.practitioner
            where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
              and tenant_id = app.current_tenant_id()
         )
    )
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or exists (
      select 1 from public.session s
       where s.id = visit_actuals.session_id
         and s.tenant_id = app.current_tenant_id()
         and s.practitioner_id in (
           select id from public.practitioner
            where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
              and tenant_id = app.current_tenant_id()
         )
    )
  );
