-- 306_kit_and_setup_photo.sql
-- The practice's instruments, and the door the setup photograph's bytes reach
-- the record through (docs/SPEC/practitioner-phone.md sections 4 and 6,
-- docs/SPEC/00-data-model.md section 5).
--
-- Four things, and they are here together because the check-in context has to
-- be replaced once for both of them:
--
--   1. `kit`, the serial-level equipment register, and `session.kit_id`;
--   2. `app.checkin_context` replaced, gaining `kit_calibration_overdue` and
--      `kit_id` beside what it already returns;
--   3. the three doors the photograph goes through — the consent check that
--      still answers after the visit has closed, the `document` row, and the
--      link on the session;
--   4. the close guard extended to admit exactly that one link and nothing
--      else.
--
-- `create or replace` cannot change a function's return columns, so
-- `app.checkin_context(uuid, text)` is dropped and created again below. That
-- is the whole reason this is a drop rather than a replace, and it is said
-- here so nobody reads it as an edit of 301.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user), 040 (active_status,
-- service_type), 050 (practitioner), 060 (client, consent, contact,
-- document), 080 (app.audit_row), 095 (app.current_actor_id), 098
-- (app.erasure_active, which the close guard must not stand in front of), 099
-- (the unique (tenant_id, id) keys the composite foreign keys below target),
-- 200 (appointment), 300 (session), 301 (app.checkin_context, replaced here)
-- and 302 (app.session_refuse_update_after_close, replaced here, and
-- session.setup_photo_document_id, which the door below sets).

------------------------------------------------------------------------------
-- 1. The equipment register.
--
-- Serial-level, because a calibration certificate is issued for one amplifier
-- and not for a model. `kind` is a closed set and an enum; `status` is the
-- `active_status` every other stood-down thing in this schema uses, so an item
-- the practice retires is deactivated and never deleted — a session that ran
-- on it still names it.
--
-- Both calibration columns are nullable, and that is the register's own
-- honesty: a laptop is never calibrated, and an amplifier whose certificate
-- the practice has not yet typed in is a gap in the register rather than an
-- instrument known to be out of date. `domain/session/kit.ts` says the same in
-- TypeScript, and the block below mirrors it in SQL.
--
-- `audited: no client`. A serial, a model and two dates: the register is about
-- the practice's own property and names nobody.
------------------------------------------------------------------------------
create type kit_kind as enum ('amplifier', 'laptop', 'electrode_set');
comment on type kit_kind is
  'What a piece of equipment is (docs/SPEC/00-data-model.md section 5). Closed set, '
  'so an enum; chain of custody, consumables and hygiene logs are Phase 2 tables '
  'hanging off kit rather than more values here.';

create table kit (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenant (id),
  -- The manufacturer's own serial, as it is written on the instrument. Not a
  -- person's anything: it identifies a box.
  serial                    text not null check (length(btrim(serial)) between 1 and 64),
  model                     text not null check (length(btrim(model)) between 1 and 120),
  kind                      kit_kind not null,
  status                    active_status not null default 'active',
  -- Null is a spare on the shelf. The check-in block is about what a
  -- practitioner is carrying, so an unassigned item stops nobody's day.
  assigned_practitioner_id  uuid,
  -- When it was last calibrated, and when the certificate runs out. Both null
  -- for anything that is never calibrated.
  last_calibrated_at        timestamptz,
  calibration_due_at        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references app_user (id),
  -- One row per instrument per practice: a serial typed twice is a mistake,
  -- and two rows for one amplifier would have the practice calibrating one of
  -- them and carrying the other.
  unique (tenant_id, serial),
  -- The practice-bound key every tenant-scoped table carries
  -- (099_tenant_scoped_keys.sql).
  unique (tenant_id, id),
  -- Composite, so an item can never be assigned to another practice's person.
  foreign key (tenant_id, assigned_practitioner_id)
    references practitioner (tenant_id, id),
  -- A due date before the calibration it follows is a typo, not a schedule.
  constraint kit_calibration_due_after_last
    check (calibration_due_at is null or last_calibrated_at is null
           or calibration_due_at >= last_calibrated_at)
);
comment on table public.kit is
  'audited: no client - the practice''s own instruments. A serial, a model, who '
  'carries it and when its calibration runs out; no client is visited by a row here.';
