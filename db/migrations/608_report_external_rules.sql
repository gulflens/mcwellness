-- 608_report_external_rules.sql
-- The rules that name the uploaded report's kind (607), and the one door it
-- is filed through (docs/SPEC/reports-v1.md section 12).
--
-- **What an uploaded report is.** A PDF the practice produced in another
-- tool — its desktop brain-map report builder exports one — filed against a
-- client so the household can be sent it and can open it in the portal, as
-- it can a report written here. This app never renders it and never signs
-- it: **the PDF is the signed artefact**, finished (and signed, where it is
-- signed) in the tool that made it.
--
-- **Filed already issued, in one step, with no draft.** A draft exists so a
-- person can read a report over before signing it; there is nothing here to
-- read over that the uploader has not just chosen, and nothing to sign. A
-- draft-then-issue pair would be two steps with no rule between them, and a
-- draft of a file is a row the household cannot see holding a document the
-- household may already have been sent by hand. So `app.file_external_report`
-- writes the document row and the report row together, the report `issued`
-- from its first moment, and the guard of 600/603 then holds it exactly as
-- it holds a signed report: no change but marking it superseded, which no
-- route offers for this kind (a correction is a new upload).
--
-- **Numbered like every issued report.** `report_issued_is_complete` asks a
-- number of every issued row, and a household quotes one whatever made the
-- PDF: the console's list, the portal's list and the delivery message all
-- name the report by its reference. So the number comes from the same
-- counter (`app.next_report_number`, 600), taken in the filing transaction.
-- The PDF itself does not print it — it was made elsewhere — which is said
-- where the reference is shown, not hidden.
--
-- **Snapshotted like every issued report, but for the signer.** The
-- practice's identity block and the recipient block are stamped at filing,
-- as `app.issue_report` stamps them: the delivery message names the practice
-- from the row (`app/api/reports/deliver.ts`), and the recipient block is
-- what says whom the report was filed for after the client row has moved on.
-- The signer's block is the one thing an uploaded report never carries:
-- nobody signed it here, and a name in `signed_by_name` would say somebody
-- did. Who filed it is `created_by` (and the document's `uploaded_by`).
--
-- **What the row holds of the file.** Its title and its size, in `content`
-- (`{"title": ..., "byteSize": ...}`), and its date as `issued_on` — the date
-- the report bears, which the uploader gives and which has already happened.
-- The fingerprint, the storage key and the media type are the document
-- row's, as they are for every filed PDF. `content` and not new columns, for
-- the erasure's sake: `app.erase_client` (972, restated by 975) already
-- empties `content` and unlinks `document_id` on every report of the client
-- and deletes the client's documents with their bytes, so an uploaded
-- report's title — free text a person typed, which may name the household —
-- and its file both go with no change to the erasure at all. The checks
-- below admit exactly that erased shape and no other empty one.
--
-- **The same file, once per client.** A retry of the same bytes for the same
-- client hands back the report already filed rather than numbering a second
-- one, so a browser that lost the answer can ask again; the route puts the
-- bytes back where the store never received them (assessments' repair,
-- `app/api/assessments/file.ts`).
--
-- Kinds are compared as TEXT inside the function, 603's reason: it keeps the
-- body working where somebody applies 607 and this file by hand in one
-- transaction.
--
-- Needs: 600 (report, the counter, the checks this restates), 603 (the
-- current form of `report_issued_is_complete`), 607 (the value), 060
-- (document), 100 (app.current_tenant_id, app.client_erasure_gate), 095
-- (app.actor_has_role), 201 (app.client_visible_to_practitioner).

------------------------------------------------------------------------------
-- 1. The checks.
------------------------------------------------------------------------------

-- 603's "an issued one carries all of it", restated with the one exemption:
-- an uploaded report carries everything an issued report does but the
-- signer's block, which the next check forbids it.
alter table public.report drop constraint report_issued_is_complete;
alter table public.report add constraint report_issued_is_complete check (
  status in ('draft', 'imported') or (
    number is not null and issued_on is not null
    and practice_legal_name is not null
    and recipient_name is not null and recipient_record_number is not null
    and (kind = 'external' or (
      signed_at is not null and signed_by_practitioner_id is not null
      and signed_by_name is not null and signed_by_certification is not null
    ))
  )
);

alter table public.report
  -- Filed issued, never drafted, never a past record.
  add constraint report_external_is_filed
    check (kind <> 'external' or status in ('issued', 'superseded')),

  -- Nobody signed it here, so nothing says somebody did.
  add constraint report_external_is_unsigned check (
    kind <> 'external' or (
      signed_at is null and signed_by_practitioner_id is null and signed_by_name is null
      and signed_by_certification is null and signed_by_certifying_body is null
      and signed_by_certificate_number is null
    )
  ),

  -- The first of nothing, about no one service and no stretch of dates: a
  -- correction is a new upload, and what the report covers is the PDF's to
  -- say. 603's `report_links_on_qeeg` and `report_source_on_qeeg` already
  -- keep twins, comparisons and sources off it.
  add constraint report_external_stands_alone check (
    kind <> 'external' or (
      version = 1 and supersedes_id is null and amendment_reason is null
      and service_type_id is null and coverage_from is null and coverage_to is null
    )
  ),

  -- The title and the size, and nothing else; or nothing at all, which is
  -- what an erasure leaves. The title is held to what
  -- domain/reports/external.ts accepts (trimmed, 1 to 120 characters) and
  -- the size to its cap. The size is read through a `case` so a value that is
  -- not a number is a check violation rather than a failed cast.
  add constraint report_external_content check (
    kind <> 'external' or content = '{}'::jsonb or (
      jsonb_typeof(content -> 'title') = 'string'
      and char_length(content ->> 'title') between 1 and 120
      and content ->> 'title' = btrim(content ->> 'title')
      and case when jsonb_typeof(content -> 'byteSize') = 'number'
               then (content ->> 'byteSize')::numeric between 1 and 20971520
               else false end
      and content - 'title' - 'byteSize' = '{}'::jsonb
    )
  ),

  -- An uploaded report is its file. The one row without one is the erased
  -- row, whose content the same erasure emptied.
  add constraint report_external_has_document
    check (kind <> 'external' or document_id is not null or content = '{}'::jsonb);

------------------------------------------------------------------------------
-- 2. Filing one.
--
--    security definer for `app.file_report_document`'s reason (600): the
--    `document` row is written as the practice, because a practitioner — who
--    may draft a report — holds no insert on `document` of her own
--    (db/policies/client/writers.sql), and the report row is inserted already
--    issued, which the API role may not do by hand (db/policies/reports/
--    reports.sql). So this body asks every question row security would have
--    asked, in the order a person can act on:
--
--      - who is asking: the owner, the lead practitioner, or a practitioner,
--        the three who may draft a report (domain/shared/actor.ts
--        `report.draft`, and `report_writers` beneath it);
--      - whether the client is there for them: in this practice, and for a
--        practitioner on her own schedule (201). Not there is not found,
--        never a refusal that confirms whose the record is;
--      - whether the record is erased: an erased record takes nothing new;
--      - whether these bytes are already filed for this client: handed back;
--      - whether the date has happened, in the practice's own time zone.
--
--    The client comes off the caller's argument and is checked here; the
--    tenant comes off the context and nothing else, so this cannot file a
--    document into another practice.
------------------------------------------------------------------------------
create function app.file_external_report(
  p_client_id       uuid,
  p_title           text,
  p_report_date     date,
  p_byte_size       integer,
  -- The document's id is the caller's, because the storage key is built from
  -- it and the bytes are written under that key (domain/shared/storage.ts).
  p_document_id     uuid,
  p_storage_key     text,
  p_sha256          bytea,
  p_retention_until timestamptz
) returns public.report
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_client    record;
  v_existing  public.report;
  v_tenant    record;
  v_today     date;
  v_report    public.report;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a report cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_actor_id is null
     or not (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
             or app.actor_has_role('practitioner'))
  then
    raise exception 'a report is filed by the owner, the lead practitioner or a practitioner'
      using errcode = 'insufficient_privilege',
            hint    = 'Whoever may write a report may upload one.';
  end if;

  select c.id, c.status::text as status, c.mrn,
         btrim(coalesce(c.given_name, '') || ' ' || coalesce(c.family_name, '')) as name
    into v_client
    from public.client c
   where c.tenant_id = v_tenant_id and c.id = p_client_id;
  if not found
     or not (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
             or app.client_visible_to_practitioner(p_client_id))
  then
    raise exception 'There is no such client in this practice.' using errcode = 'no_data_found';
  end if;
  if v_client.status = 'erased' then
    raise exception 'an erased record takes no new report'
      using errcode = 'restrict_violation';
  end if;

  -- The same bytes for the same client: the report already filed.
  select r.* into v_existing
    from public.report r
    join public.document d on d.tenant_id = r.tenant_id and d.id = r.document_id
   where r.tenant_id = v_tenant_id and r.client_id = p_client_id
     and r.kind::text = 'external' and d.sha256 = p_sha256
   order by r.created_at, r.id
   limit 1;
  if found then
    return v_existing;
  end if;

  select t.timezone, t.legal_name, t.legal_name_ar, t.licence_number, t.licensing_authority,
         l.display_address
    into v_tenant
    from public.tenant t
    left join public.location l on l.id = t.location_id
   where t.id = v_tenant_id;
  v_today := (now() at time zone v_tenant.timezone)::date;
  if p_report_date is null or p_report_date > v_today then
    raise exception 'a report is dated on a day that has already come'
      using errcode = 'check_violation';
  end if;
  if v_client.name is null or v_client.name = '' then
    raise exception 'the client this report names could not be read'
      using errcode = 'no_data_found';
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, p_client_id, 'report', p_storage_key,
    'application/pdf', p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  );

  insert into public.report (
    tenant_id, client_id, kind, status, content, number, issued_on,
    recipient_name, recipient_record_number,
    practice_legal_name, practice_legal_name_ar, practice_address,
    practice_licence_number, practice_licensing_authority,
    document_id, created_by
  ) values (
    v_tenant_id, p_client_id, 'external'::text::public.report_kind, 'issued',
    jsonb_build_object('title', p_title, 'byteSize', p_byte_size),
    app.next_report_number(), p_report_date,
    v_client.name, v_client.mrn,
    v_tenant.legal_name, v_tenant.legal_name_ar, v_tenant.display_address,
    v_tenant.licence_number, v_tenant.licensing_authority,
    p_document_id, v_actor_id
  )
  returning * into v_report;

  return v_report;
