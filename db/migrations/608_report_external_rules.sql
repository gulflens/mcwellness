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
-- route offers for this kind (a correction is a new upload), and the one
-- change of section 3, the withdraw.
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
-- (`{"externalReportTitle": ..., "byteSize": ...}`), and its date as
-- `issued_on` — the date the report bears, which the uploader gives and which
-- has already happened. The fingerprint, the storage key and the media type
-- are the document row's, as they are for every filed PDF. `content` and not
-- new columns, for the erasure's sake: `app.erase_client` (972, restated by
-- 975) already empties `content` and unlinks `document_id` on every report of
-- the client and deletes the client's documents with their bytes, so the
-- row's copy of the title and the file both go with no change to the
-- erasure. The checks below admit exactly that erased shape and no other
-- empty one.
--
-- **The trail's copy of the title is another matter.** `app.audit_row` (080)
-- writes the whole row into the append-only `audit_log` on every insert and
-- update, and no erasure reaches that table; a title — free text a person
-- typed, which may name the household — would outlive the household's
-- erasure there. So the key is named `externalReportTitle`, a name nothing
-- else in the schema uses, and migration 979 makes `app.audit_redact` drop it
-- wherever it appears one level down: the trail says `content` changed and
-- never what the title was. (The key could not be dropped here: 975 restates
-- `app.audit_redact` and sorts after this file.)
--
-- **The same file, once per client.** A retry of the same bytes for the same
-- client hands back the report already filed rather than numbering a second
-- one, so a browser that lost the answer can ask again; the route puts the
-- bytes back where the store never received them (assessments' repair,
-- `app/api/assessments/file.ts`). Two presses at once are one filing: the
-- function takes a transaction lock on the client and the fingerprint before
-- it looks, so the second waits for the first to commit and then finds it. A
-- withdrawn report is not handed back — its file is gone, and filing the
-- same bytes again is how a withdraw made in error is undone.
--
-- **Withdrawn, never deleted** (section 3). The household sees an uploaded
-- report the moment it is filed, so one filed against the wrong client, or
-- the wrong file, has to come out of the portal at once.
-- `app.withdraw_external_report` stamps the row (`withdrawn_at`,
-- `withdraw_reason`: 602's columns and 602's rule for the reason), clears the
-- title, and leaves the number, the date, the recipient block and the
-- document link where they are, so the trail and the console still say which
-- report it was. The portal stops listing it (db/policies/reports/
-- reports.sql), the console stops opening and sending it, and the route
-- deletes its bytes after the commit; what the store would not give up then,
-- the hourly erasure sweep takes (`sweepWithdrawnReportFiles`), asking the
-- store as the erasure's sweep does rather than a column that could be wrong.
--
-- Kinds are compared as TEXT inside the function, 603's reason: it keeps the
-- body working where somebody applies 607 and this file by hand in one
-- transaction.
--
-- Needs: 600 (report, the counter, the checks this restates), 602 (the
-- withdraw stamp), 603 (the current form of `report_issued_is_complete`,
-- `report_withdraw_only_imported` and `app.guard_report_write`), 607 (the
-- value), 060
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
  -- what an erasure or a withdraw leaves. The title is held to what
  -- domain/reports/external.ts accepts (trimmed, 1 to 120 characters) and
  -- the size to its cap. The size is read through a `case` so a value that is
  -- not a number is a check violation rather than a failed cast.
  add constraint report_external_content check (
    kind <> 'external' or content = '{}'::jsonb or (
      jsonb_typeof(content -> 'externalReportTitle') = 'string'
      and char_length(content ->> 'externalReportTitle') between 1 and 120
      and content ->> 'externalReportTitle' = btrim(content ->> 'externalReportTitle')
      and case when jsonb_typeof(content -> 'byteSize') = 'number'
               then (content ->> 'byteSize')::numeric between 1 and 20971520
               else false end
      and content - 'externalReportTitle' - 'byteSize' = '{}'::jsonb
    )
  ),

  -- An uploaded report is its file. The one row without one is the erased
  -- row, whose content the same erasure emptied.
  add constraint report_external_has_document
    check (kind <> 'external' or document_id is not null or content = '{}'::jsonb),

  -- A withdrawn upload has had its title taken off, as a withdrawn past
  -- record has had its content.
  add constraint report_external_withdrawn_is_empty
    check (kind <> 'external' or withdrawn_at is null or content = '{}'::jsonb);

