-- Tenant isolation on appointment (docs/SPEC/00-data-model.md section 1).
-- Core's tenant_isolation.sql loops over the tables it created; appointment is
-- this stream's own table, so this stream carries the same policy for it.
-- Declarative and idempotent: the runner re-applies this file on every migrate.

drop policy if exists tenant_isolation on public.appointment;
create policy tenant_isolation on public.appointment for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
