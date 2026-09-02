-- Row security for the billing catalogue: the tenant's VAT rate and its price
-- list (docs/SPEC/billing.md; domain/shared/actor.ts carries
-- billing.price.read and billing.price.write). Declarative and
-- idempotent: the runner re-applies this file on every migrate.

do $$
declare
  t text;
begin
  foreach t in array array['vat_setting', 'price'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);

    -- Restrictive, so it combines with (never replaces) tenant_isolation above.
    -- Practitioners and client contacts have no reason to see prices in v1.
    execute format('drop policy if exists catalogue_readers on public.%I', t);
    execute format(
      'create policy catalogue_readers on public.%I as restrictive for select to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''lead_practitioner'') or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- Writers differ by table (docs/SPEC/billing.md's "Who uses it": finance
-- changes the price list; the VAT rate is a practice setting, owner or admin
-- only). Restrictive, so each combines with tenant_isolation above; neither
-- table grants update to app_role at all (400_billing_catalogue.sql), so
-- there is no update case to guard here.
drop policy if exists catalogue_writers on public.price;
create policy catalogue_writers on public.price as restrictive for insert to app_role
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('finance')
  );

drop policy if exists catalogue_writers on public.vat_setting;
create policy catalogue_writers on public.vat_setting as restrictive for insert to app_role
  with check (app.actor_has_role('owner') or app.actor_has_role('admin'));
