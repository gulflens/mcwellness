-- 400_billing_catalogue.sql
-- The billing worktree's first tables: the practice's VAT rate and its price
-- list (docs/SPEC/billing.md section 5.1, section 2; 00-data-model.md section 6).
--
-- Both are strictly append-only (the operator's ruling on this pull request):
-- neither table is ever updated by the API role, and a price is never closed
-- out. A new price simply supersedes the old one from its own valid_from; the
-- price in force on any date is the row with the greatest valid_from on or
-- before that date (domain/billing/price.ts: currentPriceFor). VAT is
-- resolved once per price, from the tenant's current vat_setting, and
-- stamped onto the row at insert (domain/billing/vat.ts: resolveVat) — never
-- typed by hand (CLAUDE.md rule 6).
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at, app.current_tenant_id),
-- 010 (tenant), 020 (app_user, for created_by), 040 (service_type), 080
-- (app.audit_row, reused as-is: neither table carries a client_id, so
-- app.audit_client_id — generalised in 097 to look for that column rather
-- than name tables — correctly denormalises null, exactly as it already does
-- for tenant and service_type).

create table vat_setting (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant (id),
  version             integer not null check (version >= 1),
  rate_basis_points   integer not null check (rate_basis_points between 0 and 10000),  -- 500 = 5%
  effective_from      date not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references app_user (id),
  unique (tenant_id, version)
);
create index vat_setting_tenant_idx on vat_setting (tenant_id);
create index vat_setting_created_by_idx on vat_setting (created_by);
create trigger set_updated_at before update on vat_setting
  for each row execute function app.set_updated_at();

create table price (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  service_type_id        uuid not null references service_type (id),
  -- Single jurisdiction and recipient type today; 00-data-model.md section 6's
  -- shape is kept, with the values fixed by check constraint. A future value
  -- is a data change, the same idiom billing.md section 5.2 uses for a VAT split.
  jurisdiction           text not null default 'AE' check (jurisdiction = 'AE'),
  recipient_type         text not null default 'individual' check (recipient_type = 'individual'),
  unit_price_fils        integer not null check (unit_price_fils >= 0),
  -- VAT snapshot: resolved once, at insert, from the tenant's own rate at that
  -- moment. Never recomputed, never typed by hand.
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  valid_from             date not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  unique (tenant_id, service_type_id, valid_from)
);
create index price_tenant_idx on price (tenant_id);
create index price_service_type_idx on price (tenant_id, service_type_id, valid_from);
create index price_created_by_idx on price (created_by);
create trigger set_updated_at before update on price
  for each row execute function app.set_updated_at();

-- Audit: append-only history is exactly what the trigger is for. See the note
-- above on app.audit_client_id — client_id comes back null for both tables,
-- which is correct: neither carries one.
create trigger audit_row after insert or update or delete on public.vat_setting
  for each row execute function app.audit_row();
alter table public.vat_setting enable always trigger audit_row;
create trigger audit_row after insert or update or delete on public.price
  for each row execute function app.audit_row();
alter table public.price enable always trigger audit_row;

-- RLS and grants, in the shape 090_grants_and_rls.sql uses for the core
-- tables: RLS enabled (not forced, so the runner as table owner can migrate
-- and the seed can write), every default privilege stripped, then exactly
-- what app_role needs. Select and insert only on both: nothing here is ever
-- updated by the API role, and nothing is ever deleted.
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['vat_setting', 'price'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      -- Supabase: default privileges grant every new table in public to these roles.
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
    execute format('grant select, insert on public.%I to app_role', t);
  end loop;
end
$$;

-- rollback:
--   revoke select, insert on public.price from app_role;
--   revoke select, insert on public.vat_setting from app_role;
--   drop trigger if exists audit_row on public.price;
--   drop trigger if exists audit_row on public.vat_setting;
--   drop table if exists price;
--   drop table if exists vat_setting;
