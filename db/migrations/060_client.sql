-- 060_client.sql
-- The person receiving sessions, the people around them, their consents and their
-- documents (00-data-model.md section 3). Minors are the common case; a client
-- is not necessarily a user. The Emirates ID, when the practice needs it at all, is
-- the adult contact's, and exists only encrypted plus a keyed hash for lookup: no
-- column anywhere holds it in plain text.

create type client_status as enum ('lead', 'active', 'paused', 'closed', 'erased');
create type sex_at_birth as enum ('female', 'male', 'unknown');
create type relationship as enum ('self', 'mother', 'father', 'guardian', 'spouse', 'other');
create type consent_purpose as enum (
  'participation', 'minor_participation', 'home_visit', 'photo_video', 'research', 'marketing'
);
create type consent_status as enum ('active', 'withdrawn', 'expired', 'superseded');
create type consent_method as enum ('app_signature', 'paper_scan', 'verbal_witnessed');

create table client (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  mrn                    text not null,          -- MW-000001, allocated by domain/client
  given_name             text not null,
  family_name            text not null,
  given_name_ar          text,
  family_name_ar         text,
  date_of_birth          date,                   -- required at activation (client-record.md section 3)
  sex_at_birth           sex_at_birth,           -- optional; the qEEG normative comparison uses age and sex
  preferred_locale       locale not null default 'en',
  primary_contact_id     uuid,                   -- references contact(id), added below
  primary_location_id    uuid references location (id),
  referral_source        text,
  status                 client_status not null default 'lead',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  unique (tenant_id, mrn)
);
create index client_tenant_idx on client (tenant_id);
create index client_primary_location_idx on client (primary_location_id);
create index client_created_by_idx on client (created_by);
create index client_status_idx on client (tenant_id, status);
create trigger set_updated_at before update on client
  for each row execute function app.set_updated_at();

create table contact (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references tenant (id),
  client_id                  uuid not null references client (id),
  user_id                    uuid references app_user (id),   -- only if they log in
  relationship               relationship not null,
  is_legal_guardian          boolean not null default false,
  can_consent                boolean not null default false,
  can_receive_reports        boolean not null default false,
  can_pay                    boolean not null default false,
  phone                      text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),  -- E.164
  email                      text,
  whatsapp_opt_in            boolean not null default false,
  -- Emirates ID of the adult, optional and never required to enrol: collected only when the
  -- practice must verify the identity of the adult who consents for a minor or who is refunded.
  -- Never plain text: ciphertext plus a keyed HMAC-SHA256 (server-held key) for lookup.
  emirates_id_encrypted      bytea,
  emirates_id_hash           bytea check (emirates_id_hash is null or octet_length(emirates_id_hash) = 32),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references app_user (id),
  unique (tenant_id, emirates_id_hash),
  constraint contact_emirates_id_pair check ((emirates_id_encrypted is null) = (emirates_id_hash is null))
);
create index contact_tenant_idx on contact (tenant_id);
create index contact_client_idx on contact (client_id, created_at);
create index contact_user_idx on contact (user_id);
create index contact_created_by_idx on contact (created_by);
create trigger set_updated_at before update on contact
  for each row execute function app.set_updated_at();

alter table client
  add constraint client_primary_contact_fkey foreign key (primary_contact_id) references contact (id);
create index client_primary_contact_idx on client (primary_contact_id);

create table document (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant (id),
  client_id        uuid references client (id),   -- null for practice documents such as a practitioner's certificate
  kind             text not null,           -- referral, consent, report, setup_photo, certificate, ...: open set; never an image of an identity document
  storage_key      text not null,           -- opaque key in the versioned bucket
  mime_type        text not null,
  sha256           bytea not null check (octet_length(sha256) = 32),
  uploaded_by      uuid references app_user (id),
  retention_until  timestamptz,             -- 5 years from the client's last activity, or from upload for a practice document; computed by the application
  is_immutable     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references app_user (id),
  unique (tenant_id, storage_key)
);
create index document_tenant_idx on document (tenant_id);
create index document_client_idx on document (client_id, created_at);
create index document_uploaded_by_idx on document (uploaded_by);
create index document_created_by_idx on document (created_by);
create trigger set_updated_at before update on document
  for each row execute function app.set_updated_at();

create table consent (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  client_id              uuid not null references client (id),
  given_by_contact_id    uuid not null references contact (id),
  purpose                consent_purpose not null,
  version                integer not null check (version >= 1),   -- of the consent wording
  text_document_id       uuid not null references document (id),  -- the exact wording shown
  status                 consent_status not null default 'active',
  given_at               timestamptz not null default now(),
  withdrawn_at           timestamptz,
  expires_at             timestamptz,
  method                 consent_method not null,
  signature_document_id  uuid references document (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint consent_withdrawn_after_given check (withdrawn_at is null or withdrawn_at >= given_at)
);
create index consent_tenant_idx on consent (tenant_id);
create index consent_client_idx on consent (client_id, created_at);
create index consent_client_purpose_idx on consent (client_id, purpose, status);
create index consent_given_by_idx on consent (given_by_contact_id);
create index consent_text_document_idx on consent (text_document_id);
create index consent_signature_document_idx on consent (signature_document_id);
create index consent_created_by_idx on consent (created_by);
create trigger set_updated_at before update on consent
  for each row execute function app.set_updated_at();

-- Credentials can now point at their evidence.
alter table credential add column evidence_document_id uuid references document (id);
create index credential_evidence_document_idx on credential (evidence_document_id);

-- rollback:
--   drop index if exists credential_evidence_document_idx;
--   alter table credential drop column if exists evidence_document_id;
--   drop table if exists consent;
--   drop table if exists document;
--   alter table client drop constraint if exists client_primary_contact_fkey;
--   drop table if exists contact;
--   drop table if exists client;
--   drop type if exists consent_method;
--   drop type if exists consent_status;
--   drop type if exists consent_purpose;
--   drop type if exists relationship;
--   drop type if exists sex_at_birth;
--   drop type if exists client_status;