-- 603's "the withdraw stamp only on a past record", restated with the one
-- other row that may carry it: an uploaded report (section 3).
alter table public.report drop constraint report_withdraw_only_imported;
alter table public.report add constraint report_withdraw_only_imported
  check (withdrawn_at is null or status = 'imported' or (kind = 'external' and status = 'issued'));

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
--      - whether these bytes are already filed for this client, and not
--        withdrawn: handed back, under a lock so two presses file once;
--      - whether the date has happened, in the practice's own time zone —
--        refused as a check violation carrying the hint
--        `report_date_in_future`, which is the one signal the route reads as
--        that answer (any other check violation is a fault, not a date).
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

  -- One filing of these bytes for this client at a time: without it, two
  -- presses both find nothing below and both file, two numbers for one PDF.
  -- Held to the commit, so the second press finds the first one's row.
  perform pg_advisory_xact_lock(
    hashtext('external-report:' || p_client_id::text || ':' || encode(p_sha256, 'hex')));

  -- The same bytes for the same client: the report already filed.
  select r.* into v_existing
    from public.report r
    join public.document d on d.tenant_id = r.tenant_id and d.id = r.document_id
   where r.tenant_id = v_tenant_id and r.client_id = p_client_id
     and r.kind::text = 'external' and d.sha256 = p_sha256
     and r.withdrawn_at is null
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
      using errcode = 'check_violation', hint = 'report_date_in_future';
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
    jsonb_build_object('externalReportTitle', p_title, 'byteSize', p_byte_size),
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

