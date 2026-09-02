-- 100_client_record.sql
-- The client-record worktree's own tables (docs/SPEC/client-record.md, SPEC
-- PR 2): goals and their catalogue, the erasure-request record, and the
-- helper functions the worktree's own policies and routes need. Needs 000
-- through 097 (the core schema, actor resolution and the generic client_id
-- audit attribution).
--
-- Migration 097 already makes the audit trail attribute any table carrying a
-- client_id column to that client, so goal and erasure_request need no change
-- to app.audit_client_id: attaching the standard audit_row trigger is enough.

------------------------------------------------------------------------------
-- 1. Small helpers the policies in db/policies/client rely on.
------------------------------------------------------------------------------

-- The signed-in person's own row, mirroring app.current_tenant_id()
-- (000_foundation.sql). Set by the request-context middleware alongside the
-- tenant and the roles.
create function app.current_actor_id() returns uuid
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid
$$;
revoke execute on function app.current_actor_id() from public;
grant execute on function app.current_actor_id() to app_role;

-- Whether a row scoped to a client in this status may be read at all: an
-- erased record opens only for the owner and the lead practitioner
-- (client-record.md sections 2 and 8); every other status is ordinary.
-- Factored out so every table's restrictive read policy states the same rule
-- once, rather than repeating the erasure carve-out per table.
create function app.client_erasure_gate(p_status public.client_status) returns boolean
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select p_status <> 'erased' or app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
$$;
revoke execute on function app.client_erasure_gate(public.client_status) from public;
grant execute on function app.client_erasure_gate(public.client_status) to app_role;

-- The scheduling door: whether a client is on the calling practitioner's own
-- schedule (client-record.md section 2: "clients on their schedule only").
-- No schedule exists yet, so the honest answer is false for everyone, for
-- every client; the scheduling worktree replaces this body once appointments
-- and assignment exist. The parameter is unused today and named for what it
-- will read.
create function app.client_visible_to_practitioner(p_client_id uuid) returns boolean
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select false
$$;
revoke execute on function app.client_visible_to_practitioner(uuid) from public;
grant execute on function app.client_visible_to_practitioner(uuid) to app_role;

-- The next two read straight through row level security (security definer,
-- owned outside app_role) so a restrictive policy on one table can consult
-- another without the two tables' policies referencing each other — that
-- cross-reference is what Postgres reports as SQLSTATE 42P17, "infinite
-- recursion detected in policy". Both are narrow, read-only lookups; neither
-- takes the row itself further than the one column its caller already needs.

-- A client's status, read directly. Used by every other table's restrictive
-- read policy to apply app.client_erasure_gate without a policy on client
-- itself being evaluated as part of doing so.
create function app.client_status_for(p_client_id uuid) returns public.client_status
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select status from public.client
   where id = p_client_id and tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.client_status_for(uuid) from public;
grant execute on function app.client_status_for(uuid) to app_role;

-- Whether the calling actor is one of this client's own contacts — the
-- client_contact portal door — read directly for the same reason: contact's
-- own restrictive read policy must not be the thing that answers this.
create function app.actor_is_contact_of(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.contact
     where client_id = p_client_id and user_id = app.current_actor_id()
  )
$$;
revoke execute on function app.actor_is_contact_of(uuid) from public;
grant execute on function app.actor_is_contact_of(uuid) to app_role;

