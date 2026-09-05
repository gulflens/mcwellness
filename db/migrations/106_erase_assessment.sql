-- 106_erase_assessment.sql
-- The erasure reaches the measurements (docs/SPEC/assessment.md section 6,
-- "The erasure step"; docs/CHANGE-REQUESTS/assessment-01.md item 5).
--
-- `app.erase_client` lives in the client record's range, so the assessment
-- stream cannot add its own step to it: this file is that stream's change
-- request, applied here where the function belongs. It is 105's body with one
-- step added and two keys on the summary, and it is meant to be read as a diff
-- of that file rather than as a new function — same signature, same security
-- definer, same pinned search_path, same steps in the same order.
--
-- **The files go and the figures stay**, and the confirmation letter says so
-- in the same sentence it says it about sessions
-- (docs/CONSENT/erasure-letter/, rendered by domain/client/erasureLetter.ts).
-- A letter that promised the record was gone while a household's brain-map
-- recordings stood would be a letter that lies.
--
-- The new step is guarded with `to_regclass('public.assessment')` exactly as
-- 105 guards the visit tables, and for the same reason: apply order across the
-- ranges is not fixed (docs/SPEC/OWNERSHIP.md), and a database carrying this
-- range without the 500s is an ordinary state of affairs. Where the table is
-- not there, there is nothing of that stream's to erase.
--
-- Needs: 100 (erasure_request, app.erase_client), 104 and 105 (the versions of
--        that function this one replaces).
--
--        `assessment` and `assessment_document` belong to a range this file
--        may not name, for the reason 105's own header gives; both statements
--        below ask whether the table is there first.

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
  v_assessments_cleared     int;
  v_assessment_files_unlinked int;
  v_visits_cleared          int;
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

  -- Every path out of here, success or failure, must reach app.end_erasure():
  -- a raised exception that skipped it would leave the mark standing for
  -- whatever this transaction does next. "No such client" is deliberately
  -- inside this block, not before it, so that ordinary failure exercises the
  -- same cleanup a mid-erasure fault would.
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

    -- 1. The client: the name becomes a placeholder; everything an erased
    --    record does not need is nulled; the status is set last of the row's
    --    own columns because it is also the row this function is keyed on.
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

    -- 2. Contacts: reachability and identity gone; the portal account (if
    --    any) archived, renamed to a placeholder and fully unlinked — the
    --    same "Erased client" treatment the client row gets, so no screen or
    --    export can still show a name, an email, a phone number or the auth
    --    identity of a household that asked to be forgotten. archived before
    --    anonymised, so the join to contact.user_id still has a phone-free,
    --    but still-linked, row to read.
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
             -- The one statement 102_erasure_clears_a_contact_name.sql
             -- changes: the four columns migration 101 added. Nulled, not
             -- given a placeholder — they are nullable by construction, so
             -- null is a state every reader already handles, and what
             -- remains is the relationship, which is not personal data.
             given_name            = null,
             family_name           = null,
             given_name_ar         = null,
             family_name_ar        = null
       where client_id = p_client_id
      returning id
    )
    select count(*) into v_contacts_anonymised from anonymised;

    -- 3. Locations: only the emirate survives; the coordinate falls back to
    --    that emirate's centroid (the same fixed points db/seed/generate.ts
    --    uses for its synthetic practice, restated here because SQL cannot
    --    import that module).
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

    -- 4. Goals: never a diagnosis, but the free text beside the category can
    --    hold anything a client said, so it is cleared the way every other
    --    free-text field in this function is. Status and category are
    --    structured history, not personal data on their own, and stay.
    with cleared as (
      update public.goal
         set description = ''
       where client_id = p_client_id
      returning id
    )
    select count(*) into v_goals_cleared from cleared;

    -- 4b. Payments: the amount, the method and the date are the financial
    --     record and stay (CLAUDE.md rule 8, five years regardless). The
    --     reference is a bank string that identifies a person's account, so
    --     it goes the way every other free-text field here goes. The table
    --     grants no update to app_role; this function runs as its owner.
    --     Asked for in docs/CHANGE-REQUESTS/billing-03.md section 3.
    v_payments_cleared := 0;
    if to_regclass('public.payment') is not null then
      execute 'with cleared as (update public.payment set reference = null '
              'where client_id = $1 and reference is not null returning id) '
              'select count(*) from cleared'
        into v_payments_cleared using p_client_id;
    end if;

    -- 4c. The visit record. Nothing in this function reached the 300-series
    --     tables until now, and what they hold is the sharpest personal data
    --     in the schema: the coordinate the practitioner stood at when they
    --     checked in and out — the household's own door, recorded while this
    --     same function is reducing their address to the middle of an
    --     emirate — the observations written after a visit, the reason a
    --     record was amended, the access notes on the drive, and whatever a
    --     device put in an event's payload. A letter promising the record is
    --     gone while those stand is a letter that lies.
    --
    --     What stays is the measurement without the person: pre_rating,
    --     post_rating, telemetry, preflight, signal_check and
    --     signal_quality_score are numbers and checklist keys, they identify
    --     nobody once the record around them is anonymous, and the practice
    --     needs them for the aggregate view of its own work. The letter says
    --     so in as many words (docs/CONSENT/erasure-letter/).
    --
    --     amendment_reason is nulled where the row's own constraint allows it
    --     — version 1 with no predecessor — and replaced by a fixed phrase
    --     where it does not, because session_amendment_reason_with_version
    --     requires an amended row to carry one, and a constraint is not
    --     something an erasure gets to break.
    --
    --     setup_photo_document_id is unlinked here, and that is not tidiness:
    --     the foreign key to document has no `on delete` clause, so step 6's
    --     delete of a client's documents would raise on the first household
    --     that ever had a setup photograph taken, and the whole erasure would
    --     roll back. Consent evidence is unlinked in step 5 for exactly this
    --     reason; this is the second reference nothing had unlinked.
    --
    --     migration 302's immutability trigger stands aside inside an erasure
    --     (app.erasure_active), which is what lets a closed visit be touched
    --     at all; tests/client/db/erasure_act.test.ts proves it against a
    --     completed session.
    v_sessions_cleared := 0;
    -- Guarded on a column rather than the table: `observations`,
    -- `checked_out_point`, `setup_photo_document_id` and `amendment_reason`
    -- all arrive together with session-capture's close migration, so this
    -- statement is skipped where only 300 is applied. `checked_in_point` is
    -- the one thing that would then be left standing — the payload step below
    -- reaches `session_event`, not the session row — and that is a database
    -- mid-way through applying one stream's own range, never one an erasure
    -- runs against.
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

    --     A payload is free jsonb from a device: a note, a coordinate, a
    --     name, anything a later version of the app decides to put there. So
    --     the rule is the other way round from a redaction list — nothing
    --     survives unless it is a number or a true/false, which is what a
    --     rating, a threshold, a percentage and a flag are. Strings, objects
    --     and arrays go wholesale, a point among them, because nothing here
    --     can promise what is inside one. The timing is not lost with them:
    --     device_at, received_at and seq are columns of their own.
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

    -- 4d. The measurements this piece adds (docs/SPEC/assessment.md section
    --     6). **The files go and the figures stay.** Every file behind an
    --     assessment is deleted with the client's other documents by step 6 —
    --     a qEEG recording is the person's own brain activity and there is no
    --     version of it that is not personal — and the link rows are removed
    --     here first, because assessment_document's foreign key to document
    --     has no `on delete` and step 6 would otherwise raise on the first
    --     household that ever had an export filed.
    --
    --     The band powers, the reference figures and the questionnaire totals
    --     remain, as a visit's measurements already do: they identify nobody
    --     once the record around them is anonymous, and the practice uses them
    --     in aggregate. What goes with the rest of the free text is
    --     `condition_note` and `supersede_reason`. The reason is nulled where
    --     the row's own constraint allows it — version 1, which carries none —
    --     and replaced by a fixed phrase where it does not, exactly as this
    --     function already does for session.amendment_reason, because
    --     assessment_supersede_is_reasoned requires a corrected row to carry
    --     one and a constraint is not something an erasure gets to break.
    --
    --     migration 500's append-only guard stands aside inside an erasure
    --     (app.erasure_active), which is what lets a measurement be touched at
    --     all; tests/assessment/db/erasure.test.ts proves it.
    --
    --     Guarded on the table, as every statement above that reaches another
    --     stream's range is: this file is in the client record's own range and
    --     may not assume the 500s are on this database.
    v_assessments_cleared := 0;
    v_assessment_files_unlinked := 0;
    if to_regclass('public.assessment_document') is not null then
      execute 'with removed as (delete from public.assessment_document '
              'where client_id = $1 returning id) '
              'select count(*) from removed'
        into v_assessment_files_unlinked using p_client_id;
    end if;
    if to_regclass('public.assessment') is not null then
      execute 'with cleared as (update public.assessment '
              '   set condition_note   = null, '
              '       supersede_reason = case when version > 1 '
              '         then ''Erased with the record'' else null end '
              ' where client_id = $1 returning id) '
              'select count(*) from cleared'
        into v_assessments_cleared using p_client_id;
    end if;

    -- 5. Consents: signature_document_id names the client's own signed
    --    image (method app_signature or paper_scan, 00-data-model.md
    --    section 3) — one of the rows step 6 is about to delete — and must
    --    be unlinked first, or that delete fails on the foreign key and the
    --    whole erasure aborts. text_document_id names the practice's consent
    --    wording, a document with client_id null; this function never
    --    touches those, and the route that writes text_document_id
    --    (app/api/clients/consents.ts) refuses to let it point anywhere
    --    else, so it never needs unlinking here.
    with unlinked as (
      update public.consent
         set signature_document_id = null
       where client_id = p_client_id
         and signature_document_id is not null
      returning id
    )
    select count(*) into v_consents_unlinked from unlinked;

    -- 6. Documents: this function has no reach into Supabase Storage — that
    --    is outside Postgres — so the objects themselves are not deleted
    --    here. Their storage keys are recorded, against their ids, on the
    --    erasure_request row below (storage_keys_pending, and the same list
    --    inside the summary), and the request that called this registers an
    --    after-commit hook to remove the bytes through the storage seam
    --    (docs/SEAMS.md: a delete cannot be rolled back and a transaction
    --    can, so nothing calls storage.delete from inside one). Whatever the
    --    hook could not remove is swept up later by re-reading
    --    storage_keys_pending.
    --
    --    Only the client's own documents: one with client_id null is the
    --    practice's own (a practitioner's certificate, consent wording, and
    --    from this migration the erasure's own confirmation letter) and an
    --    erasure that was never about it must never delete it.
    --
    --    **And not the tax records.** An invoice, and the credit note that
    --    corrects one, are kept for five years because UAE tax law requires
    --    it of the business and does not ask the customer
    --    (docs/SPEC/00-data-model.md section 7, client-record.md section 8
    --    step 2). Two ways of naming one, because they catch different
    --    things and both are true:
    --
    --      a) by kind — 'invoice' and 'credit_note', the same list
    --         domain/client/erasureKeeps.ts holds for the screens. A kind
    --         added there joins this array too, or the two disagree and this
    --         one is the one that decides.
    --      b) by reference — any document an `invoice` row names as its
    --         rendered PDF. Billing writes nothing to invoice.document_id
    --         today (402_billing_document.sql: "the rendered PDF is not
    --         here"), so this catches nothing yet and is deliberately in
    --         place before it does, since the row that will point at a PDF
    --         is the row tax law is actually about.
    --
    --    (b) is asked only when the table is there. This migration does not
    --    name 400-series in its Needs and must not assume it: a database
    --    carrying the client-record range without billing's is an ordinary
    --    state of affairs (docs/SPEC/OWNERSHIP.md, "apply order across these
    --    ranges is not fixed"), so the invoice question is asked dynamically
    --    and skipped where there is nothing to ask.
    --
    --    Nothing is blanked on an invoice itself, deliberately: `invoice`
    --    snapshots the *supplier's* identity — the practice's own legal name,
    --    licence and tax numbers — and names its client by client_id alone,
    --    so it holds no personal detail of the erased person for this to
    --    clear, and clearing a tax record to no purpose is not a kindness.
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

    --    c) by the billing stream's own link table. `billing_document` (the
    --       billing worktree's pull request 54) names the rendered PDF of
    --       every invoice and receipt, with a foreign key to `document` and
    --       no `on delete`, so a household that ever had an invoice rendered
    --       would abort this erasure on the delete below — and deleting those
    --       files would breach the five-year financial-record rule in the
    --       same breath (CLAUDE.md rule 8). Asked here rather than joined,
    --       and guarded like the two above, so this function is valid before
    --       that table exists and correct after it does. Nothing of the
    --       client's is assumed about its shape beyond the column that names
    --       a document: the client is reached through `document` itself.
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

  -- Erasure mode ends here: the summary below names counts and storage keys,
  -- not people, and the row it closes is worth reading in the ordinary way.
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
    'assessmentsCleared', v_assessments_cleared,
    'assessmentFilesUnlinked', v_assessment_files_unlinked,
    'storage_keys_to_delete', v_storage_keys_to_delete
  );

  update public.erasure_request
     set performed_at          = now(),
         -- Who did it, beside who asked. The trail says so too; the row a
         -- screen reads should not have to be joined to the trail to answer
         -- "who erased this household".
         performed_by          = app.current_actor_id(),
         -- The request's own five years (CLAUDE.md rule 8). It outlives the
         -- record it ended — it is the evidence that an erasure happened and
         -- what it covered — and then it goes like everything else.
         retention_until       = now() + interval '5 years',
         summary               = v_summary,
         -- The same keys again, in a column of their own rather than only
         -- inside the summary: the summary is a record of what happened and
         -- is never rewritten, while this list is a worklist that shrinks as
         -- the bytes actually go (app/api/clients/erasure-file-sweep.ts).
         storage_keys_pending  = v_storage_keys_to_delete
   where id = p_request_id and client_id = p_client_id;

  -- Nothing is erased without its record: a request id that does not name
  -- this client (wrong id, already closed by a previous call, forged) leaves
  -- no erasure_request row for the work above to be attached to, so the work
  -- above must not stand either. Raising here fails the whole statement — the
  -- client, contact, location, goal, consent and document changes made above
  -- are all part of it — and Postgres rolls every one of them back with it.
  if not found then
    raise exception 'erasure request % does not name client %', p_request_id, p_client_id
      using errcode = 'no_data_found';
  end if;

  return v_summary;
end
$$;
-- rollback:
--   re-create the function as 105_erasure_reaches_the_visit.sql defines it (no
--   assessment step, and no assessmentsCleared or assessmentFilesUnlinked on
--   the summary). Nothing else in this file creates anything to drop.
