-- 403_billing_entitlement.sql
-- The ledger itself (docs/SPEC/billing.md section 1: "everything is an
-- entitlement ledger"), and the purchase that fills it
-- (00-data-model.md section 6: `client_package`, `entitlement`).
--
-- One mechanism, four commercial models. A client holds credits for a
-- service; a visit consumes one. Buying a single visit creates one credit,
-- consumed immediately. Buying a package creates as many as it contains,
-- consumed over months. Comping a visit creates one worth nothing. Nothing
-- here is special-cased per product, which is the whole point of building the
-- ledger first.
--
-- **`allocated_net_fils` is the column that does the work.** It is not the
-- list price and not the package price divided by the number of visits: it is
-- this credit's share of what was actually paid, allocated by relative
-- standalone selling price (billing.md section 4.2). The arithmetic is
-- domain/billing/allocation.ts, run once at the moment of sale, and its parts
-- sum to the price paid exactly. A trigger below holds the database to that:
-- the credits a purchase creates must total the purchase's own net price, to
-- the fils, or the sale is refused.
--
-- **Source.** billing.md section 1 gives an entitlement a `sourceType` and a
-- `sourceId`. A single polymorphic id can carry no foreign key, so the two
-- possible sources are two typed, nullable columns, each with a real key, and
-- a check constraint requires the one the source type names. A future source
-- (an insurer's approval) adds a column and a branch, not a new table.
--
-- **Waivers.** A late cancellation consumes a credit (billing.md section 4.3
-- and the founder's decision of 2026-09-03). The coordinator may waive it,
-- and a waiver never rewrites what happened: the consumed row moves to
-- `waived` and carries the reason, and a replacement credit is written beside
-- it with the same service, value and expiry, pointing back at the row it
-- replaces. The client is whole, the history is intact, and the balance
-- counts a waived row as neither delivered nor remaining
-- (domain/billing/balance.ts).
--
-- **Expiry is read, not swept.** A credit's date is stored; nothing runs
-- nightly to flip it. `expired` exists in the enum for a sweep that may come
-- later, and until then every reader judges usability against the date
-- (domain/billing/balance.ts, and app.oldest_available_entitlement below).
-- A credit whose expiry has passed is unusable the moment it passes, not the
-- next time a job happens to run.
--
-- Needs: 000, 010 (tenant), 020 (app_user), 040 (service_type), 060 (client),
-- 080 (app.audit_row), 099 (tenant-scoped keys), 200 (appointment — a late
-- cancellation names the visit it charges for), 300 (session — a delivered
-- visit names the session that consumed the credit), 401 (package,
-- package_component), 402 (invoice).

create type entitlement_source as enum ('package', 'single', 'insurance', 'complimentary');
create type entitlement_status as enum ('available', 'consumed', 'expired', 'refunded', 'waived');
-- What used a credit up. A delivered visit and a visit called off too late
-- both consume one; only the first is a session the client actually had.
create type entitlement_consumption as enum ('session', 'late_cancellation', 'no_show');
create type package_purchase_status as enum ('active', 'completed', 'expired', 'refunded', 'cancelled');

------------------------------------------------------------------------------
-- 1. package_purchase — one client bought one bundle on one day.
------------------------------------------------------------------------------
create table package_purchase (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  client_id              uuid not null references client (id),
  package_id             uuid not null,
  -- Snapshotted at the sale. Renaming a bundle next year must not rewrite
  -- what a family was sold this year (CLAUDE.md rule 7's discipline, applied
  -- to a row that is not itself versioned).
  package_name           text not null,
  package_name_ar        text,
  purchased_on           date not null,
  -- What was actually paid, net of VAT, and the VAT added on top of it. Both
  -- stamped here: the price list may move tomorrow and this row may not.
  net_fils               integer not null check (net_fils >= 0),
  vat_fils               integer not null check (vat_fils >= 0),
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  -- The list price at the moment of sale, so "you saved AED 1,825" is a fact
  -- about the sale rather than a sum done against today's catalogue.
  list_price_fils        integer not null check (list_price_fils >= 0),
  expires_on             date not null,
  -- An extension is the coordinator's discretion and always carries a reason
  -- (the founder's decision of 2026-09-03). Both columns move together.
  extended_to            date,
  extension_reason       text check (length(btrim(extension_reason)) between 1 and 200),
  status                 package_purchase_status not null default 'active',
  invoice_id             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint package_purchase_extension_is_reasoned check (
    (extended_to is null) = (extension_reason is null)
  ),
  constraint package_purchase_extension_moves_forward check (
    extended_to is null or extended_to > expires_on
  ),
  constraint package_purchase_expires_after_purchase check (expires_on > purchased_on),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, package_id) references package (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version),
  foreign key (tenant_id, invoice_id, client_id) references invoice (tenant_id, id, client_id)
);
comment on table public.package_purchase is 'audited: client';
create index package_purchase_tenant_idx on package_purchase (tenant_id);
create index package_purchase_client_idx on package_purchase (tenant_id, client_id, purchased_on);
create index package_purchase_package_idx on package_purchase (package_id);
create index package_purchase_invoice_idx on package_purchase (invoice_id);
create index package_purchase_created_by_idx on package_purchase (created_by);
create trigger set_updated_at before update on package_purchase
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update on public.package_purchase
  for each row execute function app.audit_row();
alter table public.package_purchase enable always trigger audit_row;

-- The forward reference 402 left open, now that the table it names exists.
alter table public.invoice add constraint invoice_package_purchase_fkey
  foreign key (tenant_id, package_purchase_id) references package_purchase (tenant_id, id)
  deferrable initially deferred;
-- Deferrable, and deliberately: a sale writes the invoice and the purchase in
-- one transaction, and each names the other. One of the two references must be
-- allowed to be unsatisfied until commit, or the sale cannot be written at all.

------------------------------------------------------------------------------
-- 2. entitlement — one row per credit.
------------------------------------------------------------------------------
create table entitlement (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenant (id),
  client_id                uuid not null references client (id),
  service_type_id          uuid not null,
  source_type              entitlement_source not null,
  package_purchase_id      uuid,
  invoice_id               uuid,
  -- This credit's share of what was paid (section 4.2). Zero is legitimate:
  -- a bundled consultation and a complimentary visit both carry nothing.
  allocated_net_fils       integer not null check (allocated_net_fils >= 0),
  vat_rate_basis_points    integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version      integer not null,
  status                   entitlement_status not null default 'available',
  consumption_kind         entitlement_consumption,
  consumed_by_session_id   uuid,
  consumed_by_appointment_id uuid,
  consumed_at              timestamptz,
  expires_on               date,
  -- Set only on a waived row: why the coordinator forgave the charge, and who.
  waiver_reason            text check (length(btrim(waiver_reason)) between 1 and 200),
  waived_at                timestamptz,
  waived_by                uuid references app_user (id),
  -- A replacement credit points back at the waived row it stands in for.
  replaces_entitlement_id  uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references app_user (id),
  constraint entitlement_source_is_named check (
    case source_type
      when 'package' then package_purchase_id is not null
      when 'single' then invoice_id is not null
      else true
    end
  ),
  -- Consumed means consumed by something, at a moment. Anything else means
  -- neither, so a credit can never sit "available" while naming the visit
  -- that used it.
  constraint entitlement_consumption_is_whole check (
    case
      when status = 'consumed' then
        consumption_kind is not null and consumed_at is not null
        and (consumed_by_session_id is not null or consumed_by_appointment_id is not null)
      when status = 'waived' then consumption_kind is not null and consumed_at is not null
      else consumption_kind is null and consumed_at is null
           and consumed_by_session_id is null and consumed_by_appointment_id is null
    end
  ),
  constraint entitlement_waiver_is_reasoned check (
    (status = 'waived') = (waiver_reason is not null)
  ),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, service_type_id) references service_type (tenant_id, id),
  foreign key (tenant_id, package_purchase_id) references package_purchase (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoice (tenant_id, id),
  foreign key (tenant_id, consumed_by_session_id) references session (tenant_id, id),
  foreign key (tenant_id, consumed_by_appointment_id) references appointment (tenant_id, id),
  foreign key (tenant_id, replaces_entitlement_id) references entitlement (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version)
);
comment on table public.entitlement is 'audited: client';
create index entitlement_tenant_idx on entitlement (tenant_id);
-- The query the consumption trigger runs on every completed visit: the oldest
-- usable credit for this client and this service.
create index entitlement_available_idx
  on entitlement (tenant_id, client_id, service_type_id, expires_on, created_at)
  where status = 'available';
create index entitlement_client_idx on entitlement (tenant_id, client_id, service_type_id);
create index entitlement_purchase_idx on entitlement (package_purchase_id);
create index entitlement_invoice_idx on entitlement (invoice_id);
create index entitlement_service_type_idx on entitlement (service_type_id);
create index entitlement_replaces_idx on entitlement (replaces_entitlement_id);
create index entitlement_created_by_idx on entitlement (created_by);
create index entitlement_waived_by_idx on entitlement (waived_by);
-- Exactly once, enforced by the database and not only by the trigger that
-- reads it: a visit consumes at most one credit, however many times its
-- completion is replayed.
create unique index entitlement_one_per_session
  on entitlement (tenant_id, consumed_by_session_id) where consumed_by_session_id is not null;
create unique index entitlement_one_per_appointment
  on entitlement (tenant_id, consumed_by_appointment_id)
  where consumed_by_appointment_id is not null;
-- And a waived credit is replaced once, never twice.
create unique index entitlement_one_replacement
  on entitlement (tenant_id, replaces_entitlement_id) where replaces_entitlement_id is not null;
create trigger set_updated_at before update on entitlement
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update on public.entitlement
  for each row execute function app.audit_row();
alter table public.entitlement enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. The exact-sum guard. The allocation is computed in TypeScript
--    (domain/billing/allocation.ts) and pinned by test, but the database is
--    what actually holds the money: a sale whose credits do not total what
--    was paid is refused here, whatever wrote it.
--
--    Deferred to the end of the transaction, because the credits are written
--    one statement after the purchase and the sum is only true once they all
--    are.
------------------------------------------------------------------------------
create function app.check_purchase_allocation() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- Read through jsonb rather than a column reference: one function serves
  -- two tables that do not share a column name for the purchase.
  v_row         jsonb := to_jsonb(new);
  v_purchase_id uuid := case tg_table_name
                          when 'entitlement' then (v_row ->> 'package_purchase_id')::uuid
                          else (v_row ->> 'id')::uuid
                        end;
  v_paid        integer;
  v_allocated   integer;
begin
  if v_purchase_id is null then
    return null;                                   -- a single visit, not a package
  end if;
  select net_fils into v_paid from public.package_purchase where id = v_purchase_id;
  if v_paid is null then
    return null;                                   -- the purchase is gone; nothing to check
  end if;
  select coalesce(sum(allocated_net_fils), 0) into v_allocated
    from public.entitlement
   -- A waived credit is excluded and its replacement counted in its place, so
   -- the total still comes to what was paid after a coordinator forgives a
   -- late cancellation.
   where package_purchase_id = v_purchase_id and status <> 'waived';
  if v_allocated <> v_paid then
    raise exception
      'The credits for this purchase total % fils, but % fils was paid.', v_allocated, v_paid
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke execute on function app.check_purchase_allocation() from public;

create constraint trigger check_allocation
  after insert or update on public.package_purchase
  deferrable initially deferred
  for each row execute function app.check_purchase_allocation();
create constraint trigger check_allocation
  after insert or update on public.entitlement
  deferrable initially deferred
  for each row execute function app.check_purchase_allocation();

------------------------------------------------------------------------------
-- 4. The guard 401 described: a bundle that has been sold keeps the contents
--    it was sold with. Correcting a bundle nobody has bought is ordinary;
--    changing one somebody has is history, and the honest change is a new
--    package.
------------------------------------------------------------------------------
create function app.guard_package_components() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_package_id uuid := coalesce(new.package_id, old.package_id);
  v_tenant_id  uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  if exists (
    select 1 from public.package_purchase
     where package_id = v_package_id and tenant_id = v_tenant_id
  ) then
    raise exception 'A package that has been sold cannot have its contents changed.'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$$;
revoke execute on function app.guard_package_components() from public;
create trigger guard_package_components
  before insert or update or delete on public.package_component
  for each row execute function app.guard_package_components();
alter table public.package_component enable always trigger guard_package_components;

------------------------------------------------------------------------------
-- 5. The oldest usable credit for a client and a service — what a completed
--    visit consumes (404 calls it). security definer, so the trigger can find
--    a credit whichever role is closing the visit: a practitioner writes no
--    billing row of their own, and reads none either.
------------------------------------------------------------------------------
create function app.oldest_available_entitlement(
  p_client_id uuid, p_service_type_id uuid, p_on date
) returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select id from public.entitlement
   where tenant_id = app.current_tenant_id()
     and client_id = p_client_id
     and service_type_id = p_service_type_id
     and status = 'available'
     and (expires_on is null or expires_on >= p_on)
   -- Oldest first, so the credit closest to running out is the one used, and
   -- a client never loses a credit to expiry while a newer one is spent.
   order by expires_on nulls last, created_at, id
   limit 1
$$;
revoke execute on function app.oldest_available_entitlement(uuid, uuid, date) from public;
grant execute on function app.oldest_available_entitlement(uuid, uuid, date) to app_role;

------------------------------------------------------------------------------
-- Privileges and row security.
------------------------------------------------------------------------------
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['package_purchase', 'entitlement'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  -- Update, because a credit is consumed by flipping its status (billing.md
  -- section 1) and a purchase is extended; never delete, on either.
  grant select, insert, update on public.package_purchase to app_role;
  grant select, insert, update on public.entitlement to app_role;
end
$$;

-- rollback:
--   revoke select, insert, update on public.entitlement from app_role;
--   revoke select, insert, update on public.package_purchase from app_role;
--   drop function if exists app.oldest_available_entitlement(uuid, uuid, date);
--   drop trigger if exists guard_package_components on public.package_component;
--   drop function if exists app.guard_package_components();
--   drop trigger if exists check_allocation on public.entitlement;
--   drop trigger if exists check_allocation on public.package_purchase;
--   drop function if exists app.check_purchase_allocation();
--   drop trigger if exists audit_row on public.entitlement;
--   drop table if exists entitlement;
--   alter table public.invoice drop constraint if exists invoice_package_purchase_fkey;
--   drop trigger if exists audit_row on public.package_purchase;
--   drop table if exists package_purchase;
--   drop type if exists package_purchase_status;
--   drop type if exists entitlement_consumption;
--   drop type if exists entitlement_status;
--   drop type if exists entitlement_source;
