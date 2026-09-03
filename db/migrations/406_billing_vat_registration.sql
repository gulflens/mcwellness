-- 406_billing_vat_registration.sql
-- VAT is charged because the practice is registered for it, and for no other
-- reason.
--
-- **The defect this closes.** Migration 905 gave `tenant` a `vat_registered`
-- switch and snapshotted it onto every invoice, and said plainly that nothing
-- charged from it: `app.charge_single_visit` (404) and the package-sale path
-- wrote VAT on every sale whatever the practice was registered for. McWellness
-- is **not** registered for VAT — the AED 375,000 threshold has not been
-- crossed, and the number it does hold is a corporate-tax registration
-- (docs/SPEC/billing.md section 5.1, `tenant.trn`'s own column comment) — so
-- every invoice the platform issued charged five per cent it had no right to
-- charge, under no registration it could name. This is request 1 of round 20 in
-- docs/CHANGE-REQUESTS/trunk-notes.md.
--
-- **What follows the switch and what does not.** The price list keeps its
-- stamped `vat_rate_basis_points` and `vat_setting_version`: those record what
-- the standard rate *was* on the day a price was written, so a registration
-- granted next year makes them live without a data migration. What follows the
-- registration is the money — `invoice.vat_fils`, `invoice_line.vat_fils` — and
-- the rate stamped on the invoice line, which is what a rendered document
-- reads. Prices stay net either way, so an unregistered practice's gross is its
-- net and a family pays the figure the price list showed them.
--
-- `vat_setting_version` on the line is kept even at a zero rate, and
-- deliberately: it is a foreign key to the setting that was consulted, not a
-- claim about what was charged. Which setting was in force is worth knowing on
-- the day the registration arrives and somebody asks what the rate would have
-- been.
--
-- **Why the rule is a trigger here and not the check constraint round 20 asked
-- for.** Request 1b names one line to add in this same commit:
--
--     alter table invoice add constraint invoice_no_vat_unless_supplier_registered
--       check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0);
--
-- It cannot be added from this file, and the reason is the numbering rather
-- than the rule. Migrations apply in numeric order (db/runner/plan.ts), and
-- `supplier_vat_registered` arrives in the trunk's **905**. Billing's range is
-- 400–499, so this file runs *before* that column exists on a fresh database,
-- and `checkNeeds` refuses a "-- Needs:" naming a higher number for exactly
-- that reason. The trunk's own continuation range sorts after every stream's,
-- so no stream can ever build a table-level constraint on a 9xx column; this is
-- the first place it bites and it is written up in
-- docs/CHANGE-REQUESTS/billing-04.md with the one line to add and where.
--
-- What lands instead is the same rule at the same moment, enforced by
-- before-insert triggers: a plpgsql body names `new.supplier_vat_registered` at
-- execution, not at creation, so it is written now and holds from the moment
-- 905 has run. `app.stamp_invoice_supplier` already sets this precedent — it
-- restates 905's two check constraints inside the trigger so a caller gets a
-- sentence rather than a constraint name — and `invoice` grants neither update
-- nor delete (402), so an insert is the only way a row can ever arrive.
--
-- **Two things the check constraint would have covered that a first draft of
-- the guard did not** (both found in review, both closed below):
--
--   * A null `supplier_vat_registered` was read as "says nothing" and let
--     through. That is right for an invoice issued before 905 — there were
--     none, but the reading is right — and wrong for one being inserted now,
--     because `app.stamp_invoice_supplier` returns early when a caller supplies
--     `supplier_legal_name`, leaving every other supplier column exactly as the
--     caller left it. So a hand-written insert naming its own supplier could
--     carry VAT under no registration at all. The guard now falls back to the
--     practice's own registration when the column says nothing.
--   * Nothing tied an **invoice line's** rate to its header. The totals could be
--     zero and honest while every line beneath them printed five per cent, which
--     is what the rendered document reads. `app.guard_invoice_line_vat` closes
--     it against the same question.
--
-- The guarantee is therefore the one request 1b asked for: **no invoice and no
-- invoice line can carry VAT for a practice that was not registered when it was
-- numbered.** The constraint should still be added when the trunk can add it:
-- belt and braces on a rule that is a false statement to the Federal Tax
-- Authority if it ever fails.
--
-- **Date of supply.** Round 20's second request. A UAE tax invoice states the
-- date of supply as well as the date of issue. For a visit charged on the day
-- they are the same and `issued_on` carries both; for a package sold in January
-- and delivered through May, and for anything invoiced after the fact, they are
-- not. One nullable column, written only when it differs — held to that by a
-- check constraint, so null always means "the same day" and never "nobody
-- filled it in". `invoice` is this stream's own table (402), so this column and
-- its constraint are ours to add.
--
-- **The recipient is deliberately not snapshotted.** The practice bills
-- households, who are private individuals and not registered persons, so what
-- it issues is a *simplified* tax invoice, which need not carry the recipient's
-- name and address. The rendered document says so on its own face rather than
-- leaving a reader to infer it. That is round 20's remaining note, recorded as
-- a change to docs/SPEC/billing.md in docs/CHANGE-REQUESTS/billing-04.md, which
-- this worktree does not own.
--
-- Needs: 010 (tenant), 400 (price, vat_setting), 402 (invoice, invoice_line,
-- app.next_invoice_number), 403 (entitlement), 404 (app.charge_single_visit,
-- replaced here).

