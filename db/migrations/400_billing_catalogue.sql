-- 400_billing_catalogue.sql
-- The billing worktree's first tables: the practice's VAT rate and its price
-- list (docs/SPEC/billing.md section 5.1, section 2; 00-data-model.md section 6).
--
-- Both are strictly append-only (the operator's ruling on this pull request,
-- reinforced by the schema review: update and delete are never granted to
-- app_role on either table, so both are refused at SQLSTATE 42501, not by
-- policy). A price and a VAT setting are both amendments
-- (.claude/rules/data-model.md): each carries supersedes_id (the row it
-- replaces, null for a service's first price or a tenant's first setting)
-- and a required amendment_reason, bound to the tenant by a composite
-- foreign key so a row can only supersede one of its own tenant's. The
-- price in force on a date is the row with the greatest valid_from on or
-- before that date, among rows for the same service, jurisdiction and
-- recipient type (domain/billing/price.ts: currentPriceFor). VAT is
-- resolved once per price, from the setting in force on the price's own
-- valid_from — not "today" and not simply the newest setting — and
-- stamped onto the row at insert (domain/billing/vat.ts: resolveVat) —
-- never typed by hand (CLAUDE.md rule 6).
--
-- Every tenant has a VAT rate the moment it exists: app.default_vat_setting()
-- gives a newly inserted tenant its first rate (500 basis points, effective
-- 2018-01-01, the day UAE VAT began), and the data step at the end of this
-- file backfills the same for any tenant that already existed before this
-- migration ran. The owner's screen to change the rate is the second pull
-- request's, not this migration's.
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
  -- Amendment lineage (.claude/rules/data-model.md), the same rule price
  -- carries: the setting this one replaces (null only for a tenant's first,
  -- version 1) and why. Bound to the tenant, not merely to a row: a setting
  -- can only supersede one of its own tenant's.
  supersedes_id       uuid,
  amendment_reason    text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references app_user (id),
  unique (tenant_id, version),
  unique (tenant_id, effective_from),
  unique (tenant_id, id),
  foreign key (tenant_id, supersedes_id) references vat_setting (tenant_id, id)
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
  -- shape is kept, with the values fixed by check constraint and carried in
  -- the key, so a future value is a data change, the same idiom billing.md
  -- section 5.2 uses for a VAT split.
  jurisdiction           text not null default 'AE' check (jurisdiction = 'AE'),
  recipient_type         text not null default 'individual' check (recipient_type = 'individual'),
  unit_price_fils        integer not null check (unit_price_fils >= 0),
  -- VAT snapshot: resolved once, at insert, from the setting in force on
  -- valid_from. Never recomputed, never typed by hand.
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  valid_from             date not null,
  -- Amendment lineage (.claude/rules/data-model.md): the price this one
  -- replaces (null only for a service's first price) and why. Bound to the
  -- tenant, not merely to a row: a price can only supersede one of its own
  -- tenant's, the same discipline vat_setting's own lineage now carries.
  supersedes_id          uuid,
  amendment_reason       text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  unique (tenant_id, service_type_id, jurisdiction, recipient_type, valid_from),
  unique (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version),
  foreign key (tenant_id, supersedes_id) references price (tenant_id, id)
);
create index price_tenant_idx on price (tenant_id);
create index price_service_type_idx
  on price (tenant_id, service_type_id, jurisdiction, recipient_type, valid_from);
-- Postgres does not index a foreign-key column on its own side; this one
-- supports the service_type_id foreign key above.
create index price_service_type_fk_idx on price (service_type_id);
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
-- what app_role needs. Select and insert only on both, by construction, not
-- by policy: neither update nor delete is ever granted, so app_role gets
-- SQLSTATE 42501 on either statement regardless of role or row — proved in
-- tests/billing/db/rls.test.ts.
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

-- Every tenant gets its first VAT rate the moment it is inserted, whoever
-- inserts it (a real signup, the seed, or this migration's own backfill
-- below for tenants that predate it). security definer and a pinned
-- search_path so it always succeeds and is never fooled by a caller's own
-- search_path, the same discipline app.audit_row() uses; every table name
-- inside is schema-qualified because search_path excludes public on purpose.
create function app.default_vat_setting() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.vat_setting (tenant_id, version, rate_basis_points, effective_from, amendment_reason)
  values (new.id, 1, 500, date '2018-01-01', 'standard rate at go-live');
  return new;
end
$$;
revoke execute on function app.default_vat_setting() from public;

create trigger default_vat_setting after insert on public.tenant
  for each row execute function app.default_vat_setting();

-- Data step: every tenant that already exists the moment this migration runs
-- gets the same first VAT rate the trigger above now gives every new one —
-- the trigger only fires from here on, so this is what covers a real practice
-- already live on staging or production, or a local database seeded before
-- this migration landed.
insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, amendment_reason)
select id, 1, 500, date '2018-01-01', 'standard rate at go-live' from tenant;

-- How each table is audited (trunk convention, docs/SPEC/audit.md section 14): neither carries a client.
comment on table public.vat_setting is 'audited: no client - a practice-wide tax setting';
comment on table public.price is 'audited: no client - the practice''s price list';
-- rollback:
--   drop trigger if exists default_vat_setting on public.tenant;
--   drop function if exists app.default_vat_setting();
--   revoke select, insert on public.price from app_role;
--   revoke select, insert on public.vat_setting from app_role;
--   drop trigger if exists audit_row on public.price;
--   drop trigger if exists audit_row on public.vat_setting;
--   drop table if exists price;
--   drop table if exists vat_setting;
--   comment on table public.vat_setting is null;
--   comment on table public.price is null;
