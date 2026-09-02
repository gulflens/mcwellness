-- 099_tenant_scoped_keys.sql
-- The last file in the core range (000 to 099): docs/SPEC/OWNERSHIP.md moves
-- the trunk's own migrations to 900-999 from here, because this file spends
-- the range's final number on something every stream needs.
--
-- Every stream table today binds one core row by id alone (a `session`
-- referencing `client(id)`, an `appointment` referencing `practitioner(id)`,
-- and so on). A plain foreign key has no opinion on tenant - it is satisfied
-- the moment the id exists, whichever tenant it belongs to - so a bug that
-- writes the wrong tenant_id onto a stream row is caught only by row-level
-- security filtering it out of a later query, never by the write itself
-- being refused. A composite foreign key closes that gap outright: from
-- here on, a stream's foreign key to a core table is written
--
--   (tenant_id, <core>_id) references <core> (tenant_id, id)
--
-- which Postgres can only satisfy when both columns agree with a single row
-- of the target table, so a reference across tenants is a foreign-key
-- violation at insert or update time, not merely an invisible row later.
-- This migration adds the unique (tenant_id, id) key each core table needs
-- to be the target of such a foreign key; it changes no existing column,
-- adds no new one, and every table it touches already carries tenant_id
-- not null (00-data-model.md section 1). `tenant` itself is not here: it
-- carries no tenant_id (it is the tenant, .claude/rules/data-model.md), and
-- its own id is already the whole key a foreign key needs.
--
-- Each table added here also drops its old single-column `<table>_tenant_idx`
-- (created alongside the table, 020 to 060). The unique index Postgres builds
-- to enforce (tenant_id, id) leads with tenant_id too, so any plan that used
-- to reach for the single-column index still has an index it can use - the
-- old one just becomes dead weight: the same leading column, more bytes on
-- disk, and one more index for every write on these tables to maintain, for
-- no query a planner would ever prefer it over the wider one for.
--
-- Needs: 010 (tenant, for tenant_id itself), 020 (app_user, user_role), 030
-- (location), 040 (service_type), 050 (practitioner, credential), 060
-- (client, contact, consent, document).

alter table app_user
  add constraint app_user_tenant_id_id_key unique (tenant_id, id);
alter table user_role
  add constraint user_role_tenant_id_id_key unique (tenant_id, id);
alter table location
  add constraint location_tenant_id_id_key unique (tenant_id, id);
alter table service_type
  add constraint service_type_tenant_id_id_key unique (tenant_id, id);
alter table practitioner
  add constraint practitioner_tenant_id_id_key unique (tenant_id, id);
alter table credential
  add constraint credential_tenant_id_id_key unique (tenant_id, id);
alter table client
  add constraint client_tenant_id_id_key unique (tenant_id, id);
alter table contact
  add constraint contact_tenant_id_id_key unique (tenant_id, id);
alter table consent
  add constraint consent_tenant_id_id_key unique (tenant_id, id);
alter table document
  add constraint document_tenant_id_id_key unique (tenant_id, id);

drop index app_user_tenant_idx;
drop index user_role_tenant_idx;
drop index location_tenant_idx;
drop index service_type_tenant_idx;
drop index practitioner_tenant_idx;
drop index credential_tenant_idx;
drop index client_tenant_idx;
drop index contact_tenant_idx;
drop index consent_tenant_idx;
drop index document_tenant_idx;

-- rollback:
--   -- cascade: by the time anyone rolls this back, a stream may already have
--   -- written its own composite foreign key - (tenant_id, <core>_id)
--   -- references <core> (tenant_id, id) - against one of these keys, and
--   -- that foreign key can only exist because the unique constraint does.
--   -- Dropping the constraint takes any such dependent foreign key with it;
--   -- this is only ever safe before a stream has taken up the shape, which
--   -- is what every rollback in this range assumes (docs/SPEC/OWNERSHIP.md).
--   alter table document drop constraint if exists document_tenant_id_id_key cascade;
--   alter table consent drop constraint if exists consent_tenant_id_id_key cascade;
--   alter table contact drop constraint if exists contact_tenant_id_id_key cascade;
--   alter table client drop constraint if exists client_tenant_id_id_key cascade;
--   alter table credential drop constraint if exists credential_tenant_id_id_key cascade;
--   alter table practitioner drop constraint if exists practitioner_tenant_id_id_key cascade;
--   alter table service_type drop constraint if exists service_type_tenant_id_id_key cascade;
--   alter table location drop constraint if exists location_tenant_id_id_key cascade;
--   alter table user_role drop constraint if exists user_role_tenant_id_id_key cascade;
--   alter table app_user drop constraint if exists app_user_tenant_id_id_key cascade;
--   -- Recreate the single-column indexes this migration dropped in their place.
--   create index app_user_tenant_idx on app_user (tenant_id);
--   create index user_role_tenant_idx on user_role (tenant_id);
--   create index location_tenant_idx on location (tenant_id);
--   create index service_type_tenant_idx on service_type (tenant_id);
--   create index practitioner_tenant_idx on practitioner (tenant_id);
--   create index credential_tenant_idx on credential (tenant_id);
--   create index client_tenant_idx on client (tenant_id);
--   create index contact_tenant_idx on contact (tenant_id);
--   create index consent_tenant_idx on consent (tenant_id);
--   create index document_tenant_idx on document (tenant_id);