------------------------------------------------------------------------------
-- 2. goal_category — the owner-editable reference table (00-data-model.md
--    section 4: "owner-editable reference table: focus, sleep, calm,
--    performance, ..."), the same shape as service_type. Open set, so a
--    table, not an enum (.claude/rules/data-model.md).
------------------------------------------------------------------------------
create table goal_category (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant (id),
  code        text not null,
  name        text not null,
  name_ar     text,
  status      active_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references app_user (id),
  unique (tenant_id, code)
);
create index goal_category_tenant_idx on goal_category (tenant_id);
create index goal_category_created_by_idx on goal_category (created_by);
create trigger set_updated_at before update on goal_category
  for each row execute function app.set_updated_at();

-- Seeded per existing tenant with the six starting categories. One tenant
-- exists today (00-data-model.md section 1); this reaches every one there is.
insert into goal_category (tenant_id, code, name, name_ar)
select t.id, v.code, v.name, v.name_ar
  from tenant t
 cross join (values
    ('focus',       'Focus',       'التركيز'),
    ('sleep',       'Sleep',       'النوم'),
    ('calm',        'Calm',        'الهدوء'),
    ('performance', 'Performance', 'الأداء'),
    ('mood',        'Mood',        'المزاج'),
    ('behaviour',   'Behaviour',   'السلوك')
 ) as v(code, name, name_ar);

-- The backfill above reaches every tenant that exists when this migration
-- runs; a tenant created afterwards needs the same six rows (00-data-model.md's
-- convention for a per-tenant default: an after-insert trigger on tenant).
-- Security definer, so it runs as this function's owner regardless of who
-- creates the tenant — an onboarding actor need not separately hold insert on
-- goal_category, and the fresh tenant's own row level security (which reads
-- app.current_tenant_id(), not yet pointed at a tenant that did not exist a
-- moment ago) never enters into it. search_path pinned, the same defensive
-- pattern every security-definer function in this file uses.
create function app.seed_goal_categories() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.goal_category (tenant_id, code, name, name_ar)
  values
    (new.id, 'focus',       'Focus',       'التركيز'),
    (new.id, 'sleep',       'Sleep',       'النوم'),
    (new.id, 'calm',        'Calm',        'الهدوء'),
    (new.id, 'performance', 'Performance', 'الأداء'),
    (new.id, 'mood',        'Mood',        'المزاج'),
    (new.id, 'behaviour',   'Behaviour',   'السلوك');
  return null;
end
$$;
revoke execute on function app.seed_goal_categories() from public;

create trigger seed_goal_categories after insert on public.tenant
  for each row execute function app.seed_goal_categories();

------------------------------------------------------------------------------
-- 3. goal — what the client wants from the programme (00-data-model.md
--    section 4). Never a diagnosis. At most one primary goal per client.
------------------------------------------------------------------------------
create type goal_status as enum ('active', 'achieved', 'dropped');

create table goal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  client_id    uuid not null references client (id),
  category_id  uuid not null references goal_category (id),
  description  text not null,          -- free text beside the typed category, never instead of it
  set_at       timestamptz not null default now(),
  status       goal_status not null default 'active',
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id)
);
create index goal_tenant_idx on goal (tenant_id);
create index goal_client_idx on goal (client_id, created_at);
create index goal_category_idx on goal (category_id);
create index goal_created_by_idx on goal (created_by);
-- Partial unique index: at most one *active* goal per client may carry
-- is_primary. Scoped to status = 'active' (not is_primary alone) so an
-- achieved or dropped goal that was once primary can keep that flag as
-- history without blocking a new active primary from being set — the goals
-- route (app/api/clients/goals.ts) still clears the old active primary in the
-- same statement before setting a new one, rather than relying on this index
-- to turn a swap into a 23505.
create unique index goal_one_primary_per_client on goal (client_id) where is_primary and status = 'active';
create trigger set_updated_at before update on goal
  for each row execute function app.set_updated_at();

------------------------------------------------------------------------------
-- 4. erasure_request — the record of an erasure (client-record.md section 8).
--    Inserted by the route with the reason and who asked; app.erase_client
--    fills in performed_at and the summary once the work is done.
------------------------------------------------------------------------------
create table erasure_request (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenant (id),
  client_id                 uuid not null references client (id),
  requested_by_contact_id   uuid references contact (id),
  -- Free text, boundary-cleaned (app/api/_middleware/text.ts) and capped at 200
  -- characters by the route's own schema (record-schema.ts): this row follows
  -- the erasure request's own retention, not the general free-text ceiling
  -- everything else in this file uses, so it is capped separately and tighter.
  reason                    text not null,
  requested_at              timestamptz not null default now(),
  performed_at              timestamptz,             -- null until app.erase_client completes
  summary                   jsonb,                   -- what was anonymised and what was deleted
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references app_user (id)
);
create index erasure_request_tenant_idx on erasure_request (tenant_id);
create index erasure_request_client_idx on erasure_request (client_id, created_at);
create index erasure_request_contact_idx on erasure_request (requested_by_contact_id);
create index erasure_request_created_by_idx on erasure_request (created_by);
create trigger set_updated_at before update on erasure_request
  for each row execute function app.set_updated_at();

