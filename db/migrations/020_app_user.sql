-- 020_app_user.sql
-- Anyone who logs in, and what they are. The entity is "user" in the specs;
-- the physical table is app_user because user is a reserved word in SQL.
-- Roles are rows in user_role, never a column on the user: one person may be
-- several things at once (00-data-model.md section 2).

create type user_status as enum ('active', 'suspended', 'archived');
create type role_kind as enum (
  'owner', 'admin', 'clinical_lead', 'practitioner', 'finance', 'client_contact'
);
create type locale as enum ('en', 'ar');

create table app_user (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id),
  auth_id           uuid unique,          -- the Supabase Auth user; linked in PR 3
  display_name      text not null,
  email             text,
  phone             text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),  -- E.164
  preferred_locale  locale not null default 'en',
  status            user_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references app_user (id)
);
create index app_user_tenant_idx on app_user (tenant_id);
create index app_user_created_by_idx on app_user (created_by);
create trigger set_updated_at before update on app_user
  for each row execute function app.set_updated_at();

create table user_role (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant (id),
  user_id     uuid not null references app_user (id),
  role        role_kind not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references app_user (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references app_user (id),
  unique (user_id, role)
);
create index user_role_tenant_idx on user_role (tenant_id);
create index user_role_granted_by_idx on user_role (granted_by);
create index user_role_created_by_idx on user_role (created_by);
create trigger set_updated_at before update on user_role
  for each row execute function app.set_updated_at();

-- tenant.created_by can now point at a user.
alter table tenant
  add constraint tenant_created_by_fkey foreign key (created_by) references app_user (id);
create index tenant_created_by_idx on tenant (created_by);

-- rollback:
--   drop index if exists tenant_created_by_idx;
--   alter table tenant drop constraint if exists tenant_created_by_fkey;
--   drop table if exists user_role;
--   drop table if exists app_user;
--   drop type if exists locale;
--   drop type if exists role_kind;
--   drop type if exists user_status;
