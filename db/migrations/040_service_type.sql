-- 040_service_type.sql
-- The catalogue of what the clinic delivers. Never hardcode "neurofeedback":
-- every service is a row here (00-data-model.md section 2).

create type delivery_mode as enum ('home', 'clinic', 'remote');
create type active_status as enum ('active', 'inactive');

create table service_type (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenant (id),
  code                    text not null,          -- nf-session, brain-map, consultation, ...
  name                    text not null,
  name_ar                 text,
  duration_minutes        integer not null check (duration_minutes > 0),
  is_clinical             boolean not null,       -- drives VAT (billing.md section 5)
  requires_certification  text,                   -- credential gate; open set
  delivery_modes          delivery_mode[] not null check (cardinality(delivery_modes) > 0),
  status                  active_status not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references app_user (id),
  unique (tenant_id, code)
);
create index service_type_tenant_idx on service_type (tenant_id);
create index service_type_created_by_idx on service_type (created_by);
create trigger set_updated_at before update on service_type
  for each row execute function app.set_updated_at();

-- rollback:
--   drop table if exists service_type;
--   drop type if exists active_status;
--   drop type if exists delivery_mode;