------------------------------------------------------------------------------
-- 5. app.guard_location_notes() — the column boundary for a practitioner's
--    one write on a location (client-record.md section 2: "add access notes
--    to a location"). Owner, admin and the lead practitioner may change
--    anything; row visibility for anyone else is the writers.sql restrictive
--    policy's job (gated by app.client_visible_to_practitioner, closed for
--    now), this trigger's job is only which columns, once that door opens.
--    The pattern is the same one CLAUDE.md section 5 describes for a client
--    contact's own editable fields: "a guard trigger, not a screen."
--
--    The comparison is structural (to_jsonb(new) minus the columns that may
--    legitimately change, against the same of old), not an enumerated column
--    list: an enumerated list only guards the columns someone remembered to
--    name, so a column added to location after this trigger was written would
--    silently slip past it. updated_at is excluded because app.set_updated_at
--    changes it on every update, practitioner included, which is not a
--    boundary violation; access_notes is excluded because it is the one
--    column this trigger exists to let through.
--
--    An actor with no role assumed at all — app.actor_roles unset, never
--    "set local role app_role" for this transaction (096_api_role.sql) — is
--    the owner's own maintenance: a seed script, a migration backfill, a
--    database console session, never a practitioner's request through the
--    API, which always stamps a role. Nothing to guard against there.
------------------------------------------------------------------------------
create function app.guard_location_notes() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner') then
    return new;
  end if;

  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;

  if (to_jsonb(new) - array['access_notes', 'updated_at'])
     is distinct from (to_jsonb(old) - array['access_notes', 'updated_at'])
  then
    raise exception 'only access_notes may be changed here'
      using errcode = 'insufficient_privilege',
            hint    = 'A practitioner may add access notes to a location, and nothing else on it.';
  end if;

  return new;
end
$$;
revoke execute on function app.guard_location_notes() from public;

create trigger guard_location_notes before update on public.location
  for each row execute function app.guard_location_notes();

------------------------------------------------------------------------------
-- 6. app.erase_client() — client-record.md section 8, steps 1 to 4, in one
--    transaction. Runs as the function owner (security definer), so it alone
--    may set client.status = 'erased' and delete documents; the API role
--    never deletes and never writes 'erased' through the ordinary policies
--    (db/policies/client/writers.sql). The internal role check is defence in
--    depth: this schema is never exposed to PostgREST (000_foundation.sql),
--    so only this worktree's own route can call it at all.
--
--    app.begin_erasure() (098_erasure_guard.sql) marks the transaction with a
--    secret token app.audit_redact checks for, so steps 1 to 4 below withhold
--    every value on every audited write they make, regardless of which role
--    is assumed; app.end_erasure() clears the mark before the final write —
--    closing the erasure_request row with its summary — so that one write,
--    which holds no personal data, is logged in the ordinary way. Both
--    functions are security definer and grant execute to nobody; Postgres
--    lets one security-definer function call another sharing its owner
--    without a grant, which is how a request running as app_role reaches
--    them at all.
------------------------------------------------------------------------------
create function app.erase_client(p_client_id uuid, p_request_id uuid) returns jsonb
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
             user_id               = null
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
revoke execute on function app.erase_client(uuid, uuid) from public;
grant execute on function app.erase_client(uuid, uuid) to app_role;

------------------------------------------------------------------------------
-- 6b. app.next_mrn() — MRN allocation must see an erased client too
--     (domain/client/nextMrn.ts formats the same 'MW-000001' shape, but
--     cannot be the one deciding the next number: db/policies/client/readers.sql
--     hides an erased row from every role but the owner and the lead
--     practitioner, so an admin creating a client — the common case — would
--     compute the next number from a query that cannot see the practice's own
--     highest MRN once that client is erased, and repeat it). Security
--     definer, so it reads every one of the tenant's clients regardless of
--     RLS or who is calling; search_path pinned, the same defensive pattern
--     every security-definer function in this file uses; granted to app_role,
--     since the create route (app/api/clients/record.ts) calls it directly,
--     not through a policy.
--
--     The advisory lock lives inside the function, not the caller, so
--     serialising two concurrent creates for the same tenant is this
--     function's own guarantee, not something every caller must remember to
--     do first; it is released automatically when the calling transaction
--     ends. The tenant_id unique constraint on client.mrn stays the backstop
--     it always was — this only makes the number the lock protects the
--     correct one to try.
------------------------------------------------------------------------------
create function app.next_mrn(p_tenant uuid) returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_max int;
begin
  perform pg_advisory_xact_lock(hashtext('mrn:' || p_tenant::text));

  select coalesce(max((regexp_match(mrn, '^MW-(\d+)$'))[1]::int), 0)
    into v_max
    from public.client
   where tenant_id = p_tenant;

  return 'MW-' || lpad((v_max + 1)::text, 6, '0');