comment on column public.kit.assigned_practitioner_id is
  'Who carries it. Null is a spare on the shelf, and a spare blocks nobody: the '
  'check-in rule (docs/SPEC/practitioner-phone.md section 6.3) is about the '
  'instruments a practitioner has with them.';
comment on column public.kit.calibration_due_at is
  'When the calibration certificate runs out. Null for anything never calibrated - a '
  'laptop, a set of electrodes - and for an amplifier the practice has not yet '
  'recorded one for. Null is never overdue (domain/session/kit.ts).';

create index kit_assigned_idx on kit (tenant_id, assigned_practitioner_id)
  where assigned_practitioner_id is not null;
create index kit_created_by_idx on kit (created_by);
create trigger set_updated_at before update on kit
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.kit
  for each row execute function app.audit_row();
alter table public.kit enable always trigger audit_row;

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.kit enable row level security;
  revoke all on public.kit from public;
  if has_api_roles then
    revoke all on public.kit from anon, authenticated;
  end if;
  -- No delete: an item leaves the register by being set inactive, because a
  -- visit that ran on it still names it.
  grant select, insert, update on public.kit to app_role;
end
$$;

------------------------------------------------------------------------------
-- 2. Which instrument ran the visit.
--
-- Set at check-in to the practitioner's one active amplifier when exactly one
-- is assigned, and left null otherwise, so the record says which instrument
-- ran the visit without guessing between two of them (section 6.1). Nullable
-- for that reason and because migration 300 shipped rows without it.
------------------------------------------------------------------------------
alter table public.session
  add column kit_id uuid,
  add constraint session_kit_fk foreign key (tenant_id, kit_id) references kit (tenant_id, id);
create index session_kit_idx on public.session (kit_id);
comment on column public.session.kit_id is
  'The amplifier this visit ran on, when the practitioner had exactly one active one '
  'assigned at check-in; null otherwise, because a guess between two is worse than a '
  'blank (docs/SPEC/practitioner-phone.md section 6.1).';

------------------------------------------------------------------------------
-- 3. The check-in context, replaced.
--
-- Everything 301 returned, unchanged, plus the two columns the kit rule needs:
-- whether anything the caller carries is out of calibration, and which
-- amplifier the visit should be recorded against. Read 301's header for why
-- this door exists at all and why it hands back facts rather than rows; none
-- of that changes here.
--
-- `kit_calibration_overdue` mirrors domain/session/kit.ts exactly: an item
-- counts only when it is active, assigned to the caller's own practitioner row
-- and has a `calibration_due_at` strictly before now. Nothing assigned is
-- false, which is what lets the register ship empty.
--
-- `kit_id` is the caller's one active amplifier — exactly one, or null. Two
-- amplifiers assigned to one person is a real thing the practice may do, and
-- picking one of them would be the record inventing a fact.
--
-- Both are answered whatever `found` says. They describe the caller and not
-- the client, so nulling them out with the rest would tell a caller nothing
-- and cost the route a second query on the one path that has already failed.
------------------------------------------------------------------------------
drop function if exists app.checkin_context(uuid, text);

