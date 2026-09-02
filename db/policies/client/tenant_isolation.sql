-- Tenant isolation for the client-record worktree's own tables
-- (docs/SPEC/00-data-model.md section 1). Declarative and idempotent: the
-- runner re-applies this file on every migrate. Mirrors
-- db/policies/core/tenant_isolation.sql, which already covers client,
-- contact, location, consent and document; this file covers the three
-- tables 100_client_record.sql adds.

do $$
declare
  t text;
begin
  foreach t in array array['goal_category', 'goal', 'erasure_request'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;