end
$$;
revoke execute on function app.next_mrn(uuid) from public;
grant execute on function app.next_mrn(uuid) to app_role;

------------------------------------------------------------------------------
-- 7. RLS, grants and revokes on this worktree's own tables, matching
--    090_grants_and_rls.sql exactly for the tables it does not yet know
--    about. No delete anywhere: rows are superseded, closed or erased, never
--    removed by the API role (app.erase_client runs as the owner instead).
------------------------------------------------------------------------------
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['goal_category', 'goal', 'erasure_request'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
    execute format('grant select, insert, update on public.%I to app_role', t);
  end loop;
end
$$;

------------------------------------------------------------------------------
-- 8. Audit triggers on the three new tables (audit.md section 5, layer 1).
--    goal and erasure_request both carry client_id directly, so migration
--    097's general rule attributes them without any further change here.
--    Classified for tests/db/audit.test.ts's checklist, which a stream's own
--    migration extends by comment rather than by editing that shared file
--    (audit.md section 14 item 13, .claude/rules/data-model.md).
------------------------------------------------------------------------------
comment on table public.goal_category is 'audited: no client - tenant-scoped reference table';
comment on table public.goal is 'audited: client - carries client_id directly';
comment on table public.erasure_request is 'audited: client - carries client_id directly';

do $$
declare
  t text;
begin
  foreach t in array array['goal_category', 'goal', 'erasure_request'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I '
                   'for each row execute function app.audit_row()', t);
    execute format('alter table public.%I enable always trigger audit_row', t);
  end loop;
end
$$;

-- rollback:
--   -- Remove db/policies/client/readers.sql from the tree first: the runner
--   -- re-applies every policy file on each migrate, and each of these six
--   -- policies — one client_record_readers per core table this pull request
--   -- touches — depends on a function dropped below (app.client_erasure_gate,
--   -- app.client_status_for, app.client_visible_to_practitioner or
--   -- app.actor_is_contact_of), the same dependency 095_actor.sql states for
--   -- db/policies/core/role_guard.sql. Dropped here, before any of them.
--   drop policy if exists client_record_readers on public.goal;
--   drop policy if exists client_record_readers on public.document;
--   drop policy if exists client_record_readers on public.consent;
--   drop policy if exists client_record_readers on public.location;
--   drop policy if exists client_record_readers on public.contact;
--   drop policy if exists client_record_readers on public.client;
--   drop trigger if exists audit_row on public.erasure_request;
--   drop trigger if exists audit_row on public.goal;
--   drop trigger if exists audit_row on public.goal_category;
--   revoke select, insert, update on public.erasure_request, public.goal, public.goal_category from app_role;
--   -- RLS stays enabled: disabling it is never a rollback step.
--   drop function if exists app.next_mrn(uuid);
--   drop function if exists app.erase_client(uuid, uuid);
--   drop trigger if exists guard_location_notes on public.location;
--   drop function if exists app.guard_location_notes();
--   drop table if exists erasure_request;
--   drop table if exists goal;
--   drop type if exists goal_status;
--   drop trigger if exists seed_goal_categories on public.tenant;
--   drop function if exists app.seed_goal_categories();
--   drop table if exists goal_category;
--   drop function if exists app.actor_is_contact_of(uuid);
--   drop function if exists app.client_status_for(uuid);
--   drop function if exists app.client_visible_to_practitioner(uuid);
--   drop function if exists app.client_erasure_gate(public.client_status);
--   drop function if exists app.current_actor_id();
