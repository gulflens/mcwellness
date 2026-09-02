-- 050_practitioner.sql
-- Who delivers or supervises sessions, and what each one is authorised
-- to do. What a user may do is resolved from user_role plus credential, never
-- from role alone (00-data-model.md section 2).

create table practitioner (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references tenant (id),
  user_id                       uuid not null unique references app_user (id),
  display_name_ar               text,
  home_base_location_id         uuid references location (id),  -- where their day starts
  vehicle                       text not null default 'personal',  -- reimbursed mileage and Salik
  status                        active_status not null default 'active',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid references app_user (id)
);
create index practitioner_tenant_idx on practitioner (tenant_id);
create index practitioner_home_base_idx on practitioner (home_base_location_id);
create index practitioner_created_by_idx on practitioner (created_by);
create trigger set_updated_at before update on practitioner
  for each row execute function app.set_updated_at();

-- The authorisation table: practitioner x service type x certification. Wellness
-- practitioners hold certifications (BCIA, the equipment vendor, a degree), not
-- licences; the capability flags say what each certification lets them do.
create table credential (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant (id),
  practitioner_id       uuid not null references practitioner (id),
  service_type_id       uuid not null references service_type (id),
  certification         text not null,           -- bcia_bcn, vendor_qeeg, degree, ...: open set
  certifying_body       text,                    -- BCIA, the equipment vendor, a university
  certificate_number    text,
  valid_from            date not null,
  valid_to              date,                    -- null when it does not expire
  can_author_protocol   boolean not null default false,
  can_execute_session   boolean not null default false,
  can_sign_report       boolean not null default false,
  -- evidence_document_id is added by 060_client.sql, after document exists
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references app_user (id),
  unique (practitioner_id, service_type_id, certification),
  constraint credential_valid_range check (valid_to is null or valid_to > valid_from)
);
create index credential_tenant_idx on credential (tenant_id);
create index credential_practitioner_idx on credential (practitioner_id, valid_to);
create index credential_service_type_idx on credential (service_type_id);
create index credential_created_by_idx on credential (created_by);
create trigger set_updated_at before update on credential
  for each row execute function app.set_updated_at();

-- rollback:
--   drop table if exists credential;
--   drop table if exists practitioner;
