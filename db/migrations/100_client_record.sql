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
-- Partial unique index: at most one row per client may carry is_primary.
create unique index goal_one_primary_per_client on goal (client_id) where is_primary;
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
------------------------------------------------------------------------------
create function app.guard_location_notes() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner') then
    return new;
  end if;

  if new.tenant_id       is distinct from old.tenant_id
     or new.owner_type      is distinct from old.owner_type
     or new.owner_id        is distinct from old.owner_id
     or new.label           is distinct from old.label
     or new.emirate         is distinct from old.emirate
     or new.makani_number   is distinct from old.makani_number
     or new.entrance_point  is distinct from old.entrance_point
     or new.parking_point   is distinct from old.parking_point
     or new.community_gate  is distinct from old.community_gate
     or new.display_address is distinct from old.display_address
     or new.is_primary      is distinct from old.is_primary
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
  v_tenant_id             uuid;
  v_status                public.client_status;
  v_contacts_anonymised   int;
  v_accounts_archived     int;
  v_locations_reduced     int;
  v_documents_deleted     int;
  v_summary               jsonb;
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
    --    any) archived and unlinked. archived before anonymised, so the join
    --    to contact.user_id still has a phone-free, but still-linked, row to
    --    read.
    with archived as (
      update public.app_user u
         set status = 'archived'
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

    -- 4. Documents: deleted outright. Issued invoices are Stage 15
    --    (docs/CLAUDE.md stage plan) and do not exist in this schema yet, so
    --    there is nothing yet to keep back; a later migration that adds
    --    invoices must revisit this step.
    with deleted as (
      delete from public.document where client_id = p_client_id returning id
    )
    select count(*) into v_documents_deleted from deleted;
  exception
    when others then
      perform app.end_erasure();
      raise;
  end;

  -- Erasure mode ends here: the summary below names counts, not people, and
  -- the row it closes is worth reading in the ordinary way.
  perform app.end_erasure();

  v_summary := jsonb_build_object(
    'clientId', p_client_id,
    'performedAt', now(),
    'contactsAnonymised', v_contacts_anonymised,
    'portalAccountsArchived', v_accounts_archived,
    'locationsReduced', v_locations_reduced,
    'documentsDeleted', v_documents_deleted
  );

  update public.erasure_request
     set performed_at = now(),
         summary      = v_summary
   where id = p_request_id and client_id = p_client_id;

  return v_summary;
end
$$;
revoke execute on function app.erase_client(uuid, uuid) from public;
grant execute on function app.erase_client(uuid, uuid) to app_role;

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
--   drop trigger if exists audit_row on public.erasure_request;
--   drop trigger if exists audit_row on public.goal;
--   drop trigger if exists audit_row on public.goal_category;
--   revoke select, insert, update on public.erasure_request, public.goal, public.goal_category from app_role;
--   -- RLS stays enabled: disabling it is never a rollback step.
--   drop function if exists app.erase_client(uuid, uuid);
--   drop trigger if exists guard_location_notes on public.location;
--   drop function if exists app.guard_location_notes();
--   drop table if exists erasure_request;
--   drop table if exists goal;
--   drop type if exists goal_status;
--   drop table if exists goal_category;
--   drop function if exists app.actor_is_contact_of(uuid);
--   drop function if exists app.client_status_for(uuid);
--   drop function if exists app.client_visible_to_practitioner(uuid);
--   drop function if exists app.client_erasure_gate(public.client_status);
--   drop function if exists app.current_actor_id();
