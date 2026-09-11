-- Row security for the money: bundles, purchases, credits, invoices,
-- payments and the exception queue (docs/SPEC/billing.md's "Who uses it",
-- and 00-data-model.md section 6). Declarative and idempotent: the runner
-- re-applies this file on every migrate.
--
-- Two layers, as everywhere else in this repository. `tenant_isolation` is
-- permissive and says only "your own practice"; every rule below is
-- restrictive, so it narrows that and never replaces it. The catalogue's own
-- policies live beside this file in catalogue.sql.
--
-- The audiences, from billing.md's table and the founder's own arrangement:
--
--   owner, admin, finance     the whole of it, read and write
--   lead practitioner         reads it; records nothing
--   practitioner              reads the balance of a client on their own
--                             schedule, and nothing else — a stop card says
--                             "Session 3 of 15" and shows what is owed at the
--                             door, which is the whole of what the person
--                             driving there needs
--   client contact            their own client's, read-only
--
-- A practitioner's reach goes through app.client_visible_to_practitioner
-- (201_client_visible_to_practitioner.sql): ninety days back, thirty
-- forward, confirmed visits only. A client contact's goes through
-- app.actor_is_contact_of (100_client_record.sql). Neither is restated here;
-- both are asked.
--
-- Erasure. Every client-scoped table below passes its client's status
-- through app.client_erasure_gate, exactly as db/policies/client/readers.sql
-- does, so an erased record's money is visible only to the owner and the
-- lead practitioner. Financial records outlive an erasure (CLAUDE.md rule 8:
-- five years regardless), which is precisely why they must not stay open to
-- everyone after it.

------------------------------------------------------------------------------
-- 1. Tenant isolation on every new table.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'package', 'package_component', 'package_price', 'package_purchase',
    'entitlement', 'invoice', 'invoice_line', 'payment', 'billing_exception'
  ] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;

