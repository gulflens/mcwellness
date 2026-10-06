-- 213_helper_accompaniment.sql
-- The helper: a member of the practitioner's family who drives and carries
-- kit on the day, and shares their own location while they help (round 76;
-- the operator's option 3 of 6 October 2026; docs/SPEC/dispatch.md section
-- 15.12). The role itself is core migration 974.
--
-- Three things here:
--
-- 1. **Whom a helper accompanies** — `helper_accompaniment`. The owner or an
--    admin names, for each helper, one practitioner. Append-only in the shape
--    `staff_consent` already has: one standing row per helper; ending one
--    stamps `ended_at` and `ended_by` once and nothing else on the row moves;
--    a change of practitioner is the old row ended and a new row written in
--    the same breath. Audited. Written only through the two functions in
--    section 3, which ask who is calling from `user_role` rather than from a
--    session setting (migration 923's reasoning): the API role holds select on
--    the table and nothing else, so a helper cannot change whom they
--    accompany, and neither can anybody else except through those two doors.
--
-- 2. **A helper's positions** go in `practitioner_position`, with a new
--    nullable `user_id` and a check that exactly one of `practitioner_id` and
--    `user_id` is set. Chosen over a separate `helper_position` table because
--    every rule the table already carries then holds for a helper without
--    being written twice: the two-day purge (`app.purge_practitioner_
--    positions` deletes by practice and age, whoever the row is about), the
--    server's own `recorded_at` (212's trigger), the audit exemption the
--    table names on itself and `tests/db/schema.test.ts` admits it by, and the
--    weekly backup that keeps its shape and none of its rows
--    (`.github/workflows/backup.yml`). A second table would need each of those
--    restated, and each restatement is a place for the two to drift apart.
--    The table's name now undersells it; renaming it would touch every one of
--    those places for no change in behaviour, so it keeps its name and its
--    comment says who it holds.
--
-- 3. **The doors.** Security definer, as 211's are, because each asks about
--    rows the caller's own row security would hide, and each answers one
--    question:
--    - `app.helper_accompanies(user)`: the practitioner a helper accompanies
--      now, or null — no standing row, not a helper any more, not active, or
--      the practitioner no longer working.
--    - `app.helper_position_writable(user)`, `app.helper_position_visible
--      (user)` and `app.latest_helper_position_id(user)`: 211's three
--      position questions, asked of a helper.
--    - `app.accompanied_day(start, end)`: the caller's accompanied
--      practitioner's visits on the day, as times and states only — what the
--      shift rule (domain/scheduling/locationSharing.ts) needs and nothing
--      more. No client, no address, no service name: a helper's route reads
--      the day it is fed, and a helper's row security reads no appointment at
--      all (db/policies/core/helper_reach.sql).
--    - `app.accompanied_name()`: the accompanied practitioner's display name,
--      for the helper's own page, which shows the first name only.
--    - `app.name_helper(user, practitioner)` and `app.revoke_helper(user)`:
--      the owner's or an admin's two acts.
--    - `app.forget_own_positions()` is replaced so a withdrawal takes a
--      helper's positions as well as a practitioner's.
--
-- **The enum value is never used here.** 974 adds `helper` to `role_kind`,
-- and on a fresh database this file runs first (numeric order), so every
-- comparison below is `role::text = 'helper'` and every write casts the text
-- at run time. Nothing here is parsed against a value that may not exist yet.
--
-- **The shift is the accompanied practitioner's**, worked out by the same
-- pure rule in the route (`helperShiftWindow`), never written again in SQL —
-- 212's reasoning, unchanged.
--
-- Needs: 020 (app_user, user_role), 050 (practitioner), 080 (app.audit_row),
--        090 (app_role), 099 (tenant-scoped keys), 100
--        (app.current_actor_id), 200 (appointment), 211 and 212 (the tables
--        and functions extended here). `app.accompanied_day` also reads
--        `session` (300), which a "Needs" line cannot name from here; it is
--        PL/pgSQL so the table is looked up when it runs, not when it is made.

