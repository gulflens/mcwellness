-- The practice's enquiries are the practice's (db/migrations/916_enquiry.sql).
drop policy if exists tenant_isolation on public.enquiry;
create policy tenant_isolation on public.enquiry for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
