-- 501_assessment_document.sql
-- Where the equipment's own files are filed against the measurement they
-- produced (docs/SPEC/assessment.md sections 6 and 7.1).
--
-- **Why a link table and not a column.** `00-data-model.md` section 4 sketches
-- `assessment.raw_document_id`, one file per measurement. One brain map
-- produces several: an eyes-open recording, an eyes-closed recording, and the
-- software's own report. A single column forces a choice between them and
-- loses the rest, so this is a table, and the change to the model is a change
-- request rather than an edit (docs/CHANGE-REQUESTS/assessment-01.md item 1).
--
-- **The composite key binds the file to the assessment's own client**, the
-- pattern `billing_document` (407) sets: `(tenant_id, assessment_id,
-- client_id)` references the assessment's own three columns, so a link row can
-- never claim a client the assessment does not have. `document` carries no
-- `(tenant_id, id, client_id)` key of its own to point the same kind of
-- foreign key at — that would be an alter of a core table, which is the
-- trunk's — so the second half of the binding is a guard trigger below, which
-- refuses a link naming a document filed against anybody else. The two
-- together are what section 11's "an `assessment_document` naming another
-- client's document is refused" asks for.
--
-- **Nothing inserts into this table directly.** app_role holds select alone;
-- the only way a row arrives is `app.file_assessment_document`, which reads
-- the client off the assessment itself, writes the `document` row and the link
-- together or neither, and cannot be asked to file against a client a caller
-- names. That is 407's own reasoning, and it is what keeps a security definer
-- function from being a way to file a document against anybody's record.
--
-- **The bytes are not this migration's.** The document row names a
-- `storage_key`; what is behind it goes through the storage seam
-- (docs/SEAMS.md) from the route, after the row. Nothing in SQL talks to a
-- store.
--
-- Needs: 010 (tenant), 020 (app_user), 060 (client, document), 080
-- (app.audit_row, app.set_updated_at), 095 (app.current_actor_id), 098
-- (app.erasure_active), 099 (the tenant-scoped keys on client and document),
-- 500 (assessment, and the (tenant_id, id, client_id) key it carries).

create type assessment_document_role as enum ('raw', 'vendor_report');

create table assessment_document (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id),
  -- Denormalised so the audit trigger attributes the row to a client without a
  -- join (097), and bound to the assessment's own client by the composite key
  -- below so it can never name a different one.
  client_id      uuid not null references client (id),
  assessment_id  uuid not null,
  document_id    uuid not null,
  role           assessment_document_role not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_user (id),
  constraint assessment_document_tenant_id_id_key unique (tenant_id, id),
  -- A document is filed against one assessment, once.
  constraint assessment_document_one_per_document unique (tenant_id, document_id),
  constraint assessment_document_client_fk
    foreign key (tenant_id, client_id) references client (tenant_id, id),
  constraint assessment_document_document_fk
    foreign key (tenant_id, document_id) references document (tenant_id, id),
  constraint assessment_document_assessment_fk
    foreign key (tenant_id, assessment_id, client_id)
    references assessment (tenant_id, id, client_id)
);
comment on table public.assessment_document is 'audited: client';

create index assessment_document_tenant_idx on assessment_document (tenant_id);
create index assessment_document_client_idx on assessment_document (client_id);
create index assessment_document_assessment_idx on assessment_document (assessment_id);
create index assessment_document_created_by_idx on assessment_document (created_by);

create trigger set_updated_at before update on assessment_document
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on assessment_document
  for each row execute function app.audit_row();
alter table public.assessment_document enable always trigger audit_row;

------------------------------------------------------------------------------
-- The other half of the binding: the document must be this client's own.
--
-- The composite foreign key above ties the link's client to the assessment's.
-- This ties it to the document's, which no foreign key can do while `document`
-- has no `(tenant_id, id, client_id)` key — and a practice document, filed
-- against no client at all, is not evidence of anybody's measurement either.
------------------------------------------------------------------------------
create function app.assessment_document_is_the_clients() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_document_client uuid;
begin
  select d.client_id into v_document_client
    from public.document d
   where d.id = new.document_id and d.tenant_id = new.tenant_id;
  if v_document_client is distinct from new.client_id then
    raise exception 'that document is not filed against this assessment''s client'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end
