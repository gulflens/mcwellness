-- 211_live_location.sql
-- Live location for the dispatcher, consent-first (docs/SPEC/dispatch.md
-- section 15, piece twenty-five; docs/PLAN/dispatch.md, "The one that needs
-- your signature"; switched on by the operator on 6 October 2026).
--
-- Three tables:
--
-- * `staff_consent` — a member of staff's own written, revocable consent, naming
--   the version of the notice they read (docs/CONSENT/staff/location.en.md).
--   Not the client `consent` table, which is client-scoped by its own schema.
--   One standing consent per person and purpose; withdrawing it stamps
--   `withdrawn_at` and a later consent is a new row, so the history of yes and
--   no is kept. Audited.
-- * `location_sharing` — the person's own switch. Consent is given once;
--   sharing is turned on and off as often as they like. Audited.
-- * `practitioner_position` — where they were, when, and how sure the phone
--   was. Written only while the person's consent stands and their switch is on
--   (checked here, through `app.position_writable`) and their shift is open
--   (checked by domain/scheduling/locationSharing.ts in the route, because what
--   a shift is is a business rule). **Never audited**: the audit trail copies a
--   row's contents into an append-only log kept five years, and a two-day
--   limit on positions would mean nothing if every one of them were also kept
--   there. So the table has no `audit_row` trigger, says so on itself, and
--   tests/db/schema.test.ts admits it by that comment. Deleted after two days
--   by the hourly job (`app.purge_practitioner_positions`), and at once when
--   the person withdraws consent (`app.forget_own_positions`).
--
-- Nobody can give, withdraw or switch on for somebody else, the owner
-- included: the policies (db/policies/dispatch/location.sql) admit a write
-- only where `user_id` is the caller's own.
--
-- Needs: 010 (tenant), 020 (app_user), 050 (practitioner), 080 (app.audit_row),
--        090 (app_role), 095 (app.actor_has_role), 099 (app_user's tenant-scoped
--        key), 100 (app.current_actor_id)

create type public.staff_consent_purpose as enum ('location_sharing');

------------------------------------------------------------------------------
-- 1. The consent.
------------------------------------------------------------------------------
create table public.staff_consent (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id),
  user_id         uuid not null references public.app_user (id),
  purpose         public.staff_consent_purpose not null,
  notice_version  text not null check (notice_version ~ '^[0-9]+\.[0-9]+$'),
  given_at        timestamptz not null default now(),
  withdrawn_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.app_user (id),
  unique (tenant_id, id),
  -- Bound to a person of the SAME practice (099's rule pointing outwards).
  foreign key (tenant_id, user_id) references public.app_user (tenant_id, id),
  constraint staff_consent_withdrawn_after_given
    check (withdrawn_at is null or withdrawn_at >= given_at)
);
create unique index staff_consent_one_standing_idx
  on public.staff_consent (tenant_id, user_id, purpose) where withdrawn_at is null;
create index staff_consent_user_idx on public.staff_consent (user_id);
create index staff_consent_created_by_idx on public.staff_consent (created_by);

comment on table public.staff_consent is
  'audited: no client - a member of staff''s own consent to a purpose that concerns them, '
  'today only sharing their location while they work (docs/SPEC/dispatch.md section 15). '
  'Given and withdrawn by that person alone; a withdrawal stamps withdrawn_at and a later '
  'consent is a new row.';

-- A consent is evidence of what somebody agreed to, so the only change it
-- takes is its own withdrawal: once, and nothing else on the row moves.
create function app.guard_staff_consent() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'a withdrawn consent is not changed; a new consent is a new row'
      using errcode = 'check_violation';
  end if;
  if new.withdrawn_at is null
     or new.id <> old.id or new.tenant_id <> old.tenant_id or new.user_id <> old.user_id
     or new.purpose <> old.purpose or new.notice_version <> old.notice_version
     or new.given_at <> old.given_at or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'a consent is only ever withdrawn, never edited'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger guard_staff_consent before update on public.staff_consent
  for each row execute function app.guard_staff_consent();
create trigger set_updated_at before update on public.staff_consent
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.staff_consent
  for each row execute function app.audit_row();
alter table public.staff_consent enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. The switch.
------------------------------------------------------------------------------
create table public.location_sharing (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id),
  user_id     uuid not null unique references public.app_user (id),
  sharing_on  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_user (id),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references public.app_user (tenant_id, id)
);
create index location_sharing_created_by_idx on public.location_sharing (created_by);

comment on table public.location_sharing is
  'audited: no client - a member of staff''s own switch for sharing their location while '
  'they work (docs/SPEC/dispatch.md section 15). Turned on and off by that person alone, '
  'and only on while their consent stands.';

create trigger set_updated_at before update on public.location_sharing
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.location_sharing
  for each row execute function app.audit_row();
alter table public.location_sharing enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. The positions. No audit trigger, by decision (the header above).
------------------------------------------------------------------------------
create table public.practitioner_position (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id),
  practitioner_id  uuid not null references public.practitioner (id),
  recorded_at      timestamptz not null default now(),
  latitude         double precision not null check (latitude between -90 and 90),
  longitude        double precision not null check (longitude between -180 and 180),
  accuracy_metres  real not null check (accuracy_metres >= 0 and accuracy_metres <= 100000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.app_user (id),
  unique (tenant_id, id)
);
create index practitioner_position_latest_idx
  on public.practitioner_position (practitioner_id, recorded_at desc);
create index practitioner_position_age_idx
  on public.practitioner_position (tenant_id, recorded_at);
