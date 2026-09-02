-- Tenant isolation on every core table (docs/SPEC/00-data-model.md section 1).
-- Declarative and idempotent: the runner re-applies this file on every migrate.
-- app.current_tenant_id() is set per request by the middleware (PR 3); when it
-- is unset, every tenant-scoped row is invisible.

do $$
declare
  t text;
begin
  foreach t in array array['app_user', 'user_role', 'location', 'service_type', 'practitioner',
                           'credential', 'client', 'contact', 'consent', 'document'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;

-- The tenant row itself is its own tenant.
drop policy if exists tenant_isolation on public.tenant;
create policy tenant_isolation on public.tenant for all to app_role
  using (id = app.current_tenant_id())
  with check (id = app.current_tenant_id());
