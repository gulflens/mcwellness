-- 401_billing_package.sql
-- The catalogue of bundles the practice sells (docs/SPEC/billing.md
-- section 2, 00-data-model.md section 6's `package`), and the append-only
-- price list for them, in the same shape 400_billing_catalogue.sql gave the
-- per-service price list.
--
-- Three tables and why each exists.
--
-- `package` is the bundle itself. It carries the **list price** — what the
-- contents come to bought one at a time — because that is a figure the
-- practice publishes and quotes ("normally AED 12,150"), not one the app
-- derives. `package_price` carries what it is actually being sold for today,
-- as an append-only row with a reason, so "launch pricing, ends on the
-- founder's word" is recorded rather than remembered. The founder's decision
-- of 2026-09-03 is explicit on this: a package price is a figure the founder
-- sets, never one the app computes from a discount percentage. Neither
-- number is ever derived from the other, and nothing here stores a percentage.
--
-- `package_component` is what is in the bundle: so many credits of one
-- service. Rows, not a jsonb blob, because the sale reads them with a join to
-- `price` to work out each credit's allocated share (billing.md section 4.2,
-- domain/billing/allocation.ts), and because a component with no row in
-- `price` must fail loudly at that join rather than be quietly valued at
-- nothing.
--
-- What is deliberately not here: the sale itself, the credits it creates, and
-- the money. Those are 403 and 402. This migration ships a catalogue and
-- nothing that touches a client.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user, for created_by), 040
-- (service_type, active_status), 080 (app.audit_row), 099 (the tenant-scoped
-- keys the composite foreign keys below reference on service_type), 400
-- (vat_setting, whose version each package price stamps).

------------------------------------------------------------------------------
-- 1. package — the bundle definition.
------------------------------------------------------------------------------
create table package (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id),
  -- An open set (silver, gold, platinum, and whatever the practice adds), so
  -- text with a per-tenant unique key, never an enum (.claude/rules/data-model.md).
  code              text not null check (code ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  name              text not null check (length(btrim(name)) between 1 and 120),
  name_ar           text check (length(btrim(name_ar)) between 1 and 120),
  -- What the contents come to bought one at a time: the "normally" figure.
  -- Set by the practice, checked against the components at sale time but
  -- never overwritten by the app.
  list_price_fils   integer not null check (list_price_fils >= 0),
  -- Twelve months, the founder's decision of 2026-09-03. A setting on the
  -- package, so a future bundle can carry its own term without a migration.
  expiry_months     integer not null default 12 check (expiry_months between 1 and 60),
  status            active_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references app_user (id),
  unique (tenant_id, code),
  unique (tenant_id, id)
);
comment on table public.package is 'audited: no client - the practice''s bundle catalogue';
create index package_tenant_idx on package (tenant_id);
create index package_created_by_idx on package (created_by);
create trigger set_updated_at before update on package
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.package
  for each row execute function app.audit_row();
alter table public.package enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. package_component — so many credits of one service, per bundle.
------------------------------------------------------------------------------
create table package_component (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id),
  package_id        uuid not null,
  service_type_id   uuid not null,
  quantity          integer not null check (quantity between 1 and 1000),
  -- The order the components are listed and allocated in. The allocation's
  -- tie-break for the rounding remainder is the order the components arrive
  -- in (domain/billing/allocation.ts), so that order is data, not whatever
  -- order a query happened to return.
  line_no           integer not null check (line_no >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references app_user (id),
  -- One line per service per package: fifteen sessions are one row with a
  -- quantity, never fifteen rows.
  unique (tenant_id, package_id, service_type_id),
  unique (tenant_id, package_id, line_no),
  unique (tenant_id, id),
  -- Composite, so a component can only ever point at its own practice's
  -- package and service (trunk round 4's tenant-scoped keys).
  foreign key (tenant_id, package_id) references package (tenant_id, id),
  foreign key (tenant_id, service_type_id) references service_type (tenant_id, id)
);
comment on table public.package_component is 'audited: no client - what a bundle contains';
create index package_component_tenant_idx on package_component (tenant_id);
create index package_component_package_idx on package_component (tenant_id, package_id, line_no);
create index package_component_service_type_idx on package_component (service_type_id);
create index package_component_created_by_idx on package_component (created_by);
create trigger set_updated_at before update on package_component
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.package_component
  for each row execute function app.audit_row();
alter table public.package_component enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. package_price — what a bundle sells for, append-only.
--    The same discipline `price` carries (400_billing_catalogue.sql): a new
--    price never edits or closes an old one, it supersedes it from its own
--    valid_from; VAT is resolved once, from the setting in force on that
--    date, and stamped (CLAUDE.md rule 6). Update and delete are never
--    granted, so both are refused at SQLSTATE 42501 rather than by policy.
------------------------------------------------------------------------------
create table package_price (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  package_id             uuid not null,
  amount_fils            integer not null check (amount_fils >= 0),
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  valid_from             date not null,
  supersedes_id          uuid,
  amendment_reason       text not null check (length(btrim(amendment_reason)) between 1 and 200),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  unique (tenant_id, package_id, valid_from),
  unique (tenant_id, id),
  foreign key (tenant_id, package_id) references package (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version),
  foreign key (tenant_id, supersedes_id) references package_price (tenant_id, id)
);
comment on table public.package_price is 'audited: no client - what a bundle sells for';
create index package_price_tenant_idx on package_price (tenant_id);
create index package_price_package_idx on package_price (tenant_id, package_id, valid_from);
create index package_price_created_by_idx on package_price (created_by);
create trigger set_updated_at before update on package_price
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update on public.package_price
  for each row execute function app.audit_row();
alter table public.package_price enable always trigger audit_row;

------------------------------------------------------------------------------
-- Privileges and row security, in 090_grants_and_rls.sql's shape. package and
-- package_component may be amended (a bundle is withdrawn by setting its
-- status, never deleted, because purchases reference it); package_price is
-- append-only by construction, like price and vat_setting before it.
------------------------------------------------------------------------------
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['package', 'package_component', 'package_price'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  grant select, insert, update on public.package to app_role;
  grant select, insert, update, delete on public.package_component to app_role;
  -- Append-only: no update, no delete, ever.
  grant select, insert on public.package_price to app_role;
end
$$;

-- rollback:
--   revoke select, insert on public.package_price from app_role;
--   revoke select, insert, update, delete on public.package_component from app_role;
--   revoke select, insert, update on public.package from app_role;
--   drop trigger if exists audit_row on public.package_price;
--   drop trigger if exists audit_row on public.package_component;
--   drop trigger if exists audit_row on public.package;
--   drop table if exists package_price;
--   drop table if exists package_component;
--   drop table if exists package;