------------------------------------------------------------------------------
-- 1. Date of supply, where it differs from the date of issue.
------------------------------------------------------------------------------
alter table invoice add column supplied_on date;

comment on column public.invoice.supplied_on is
  'The date of supply, written only when it differs from issued_on and null when it does '
  'not — so null means "supplied on the day it was issued", never "unknown". A UAE tax '
  'invoice states both (docs/CHANGE-REQUESTS/trunk-notes.md, round 20).';

alter table invoice add constraint invoice_supplied_on_differs
  check (supplied_on is null or supplied_on <> issued_on);

------------------------------------------------------------------------------
-- 2. Whether the practice charges VAT at all: one question, one answer.
--
--    plpgsql rather than sql, and that is not a style choice: a `language sql`
--    body is parsed and its columns resolved when the function is created, and
--    `tenant.vat_registered` does not exist yet on a fresh database at this
--    point in the run (see the header). A plpgsql body is resolved when it is
--    called, by which time 905 has been applied.
--
--    security definer for the reason app.next_invoice_number() is: the
--    practitioner closing a visit holds no billing role, and this reads the
--    practice's own row on their behalf. It answers false for a practice that
--    is not there, which is the safe way round — an invoice with no VAT is a
--    smaller wrong than an invoice charging tax under no registration.
------------------------------------------------------------------------------
create function app.tenant_charges_vat(p_tenant_id uuid) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_registered boolean;
begin
  select t.vat_registered into v_registered from public.tenant t where t.id = p_tenant_id;
  return coalesce(v_registered, false);
end
$$;
revoke execute on function app.tenant_charges_vat(uuid) from public;
grant execute on function app.tenant_charges_vat(uuid) to app_role;

comment on function app.tenant_charges_vat(uuid) is
  'Whether this practice is registered for VAT. The one question the charge paths ask; '
  'the invoice snapshots the answer (migration 905) and a rendered document reads that '
  'snapshot, never this.';

------------------------------------------------------------------------------
-- 3. The rule request 1b asked for, as a guard rather than a constraint.
--
--    Before insert, after app.stamp_invoice_supplier has filled the snapshot:
--    triggers of the same event fire in name order, and `stamp_supplier` sorts
--    before `zz_guard_invoice_vat`, which is why the guard carries that prefix
--    rather than a tidier name. It must see the stamped value, not the null a
--    caller passed in.
------------------------------------------------------------------------------
create function app.guard_invoice_vat() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- A null here is not "says nothing" at insert time. The stamp returns early
  -- when a caller supplies its own supplier_legal_name, so null is exactly what
  -- an insert that named its own supplier and skipped the registration leaves
  -- behind — and reading that as permission is how VAT gets onto an invoice
  -- from a practice that holds no registration. The practice's own answer is
  -- the fallback, which is what the stamp would have written.
  if not coalesce(new.supplier_vat_registered, app.tenant_charges_vat(new.tenant_id))
     and new.vat_fils <> 0 then
    raise exception 'an invoice cannot carry VAT for a practice that is not registered for it'
      using errcode = 'check_violation',
            hint    = 'Prices are net and VAT is added only while tenant.vat_registered is true '
                      '(migration 406). Leave vat_fils at zero.';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_invoice_vat() from public;
