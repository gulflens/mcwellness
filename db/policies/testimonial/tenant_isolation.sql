-- The practice's reviews are the practice's (db/migrations/978_testimonial.sql).
drop policy if exists tenant_isolation on public.testimonial;
create policy tenant_isolation on public.testimonial for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
