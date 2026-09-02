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

-- rollback:
--   alter table document drop constraint if exists document_tenant_id_id_key;
--   alter table consent drop constraint if exists consent_tenant_id_id_key;
--   alter table contact drop constraint if exists contact_tenant_id_id_key;
--   alter table client drop constraint if exists client_tenant_id_id_key;
--   alter table credential drop constraint if exists credential_tenant_id_id_key;
--   alter table practitioner drop constraint if exists practitioner_tenant_id_id_key;
--   alter table service_type drop constraint if exists service_type_tenant_id_id_key;
--   alter table location drop constraint if exists location_tenant_id_id_key;
--   alter table user_role drop constraint if exists user_role_tenant_id_id_key;
--   alter table app_user drop constraint if exists app_user_tenant_id_id_key;