create function app.checkin_context(p_client_id uuid, p_mrn text)
returns table (
  found                    boolean,
  client_id                uuid,
  has_date_of_birth        boolean,
  is_minor                 boolean,
  active_consent_purposes  text[],
  kit_calibration_overdue  boolean,
  kit_id                   uuid
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  with today_dubai as (
    -- Local midnight today, and tomorrow's, as real instants. See 301's own
    -- header for why day_end is derived from `today + 1` as a date rather than
    -- by adding a calendar interval to a timestamptz.
    select
      t.today,
      t.today::timestamp at time zone 'Asia/Dubai' as day_start,
      (t.today + 1)::timestamp at time zone 'Asia/Dubai' as day_end
    from (select (date_trunc('day', now() at time zone 'Asia/Dubai'))::date as today) as t
  ),
  caller as (
    select pr.id
      from public.practitioner pr
     where pr.user_id = nullif(current_setting('app.actor_id', true), '')::uuid
       and pr.tenant_id = app.current_tenant_id()
  ),
  carried as (
    -- Everything active the caller has with them. An unassigned item is not
    -- here at all, which is how "no item assigned is no block" is written.
    select k.id, k.kind, k.calibration_due_at
      from public.kit k
     where k.tenant_id = app.current_tenant_id()
       and k.status = 'active'
       and k.assigned_practitioner_id = (select id from caller)
  ),
  resolved as (
    select c.id, c.date_of_birth
      from public.client c
     where c.tenant_id = app.current_tenant_id()
       and (
         (p_client_id is not null and c.id = p_client_id)
         or (p_client_id is null and p_mrn is not null and c.mrn = p_mrn)
       )
  )
  select
    resolved_ctx.found as found,
    case when resolved_ctx.found then resolved_ctx.client_id end as client_id,
    resolved_ctx.found and resolved_ctx.has_date_of_birth as has_date_of_birth,
    resolved_ctx.found and resolved_ctx.is_minor as is_minor,
    case when resolved_ctx.found then resolved_ctx.active_consent_purposes else '{}'::text[] end
      as active_consent_purposes,
    -- The caller's own instruments, answered whatever found says.
    exists (
      select 1 from carried where carried.calibration_due_at < now()
    ) as kit_calibration_overdue,
    (
      -- Exactly one, or nothing: a second amplifier makes this null rather
      -- than making the record choose between them.
      select k.id from carried k
       where k.kind = 'amplifier'
         and (select count(*) from carried c where c.kind = 'amplifier') = 1
    ) as kit_id
  from (
    select
      resolved.id is not null and exists (
        select 1
          from public.appointment a, today_dubai t
         where a.tenant_id = app.current_tenant_id()
           and a.client_id = resolved.id
           and a.status in ('proposed', 'confirmed', 'checked_in')
           and a.practitioner_id = (select id from caller)
           and a.window_start < t.day_end
           and a.window_end > t.day_start
      ) as found,
      resolved.id as client_id,
      resolved.date_of_birth is not null as has_date_of_birth,
      coalesce(
        resolved.date_of_birth is not null
          and resolved.date_of_birth
              > ((select today from today_dubai) - interval '18 years')::date,
        false
      ) as is_minor,
      coalesce(
        (select array_agg(distinct co.purpose::text)
           from public.consent co
          where co.client_id = resolved.id
            and co.tenant_id = app.current_tenant_id()
            and co.status = 'active'
            and (co.expires_at is null or co.expires_at > now())
            and co.purpose = any(array['participation', 'minor_participation', 'home_visit']::public.consent_purpose[])),
        '{}'::text[]
      ) as active_consent_purposes
    from (select 1) as seed
    left join resolved on true
  ) as resolved_ctx
$$;
revoke execute on function app.checkin_context(uuid, text) from public;
grant execute on function app.checkin_context(uuid, text) to app_role;

------------------------------------------------------------------------------
-- 4. The photograph's consent, after the visit has closed.
--
-- `app.session_consent_active` (304) answers only for a visit that is still
-- open, deliberately: it serves the runner, and a door into a visit nobody is
-- standing in front of any more is a door too many.
--
-- The photograph's bytes are the one thing that legitimately arrives late.
-- The device holds them until the event that names them has been acknowledged
-- and until it has a connection, and an offline day may close the visit first
-- (section 4.4, decision 4). Asking 304's question at that moment would answer
-- false for a household that has agreed, and the device would drop the picture
-- it was told to take.
--
-- So: the same question, with the same guardian rule and the same tenant and
-- practitioner binding, and without the requirement that the visit still be
-- open. It is narrower than 304 in the other direction — one purpose,
-- `photo_video`, and no argument that could ask it about another.
------------------------------------------------------------------------------
create function app.setup_photo_consent_active(p_session_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.session s
      join public.practitioner p on p.id = s.practitioner_id
      join public.client cl on cl.id = s.client_id and cl.tenant_id = s.tenant_id
      join public.consent c on c.client_id = s.client_id and c.tenant_id = s.tenant_id
      join public.contact ct on ct.id = c.given_by_contact_id and ct.tenant_id = c.tenant_id
     where s.id = p_session_id
       and s.tenant_id = app.current_tenant_id()
       and p.tenant_id = app.current_tenant_id()
       and p.user_id = app.current_actor_id()
       and p.status = 'active'
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
       and c.purpose = 'photo_video'::public.consent_purpose
       and (
         -- An adult: the consent stands on its own.
         cl.date_of_birth is not null
         and cl.date_of_birth
             <= ((date_trunc('day', now() at time zone 'Asia/Dubai'))::date
                 - interval '18 years')::date
         -- A minor, or a client with no date of birth on file: the contact who
         -- gave it must be one the practice records as able to.
         or ct.can_consent
       )
  )
$$;
revoke execute on function app.setup_photo_consent_active(uuid) from public;
grant execute on function app.setup_photo_consent_active(uuid) to app_role;

------------------------------------------------------------------------------
-- 5. The `document` row for a setup photograph.
--
-- db/policies/client/writers.sql gives filing a client document to the owner,
-- an admin and the lead practitioner, and deliberately not to a practitioner:
-- "section 2 gives them the client brief and access notes on a location, not
-- the filing." That is the right rule for the filing cabinet and the wrong one
-- for the single row a visit produces, and widening it would hand a
-- practitioner every kind of document against every client they can see.
--
-- So this is a door and not a widening, in the shape 301 and 302 already set:
-- security definer, granted to the API role, and able to do exactly one thing.
-- It files a `setup_photo` against the client of the caller's own session,
-- with the key the caller computed from ids alone, and it refuses everything
-- else — another kind, another client, another practitioner's visit, a visit
-- whose household has not agreed, and a second photograph on a visit that
-- already has one.
--
-- Immutable, like every other piece of evidence: a photograph of an electrode
-- placement is the record of how the session was set up, and 903 makes that
-- mean the row is neither changed nor deleted outside an erasure.
-- `retention_until` follows the client's own activity, which is what
-- `p_retention_until` carries in — computed by the application, as
-- 00-data-model.md section 3 requires, and never by this function.
------------------------------------------------------------------------------
create function app.file_setup_photo_document(
  p_session_id      uuid,
  p_document_id     uuid,
  p_storage_key     text,
  p_mime_type       text,
  p_sha256          bytea,
  p_retention_until timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_client_id uuid;
  v_tenant_id uuid;
  v_existing  uuid;
begin
  if p_mime_type not in ('image/jpeg', 'image/webp', 'image/png') then
    raise exception 'a setup photograph is a jpeg, a webp or a png'
      using errcode = 'check_violation';
  end if;

  -- The visit must be the caller's own, and the caller must be somebody the
  -- practice still has working. Checked here rather than trusted, because
  -- security definer means row security is not going to check it for us.
  select s.client_id, s.tenant_id, s.setup_photo_document_id
    into v_client_id, v_tenant_id, v_existing
    from public.session s
    join public.practitioner p on p.id = s.practitioner_id
   where s.id = p_session_id
     and s.tenant_id = app.current_tenant_id()
     and p.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id()
     and p.status = 'active';

  if v_client_id is null then
    return false;
  end if;
  -- One setup photograph per visit (session.setup_photo_document_id is
  -- singular). A second is refused here rather than filed and orphaned.
  if v_existing is not null then
    return false;
  end if;
  if not app.setup_photo_consent_active(p_session_id) then
    return false;
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, 'setup_photo', p_storage_key, p_mime_type,
    p_sha256, app.current_actor_id(), p_retention_until, true, app.current_actor_id()
  );
  return true;
end
$$;
revoke execute on function app.file_setup_photo_document(uuid, uuid, text, text, bytea, timestamptz)
  from public;
grant execute on function app.file_setup_photo_document(uuid, uuid, text, text, bytea, timestamptz)
  to app_role;

------------------------------------------------------------------------------
-- 6. The link on the visit, and the one change a closed visit admits.
--
-- The bytes may reach the server after an offline day has closed the visit
-- (section 4.4, decision 4). The close does not wait for them, so the closed
-- row has to admit exactly one change: `setup_photo_document_id`, from null to
-- a value, made by this function, and nothing else ever.
--
-- The guard in section 7 below is what enforces "made by this function": it
-- refuses every other change to a closed row exactly as it did, and admits
-- this one only while the flag this function sets is on for the current
-- transaction. A route cannot set that flag — `app.setup_photo_filing` is
-- granted to nobody — so the exception is genuinely this door's and not a
-- widening of the guard.
------------------------------------------------------------------------------
-- A transaction-local marker in the shape 098_erasure_guard.sql's
-- app.erasure_active uses: a bookkeeping table, not a business row, carrying
-- only the txid that names the transaction. app_role holds no grant on it at
-- all, so nothing but the definer function below can raise the flag.
create table app.setup_photo_filing (
  txid bigint primary key
);
comment on table app.setup_photo_filing is
  'Transaction marker, not a business row: says that app.file_setup_photo is running '
  'in this transaction, which is the one thing the close guard admits on a frozen '
  'session (docs/SPEC/practitioner-phone.md section 4.4). app_role holds no grant on '
  'it, so no route can raise the flag itself.';
revoke all on app.setup_photo_filing from public;
-- Row security on, with no policy at all, exactly as app.erasure_active
-- carries it (098_erasure_guard.sql): nothing but the definer functions above
-- and below ever reads or writes this row, and tests/db/schema.test.ts asks
-- every table in these two schemas for it.
alter table app.setup_photo_filing enable row level security;

create function app.file_setup_photo(p_session_id uuid, p_document_id uuid) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_updated integer;
begin
  insert into app.setup_photo_filing (txid) values (txid_current())
  on conflict (txid) do nothing;

  update public.session s
     set setup_photo_document_id = p_document_id
    from public.practitioner p, public.document d
   where s.id = p_session_id
     and p.id = s.practitioner_id
     and s.tenant_id = app.current_tenant_id()
     and p.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id()
     and p.status = 'active'
     -- From null to a value, once. A visit that already names a photograph is
     -- not one this door replaces.
     and s.setup_photo_document_id is null
     -- The document must be this client's own setup photograph, already filed.
     and d.id = p_document_id
     and d.tenant_id = s.tenant_id
     and d.client_id = s.client_id
     and d.kind = 'setup_photo';
  get diagnostics v_updated = row_count;

  delete from app.setup_photo_filing where txid = txid_current();
  return v_updated = 1;
end
$$;
revoke execute on function app.file_setup_photo(uuid, uuid) from public;
grant execute on function app.file_setup_photo(uuid, uuid) to app_role;

------------------------------------------------------------------------------
-- 7. The close guard, extended by exactly one column.
--
-- Replaced rather than edited: 302 is merged, and this is a new definition of
-- the same function, which is how a forward-only schema changes behaviour.
--
-- Everything 302 refused it still refuses. The one addition is the filing
-- above: on a closed row, inside a transaction app.file_setup_photo has
-- flagged, a change that moves `setup_photo_document_id` from null to a value
-- and leaves every other column standing still is allowed through. The
-- comparison is written as "the row minus those two columns is unchanged", the
-- same shape 903 uses to let a wording be retired, so a filing that tried to
-- ride a second change in with it is refused rather than admitted.
------------------------------------------------------------------------------
create or replace function app.session_refuse_update_after_close() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.closed_at is null
     or exists (select 1 from app.erasure_active where txid = txid_current()) then
    return new;
  end if;
  -- to_jsonb rather than `new is not distinct from old`: the row carries a
  -- geography column, and this comparison must not depend on which types
  -- happen to have an equality operator today.
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return null;
  end if;
  -- The one change a closed visit admits (docs/SPEC/practitioner-phone.md
  -- section 4.4): the photograph's link, from null to a value, filed by
  -- app.file_setup_photo, with everything else standing still.
  if old.setup_photo_document_id is null
     and new.setup_photo_document_id is not null
     and exists (select 1 from app.setup_photo_filing where txid = txid_current())
     and (to_jsonb(new) - array['setup_photo_document_id', 'updated_at'])
         is not distinct from (to_jsonb(old) - array['setup_photo_document_id', 'updated_at'])
  then
    return new;
  end if;
  raise exception 'session % is closed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation';
end
$$;

-- rollback:
--   -- The policy file db/policies/session/kit.sql must be deleted first, or the
--   -- next migrate's policy pass fails creating a policy on a table that no longer
--   -- exists. Its own drops, run ahead of the table drop:
--   drop policy if exists kit_amend on public.kit;
--   drop policy if exists kit_write on public.kit;
--   drop policy if exists kit_read on public.kit;
--   drop policy if exists tenant_isolation on public.kit;
--   -- Section 7 back to 302's own definition: re-run that migration's body for
--   -- app.session_refuse_update_after_close.
--   drop function if exists app.file_setup_photo(uuid, uuid);
--   drop table if exists app.setup_photo_filing;
--   drop function if exists app.file_setup_photo_document(uuid, uuid, text, text, bytea, timestamptz);
--   drop function if exists app.setup_photo_consent_active(uuid);
--   -- app.checkin_context back to 301's own definition: drop this one and re-run
--   -- that migration's body.
--   drop function if exists app.checkin_context(uuid, text);
--   drop index if exists session_kit_idx;
--   alter table public.session
--     drop constraint if exists session_kit_fk,
--     drop column if exists kit_id;
--   revoke select, insert, update on public.kit from app_role;
--   drop table if exists public.kit;
--   drop type if exists kit_kind;
