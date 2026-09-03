-- 104_erasure_the_act.sql
-- Needs: 060 (document), 099 (the tenant-scoped keys a foreign key to a core
--        table is written against), 100 (erasure_request, app.erase_client),
--        102 (the version of that function this one replaces).
--        Not needed, and deliberately not assumed: 402 (invoice). The
--        function below asks whether that table is there before it reads it,
--        because a database carrying this range without billing's is an
--        ordinary state of affairs (docs/SPEC/OWNERSHIP.md, "apply order
--        across these ranges is not fixed").
--
-- Recording an erasure request and performing one become two acts
-- (docs/SPEC/client-record.md section 8). Until now the route did both in one
-- breath: it wrote the request and called app.erase_client in the next
-- statement, so there was no moment between asking and doing in which anybody
-- could be asked "are you sure", and no way to record a request that had not
-- happened yet. This migration gives the request row the four things the
-- second act needs.
--
--   requested_by_phone     The number the confirmation letter is sent to.
--                          Captured when the request is *recorded*, because
--                          by the time it is performed every contact's phone
--                          is null — that is what the erasure does. One
--                          number, on the row that exists to say a household
--                          asked to be forgotten, kept because a confirmation
--                          nobody can deliver is not a confirmation
--                          (section 8 step 5). It is not a way back into the
--                          record: nothing joins from it, and app.audit_redact
--                          withholds it like every other value written under
--                          an erasure.
--   letter_document_id     The letter that was cut, filed as a practice
--   letter_version         document (client_id null) rather than against the
--                          client, who no longer has a record to file
--                          anything against, with the version of the template
--                          it came from beside it: the wording is a draft
--                          until the practice's lawyer approves one
--                          (docs/CONSENT/erasure-letter/), and which draft a
--                          person was sent is worth knowing.
--   storage_keys_pending   The worklist of bytes still to remove, and when it
--   files_cleared_at       emptied. The summary already records what the
--                          erasure found; this is the part that changes as
--                          the files actually go. The request's own
--                          after-commit hook removes them first
--                          (docs/SEAMS.md); whatever it could not remove — a
--                          bucket that was down for those few seconds — is
--                          re-read from here and swept up later, which is why
--                          the list is a column and not only a line inside a
--                          summary nothing may rewrite.
--
-- The one behavioural change to app.erase_client is step 6, and it is the
-- step the function's own comment asked a later migration to revisit: invoices
-- did not exist in this schema when 100 was written and now they do, so the
-- documents tax law keeps are held back from the delete. Everything else in
-- the body below is 102's, verbatim, for the reason 102 gives: replacing the
-- whole function is the only way to change one statement inside it, and a
-- merged migration is never edited.

alter table erasure_request
  add column requested_by_phone   text,
  add column letter_document_id   uuid,
  add column letter_version       text,
  add column storage_keys_pending jsonb not null default '[]'::jsonb,
  add column files_cleared_at     timestamptz;

-- The tenant-composite reference 099 asks every foreign key to a core table to
-- be written as, so a letter filed under one practice can never be attached to
-- another's erasure request.
alter table erasure_request
  add constraint erasure_request_letter_document_fkey
  foreign key (tenant_id, letter_document_id) references document (tenant_id, id);

-- A worklist is a list. Anything else here would be a shape the sweep cannot
-- read, discovered at three in the morning by a job that stops.
alter table erasure_request
  add constraint erasure_request_pending_keys_is_an_array
  check (jsonb_typeof(storage_keys_pending) = 'array');

-- A letter has a version and a version belongs to a letter: neither half means
-- anything alone, and a row carrying only one of them would be a letter nobody
-- can say the wording of, or a wording nobody can find the letter for.
alter table erasure_request
  add constraint erasure_request_letter_is_whole
  check (num_nonnulls(letter_document_id, letter_version) in (0, 2));

create index erasure_request_letter_idx on erasure_request (letter_document_id);

comment on column public.erasure_request.requested_by_phone is
  'The number the confirmation letter goes to, captured when the request is recorded: '
  'every contact phone is null once the erasure has run. Kept only so the confirmation '
  'section 8 promises can be delivered.';
comment on column public.erasure_request.storage_keys_pending is
  'Document bytes not yet known to be gone: [{id, storageKey}]. Emptied by the '
  'after-commit hook the request registers, and swept up afterwards by '
  'app/api/clients/erasure-file-sweep.ts for anything the store refused at the time.';
comment on column public.erasure_request.files_cleared_at is
  'When the last key left storage_keys_pending. Null while bytes may still be out there.';

------------------------------------------------------------------------------
-- app.erase_client(), 102's body with step 6 changed. Read this file as a
-- diff of that one statement, not as a new function: same signature, same
-- security definer, same pinned search_path, same steps in the same order,
-- same summary keys plus one.
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
    'storage_keys_to_delete', v_storage_keys_to_delete
  );

  update public.erasure_request
     set performed_at          = now(),
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
--   re-create the function as 102_erasure_clears_a_contact_name.sql defines
--   it (step 6 deleting every document of the client, and no documentsKept in
--   the summary), then:
--   drop index if exists erasure_request_letter_idx;
--   alter table erasure_request
--     drop constraint if exists erasure_request_letter_is_whole,
--     drop constraint if exists erasure_request_pending_keys_is_an_array,
--     drop constraint if exists erasure_request_letter_document_fkey;
--   alter table erasure_request
--     drop column if exists files_cleared_at,
--     drop column if exists storage_keys_pending,
--     drop column if exists letter_version,
--     drop column if exists letter_document_id,
--     drop column if exists requested_by_phone;
