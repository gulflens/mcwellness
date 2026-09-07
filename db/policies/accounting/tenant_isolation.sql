-- Tenant isolation for the books' five tables, in the shape
-- db/policies/billing/ledger.sql section 1 uses: permissive, and saying only
-- "your own practice". Every rule about who may read or write is restrictive
-- and lives beside this file in access.sql, so it narrows this and never
-- replaces it. Declarative and idempotent: the runner re-applies this file
-- after every migration on every database.
--
-- **Why each table is guarded with to_regclass.** The runner applies every
-- policy file after every migrate, including on a database that has run 450
-- and 451 but not yet 452 and 453 — which is exactly what happens while this
-- piece is being built, and what happens to anybody bisecting the migrations.
-- A policy on a table that does not exist yet is a hard error, so each table
-- is skipped when it is absent, the way migration 956's own check does.
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounting_setting', 'account', 'fiscal_year', 'journal_entry', 'journal_line'
  ] loop
    continue when to_regclass('public.' || quote_ident(t)) is null;
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;
