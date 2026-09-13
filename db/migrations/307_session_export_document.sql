-- 307_session_export_document.sql
-- The export the practice's own software wrote, attached to the visit
-- (docs/SPEC/session-capture.md section 3.6; the operator, 13 September 2026).
--
-- The practice runs its brain mapping and neurofeedback on professional
-- software, on a Windows laptop the practitioner carries as part of the
-- equipment. Earlier in this round the visit stopped asking anybody to
-- transcribe figures off that software's screen (migration 918); this is the
-- other half — the practitioner attaches the software's exported result file
-- to the visit instead.
--
-- **A file on a session is already a solved problem here.** The setup
-- photograph has referenced `document` since 302 and was filed through one
-- narrow door in 306, so this is the same reference under a second name
-- rather than a second mechanism. Everything below is that shape: a nullable
-- uuid on `session`, an index on it, and one security definer door the API
-- role may call and nothing else.
--
-- **Nullable and never required.** A practitioner standing in someone's home
-- must always be able to close the visit; a missing export is a marker on the
-- record, not a gate. `domain/session/canCheckIn.ts` gates entry and nothing
-- gates exit, and that stays true.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 050 (practitioner, whose active row the door below
-- requires), 060 (client, document), 095 (app.current_actor_id), 300
-- (session) and 302 (session.setup_photo_document_id, the shape this column
-- copies, and the close guard this file deliberately does not touch).

------------------------------------------------------------------------------
-- 1. The column.
--
-- `on delete set null`, which `setup_photo_document_id` does not carry, and
-- the difference is deliberate rather than a slip.
--
-- Every other reference to `document` in this schema has no `on delete`, and
-- each one had to be unlinked by name inside `app.erase_client` before step
-- 6's delete of a household's documents could run at all — 105 for the setup
-- photograph, 106 for an assessment's files, 107 for a report, 954 for a
-- rendered tax document. That function lives in the trunk's 950-999 half,
-- which sorts *after* every stream's range: a `create or replace` from 307
-- would be overwritten by 954 on any fresh database, so this stream cannot
-- teach it a new column name and must not pretend to.
--
-- Leaving the reference bare would therefore break every erasure of a
-- household that ever had an export attached — the exact fault 105 found on
-- the setup photograph, discovered again a year later. `on delete set null`
-- puts the unlink where this stream can actually put it, and it holds
-- whichever definition of `app.erase_client` a database is carrying.
--
-- It cannot fire outside an erasure: the row is filed `is_immutable`, and
-- migration 903 refuses to delete an immutable document unless
-- `app.erasure_active` names the transaction. And inside an erasure the close
-- guard stands aside for the same reason (302, 960), so the referential
-- action reaches a frozen visit exactly as the erasure's own update does.
-- Naming the column in a later `app.erase_client` would be harmless and
-- redundant, not a correction.
------------------------------------------------------------------------------
alter table public.session
  add column export_document_id uuid references public.document (id) on delete set null;

-- The foreign key Postgres does not index for us, matching
-- session_setup_photo_idx beside it.
create index session_export_document_idx on public.session (export_document_id);

comment on column public.session.export_document_id is
  'The practice software''s exported result for this visit, filed by '
  'app.file_session_export. Optional; never blocks check-out. Unlinked by the '
  'foreign key''s own on delete set null when an erasure removes the document, '
  'because app.erase_client sorts after this stream''s range and cannot be taught '
  'the column here (docs/SPEC/OWNERSHIP.md).';