$$;
revoke execute on function app.assessment_document_is_the_clients() from public;

create trigger the_document_is_the_clients before insert or update on public.assessment_document
  for each row execute function app.assessment_document_is_the_clients();
alter table public.assessment_document enable always trigger the_document_is_the_clients;

------------------------------------------------------------------------------
-- Filing one. The document row and the link together, or neither.
--
-- `p_retention_until` is the application's arithmetic, never invented here:
-- `documentRetentionUntil` in domain/shared/storage.ts is the one place that
-- decides how long a document is kept.
--
-- **Idempotent on the digest.** A device or a browser whose connection dropped
-- after the server committed asks again, and is handed the same document
-- rather than a second row over the same bytes. A different file against the
-- same assessment is an ordinary second file — one brain map produces several
-- — so the key is the assessment and the digest, not the assessment alone.
--
-- **It checks who is asking**, because security definer means row security is
-- not going to: the caller must be one of the three oversight roles or a
-- practitioner the client is visible to. Section 7.2 admits an admin filing an
-- export against an assessment a practitioner recorded, and admits nobody
-- filing against a record they may not read.
------------------------------------------------------------------------------
create function app.file_assessment_document(
  p_assessment_id   uuid,
  -- The document's id is the caller's, not a default, because the storage key
  -- is built from it (domain/shared/storage.ts) and the bytes are written
  -- under that key.
  p_document_id     uuid,
  p_storage_key     text,
  p_mime_type       text,
  p_sha256          bytea,
  p_retention_until timestamptz,
  p_role            assessment_document_role
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_client_id uuid;
  v_existing  uuid;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a document cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The client comes off the assessment, never from the caller.
  select a.client_id into v_client_id
    from public.assessment a
   where a.tenant_id = v_tenant_id and a.id = p_assessment_id;
  if v_client_id is null then
    raise exception 'There is no such assessment in this practice.'
      using errcode = 'no_data_found';
  end if;

  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('lead_practitioner')
       or app.client_visible_to_practitioner(v_client_id)) then
    raise exception 'that record is not one you may file against'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already filed, same bytes: hand back what is there. A filed evidence
  -- document is never replaced (docs/SEAMS.md).
  select ad.document_id into v_existing
    from public.assessment_document ad
    join public.document d on d.id = ad.document_id and d.tenant_id = ad.tenant_id
   where ad.tenant_id = v_tenant_id
     and ad.assessment_id = p_assessment_id
     and d.sha256 = p_sha256;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, 'assessment_raw', p_storage_key,
    p_mime_type, p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  );

  insert into public.assessment_document (
    tenant_id, client_id, assessment_id, document_id, role, created_by
  ) values (
    v_tenant_id, v_client_id, p_assessment_id, p_document_id, p_role, v_actor_id
  );

  return p_document_id;
end
$$;
revoke execute on function app.file_assessment_document(
  uuid, uuid, text, text, bytea, timestamptz, assessment_document_role) from public;
grant execute on function app.file_assessment_document(
  uuid, uuid, text, text, bytea, timestamptz, assessment_document_role) to app_role;

------------------------------------------------------------------------------
-- Privileges. Read only: the one way a row arrives is the function above, and
-- a filed document is never changed or removed by the API (migration 903 says
-- the same of the `document` row it points at). An erasure takes the link away
-- as the owner, which needs no grant here.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.assessment_document enable row level security;
  revoke all on public.assessment_document from public;
  if has_api_roles then
    revoke all on public.assessment_document from anon, authenticated;
  end if;
  grant select on public.assessment_document to app_role;
end
$$;

-- rollback:
--   revoke select on public.assessment_document from app_role;
--   drop function if exists app.file_assessment_document(
--     uuid, uuid, text, text, bytea, timestamptz, assessment_document_role);
--   drop trigger if exists the_document_is_the_clients on public.assessment_document;
--   drop function if exists app.assessment_document_is_the_clients();
--   drop trigger if exists audit_row on public.assessment_document;
--   drop table if exists public.assessment_document;
--   drop type if exists assessment_document_role;
--   -- The `document` rows and the bytes behind them are not removed here: a
--   -- filed document is immutable and an erasure is what takes one away.
