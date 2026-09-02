-- 030_location.sql
-- Any place: a client's home, the clinic, a practitioner's home base.
-- Makani is optional and Dubai-only; the verified entrance coordinate is
-- mandatory (00-data-model.md section 2, navigation.md section 2).

create type location_owner_type as enum ('client', 'tenant', 'practitioner');
create type location_label as enum ('home', 'work', 'school', 'clinic', 'base', 'other');

create table location (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant (id),
  owner_type       location_owner_type not null,
  owner_id         uuid not null,        -- polymorphic: client, tenant or practitioner id
  label            location_label not null,
  emirate          emirate not null,
  makani_number    text,
  entrance_point   extensions.geography(point, 4326) not null,   -- verified coordinate, required
  parking_point    extensions.geography(point, 4326),
  community_gate   extensions.geography(point, 4326),
  display_address  text,
  access_notes     text,                 -- arrival intelligence; structured in Phase 2
  is_primary       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references app_user (id),
  constraint location_makani_ten_digits check (makani_number is null or makani_number ~ '^[0-9]{10}$'),
  constraint location_makani_dubai_only check (makani_number is null or emirate = 'DXB')
);
create index location_tenant_idx on location (tenant_id);
create index location_owner_idx on location (owner_type, owner_id, created_at);
create index location_created_by_idx on location (created_by);
create index location_entrance_gix on location using gist (entrance_point);
create trigger set_updated_at before update on location
  for each row execute function app.set_updated_at();

-- The clinic.
alter table tenant add column location_id uuid references location (id);
create index tenant_location_idx on tenant (location_id);

-- rollback:
--   drop index if exists tenant_location_idx;
--   alter table tenant drop column if exists location_id;
--   drop table if exists location;
--   drop type if exists location_label;
--   drop type if exists location_owner_type;