------------------------------------------------------------------------------
-- 1. Whom a helper accompanies.
------------------------------------------------------------------------------
create table public.helper_accompaniment (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id),
  helper_user_id   uuid not null references public.app_user (id),
  practitioner_id  uuid not null references public.practitioner (id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  ended_by         uuid references public.app_user (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.app_user (id),
  unique (tenant_id, id),
  -- Both ends belong to the SAME practice (099's rule pointing outwards).
  foreign key (tenant_id, helper_user_id) references public.app_user (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.practitioner (tenant_id, id),
  constraint helper_accompaniment_ended_after_started
    check (ended_at is null or ended_at >= started_at),
  constraint helper_accompaniment_ended_by_with_ended
    check (ended_by is null or ended_at is not null)
);
create unique index helper_accompaniment_one_standing_idx
  on public.helper_accompaniment (tenant_id, helper_user_id) where ended_at is null;
create index helper_accompaniment_helper_idx on public.helper_accompaniment (helper_user_id);
create index helper_accompaniment_practitioner_idx on public.helper_accompaniment (practitioner_id);
create index helper_accompaniment_ended_by_idx on public.helper_accompaniment (ended_by);
create index helper_accompaniment_created_by_idx on public.helper_accompaniment (created_by);

comment on table public.helper_accompaniment is
  'audited: no client - which practitioner a helper accompanies on the day, named by the '
  'owner or an admin (docs/SPEC/dispatch.md section 15.12). Append-only: ending one stamps '
  'ended_at once, and a change of practitioner is a new row. A helper reads their own and '
  'changes none.';

-- Evidence of who was named to go with whom, and when: the only change a row
-- takes is its own ending, once.
create function app.guard_helper_accompaniment() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.ended_at is not null then
    raise exception 'an ended accompaniment is not changed; a new one is a new row'
      using errcode = 'check_violation';
  end if;
  if new.ended_at is null
     or new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.helper_user_id <> old.helper_user_id or new.practitioner_id <> old.practitioner_id
     or new.started_at <> old.started_at or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'an accompaniment is only ever ended, never edited'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger guard_helper_accompaniment before update on public.helper_accompaniment
  for each row execute function app.guard_helper_accompaniment();
create trigger set_updated_at before update on public.helper_accompaniment
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.helper_accompaniment
  for each row execute function app.audit_row();
alter table public.helper_accompaniment enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. A helper's positions, in the same table and under the same rules.
------------------------------------------------------------------------------
alter table public.practitioner_position
  add column user_id uuid,
  alter column practitioner_id drop not null,
  add constraint practitioner_position_one_person
    check (num_nonnulls(practitioner_id, user_id) = 1),
  add constraint practitioner_position_helper_fkey
    foreign key (tenant_id, user_id) references public.app_user (tenant_id, id);
create index practitioner_position_helper_latest_idx
  on public.practitioner_position (user_id, recorded_at desc) where user_id is not null;

comment on table public.practitioner_position is
  'unaudited by decision - where a practitioner, or a helper accompanying one, who chose to '
  'share it was while they worked (docs/PLAN/dispatch.md, "The one that needs your '
  'signature", approved 10 September 2026 and switched on 6 October 2026; helpers from '
  'round 76, docs/SPEC/dispatch.md section 15.12). Exactly one of practitioner_id and '
  'user_id is set: user_id is a helper''s. Kept two days and then deleted by the hourly job; '
  'deleted at once when the person withdraws consent; never copied into the audit log, '
  'which would keep it five years; read only by the board''s roles, and only the last one.';

------------------------------------------------------------------------------
-- 3. The doors.
------------------------------------------------------------------------------

-- The practitioner this person accompanies now, in the current practice, or
-- null: they hold the helper role, their sign-in is active, they have a
-- standing accompaniment, and the practitioner is still working.
create function app.helper_accompanies(p_user_id uuid) returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select a.practitioner_id
    from public.helper_accompaniment a
    join public.app_user u on u.id = a.helper_user_id and u.tenant_id = a.tenant_id
    join public.practitioner p on p.id = a.practitioner_id and p.tenant_id = a.tenant_id
   where a.helper_user_id = p_user_id
     and a.tenant_id = app.current_tenant_id()
     and a.ended_at is null
     and u.status = 'active'
     and p.status = 'active'
     and exists (select 1 from public.user_role r
                  where r.user_id = a.helper_user_id and r.tenant_id = a.tenant_id
                    and r.role::text = 'helper')
$$;
revoke execute on function app.helper_accompanies(uuid) from public;
grant execute on function app.helper_accompanies(uuid) to app_role;

-- Whether the caller may write a position as a helper: it is their own, they
-- accompany somebody now, and their sharing is active (consent to the notice
-- in force and their own switch on, 212's `app.location_sharing_active`).
create function app.helper_position_writable(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select p_user_id is not null
     and p_user_id = app.current_actor_id()
     and app.helper_accompanies(p_user_id) is not null
     and app.location_sharing_active(p_user_id)
$$;
revoke execute on function app.helper_position_writable(uuid) from public;
grant execute on function app.helper_position_writable(uuid) to app_role;

-- Whether a helper's location may be shown: they accompany somebody now and
-- are sharing now. An accompaniment ended takes the last position off the
-- board at once, as a switch turned off does.
create function app.helper_position_visible(p_user_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select app.helper_accompanies(p_user_id) is not null
     and app.location_sharing_active(p_user_id)
$$;
revoke execute on function app.helper_position_visible(uuid) from public;
grant execute on function app.helper_position_visible(uuid) to app_role;

-- A helper's last position (211's `app.latest_position_id`, for a helper).
create function app.latest_helper_position_id(p_user_id uuid) returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select pp.id from public.practitioner_position pp
   where pp.user_id = p_user_id
     and pp.tenant_id = app.current_tenant_id()
   order by pp.recorded_at desc, pp.id desc
   limit 1
$$;
revoke execute on function app.latest_helper_position_id(uuid) from public;
grant execute on function app.latest_helper_position_id(uuid) to app_role;

-- The day of the practitioner the caller accompanies, as the shift rule needs
-- it: when each visit's window opens and closes, how long the service is, what
-- state the visit is in and when its session closed. Exactly the columns of
-- the practitioner's own day read in app/api/location/routes.ts, and nothing
-- that names a household or a place. Empty for anybody who accompanies nobody.
--
-- PL/pgSQL rather than SQL for one reason: `session` is migration 300, and on a
-- fresh database this file runs before it. A SQL function's body is checked
-- against the tables when it is created; a PL/pgSQL one's when it first runs,
-- by which time every migration has.
create function app.accompanied_day(p_start timestamptz, p_end timestamptz)
returns table (window_start timestamptz, window_end timestamptz, status text,
               duration_minutes integer, closed_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return query
  select a.window_start, a.window_end, a.status::text, st.duration_minutes::integer, s.closed_at
    from public.appointment a
    join public.service_type st on st.id = a.service_type_id and st.tenant_id = a.tenant_id
    left join lateral (
      select s.closed_at from public.session s
       where s.appointment_id = a.id and s.tenant_id = a.tenant_id
       order by s.checked_in_at desc limit 1
    ) s on true
   where a.tenant_id = app.current_tenant_id()
     and a.practitioner_id = app.helper_accompanies(app.current_actor_id())
     and a.window_start >= p_start and a.window_start < p_end;
end
$$;
revoke execute on function app.accompanied_day(timestamptz, timestamptz) from public;
grant execute on function app.accompanied_day(timestamptz, timestamptz) to app_role;

-- The display name of the practitioner the caller accompanies, or null. The
-- helper's page shows the first name only (domain/scheduling/locationSharing.ts
-- `firstNameOf`); the route cuts it before anything leaves.
create function app.accompanied_name() returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.display_name
    from public.practitioner p
    join public.app_user u on u.id = p.user_id and u.tenant_id = p.tenant_id
   where p.id = app.helper_accompanies(app.current_actor_id())
     and p.tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.accompanied_name() from public;
grant execute on function app.accompanied_name() to app_role;

-- Whether the caller is the owner or an admin of the current practice, read
-- from user_role and not from a session setting (923's reasoning: these doors
-- write rows the API role cannot, so the question has one answer).
create function app.office_names_helpers(p_actor uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select p_actor is not null and exists (
    select 1 from public.user_role r
     where r.user_id = p_actor and r.tenant_id = app.current_tenant_id()
       and r.role::text in ('owner', 'admin'))
$$;
revoke execute on function app.office_names_helpers(uuid) from public;

-- The owner or an admin names whom a helper accompanies: makes the person a
-- helper if they are not one yet, and replaces any standing accompaniment
-- with one naming this practitioner. Naming the same practitioner again
-- changes nothing. Returns the standing row's id.
create function app.name_helper(p_user_id uuid, p_practitioner_id uuid) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor    uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant   uuid := app.current_tenant_id();
  v_standing public.helper_accompaniment%rowtype;
  v_id       uuid;
begin
  if not app.office_names_helpers(v_actor) then
    raise exception 'only the owner or an admin names a helper' using errcode = '42501';
  end if;
  if p_user_id is null or p_practitioner_id is null then
    raise exception 'a helper and a practitioner are both named' using errcode = '22004';
  end if;
  if v_actor = p_user_id then
    raise exception 'nobody makes themselves a helper' using errcode = '42501';
  end if;
  -- Serialise every naming of the same person, as 923 does for a revoke.
  perform 1 from public.app_user u
   where u.id = p_user_id and u.tenant_id = v_tenant and u.status = 'active'
     for update;
  if not found then
    raise exception 'no such active person in this practice' using errcode = '42501';
  end if;
  -- A helper holds no other role: what a helper may reach is drawn round
  -- exactly that one role (db/policies/core/helper_reach.sql), and a person
  -- who already works at the practice, or is a household's contact, is not
  -- made a helper on top of it.
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant
                and r.role::text <> 'helper') then
    raise exception 'a helper holds no other role' using errcode = '42501';
  end if;
  if not exists (select 1 from public.practitioner p
                  where p.id = p_practitioner_id and p.tenant_id = v_tenant
                    and p.status = 'active' and p.user_id <> p_user_id) then
    raise exception 'no such working practitioner in this practice' using errcode = '42501';
  end if;

  insert into public.user_role (tenant_id, user_id, role, granted_by, created_by)
  values (v_tenant, p_user_id, 'helper'::text::public.role_kind, v_actor, v_actor)
  on conflict (user_id, role) do nothing;

  select * into v_standing from public.helper_accompaniment a
   where a.helper_user_id = p_user_id and a.tenant_id = v_tenant and a.ended_at is null;
  if found and v_standing.practitioner_id = p_practitioner_id then
    return v_standing.id;
  end if;
  if found then
    update public.helper_accompaniment
       set ended_at = now(), ended_by = v_actor
     where id = v_standing.id;
  end if;
  insert into public.helper_accompaniment (tenant_id, helper_user_id, practitioner_id, created_by)
  values (v_tenant, p_user_id, p_practitioner_id, v_actor)
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.name_helper(uuid, uuid) from public;
grant execute on function app.name_helper(uuid, uuid) to app_role;

-- The owner or an admin revokes a helper: the accompaniment ends, every
-- position of theirs still held is deleted, and their sign-in is suspended,
-- which the fence refuses (`app.resolve_actor` answers nobody who is not
-- active). The role row stays, so the person is still found in Settings ›
-- Team as a helper, suspended, and the trail reads whole. Returns whether
-- there was anything to revoke.
create function app.revoke_helper(p_user_id uuid) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor  uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant uuid := app.current_tenant_id();
  v_ended  integer;
  v_gone   integer;
  v_shut   integer;
begin
  if not app.office_names_helpers(v_actor) then
    raise exception 'only the owner or an admin revokes a helper' using errcode = '42501';
  end if;
  if p_user_id is null or v_actor = p_user_id then
    raise exception 'nobody revokes themselves' using errcode = '42501';
  end if;
  perform 1 from public.app_user u
   where u.id = p_user_id and u.tenant_id = v_tenant
     for update;
  if not exists (select 1 from public.user_role r
                  where r.user_id = p_user_id and r.tenant_id = v_tenant
                    and r.role::text = 'helper')
     or exists (select 1 from public.user_role r
                 where r.user_id = p_user_id and r.tenant_id = v_tenant
                   and r.role::text <> 'helper') then
    raise exception 'not a helper' using errcode = '42501';
  end if;
  update public.helper_accompaniment
     set ended_at = now(), ended_by = v_actor
   where helper_user_id = p_user_id and tenant_id = v_tenant and ended_at is null;
  get diagnostics v_ended = row_count;
  delete from public.practitioner_position
   where user_id = p_user_id and tenant_id = v_tenant;
  get diagnostics v_gone = row_count;
  update public.app_user set status = 'suspended'
   where id = p_user_id and tenant_id = v_tenant and status = 'active';
  get diagnostics v_shut = row_count;
  return v_ended + v_gone + v_shut > 0;
end
$$;
revoke execute on function app.revoke_helper(uuid) from public;
grant execute on function app.revoke_helper(uuid) to app_role;

-- 211's withdrawal, widened: the caller's own positions as a practitioner AND
-- as a helper, and nobody else's.
create or replace function app.forget_own_positions() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
  v_more  integer;
begin
  delete from public.practitioner_position pp
   using public.practitioner p
   where p.id = pp.practitioner_id
     and p.tenant_id = app.current_tenant_id()
     and pp.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id();
  get diagnostics v_count = row_count;
  delete from public.practitioner_position pp
   where pp.user_id = app.current_actor_id()
     and pp.tenant_id = app.current_tenant_id();
  get diagnostics v_more = row_count;
  return v_count + v_more;
end
$$;

------------------------------------------------------------------------------
-- 4. Row security and privileges, in 211's shape. The API role reads the
--    accompaniment and writes it only through the two functions above.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.helper_accompaniment enable row level security;
  revoke all on public.helper_accompaniment from public;
  if has_api_roles then
    revoke all on public.helper_accompaniment from anon, authenticated;
  end if;
  grant select on public.helper_accompaniment to app_role;
end
$$;

-- rollback:
--   drop function if exists app.revoke_helper(uuid);
--   drop function if exists app.name_helper(uuid, uuid);
--   drop function if exists app.office_names_helpers(uuid);
--   drop function if exists app.accompanied_name();
--   drop function if exists app.accompanied_day(timestamptz, timestamptz);
--   drop function if exists app.latest_helper_position_id(uuid);
--   drop function if exists app.helper_position_visible(uuid);
--   drop function if exists app.helper_position_writable(uuid);
--   drop function if exists app.helper_accompanies(uuid);
--   create or replace function app.forget_own_positions() ... as in 211;
--   delete from public.practitioner_position where user_id is not null;
--   drop index if exists public.practitioner_position_helper_latest_idx;
--   alter table public.practitioner_position
--     drop constraint if exists practitioner_position_helper_fkey,
--     drop constraint if exists practitioner_position_one_person,
--     drop column if exists user_id,
--     alter column practitioner_id set not null;
--   comment on table public.practitioner_position is ... as in 211;
--   drop table if exists public.helper_accompaniment;
--   drop function if exists app.guard_helper_accompaniment();
--
--   The policy files go first, because the runner re-applies every policy
--   file after the migrations on each db:migrate: restore
--   db/policies/dispatch/location.sql to 211's form (drop the helper arms and
--   the helper_accompaniment policies) and delete
--   db/policies/core/helper_reach.sql.
