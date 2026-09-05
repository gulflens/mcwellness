-- 107_erase_report.sql
-- The erasure reaches the report.
--
-- Needs: 100 (erasure_request, app.erase_client), 104 and 105 (the version of
--        that function this one replaces).
--
--        `report` and `report_delivery` belong to the reports stream's range
--        (600–699), which this file may not name in its Needs: db/runner
--        refuses a `Needs` naming a higher number, and docs/SPEC/OWNERSHIP.md
--        is why — apply order across the ranges is not fixed, and a database
--        carrying this range without the reports stream's is an ordinary state
--        of affairs. So every statement below asks whether the table is there
--        first, exactly as 105 asks about the visit tables and 104 about
--        `invoice`.
--
-- **A report is deleted, not kept** (docs/SPEC/reports-v1.md section 6, and
-- section 10's decision 2, which is the operator's to overrule through the
-- practice's lawyer). An invoice is kept five years because UAE tax law
-- requires it of the business and does not ask the customer; nothing requires
-- the practice to keep a report, and a report is the most personal document
-- this platform produces — a household's goals, how they were before and after
-- each visit, what a practitioner observed, and the comparison between two
-- measurements of their own brain.
--
-- **The PDF goes without a change here, and that is the point of checking.**
-- Step 6 of `app.erase_client` already deletes every document filed against
-- the client except the kinds held back by name — `invoice` and `credit_note`
-- (domain/client/erasureKeeps.ts) — and the documents `billing_document`
-- names. `report` is in neither list, so the bytes and the `document` row go
-- with the household's other files. The `report` row's foreign key to
-- `document` would abort that delete, exactly as `session.setup_photo_document_id`
-- did before 105 unlinked it, so it is unlinked here first.
--
-- **What this migration adds is the narrative.** `report.content` holds what
-- the PDF was rendered from: the goals in the household's own words, the
-- ratings, the practitioner's summary, the brain-map figures and the
-- assessment ids. Deleting the file and leaving that jsonb standing would be
-- an erasure that took the copy and kept the original. It is emptied, and
-- `amendment_reason` with it, and the practice identity and signer snapshots
-- stay — they name the practice and a practitioner, not the household.
--
-- **And the deliveries go.** `report_delivery` says which contact was sent
-- which report and when; a contact of an erased household is a person whose
-- own record has just been anonymised, and a row naming them by id, with a
-- date, is a record about them.
--
-- What is deliberately kept, and named in the letter: the row itself, in the
-- state a reader can see a report once existed and was erased — the same
-- treatment a session gets. Nothing in it then says anything about the person.

------------------------------------------------------------------------------
-- app.erase_client(), 105's body with the report step added. Read it as a diff
-- of that: same signature, same security definer, same pinned search_path,
-- same steps in the same order, same summary keys plus two.
------------------------------------------------------------------------------
create or replace function app.erase_client(p_client_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id               uuid;
  v_status                  public.client_status;
  v_contacts_anonymised     int;
  v_accounts_archived       int;
  v_locations_reduced       int;
  v_goals_cleared           int;
  v_consents_unlinked       int;
  v_documents_deleted       int;
  v_documents_kept          int;
  v_payments_cleared        int;
  v_sessions_cleared        int;
  v_events_cleared          int;
  v_visits_cleared          int;
  v_reports_cleared         int;
  v_deliveries_deleted      int;
  v_kept_ids                uuid[];
  v_invoice_ids             uuid[];
  v_storage_keys_to_delete  jsonb;
  v_summary                 jsonb;
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')) then
    raise exception 'erasure requires the owner, an admin or the lead practitioner'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_erasure();

  begin
    select tenant_id, status into v_tenant_id, v_status
      from public.client
     where id = p_client_id
       for update;

    if not found then
      raise exception 'no such client: %', p_client_id;
    end if;
    if v_tenant_id <> app.current_tenant_id() then
      raise exception 'client belongs to another tenant' using errcode = 'insufficient_privilege';
    end if;
    if v_status = 'erased' then
      raise exception 'client % is already erased', p_client_id;
    end if;

    -- 1. The client.
    update public.client
       set given_name      = 'Erased client',
           family_name     = 'Erased client',
           given_name_ar   = null,
           family_name_ar  = null,
           date_of_birth   = null,
           sex_at_birth    = null,
           referral_source = null,
           status          = 'erased'
     where id = p_client_id;

    -- 2. Contacts and the portal account.
    with archived as (
      update public.app_user u
         set display_name = 'Erased user',
             email        = null,
             phone        = null,
             auth_id      = null,
             status       = 'archived'
        from public.contact ct
       where ct.client_id = p_client_id
         and ct.user_id = u.id
      returning u.id
    )
    select count(*) into v_accounts_archived from archived;

    with anonymised as (
      update public.contact
         set phone                 = null,
             email                 = null,
             whatsapp_opt_in       = false,
             emirates_id_encrypted = null,
             emirates_id_hash      = null,
             user_id               = null,
             given_name            = null,
             family_name           = null,
             given_name_ar         = null,
             family_name_ar        = null
       where client_id = p_client_id
      returning id
    )
    select count(*) into v_contacts_anonymised from anonymised;

    -- 3. Locations.
    with reduced as (
      update public.location
         set makani_number   = null,
             display_address = null,
             access_notes    = null,
             parking_point   = null,
             community_gate  = null,
             entrance_point  = case emirate
               when 'DXB' then extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.2)')
               when 'AUH' then extensions.st_geogfromtext('SRID=4326;POINT(54.38 24.45)')
               when 'SHJ' then extensions.st_geogfromtext('SRID=4326;POINT(55.4 25.35)')
               when 'AJM' then extensions.st_geogfromtext('SRID=4326;POINT(55.45 25.4)')
               when 'UAQ' then extensions.st_geogfromtext('SRID=4326;POINT(55.55 25.55)')
               when 'RAK' then extensions.st_geogfromtext('SRID=4326;POINT(55.95 25.78)')
               when 'FUJ' then extensions.st_geogfromtext('SRID=4326;POINT(56.33 25.12)')
             end
       where owner_type = 'client' and owner_id = p_client_id
      returning id
    )
    select count(*) into v_locations_reduced from reduced;

    -- 4. Goals.
    with cleared as (
      update public.goal
         set description = ''
       where client_id = p_client_id
      returning id
    )
    select count(*) into v_goals_cleared from cleared;

    -- 4b. Payments.
    v_payments_cleared := 0;
    if to_regclass('public.payment') is not null then
      execute 'with cleared as (update public.payment set reference = null '
              'where client_id = $1 and reference is not null returning id) '
              'select count(*) from cleared'
        into v_payments_cleared using p_client_id;
    end if;

    -- 4c. The visit record.
    v_sessions_cleared := 0;
    if exists (select 1 from pg_catalog.pg_attribute
                where attrelid = to_regclass('public.session')
                  and attname = 'observations' and not attisdropped) then
      execute 'with cleared as (update public.session '
              '   set checked_in_point        = null, '
              '       checked_out_point       = null, '
              '       observations            = null, '
              '       setup_photo_document_id = null, '
              '       amendment_reason        = case '
              '         when version = 1 and supersedes_id is null then null '
              '         else ''Erased with the record'' end '
              ' where client_id = $1 returning id) '
              'select count(*) from cleared'
        into v_sessions_cleared using p_client_id;
    end if;

    v_visits_cleared := 0;
    if to_regclass('public.visit_actuals') is not null then
      execute 'with cleared as (update public.visit_actuals set access_issues = null '
              'where client_id = $1 and access_issues is not null returning id) '
              'select count(*) from cleared'
        into v_visits_cleared using p_client_id;
    end if;

    v_events_cleared := 0;
    if to_regclass('public.session_event') is not null then
      execute 'with cleared as (update public.session_event as e '
              '   set payload = coalesce(('
              '     select jsonb_object_agg(entry.key, entry.value) '
              '       from jsonb_each(e.payload) as entry '
              '      where jsonb_typeof(entry.value) in (''number'', ''boolean'')), ''{}''::jsonb) '
              ' where e.client_id = $1 returning e.id) '
              'select count(*) from cleared'
        into v_events_cleared using p_client_id;
    end if;

    -- 4d. The reports (docs/SPEC/reports-v1.md section 6).
    --
    --     Three statements, in this order, and the order matters. The
    --     deliveries go first, because they name the report by a foreign key.
    --     Then the narrative inside `content` is emptied and the amendment
    --     reason with it — free text a person wrote about a household, held so
    --     the PDF could be rendered again, which is exactly what an erasure is
    --     about. Then `document_id` is unlinked, because the foreign key to
    --     `document` has no `on delete` and step 6's delete of the client's
    --     documents would otherwise abort the whole erasure on the first
    --     household that ever received a report — the same fault 105 found on
    --     `session.setup_photo_document_id`.
    --
    --     `app.guard_report_write` (600) stands aside inside an erasure, which
    --     is what lets a signed report be touched at all. A record frozen
    --     against its own author is right; a record frozen against a person's
    --     right to be forgotten is not.
    --
    --     What stays is the row: its kind, its reference, its version and its
    --     dates, and the practice's own identity and the practitioner who
    --     signed. Those name the practice, not the household, and they are
    --     what lets a reader see that a report once existed and was erased.
    v_deliveries_deleted := 0;
    if to_regclass('public.report_delivery') is not null then
      execute 'with removed as (delete from public.report_delivery '
              'where client_id = $1 returning id) select count(*) from removed'
        into v_deliveries_deleted using p_client_id;
    end if;

    v_reports_cleared := 0;
    if to_regclass('public.report') is not null then
      execute 'with cleared as (update public.report '
              '   set content          = ''{}''::jsonb, '
              '       document_id      = null, '
              '       amendment_reason = case '
              '         when version = 1 and supersedes_id is null then null '
              '         else ''Erased with the record'' end '
              ' where client_id = $1 returning id) '
              'select count(*) from cleared'
        into v_reports_cleared using p_client_id;
    end if;

    -- 5. Consents.
    with unlinked as (
      update public.consent
         set signature_document_id = null
       where client_id = p_client_id
         and signature_document_id is not null
      returning id
    )
    select count(*) into v_consents_unlinked from unlinked;

    -- 6. Documents. The report's PDF is deliberately not among the kinds held
    --    back: `report` is in neither `domain/client/erasureKeeps.ts` nor the
    --    array below, so it goes with the household's other files.
    select coalesce(array_agg(d.id), '{}'::uuid[]) into v_kept_ids
      from public.document d
     where d.client_id = p_client_id
       and d.kind = any (array['invoice', 'credit_note']);

    if to_regclass('public.invoice') is not null then
      execute 'select coalesce(array_agg(i.document_id), ''{}''::uuid[]) from public.invoice i '
              'where i.client_id = $1 and i.document_id is not null'
        into v_invoice_ids using p_client_id;
      v_kept_ids := v_kept_ids || coalesce(v_invoice_ids, '{}'::uuid[]);
    end if;

    if to_regclass('public.billing_document') is not null then
      execute 'select coalesce(array_agg(d.id), ''{}''::uuid[]) from public.document d '
              'where d.client_id = $1 and exists ('
              '  select 1 from public.billing_document b where b.document_id = d.id)'
        into v_invoice_ids using p_client_id;
      v_kept_ids := v_kept_ids || coalesce(v_invoice_ids, '{}'::uuid[]);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'storageKey', d.storage_key)), '[]'::jsonb)
      into v_storage_keys_to_delete
      from public.document d
     where d.client_id = p_client_id
       and not (d.id = any (v_kept_ids));

    select count(*) into v_documents_kept
      from public.document d
     where d.client_id = p_client_id
       and d.id = any (v_kept_ids);

    with deleted as (
      delete from public.document
       where client_id = p_client_id and not (id = any (v_kept_ids))
      returning id
    )
    select count(*) into v_documents_deleted from deleted;
  exception
    when others then
      perform app.end_erasure();
      raise;
  end;

  perform app.end_erasure();

  v_summary := jsonb_build_object(
    'clientId', p_client_id,
    'performedAt', now(),
    'contactsAnonymised', v_contacts_anonymised,
    'portalAccountsArchived', v_accounts_archived,
    'locationsReduced', v_locations_reduced,
    'goalsCleared', v_goals_cleared,
    'consentsUnlinked', v_consents_unlinked,
    'documentsDeleted', v_documents_deleted,
    'documentsKept', v_documents_kept,
    'paymentsCleared', v_payments_cleared,
    'sessionsCleared', v_sessions_cleared,
    'sessionEventsCleared', v_events_cleared,
    'visitActualsCleared', v_visits_cleared,
    'reportsCleared', v_reports_cleared,
    'reportDeliveriesDeleted', v_deliveries_deleted,
    'storage_keys_to_delete', v_storage_keys_to_delete
  );

  update public.erasure_request
     set performed_at          = now(),
         performed_by          = app.current_actor_id(),
         retention_until       = now() + interval '5 years',
         summary               = v_summary,
         storage_keys_pending  = v_storage_keys_to_delete
   where id = p_request_id and client_id = p_client_id;

  if not found then
    raise exception 'erasure request % does not name client %', p_request_id, p_client_id
      using errcode = 'no_data_found';
  end if;

  return v_summary;
end
$$;

-- rollback:
--   re-create the function as 105_erasure_reaches_the_visit.sql defines it (no
--   report step, and no reportsCleared or reportDeliveriesDeleted in the
--   summary). Nothing else in this migration creates anything to drop.