create index practitioner_position_created_by_idx on public.practitioner_position (created_by);

comment on table public.practitioner_position is
  'unaudited by decision - where a practitioner who chose to share it was while they worked '
  '(docs/PLAN/dispatch.md, "The one that needs your signature", approved 10 September 2026 '
  'and switched on 6 October 2026). Kept two days and then deleted by the hourly job; '
  'deleted at once when the person withdraws consent; never copied into the audit log, '
  'which would keep it five years; read only by the board''s roles, and only the last one.';

------------------------------------------------------------------------------
-- 4. The doors. Security definer, because each asks about rows the caller's
--    own row security would hide (a lead practitioner reading the board
--    cannot read a colleague's consent, and should not), and each answers one
--    question and nothing more.
------------------------------------------------------------------------------

-- Whether this person's location may be shared at all: a standing consent and
-- the switch on, in the current practice.
create function app.location_sharing_active(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
      select 1 from public.staff_consent c
       where c.user_id = p_user_id
         and c.tenant_id = app.current_tenant_id()
         and c.purpose = 'location_sharing'::public.staff_consent_purpose
         and c.withdrawn_at is null)
     and exists (
      select 1 from public.location_sharing s
       where s.user_id = p_user_id
         and s.tenant_id = app.current_tenant_id()
         and s.sharing_on)
$$;
revoke execute on function app.location_sharing_active(uuid) from public;
grant execute on function app.location_sharing_active(uuid) to app_role;

-- Whether the caller may write a position for this practitioner: it is their
-- own practitioner row, still working, and their sharing is active.
create function app.position_writable(p_practitioner_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.practitioner p
     where p.id = p_practitioner_id
       and p.tenant_id = app.current_tenant_id()
       and p.user_id = app.current_actor_id()
       and p.status = 'active'
       and app.location_sharing_active(p.user_id))
$$;
revoke execute on function app.position_writable(uuid) from public;
grant execute on function app.position_writable(uuid) to app_role;

-- Whether this practitioner's location may be shown: they are sharing now. A
-- switch turned off takes the last position off the board at once rather
-- than leaving it there to look current.
create function app.position_visible(p_practitioner_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.practitioner p
     where p.id = p_practitioner_id
       and p.tenant_id = app.current_tenant_id()
       and app.location_sharing_active(p.user_id))
$$;
revoke execute on function app.position_visible(uuid) from public;
grant execute on function app.position_visible(uuid) to app_role;

-- The last position of a practitioner. A policy on this table cannot ask the
-- table about itself without recursing, so the question is asked here.
create function app.latest_position_id(p_practitioner_id uuid) returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select pp.id from public.practitioner_position pp
   where pp.practitioner_id = p_practitioner_id
     and pp.tenant_id = app.current_tenant_id()
   order by pp.recorded_at desc, pp.id desc
   limit 1
$$;
revoke execute on function app.latest_position_id(uuid) from public;
grant execute on function app.latest_position_id(uuid) to app_role;

-- A withdrawal takes everything with it, at once: the caller's own positions
-- and nobody else's. The API role holds no delete on the table, so this is
-- the only way a person's positions leave it before the job takes them.
create function app.forget_own_positions() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.practitioner_position pp
   using public.practitioner p
   where p.id = pp.practitioner_id
     and p.tenant_id = app.current_tenant_id()
     and pp.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.forget_own_positions() from public;
grant execute on function app.forget_own_positions() to app_role;

-- The hourly job's delete, for the current practice. The cutoff is the
-- domain's (positionsCutoff, two days); this only refuses a cutoff in the
-- future, which no job could mean, and a caller who is not the office.
create function app.purge_practitioner_positions(p_before timestamptz) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'only the office deletes positions'
      using errcode = 'insufficient_privilege';
  end if;
  if p_before is null or p_before > now() then
    raise exception 'a cutoff is in the past'
      using errcode = 'check_violation';
  end if;
  delete from public.practitioner_position
   where tenant_id = app.current_tenant_id()
     and recorded_at < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.purge_practitioner_positions(timestamptz) from public;
grant execute on function app.purge_practitioner_positions(timestamptz) to app_role;

------------------------------------------------------------------------------
-- 5. Row security and privileges, in the shape 090_grants_and_rls.sql uses.
--    No delete on any of the three: a consent is withdrawn, a switch is turned
--    off, and positions leave only through the two functions above.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
  t text;
begin
  foreach t in array array['staff_consent', 'location_sharing', 'practitioner_position'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  grant select, insert, update on public.staff_consent to app_role;
  grant select, insert, update on public.location_sharing to app_role;
  grant select, insert on public.practitioner_position to app_role;
end
$$;

-- rollback:
--   drop function if exists app.purge_practitioner_positions(timestamptz);
--   drop function if exists app.forget_own_positions();
--   drop function if exists app.latest_position_id(uuid);
--   drop function if exists app.position_visible(uuid);
--   drop function if exists app.position_writable(uuid);
--   drop function if exists app.location_sharing_active(uuid);
--   drop table if exists public.practitioner_position;
--   drop table if exists public.location_sharing;
--   drop table if exists public.staff_consent;
--   drop function if exists app.guard_staff_consent();
--   drop type if exists public.staff_consent_purpose;
--
--   The policy file goes with the tables, because the runner re-applies every
--   policy after the migrations on each db:migrate: delete
--   db/policies/dispatch/location.sql, or the next db:migrate fails on a policy
--   for a table that is no longer there.