create trigger zz_guard_invoice_vat before insert on public.invoice
  for each row execute function app.guard_invoice_vat();
alter table public.invoice enable always trigger zz_guard_invoice_vat;

-- The same question, asked of a line. Nothing tied a line's rate to its
-- header: an invoice could total zero VAT honestly while every line under it
-- printed five per cent, and the rendered document reads the lines. The header
-- is read rather than trusted from the line, and its null is resolved the same
-- way.
create function app.guard_invoice_line_vat() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_registered boolean;
begin
  select coalesce(i.supplier_vat_registered, app.tenant_charges_vat(i.tenant_id))
    into v_registered
    from public.invoice i
   where i.id = new.invoice_id and i.tenant_id = new.tenant_id;

  if not coalesce(v_registered, false)
     and (new.vat_fils <> 0 or new.vat_rate_basis_points <> 0) then
    raise exception 'an invoice line cannot carry VAT for a practice that is not registered for it'
      using errcode = 'check_violation',
            hint    = 'The line''s rate is what the rendered document prints. Leave '
                      'vat_rate_basis_points and vat_fils at zero (migration 406).';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_invoice_line_vat() from public;
create trigger zz_guard_invoice_line_vat before insert on public.invoice_line
  for each row execute function app.guard_invoice_line_vat();
alter table public.invoice_line enable always trigger zz_guard_invoice_line_vat;