------------------------------------------------------------------------------
-- 3. Withdrawing one.
--
--    The guard, restated whole from 603 with one arm added, (c): an uploaded
--    report, issued and not yet withdrawn, may be stamped withdrawn once with
--    its title cleared and nothing else moving. Then the door that makes that
--    change, security definer for the filing door's reason (the document row
--    is read whoever is asking, and the question is asked in sentences
--    before the guard asks it structurally):
--
--      - who is asking: whoever may file one (section 2's three roles);
--      - the reason: more than white space, at most 200 characters (602's
--        `report_withdraw_together` holds the same);
--      - whether the report is there for them: this practice, and for a
--        practitioner a client on her schedule. Not there is not found;
--      - whether it is an uploaded report, still issued: a report written
--        here is corrected by a new version, never withdrawn;
--      - whether the record is erased: an erased record has nothing left to
--        withdraw;
--      - whether it is already withdrawn: answered, not refused, with the
--        same storage key, so a retry still deletes bytes the first attempt
--        could not.
--
--    The reason is stamped on the transaction first (`app.reason`), so the
--    report row's own audit row carries it, as 977's archive does. The answer
--    is the storage key of the file, which the route deletes after the commit
--    — a store cannot be rolled back — and the sweep deletes later if that
--    fails. The document row stays: it is immutable (903), it is what the
--    report row's link names, and it says which bytes were filed and by whom.
------------------------------------------------------------------------------
create or replace function app.guard_report_write() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- Who may keep a past record, withdraw one, or mark a version superseded:
  -- the owner or the lead practitioner, or nobody at all where no role has
  -- been assumed — the owner's own maintenance, a migration, the seed, never a
  -- request through the API, which always stamps a role
  -- (app.guard_erasure_request_write sets the precedent).
  v_owner_or_lead boolean :=
    nullif(current_setting('app.actor_roles', true), '') is null
    or app.actor_has_role('owner')
    or app.actor_has_role('lead_practitioner');
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status::text = 'draft' then
      -- A draft is work in progress and may be abandoned. The API role holds
      -- no delete grant, so this is the owner's own maintenance and the seed's.
      return old;
    end if;
    if old.status::text = 'imported' then
      raise exception 'a past record is withdrawn, never deleted'
        using errcode = 'restrict_violation',
              hint    = 'Withdraw it with a reason; the stamp of what was brought in stays.';
    end if;
    raise exception 'a signed report is never deleted; correct it with a new version'
      using errcode = 'restrict_violation',
            hint    = 'A household may already hold it.';
  end if;

  if old.status::text = 'draft' then
    -- Keeping a past record (app.keep_imported_report). The row's own checks
    -- say what a past record must be; this says who may make one.
    if new.status::text = 'imported' and not v_owner_or_lead then
      raise exception 'a past record is kept by the owner or the lead practitioner'
        using errcode = 'insufficient_privilege',
              hint    = 'A practitioner may read one over; keeping it is not theirs.';
    end if;
    return new;
  end if;

  -- A kept past record. One change and no other: the withdraw, once — the
  -- stamp set, the content cleared, and nothing else on the row moving. The
  -- stamp's own check asks for the reason; this asks that nothing rides along
  -- with it. Structural, for (a)'s reason below.
  if old.status::text = 'imported' then
    if old.withdrawn_at is null and new.withdrawn_at is not null
       and new.content = '{}'::jsonb
       and (to_jsonb(new) - array['content', 'withdrawn_at', 'withdraw_reason',
                                  'reference', 'other_locale', 'comparable_id', 'updated_at'])
           is not distinct from
           (to_jsonb(old) - array['content', 'withdrawn_at', 'withdraw_reason',
                                  'reference', 'other_locale', 'comparable_id', 'updated_at'])
    then
      if v_owner_or_lead then
        return new;
      end if;
      raise exception 'a past record is withdrawn by the owner or the lead practitioner'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'past record % is kept as it was brought in and cannot be changed', old.id
      using errcode = 'restrict_violation',
            hint    = 'Kept against the wrong client, it is withdrawn once, with a reason.';
  end if;

  -- (c) An uploaded report withdrawn (608, section 3): filed against the
  --     wrong client, or the wrong file. Once — the stamp set, the title
  --     cleared, nothing else on the row moving — so the number, the date, the
  --     recipient block and the document link stay for the trail. By whoever
  --     may file one; `app.withdraw_external_report` asks first, in sentences.
  if old.kind::text = 'external' and old.status::text = 'issued'
     and old.withdrawn_at is null and new.withdrawn_at is not null
     and new.content = '{}'::jsonb
     and (to_jsonb(new) - array['content', 'withdrawn_at', 'withdraw_reason',
                                'reference', 'other_locale', 'comparable_id', 'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['content', 'withdrawn_at', 'withdraw_reason',
                                'reference', 'other_locale', 'comparable_id', 'updated_at'])
  then
    if v_owner_or_lead or app.actor_has_role('practitioner') then
      return new;
    end if;
    raise exception 'an uploaded report is withdrawn by whoever may file one'
      using errcode = 'insufficient_privilege';
  end if;

  -- (a) The PDF being filed against the row that was just issued, and nothing
  --     else moving with it. Structural — the whole row minus the columns this
  --     transition is allowed to touch, compared as one value — so a column
  --     added to this table later is guarded by this trigger rather than
  --     slipping past an enumerated list (105's own guard does the same).
  --
  --     `reference` is excluded from both comparisons for a reason that is not
  --     about permission at all: it is a generated column, and Postgres
  --     computes a generated column *after* the before-update triggers have
  --     run, so `new.reference` is null here on every update while `old`
  --     carries the value. It would therefore read as a change on every row
  --     that has a number. Nothing is lost by leaving it out: it is generated
  --     from `number`, which is compared, so a reference cannot move unless
  --     the number it is made from does. `other_locale` (602) and
  --     `comparable_id` (above) are generated too, and left out for the same
  --     reason: each is made from columns that are compared.
  if old.document_id is null and new.document_id is not null
     and (to_jsonb(new) - array['document_id', 'reference', 'other_locale', 'comparable_id',
                                'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['document_id', 'reference', 'other_locale', 'comparable_id',
                                'updated_at'])
  then
    return new;
  end if;

  -- (b) The standing version being replaced by a later one, by the owner or
  --     the lead practitioner and nobody else.
  if old.status::text = 'issued' and new.status::text = 'superseded'
     and (to_jsonb(new) - array['status', 'reference', 'other_locale', 'comparable_id',
                                'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['status', 'reference', 'other_locale', 'comparable_id',
                                'updated_at'])
  then
    if v_owner_or_lead then
      return new;
    end if;
    raise exception 'a signed report is replaced by the owner or the lead practitioner'
      using errcode = 'insufficient_privilege',
            hint    = 'A practitioner may draft one and may sign it; hiding a version a '
                      'household already holds is not theirs.';
  end if;

  raise exception 'report % is signed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation',
          hint    = 'A correction is a new version with a reason; both are kept.';
end
$$;
revoke execute on function app.guard_report_write() from public;

create function app.withdraw_external_report(p_report_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_reason    text := nullif(btrim(p_reason), '');
  v_report    record;
  v_key       text;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a report cannot be withdrawn.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_actor_id is null
     or not (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
             or app.actor_has_role('practitioner'))
  then
    raise exception 'an uploaded report is withdrawn by the owner, the lead practitioner or a practitioner'
      using errcode = 'insufficient_privilege',
            hint    = 'Whoever may upload a report may withdraw one.';
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'a withdraw carries a reason of at most 200 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.id, r.client_id, r.kind::text as kind, r.status::text as status,
         r.withdrawn_at, r.document_id, c.status::text as client_status
    into v_report
    from public.report r
    join public.client c on c.tenant_id = r.tenant_id and c.id = r.client_id
   where r.tenant_id = v_tenant_id and r.id = p_report_id
     for update of r;
  if not found
     or not (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
             or app.client_visible_to_practitioner(v_report.client_id))
  then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if v_report.kind <> 'external' or v_report.status <> 'issued' then
    raise exception 'only an uploaded report is withdrawn; a report written here is corrected'
      using errcode = 'check_violation', hint = 'not_an_upload';
  end if;
  if v_report.client_status = 'erased' then
    raise exception 'an erased record has nothing left to withdraw'
      using errcode = 'restrict_violation';
  end if;

  select d.storage_key into v_key
    from public.document d
   where d.tenant_id = v_tenant_id and d.id = v_report.document_id;

  if v_report.withdrawn_at is not null then
    return jsonb_build_object('withdrawn', false, 'storageKey', v_key);
  end if;

  perform set_config('app.reason', v_reason, true);
  update public.report
     set content = '{}'::jsonb, withdrawn_at = now(), withdraw_reason = v_reason
   where tenant_id = v_tenant_id and id = p_report_id;

  return jsonb_build_object('withdrawn', true, 'storageKey', v_key);
end
$$;
revoke execute on function app.withdraw_external_report(uuid, text) from public;
grant execute on function app.withdraw_external_report(uuid, text) to app_role;

comment on function app.withdraw_external_report(uuid, text) is
  'Withdraws an uploaded report filed against the wrong client or with the wrong file: the '
  'stamp and the reason set, the title cleared, the number and the document link kept. Answers '
  'the storage key of the file, which the caller deletes after the commit.';

-- rollback:
--   drop function if exists app.withdraw_external_report(uuid, text);
--   -- and re-create app.guard_report_write exactly as 603 defines it.
--   drop function if exists app.file_external_report(uuid, text, date, integer, uuid, text, bytea, timestamptz);
--   -- Every row of kind external must be gone first (an erasure, as the
--   -- table owner), or the restored check below refuses it.
--   alter table public.report drop constraint report_withdraw_only_imported;
--   alter table public.report add constraint report_withdraw_only_imported
--     check (withdrawn_at is null or status = 'imported');
--   alter table public.report
--     drop constraint if exists report_external_withdrawn_is_empty,
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
