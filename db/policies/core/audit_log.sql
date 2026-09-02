-- Who may read and write the audit log through the API role.
-- Reads are tenant-scoped. Inserts are the application's own read logging
-- (audit.md section 5, layer 2, PR 3); the chain trigger stamps every row.
-- Rows with a null tenant_id (system actions) are visible to the owner only.

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to app_role
  using (tenant_id = app.current_tenant_id());

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to app_role
  with check (tenant_id = app.current_tenant_id());
