-- 409_billing_discount.sql
-- Money off a list figure, and the books do not notice.
--
-- **The operator's decision of 7 September 2026 at 21:49**, recorded in
-- docs/PLAN/billing-discounts.md and specified in docs/SPEC/billing.md section
-- 2.4: "for my books, i need to be able to apply discount in any transaction i
-- am doing, so add a discount field to the transactions, packages and
-- individual prices". It **amends the founder's decision of 2026-09-03**,
-- recorded in 401's own header and in that file's comment on package_price,
-- that a package price is a figure she sets and no discount percentage is
-- stored anywhere. The figure is still hers to set; a discount is now one of
-- the two ways of setting it, and both are kept. 401 is merged and is not
-- edited: this header is where its sentence is amended.
--
-- **What a discount is, here and everywhere.** Money off a list figure, held
-- as fils, with the percentage kept beside it when that is how it was typed.
-- The arithmetic is domain/billing/discount.ts and nothing else; these
-- constraints are the same rule stated where two readers cannot drift apart.
--
-- **Why the books are untouched.** `net_fils` on an invoice, a line and a
-- purchase keeps exactly the meaning it had: what is charged, net of VAT. A
-- discount moves that figure down before it is written, so every reader of it
-- — the allocation, the deferred balance, revenue recognition, migration 454's
-- unposted money events and the poster above them — reads the net after
-- discount and needs no change. Revenue net of a discount given at the point
-- of sale is the ordinary treatment; no contra-revenue account is opened, and
-- "discounts given against list price" as a figure is piece thirteen's
-- (docs/SPEC/accounting.md section 14), read off the lines this file records.
--
-- **Why nothing a family was shown changes.** Every price already on the list
-- becomes its own list figure with no discount, so `unit_price_fils` is what it
-- always was. Every package price becomes "list minus the difference", which is
-- what its own amendment reason already says in words — the launch prices of 7
-- September were set as a figure below the list, and this only names the gap.
-- The backfill therefore rewrites no charge and no quotation.
--
-- **Why VAT is computed after the discount.** UAE VAT values a supply net of
-- discounts, so the line's `net_fils` — already after the discount — is the
-- base, exactly as it was before. Nothing about the rate, the setting version
-- or the registration switch (406) changes.
--
-- Needs: 400 (price, vat_setting), 401 (package, package_price), 402
-- (invoice_line), 403 (package_purchase), 406 (app.charge_single_visit, the
-- version this replaces, and app.tenant_charges_vat).

------------------------------------------------------------------------------
-- 1. price: the list figure, and the discount taken from it.
------------------------------------------------------------------------------
alter table price add column list_price_fils integer;
alter table price add column discount_fils integer not null default 0;
alter table price add column discount_basis_points integer;
-- Backfill: every price on the list today is its own list figure with no
-- discount. Written before the not-null, so a populated database crosses this
-- file without a moment in which a price says nothing about its list.
update price set list_price_fils = unit_price_fils;
alter table price alter column list_price_fils set not null;
alter table price add constraint price_list_nonnegative check (list_price_fils >= 0);
alter table price add constraint price_discount_within_list
  check (discount_fils between 0 and list_price_fils);
alter table price add constraint price_discount_percent_range
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
alter table price add constraint price_unit_is_list_less_discount
  check (unit_price_fils = list_price_fils - discount_fils);
comment on column public.price.list_price_fils is
  'The price before any discount, net of VAT. Equal to unit_price_fils when nothing is off.';
comment on column public.price.discount_fils is
  'Money off list_price_fils, in fils. The list is the ceiling: nothing is ever sold above it.';
comment on column public.price.discount_basis_points is
  'The share the discount was typed as (1500 is fifteen per cent), or null when it was a sum.';

------------------------------------------------------------------------------
-- 2. package_price: the same three, with the list figure snapshotted from the
--    package at the moment the row was written, so the arithmetic on the row
--    never depends on a figure that can be edited later.
------------------------------------------------------------------------------
alter table package_price add column list_price_fils integer;
alter table package_price add column discount_fils integer not null default 0;
alter table package_price add column discount_basis_points integer;
-- greatest(), not the package's figure alone: a bundle priced at or above its
-- own list would otherwise arrive with a negative discount, and a backfill is
-- not the place to refuse a row somebody has already been sold.
update package_price pp
   set list_price_fils = greatest(p.list_price_fils, pp.amount_fils),
       discount_fils   = greatest(p.list_price_fils, pp.amount_fils) - pp.amount_fils
  from package p
 where p.id = pp.package_id and p.tenant_id = pp.tenant_id;
