-- 010_tenant.sql
-- The practice. One row today; tenant_id on every other table from day one
-- (00-data-model.md section 1 and 2). This table is the tenant, so it carries
-- no tenant_id of its own: recorded exemption in .claude/rules/data-model.md.

create type emirate as enum ('DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ');

create table tenant (
  id                        uuid primary key default gen_random_uuid(),
  legal_name                text not null,
  trn                       text,
  default_emirate           emirate not null default 'DXB',
  timezone                  text not null default 'Asia/Dubai',
  -- location_id (the studio) is added by 030_location.sql
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid          -- references app_user(id), added by 020_app_user.sql
);

create trigger set_updated_at before update on tenant
  for each row execute function app.set_updated_at();

-- rollback:
--   drop table if exists tenant;
--   drop type if exists emirate;