------------------------------------------------------------------------------
-- 2. The bundle catalogue. The same audience the price list has
--    (catalogue.sql): the four office roles read it, three of them write it.
--    A practitioner and a client contact see no catalogue in v1 — a price
--    list is a sales instrument, and neither of them sells.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['package', 'package_component', 'package_price'] loop
    execute format('drop policy if exists catalogue_readers on public.%I', t);
    execute format(
      'create policy catalogue_readers on public.%I as restrictive for select to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''lead_practitioner'') or app.actor_has_role(''finance''))', t);

    execute format('drop policy if exists catalogue_writers on public.%I', t);
    execute format(
      'create policy catalogue_writers on public.%I as restrictive for insert to app_role '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- package and package_component may also be amended (a bundle is withdrawn by
-- status, a line corrected before the bundle has ever been sold); package_price
-- may not, and is not granted update at all (401).
do $$
declare
  t text;
begin
  foreach t in array array['package', 'package_component'] loop
    execute format('drop policy if exists catalogue_amenders on public.%I', t);
    execute format(
      'create policy catalogue_amenders on public.%I as restrictive for update to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance'')) '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

drop policy if exists catalogue_deleters on public.package_component;
create policy catalogue_deleters on public.package_component as restrictive for delete to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('finance')
  );

------------------------------------------------------------------------------
-- 3. A client's own money: purchases, credits, invoices, lines, payments.
--    Read by the four office roles; by a practitioner within their schedule;
--    by a client contact for their own client.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'package_purchase', 'entitlement', 'invoice', 'invoice_line', 'payment'
  ] loop
    execute format('drop policy if exists ledger_readers on public.%I', t);
    execute format(
      'create policy ledger_readers on public.%I as restrictive for select to app_role using ('
      '  app.client_erasure_gate(app.client_status_for(client_id)) and ('
      '    app.actor_has_role(''owner'') or app.actor_has_role(''admin'')'
      '    or app.actor_has_role(''lead_practitioner'') or app.actor_has_role(''finance'')'
      '    or (app.actor_has_role(''practitioner'') and app.client_visible_to_practitioner(client_id))'
      '    or (app.actor_has_role(''client_contact'') and app.actor_is_contact_of(client_id))'
      '  )'
      ')', t);

    -- Recording money is the owner's, an admin's and finance's alone. The
    -- lead practitioner reads the ledger and writes nothing to it; a
    -- practitioner and a client contact neither.
    --
    -- Nothing here contradicts the consumption triggers
    -- (404_billing_consumption.sql): those run security definer as the table
    -- owner, so a practitioner closing a visit never writes an entitlement
    -- row under their own privileges — the practice writes it.
    execute format('drop policy if exists ledger_writers on public.%I', t);
    execute format(
      'create policy ledger_writers on public.%I as restrictive for insert to app_role '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- Only package_purchase and entitlement are granted update at all (403):
-- a purchase is extended, a credit is consumed, waived or refunded. Invoices,
-- lines and payments are append-only by construction and have no update case
-- to guard.
do $$
declare
  t text;
begin
  foreach t in array array['package_purchase', 'entitlement'] loop
    execute format('drop policy if exists ledger_amenders on public.%I', t);
    execute format(
      'create policy ledger_amenders on public.%I as restrictive for update to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance'')) '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      'or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- `package_extension` (410) had its three policies here until migration 964
-- dropped the table with the rest of the extension machinery: a programme's
-- term is optional from 2026-09-12, and a programme with no term has nothing
-- to extend. This file is re-applied on every migrate, so the blocks had to go
-- in the same pull request as the migration or the policy pass would fail on a
-- table that is no longer there.

------------------------------------------------------------------------------
-- 4. The exception queue. An office matter: something the practice owes an
--    answer on, not something a client or the practitioner at the door is
--    shown.
------------------------------------------------------------------------------
drop policy if exists exception_readers on public.billing_exception;
create policy exception_readers on public.billing_exception
  as restrictive for select to app_role using (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner') or app.actor_has_role('finance')
    )
  );

drop policy if exists exception_writers on public.billing_exception;
create policy exception_writers on public.billing_exception
  as restrictive for insert to app_role with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('finance')
  );

drop policy if exists exception_resolvers on public.billing_exception;
create policy exception_resolvers on public.billing_exception
  as restrictive for update to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('finance')
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('finance')
  );

------------------------------------------------------------------------------
-- 5. The receipt counter (405_billing_receipt.sql). Moved only through
--    app.next_receipt_number(), which is security definer, so app_role is
--    granted nothing on the table at all — not even select, so nobody can
--    read or set another practice's next number. Row security is enabled all
--    the same, so a future grant cannot quietly open it.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.payment_receipt_series enable row level security;
  revoke all on public.payment_receipt_series from public;
  if has_api_roles then
    revoke all on public.payment_receipt_series from anon, authenticated;
  end if;
end
$$;

drop policy if exists tenant_isolation on public.payment_receipt_series;
create policy tenant_isolation on public.payment_receipt_series for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

------------------------------------------------------------------------------
-- 6. Rendered invoices and receipts (407_billing_rendered_document.sql).
--
--    The same audience as the invoice book itself: whoever may read what the
--    document says may see that it exists. The bytes are a separate question —
--    `document`'s own read policy (db/policies/client/readers.sql) decides who
--    may be handed a signed link, and it is narrower: finance may read the
--    ledger but not a client's filing, so a coordinator who records money sees
--    the receipt row and the route refuses them the link.
--
--    Insert is granted to nobody. A row arrives only through
--    app.file_billing_document, which is security definer and writes as the
--    practice, and nothing ever updates or deletes one.
------------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.billing_document;
create policy tenant_isolation on public.billing_document for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists ledger_readers on public.billing_document;
create policy ledger_readers on public.billing_document
  as restrictive for select to app_role using (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner') or app.actor_has_role('finance')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
      or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
    )
  );