end
$$;
revoke execute on function app.file_external_report(uuid, text, date, integer, uuid, text, bytea, timestamptz) from public;
grant execute on function app.file_external_report(uuid, text, date, integer, uuid, text, bytea, timestamptz) to app_role;

comment on function app.file_external_report(uuid, text, date, integer, uuid, text, bytea, timestamptz) is
  'Files a PDF made in another tool as an issued report of kind external: the document row and '
  'the report row together, numbered, never signed here (docs/SPEC/reports-v1.md section 12). '
  'The same bytes for the same client hand back the report already filed.';

-- rollback:
--   drop function if exists app.file_external_report(uuid, text, date, integer, uuid, text, bytea, timestamptz);
--   -- Every row of kind external must be gone first (an erasure, as the
--   -- table owner), or the restored check below refuses it.
--   alter table public.report
--     drop constraint if exists report_external_has_document,
--     drop constraint if exists report_external_content,
--     drop constraint if exists report_external_stands_alone,
--     drop constraint if exists report_external_is_unsigned,
--     drop constraint if exists report_external_is_filed;
--   alter table public.report drop constraint report_issued_is_complete;
--   alter table public.report add constraint report_issued_is_complete check (
--     status in ('draft', 'imported') or (
--       number is not null and issued_on is not null and signed_at is not null
--       and signed_by_practitioner_id is not null and signed_by_name is not null
--       and signed_by_certification is not null and practice_legal_name is not null
--       and recipient_name is not null and recipient_record_number is not null
--     )
--   );
