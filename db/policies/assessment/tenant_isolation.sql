-- Tenant isolation on the assessment tables (docs/SPEC/00-data-model.md
-- section 1), the same pattern core uses. Declarative and idempotent: the
-- runner re-applies this file on every db:migrate.

drop policy if exists tenant_isolation on public.assessment;
create policy tenant_isolation on public.assessment for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_isolation on public.assessment_document;
create policy tenant_isolation on public.assessment_document for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
