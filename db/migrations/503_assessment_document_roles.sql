-- 503_assessment_document_roles.sql
-- What a filed export actually is, in the practice's own words, and which
-- condition a recording was taken under (docs/SPEC/assessment.md sections 6
-- and 7.1, amended 2026-09-06 on the founder's equipment answer).
--
-- **Why the vocabulary changes.** Migration 501 named two roles, `raw` and
-- `vendor_report`, written before anything in this repository knew what the
-- practice's equipment produced. It now does, and the workflow produces three
-- distinguishable things:
--
--   * `raw_recording` — the recording as the amplifier's software wrote it,
--     one per condition, either in the published interchange format or in the
--     software's own. `raw` is renamed to this rather than left alone: "raw"
--     described a file's relationship to a report, not what the file is, and a
--     column that has to be explained is a column that will be read wrongly.
--   * `vendor_report` — the analysis software's own report, unchanged.
--   * `session_export` — what the neurofeedback software writes at the end of
--     a session. A PDF today and, when the founder sends one, a numeric export
--     a later parser reads (spec decision 2).
--
-- **Why a rename and an addition rather than a new type.** The rename keeps
-- every row that already exists and every policy, index and function pointing
-- at the same type; a new type would mean rewriting the column and the
-- function signature for a change of two words. `alter type ... rename value`
-- moves no data at all.
--
-- **The condition is the document's own field and is never parsed from a file
-- name.** The practice's exports are named after the people in them, and a
-- file name is not a fact this platform holds about anybody. So the person
-- filing says which condition the recording was taken under, in the drawer,
-- and it is stored here.
--
-- **Nullable, on purpose.** A recording may cover both conditions in one file
-- — the practice's own native recordings do — so a recording without a
-- condition is ordinary and not a gap. What is refused is a condition on
-- anything that is not a recording: a report is not taken under a condition,
-- and a column that allowed one would invite a screen to show a fact nobody
-- recorded.
--
-- **501 is not edited**, as no merged migration ever is
-- (.claude/rules/data-model.md). Everything here is forward-only.
--
-- Needs: 500 (assessment), 501 (assessment_document, the role type and
-- app.file_assessment_document), 502 (the composite key on the link row)

------------------------------------------------------------------------------
-- 1. The words. The rename first, because the constraint below names the new
--    one; `add value` last, because a value added inside a transaction may not
--    be used inside that same transaction on every version this runs on.
------------------------------------------------------------------------------
alter type assessment_document_role rename value 'raw' to 'raw_recording';

------------------------------------------------------------------------------
-- 2. The condition a recording was taken under. Its own type rather than free
--    text: two conditions is the whole of what the practice records, and a
--    text column would hold three spellings of each within a month.
------------------------------------------------------------------------------
create type assessment_recording_condition as enum ('eyes-open', 'eyes-closed');

alter table public.assessment_document
  add column condition assessment_recording_condition;

comment on column public.assessment_document.condition is
  'Eyes open or eyes closed, where the file is a recording and covers one of them. Said by the '
  'person filing and stored here; never parsed from a file name, which in this practice is a '
  'person''s name.';

alter table public.assessment_document
  add constraint assessment_document_condition_is_a_recording
  check (condition is null or role = 'raw_recording');

------------------------------------------------------------------------------
-- 3. Filing one, with the condition beside the role.
--
--    The parameter list changes, so this is a drop and a create rather than a
--    replace. Everything else about the function is 501's and unchanged: the
--    client comes off the assessment and never from the caller, the caller
--    must be one of the three oversight roles or a practitioner the client is
--    visible to, and a second attempt with the same bytes against the same
--    measurement is handed the document that is already there.
------------------------------------------------------------------------------
drop function if exists app.file_assessment_document(
  uuid, uuid, text, text, bytea, timestamptz, assessment_document_role);

create function app.file_assessment_document(
  p_assessment_id   uuid,
  p_document_id     uuid,
  p_storage_key     text,
  p_mime_type       text,
  p_sha256          bytea,
  p_retention_until timestamptz,
  p_role            assessment_document_role,
  p_condition       assessment_recording_condition default null
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
    tenant_id, client_id, assessment_id, document_id, role, condition, created_by
  ) values (
    v_tenant_id, v_client_id, p_assessment_id, p_document_id, p_role, p_condition, v_actor_id
  );

  return p_document_id;
end
$$;
revoke execute on function app.file_assessment_document(
  uuid, uuid, text, text, bytea, timestamptz, assessment_document_role,
  assessment_recording_condition) from public;
grant execute on function app.file_assessment_document(
  uuid, uuid, text, text, bytea, timestamptz, assessment_document_role,
  assessment_recording_condition) to app_role;

------------------------------------------------------------------------------
-- 4. The third word, added last for the reason given at the top.
------------------------------------------------------------------------------
alter type assessment_document_role add value if not exists 'session_export';

-- rollback:
--   -- `session_export` cannot be taken off an enum and nothing needs it to be:
--   -- a value nothing writes is inert. Every row that used it would have to go
--   -- first in any case, and this migration files nothing.
--   drop function if exists app.file_assessment_document(
--     uuid, uuid, text, text, bytea, timestamptz, assessment_document_role,
--     assessment_recording_condition);
--   create function app.file_assessment_document(
--     p_assessment_id   uuid,
--     p_document_id     uuid,
--     p_storage_key     text,
--     p_mime_type       text,
--     p_sha256          bytea,
--     p_retention_until timestamptz,
--     p_role            assessment_document_role
--   ) returns uuid
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--     v_actor_id  uuid := app.current_actor_id();
--     v_client_id uuid;
--     v_existing  uuid;
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; a document cannot be filed.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     select a.client_id into v_client_id
--       from public.assessment a
--      where a.tenant_id = v_tenant_id and a.id = p_assessment_id;
--     if v_client_id is null then
--       raise exception 'There is no such assessment in this practice.'
--         using errcode = 'no_data_found';
--     end if;
--     if not (app.actor_has_role('owner')
--          or app.actor_has_role('admin')
--          or app.actor_has_role('lead_practitioner')
--          or app.client_visible_to_practitioner(v_client_id)) then
--       raise exception 'that record is not one you may file against'
--         using errcode = 'insufficient_privilege';
--     end if;
--     select ad.document_id into v_existing
--       from public.assessment_document ad
--       join public.document d on d.id = ad.document_id and d.tenant_id = ad.tenant_id
--      where ad.tenant_id = v_tenant_id
--        and ad.assessment_id = p_assessment_id
--        and d.sha256 = p_sha256;
--     if v_existing is not null then
--       return v_existing;
--     end if;
--     insert into public.document (
--       id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
--       uploaded_by, retention_until, is_immutable, created_by
--     ) values (
--       p_document_id, v_tenant_id, v_client_id, 'assessment_raw', p_storage_key,
--       p_mime_type, p_sha256, v_actor_id, p_retention_until, true, v_actor_id
--     );
--     insert into public.assessment_document (
--       tenant_id, client_id, assessment_id, document_id, role, created_by
--     ) values (
--       v_tenant_id, v_client_id, p_assessment_id, p_document_id, p_role, v_actor_id
--     );
--     return p_document_id;
--   end
--   $fn$;
--   revoke execute on function app.file_assessment_document(
--     uuid, uuid, text, text, bytea, timestamptz, assessment_document_role) from public;
--   grant execute on function app.file_assessment_document(
--     uuid, uuid, text, text, bytea, timestamptz, assessment_document_role) to app_role;
--   alter table public.assessment_document
--     drop constraint assessment_document_condition_is_a_recording;
--   alter table public.assessment_document drop column condition;
--   drop type if exists assessment_recording_condition;
--   alter type assessment_document_role rename value 'raw_recording' to 'raw';
