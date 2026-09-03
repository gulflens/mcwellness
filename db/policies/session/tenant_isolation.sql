-- Tenant isolation on the session-capture tables (00-data-model.md section 1),
-- the same pattern core uses. Declarative and idempotent: the runner
-- re-applies this file on every migrate.

drop policy if exists tenant_isolation on public.session;
create policy tenant_isolation on public.session for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.session_event;
create policy tenant_isolation on public.session_event for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.visit_actuals;
create policy tenant_isolation on public.visit_actuals for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
