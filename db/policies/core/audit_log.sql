-- Who may read and write the audit log through the API role.
-- Reads are tenant-scoped. Inserts are the application's own read logging
-- (audit.md section 5, layer 2, PR 3); the chain trigger stamps every row.
-- Every row carries a tenant_id, so the API role sees exactly its own tenant's
-- trail; the table owner bypasses RLS and sees all of it.

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to app_role
  using (tenant_id = app.current_tenant_id());

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to app_role
  with check (tenant_id = app.current_tenant_id());
