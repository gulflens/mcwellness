-- 102_erasure_clears_a_contact_name.sql
-- Needs: 100 (app.erase_client), 101 (the contact name columns)
--
-- Migration 101 gave `contact` four name columns. This teaches the erasure to
-- clear them.
--
-- `app.erase_client` (100_client_record.sql section 6) anonymises a contact
-- with an enumerated column list — phone, email, whatsapp_opt_in, the two
-- Emirates ID columns, user_id — not the structural comparison
-- app.guard_location_notes() and app.guard_document_write() use. An
-- enumerated list only clears the columns somebody remembered to name, so
-- without this a household that asked to be forgotten would keep its
-- contacts' names on file: exactly what CLAUDE.md rule 8 and
-- docs/SPEC/client-record.md section 8 promise goes ("names and Arabic names
-- become 'Erased client'").
--
-- Replacing the whole function is the only way to change one statement inside
-- it, and 100_client_record.sql is merged and may never be edited
-- (.claude/rules/data-model.md). The body below is that function verbatim
-- with **one statement changed** — the `update public.contact` in step 2,
-- which now also nulls given_name, family_name, given_name_ar and
-- family_name_ar. Nothing else moves: same signature, same security definer,
-- same pinned search_path, same steps in the same order, same summary keys.
-- Read this file as a diff of one statement, not as a new function.
--
-- A contact's name is nulled rather than replaced with a placeholder. The
-- client row gets "Erased client" because a screen still lists that row and
-- needs something to render; a contact's name is nullable by construction
-- (101: "a contact known only by relationship predates this column"), so null
-- is a state every reader already handles and the honest one here — the
-- relationship, which is not personal data, is what remains.
--
-- The grants do not move: `create or replace` keeps the existing ones
-- (revoke from public, execute to app_role, 100_client_record.sql), and
-- re-issuing them would only invite a difference.

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
    --    here. Their storage keys are recorded, against their ids, in the
    --    erasure_request row below under storage_keys_to_delete, for a
    --    storage-deletion job to remove them; that job is a later pull
    --    request (client-record.md section 8 step 2), not this one. Only the
    --    client's own documents: one with client_id null is the practice's
    --    own (a practitioner's certificate, consent wording) and an erasure
    --    that was never about it must never delete it. Issued invoices are
    --    Stage 15 (docs/CLAUDE.md stage plan) and do not exist in this schema
    --    yet, so there is nothing yet to keep back; a later migration that
    --    adds invoices must revisit this step.
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'storageKey', d.storage_key)), '[]'::jsonb)
      into v_storage_keys_to_delete
      from public.document d
     where d.client_id = p_client_id;

    with deleted as (
      delete from public.document where client_id = p_client_id returning id
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
    'storage_keys_to_delete', v_storage_keys_to_delete
  );

  update public.erasure_request
     set performed_at = now(),
         summary      = v_summary
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

-- rollback: re-create the function as 100_client_record.sql section 6 defines
-- it, without the four name columns in step 2's contact update. The columns
-- themselves are 101's to drop.