alter table package_price alter column list_price_fils set not null;
alter table package_price add constraint package_price_list_nonnegative
  check (list_price_fils >= 0);
alter table package_price add constraint package_price_discount_within_list
  check (discount_fils between 0 and list_price_fils);
alter table package_price add constraint package_price_discount_percent_range
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
alter table package_price add constraint package_price_amount_is_list_less_discount
  check (amount_fils = list_price_fils - discount_fils);
comment on column public.package_price.list_price_fils is
  'The bundle''s list price as it stood when this row was written; never read from package again.';
comment on column public.package_price.discount_fils is
  'Money off list_price_fils, in fils. amount_fils is held to the difference.';
comment on column public.package_price.discount_basis_points is
  'The share the discount was typed as (1500 is fifteen per cent), or null when it was a sum.';

------------------------------------------------------------------------------
-- 3. invoice_line: the discount on the line. unit_net_fils becomes the list
--    figure and net_fils stays what is charged, so the check gains one term.
------------------------------------------------------------------------------
alter table invoice_line add column discount_fils integer not null default 0;
alter table invoice_line add column discount_basis_points integer;
alter table invoice_line drop constraint invoice_line_net_is_quantity_times_unit;
alter table invoice_line add constraint invoice_line_net_is_quantity_times_unit_less_discount
  check (net_fils = quantity * unit_net_fils - discount_fils);
alter table invoice_line add constraint invoice_line_discount_within_line
  check (discount_fils between 0 and quantity * unit_net_fils);
alter table invoice_line add constraint invoice_line_discount_percent_range
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
comment on column public.invoice_line.discount_fils is
  'Money off the line, in fils. The rendered invoice states it, as the FTA asks a full tax invoice to.';
comment on column public.invoice_line.discount_basis_points is
  'The share the discount was typed as, or null when it was a sum or two sums added.';

------------------------------------------------------------------------------
-- 4. package_purchase: how the sale's discount was expressed, and why the
--    extra was given. The discount itself is list_price_fils - net_fils, both
--    already on the row; nothing is stored twice.
------------------------------------------------------------------------------
alter table package_purchase add column discount_basis_points integer
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
alter table package_purchase add column discount_reason text
  check (length(btrim(discount_reason)) between 1 and 200);
comment on column public.package_purchase.discount_basis_points is
  'The combined share off the list figure, when both the list''s discount and the extra were percentages.';
comment on column public.package_purchase.discount_reason is
  'Why an extra discount was given at this sale. Null when the price list''s own discount was all of it.';