------------------------------------------------------------------------------
-- 4. The single-visit charge, with the rate taken from the registration.
--
--    Replaced whole rather than patched: `create or replace` has no undo, so
--    404's version is written out in this file's rollback. Everything else
--    about it is unchanged — the same price lookup, the same invoice, the same
--    credit consumed on the spot.
------------------------------------------------------------------------------
create or replace function app.charge_single_visit(
  p_client_id uuid, p_service_type_id uuid, p_session_id uuid, p_on date
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id     uuid := app.current_tenant_id();
  v_actor_id      uuid := app.current_actor_id();
  v_price         public.price%rowtype;
  v_service_name  text;
  v_service_ar    text;
  v_rate          integer;
  v_vat_fils      integer;
  v_invoice_id    uuid;
  v_entitlement_id uuid;
begin
  -- The price in force on the day of the visit, for that service: the row
  -- with the greatest valid_from at or before it (domain/billing/price.ts's
  -- currentPriceFor, in SQL).
  select * into v_price from public.price
   where tenant_id = v_tenant_id and service_type_id = p_service_type_id
     and jurisdiction = 'AE' and recipient_type = 'individual'
     and valid_from <= p_on
   order by valid_from desc limit 1;
  if not found then
    return null;
  end if;

  select name, name_ar into v_service_name, v_service_ar
    from public.service_type where id = p_service_type_id and tenant_id = v_tenant_id;

  -- The rate the price row was stamped with, but only while the practice is
  -- registered to charge it. Unregistered: no rate, no VAT, and the gross is
  -- the net — prices are published net either way, so the family pays what the
  -- list said. This is the whole of this migration's behaviour change, and
  -- domain/billing/vat.ts's resolveSaleVat is the same arithmetic in TypeScript
  -- for the package-sale path.
  if app.tenant_charges_vat(v_tenant_id) then
    v_rate := v_price.vat_rate_basis_points;
  else
    v_rate := 0;
  end if;
  v_vat_fils := round(v_price.unit_price_fils::numeric * v_rate / 10000);

  insert into public.invoice (
    tenant_id, client_id, number, kind, issued_on, session_id,
    net_fils, vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, p_client_id, app.next_invoice_number(), 'session', p_on, p_session_id,
    v_price.unit_price_fils, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
  ) returning id into v_invoice_id;

  -- A single visit is supplied on the day it is invoiced, so supplied_on stays
  -- null and issued_on carries both dates.
  insert into public.invoice_line (
    tenant_id, invoice_id, client_id, line_no, description, description_ar, service_type_id,
    quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version,
    vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, v_invoice_id, p_client_id, 1, v_service_name, v_service_ar, p_service_type_id,
    1, v_price.unit_price_fils, v_price.unit_price_fils, v_rate,
    v_price.vat_setting_version, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
  );

  -- The credit keeps the price row's own rate, not the charged one: it records
  -- the standard rate that applies to this service, which is what a later
  -- registration makes live, and it is never printed on a document.
  insert into public.entitlement (
    tenant_id, client_id, service_type_id, source_type, invoice_id, allocated_net_fils,
    vat_rate_basis_points, vat_setting_version, status, consumption_kind,
    consumed_by_session_id, consumed_at, created_by
  ) values (
    v_tenant_id, p_client_id, p_service_type_id, 'single', v_invoice_id, v_price.unit_price_fils,
    v_price.vat_rate_basis_points, v_price.vat_setting_version, 'consumed', 'session',
    p_session_id, now(), v_actor_id
  ) returning id into v_entitlement_id;

  return v_entitlement_id;
end
$$;
revoke execute on function app.charge_single_visit(uuid, uuid, uuid, date) from public;

-- rollback:
--   alter table invoice drop constraint if exists invoice_supplied_on_differs;
--   alter table invoice drop column if exists supplied_on;
--   drop trigger if exists zz_guard_invoice_line_vat on public.invoice_line;
--   drop function if exists app.guard_invoice_line_vat();
--   drop trigger if exists zz_guard_invoice_vat on public.invoice;
--   drop function if exists app.guard_invoice_vat();
--   -- 404's charge, written out: `create or replace` has no undo of its own,
--   -- and going back means charging VAT on every sale again.
--   create or replace function app.charge_single_visit(
--     p_client_id uuid, p_service_type_id uuid, p_session_id uuid, p_on date
--   ) returns uuid
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_tenant_id     uuid := app.current_tenant_id();
--     v_actor_id      uuid := app.current_actor_id();
--     v_price         public.price%rowtype;
--     v_service_name  text;
--     v_service_ar    text;
--     v_vat_fils      integer;
--     v_invoice_id    uuid;
--     v_entitlement_id uuid;
--   begin
--     select * into v_price from public.price
--      where tenant_id = v_tenant_id and service_type_id = p_service_type_id
--        and jurisdiction = 'AE' and recipient_type = 'individual'
--        and valid_from <= p_on
--      order by valid_from desc limit 1;
--     if not found then
--       return null;
--     end if;
--     select name, name_ar into v_service_name, v_service_ar
--       from public.service_type where id = p_service_type_id and tenant_id = v_tenant_id;
--     v_vat_fils := round(v_price.unit_price_fils::numeric * v_price.vat_rate_basis_points / 10000);
--     insert into public.invoice (
--       tenant_id, client_id, number, kind, issued_on, session_id,
--       net_fils, vat_fils, gross_fils, created_by
--     ) values (
--       v_tenant_id, p_client_id, app.next_invoice_number(), 'session', p_on, p_session_id,
--       v_price.unit_price_fils, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
--     ) returning id into v_invoice_id;
--     insert into public.invoice_line (
--       tenant_id, invoice_id, client_id, line_no, description, description_ar, service_type_id,
--       quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version,
--       vat_fils, gross_fils, created_by
--     ) values (
--       v_tenant_id, v_invoice_id, p_client_id, 1, v_service_name, v_service_ar, p_service_type_id,
--       1, v_price.unit_price_fils, v_price.unit_price_fils, v_price.vat_rate_basis_points,
--       v_price.vat_setting_version, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
--     );
--     insert into public.entitlement (
--       tenant_id, client_id, service_type_id, source_type, invoice_id, allocated_net_fils,
--       vat_rate_basis_points, vat_setting_version, status, consumption_kind,
--       consumed_by_session_id, consumed_at, created_by
--     ) values (
--       v_tenant_id, p_client_id, p_service_type_id, 'single', v_invoice_id, v_price.unit_price_fils,
--       v_price.vat_rate_basis_points, v_price.vat_setting_version, 'consumed', 'session',
--       p_session_id, now(), v_actor_id
--     ) returning id into v_entitlement_id;
--     return v_entitlement_id;
--   end
--   $fn$;
--   drop function if exists app.tenant_charges_vat(uuid);