------------------------------------------------------------------------------
-- 2. The door the bytes' row goes through.
--
-- db/policies/client/writers.sql gives filing a client document to the owner,
-- an admin and the lead practitioner, and deliberately not to a practitioner.
-- That is the right rule for the filing cabinet and the wrong one for the one
-- row a visit produces, and widening it would hand a practitioner every kind
-- of document against every client they can see. So this is a door and not a
-- widening, in the shape 301, 302 and 306 already set: security definer,
-- granted to the API role, able to do exactly one thing.
--
-- It files a `session_export` against the client of the caller's own **open**
-- visit, with the key the caller computed from ids alone, and refuses
-- everything else — another client, another practitioner's visit, a visit
-- already closed, and a second export on a visit that already names a
-- different one.
--
-- **Open only, and that is the whole of it.** Migration 960 took away the one
-- change a closed visit admitted, on the ground that a guard with nothing to
-- guard is a guard somebody later mistakes for permission. Nothing here asks
-- for it back: the attach control sits on the Summary step, where the
-- practitioner is finishing the visit on the same laptop the export sits on,
-- so the file is attached before check-out or not at all.
--
-- **Idempotent on the digest**, the way app.file_assessment_document (501)
-- is: a browser that retries after a dropped connection is handed the same
-- document rather than filing a second one. A *different* file against a
-- visit that already has one is refused rather than silently replacing it —
-- the column is singular, and a filed evidence document is never replaced
-- (docs/SEAMS.md).
--
-- Immutable, like every other piece of evidence. `retention_until` follows
-- the client's own activity and is computed by the application
-- (`documentRetentionUntil` in domain/shared/storage.ts), as
-- 00-data-model.md section 3 requires, and never by this function.
--
-- Returns the document id that now stands against the visit, or null when the
-- filing is refused. Null rather than a raise, because the route turns each
-- refusal into an answer a browser can act on and a raise would take the
-- request's whole transaction down with it.
------------------------------------------------------------------------------
create function app.file_session_export(
  p_session_id      uuid,
  -- The document's id is the caller's, not a default, because the storage key
  -- is built from it (domain/shared/storage.ts) and the bytes are written
  -- under that key.
  p_document_id     uuid,
  p_storage_key     text,
  p_mime_type       text,
  p_sha256          bytea,
  p_retention_until timestamptz
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_client_id uuid;
  v_existing  uuid;
  v_updated   integer;
begin
  -- The two the export's own door accepts (domain/assessment/fileType.ts):
  -- the analysis software's PDF, and a recording as bytes with no registered
  -- type. Which of the three kinds the bytes actually are is decided from the
  -- bytes themselves, in the route, before this is ever called.
  if p_mime_type not in ('application/pdf', 'application/octet-stream') then
    raise exception 'an export is a pdf or a recording'
      using errcode = 'check_violation';
  end if;

  -- Two requests can reach this at once: a browser that retried while the
  -- first attempt was still in flight. The row is locked before it is read,
  -- so the second one waits and then sees what the first wrote, rather than
  -- both reading a null column and one of them inserting a document the
  -- session never comes to name. `for no key update` is the weakest lock that
  -- does it — it does not block the reads every other route makes of this
  -- visit, only another writer of the same row.
  perform 1 from public.session s
    where s.id = p_session_id and s.tenant_id = v_tenant_id
    for no key update;

  -- The visit must be the caller's own and still open, and the caller must be
  -- somebody the practice still has working. Checked here rather than
  -- trusted, because security definer means row security is not going to
  -- check it for us.
  select s.client_id, s.export_document_id
    into v_client_id, v_existing
    from public.session s
    join public.practitioner p on p.id = s.practitioner_id
   where s.id = p_session_id
     and s.tenant_id = v_tenant_id
     and p.tenant_id = v_tenant_id
     and p.user_id = v_actor_id
     and p.status = 'active'
     and s.closed_at is null;

  if v_client_id is null then
    return null;
  end if;

  if v_existing is not null then
    -- The same bytes again: hand back what is already filed. Anything else is
    -- a second export on a visit whose column holds one, and is refused.
    return (
      select d.id
        from public.document d
       where d.id = v_existing
         and d.tenant_id = v_tenant_id
         and d.sha256 = p_sha256
    );
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, 'session_export', p_storage_key, p_mime_type,
    p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  );

  update public.session s
     set export_document_id = p_document_id
   where s.id = p_session_id
     and s.tenant_id = v_tenant_id
     -- From null to a value, once, on a visit still open. Repeated from the
     -- read above so two requests racing each other cannot both write.
     and s.export_document_id is null
     and s.closed_at is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    -- Unreachable while the lock above is held: the same predicate answered a
    -- moment ago and nothing else may have written the row since. Raised
    -- rather than swallowed, because the alternative is a document row nothing
    -- names, and deleting it here is not open to this function anyway —
    -- migration 903 refuses to delete an immutable document outside an
    -- erasure. A raise takes the request's own transaction down with it, which
    -- is exactly right for a state that should not exist.
    raise exception 'the visit % changed underneath the export being filed', p_session_id
      using errcode = 'serialization_failure';
  end if;

  return p_document_id;
end
$$;
revoke execute on function app.file_session_export(uuid, uuid, text, text, bytea, timestamptz)
  from public;
grant execute on function app.file_session_export(uuid, uuid, text, text, bytea, timestamptz)
  to app_role;

-- rollback:
--   drop function if exists app.file_session_export(uuid, uuid, text, text, bytea, timestamptz);
--   drop index if exists session_export_document_idx;
--   alter table public.session drop column if exists export_document_id;