------------------------------------------------------------------------------
-- 5. The single-visit charge, replaced whole (406's text in the rollback).
--
--    Replaced rather than patched for the reason 406 gives: `create or
--    replace` has no undo, so the version it supersedes is written out below.
--    The one change is the line: it carries the list figure as the unit, the
--    price row's own discount, and the net that was already being charged. No
--    person is present when a session closes, so no extra discount can be
--    given here (docs/SPEC/billing.md section 2.4); the invoice's net, the VAT
--    and the credit's allocated value are all unchanged.
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
  -- list said. VAT falls on unit_price_fils, which is the net after the price
  -- row's own discount, because UAE VAT values a supply net of discounts.
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
  -- null and issued_on carries both dates. The line prints the list figure and
  -- the discount beneath it; net_fils is what is charged, as it always was.
  insert into public.invoice_line (
    tenant_id, invoice_id, client_id, line_no, description, description_ar, service_type_id,
    quantity, unit_net_fils, discount_fils, discount_basis_points, net_fils,
    vat_rate_basis_points, vat_setting_version, vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, v_invoice_id, p_client_id, 1, v_service_name, v_service_ar, p_service_type_id,
    1, v_price.list_price_fils, v_price.discount_fils, v_price.discount_basis_points,
    v_price.unit_price_fils, v_rate, v_price.vat_setting_version, v_vat_fils,
    v_price.unit_price_fils + v_vat_fils, v_actor_id
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
--   alter table package_purchase drop column if exists discount_reason;
--   alter table package_purchase drop column if exists discount_basis_points;
--   alter table invoice_line drop constraint if exists invoice_line_discount_percent_range;
--   alter table invoice_line drop constraint if exists invoice_line_discount_within_line;
--   alter table invoice_line
--     drop constraint if exists invoice_line_net_is_quantity_times_unit_less_discount;
--   alter table invoice_line add constraint invoice_line_net_is_quantity_times_unit
--     check (net_fils = quantity * unit_net_fils);
--   alter table invoice_line drop column if exists discount_basis_points;
--   alter table invoice_line drop column if exists discount_fils;
--   alter table package_price
--     drop constraint if exists package_price_amount_is_list_less_discount;
--   alter table package_price drop constraint if exists package_price_discount_percent_range;
--   alter table package_price drop constraint if exists package_price_discount_within_list;
--   alter table package_price drop constraint if exists package_price_list_nonnegative;
--   alter table package_price drop column if exists discount_basis_points;
--   alter table package_price drop column if exists discount_fils;
--   alter table package_price drop column if exists list_price_fils;
--   alter table price drop constraint if exists price_unit_is_list_less_discount;
--   alter table price drop constraint if exists price_discount_percent_range;
--   alter table price drop constraint if exists price_discount_within_list;
--   alter table price drop constraint if exists price_list_nonnegative;
--   alter table price drop column if exists discount_basis_points;
--   alter table price drop column if exists discount_fils;
--   alter table price drop column if exists list_price_fils;
--   -- 406's charge, written out: `create or replace` has no undo of its own,
--   -- and the columns its line names are gone by the time this runs.
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
--     v_rate          integer;
--     v_vat_fils      integer;
--     v_invoice_id    uuid;
--     v_entitlement_id uuid;
--   begin
--     -- The price in force on the day of the visit, for that service: the row
--     -- with the greatest valid_from at or before it (domain/billing/price.ts's
--     -- currentPriceFor, in SQL).
--     select * into v_price from public.price
--      where tenant_id = v_tenant_id and service_type_id = p_service_type_id
--        and jurisdiction = 'AE' and recipient_type = 'individual'
--        and valid_from <= p_on
--      order by valid_from desc limit 1;
--     if not found then
--       return null;
--     end if;
--
--     select name, name_ar into v_service_name, v_service_ar
--       from public.service_type where id = p_service_type_id and tenant_id = v_tenant_id;
--
--     -- The rate the price row was stamped with, but only while the practice is
--     -- registered to charge it. Unregistered: no rate, no VAT, and the gross is
--     -- the net — prices are published net either way, so the family pays what the
--     -- list said. This is the whole of this migration's behaviour change, and
--     -- domain/billing/vat.ts's resolveSaleVat is the same arithmetic in TypeScrip
--     -- for the package-sale path.
--     if app.tenant_charges_vat(v_tenant_id) then
--       v_rate := v_price.vat_rate_basis_points;
--     else
--       v_rate := 0;
--     end if;
--     v_vat_fils := round(v_price.unit_price_fils::numeric * v_rate / 10000);
--
--     insert into public.invoice (
--       tenant_id, client_id, number, kind, issued_on, session_id,
--       net_fils, vat_fils, gross_fils, created_by
--     ) values (
--       v_tenant_id, p_client_id, app.next_invoice_number(), 'session', p_on, p_session_id,
--       v_price.unit_price_fils, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
--     ) returning id into v_invoice_id;
--
--     -- A single visit is supplied on the day it is invoiced, so supplied_on stays
--     -- null and issued_on carries both dates.
--     insert into public.invoice_line (
--       tenant_id, invoice_id, client_id, line_no, description, description_ar, service_type_id,
--       quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version,
--       vat_fils, gross_fils, created_by
--     ) values (
--       v_tenant_id, v_invoice_id, p_client_id, 1, v_service_name, v_service_ar, p_service_type_id,
--       1, v_price.unit_price_fils, v_price.unit_price_fils, v_rate,
--       v_price.vat_setting_version, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
--     );
--
--     -- The credit keeps the price row's own rate, not the charged one: it records
--     -- the standard rate that applies to this service, which is what a later
--     -- registration makes live, and it is never printed on a document.
--     insert into public.entitlement (
--       tenant_id, client_id, service_type_id, source_type, invoice_id, allocated_net_fils,
--       vat_rate_basis_points, vat_setting_version, status, consumption_kind,
--       consumed_by_session_id, consumed_at, created_by
--     ) values (
--       v_tenant_id, p_client_id, p_service_type_id, 'single', v_invoice_id, v_price.unit_price_fils,
--       v_price.vat_rate_basis_points, v_price.vat_setting_version, 'consumed', 'session',
--       p_session_id, now(), v_actor_id
--     ) returning id into v_entitlement_id;
--
--     return v_entitlement_id;
--   end
--   $fn$;
--   revoke execute on function app.charge_single_visit(uuid, uuid, uuid, date) from public;
