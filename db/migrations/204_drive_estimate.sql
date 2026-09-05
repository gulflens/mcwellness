-- 204_drive_estimate.sql
-- The cache of what the drive between two places takes, and the two figures
-- the fallback's arithmetic turns on (docs/SPEC/scheduling-manual.md section
-- 7, docs/SPEC/practitioner-phone.md sections 5.2 and 5.6,
-- docs/SPEC/00-data-model.md section 5).
--
-- **Why a cache at all.** The routing seam's real implementation is a metered
-- call to a vendor (docs/SEAMS.md), and a day sheet reopened six times in a
-- morning would ask the same six questions six times over. A leg's estimate is
-- keyed by the two locations and the hour of the practice's own day, and read
-- back for thirty days: a day of six stops is at most six calls the first time
-- it is opened and none after, and a stop moved to another hour is one more.
--
-- **The hour is part of the key, not a detail of the answer.** The same pair of
-- addresses at eight in the morning and at midday are two different drives in
-- this country, so they are two rows; without the hour in the key one would
-- quietly overwrite the other and the day sheet would show the school run's
-- figure at lunchtime.
--
-- **It names no person.** A row is two location ids, an hour, a distance, a
-- duration and where the figure came from. There is no client_id to
-- denormalise and there deliberately is not one: the same drive serves whoever
-- is behind either door, and a table that recorded who was visited from where
-- would be a movement log of households. Hence `audited: no client`, with that
-- reason written into the comment as .claude/rules/data-model.md asks.
--
-- **`source` is on the row and not inferred.** A figure from the vendor and a
-- figure from the straight-line fallback are both estimates, and the screen
-- says which it is showing (docs/SEAMS.md). A cache that forgot which one it
-- held would have the day sheet claim traffic it never asked about.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user, for created_by), 030
-- (location, the two places a leg joins), 080 (app.audit_row), 099 (the
-- unique (tenant_id, id) key on location that the composite foreign keys
-- below target) and 202 (scheduling_setting, which gains two columns here).

------------------------------------------------------------------------------
-- 1. Where an estimate came from.
------------------------------------------------------------------------------
create type drive_source as enum ('traffic', 'straight-line');
comment on type drive_source is
  'Which implementation of the routing seam answered: the vendor''s traffic-aware '
  'estimate, or the straight-line fallback (docs/SEAMS.md). Both are estimates and '
  'the screen labels them as such.';

------------------------------------------------------------------------------
-- 2. The cache itself.
------------------------------------------------------------------------------
create table drive_estimate (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id),
  from_location_id  uuid not null,
  to_location_id    uuid not null,
  -- 0 to 23 in the practice's own zone (domain/shared/routing.ts's
  -- hourBucket), never the server's: a laptop set to London would otherwise
  -- file the school run under four in the morning.
  hour_bucket       smallint not null check (hour_bucket between 0 and 23),
  -- A day's drive at the very most. A figure past that is a bug in whatever
  -- produced it, and a cache is not the place to keep one.
  seconds           integer not null check (seconds between 0 and 86400),
  -- Two thousand kilometres: several times the length of the country, so a
  -- swapped axis or a stray zero is refused here rather than rendered.
  metres            integer not null check (metres between 0 and 2000000),
  source            drive_source not null,
  -- When the figure was got. The route reads a row back only while it is
  -- fresh (thirty days); nothing deletes a stale one, because the next ask
  -- for that pair and hour overwrites it in place.
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references app_user (id),
  -- One figure per pair per hour, per practice.
  unique (tenant_id, from_location_id, to_location_id, hour_bucket),
  -- The practice-bound key every tenant-scoped table carries
  -- (099_tenant_scoped_keys.sql); tests/db/constraints.test.ts asks every such
  -- table for it by name.
  unique (tenant_id, id),
  -- Composite, so a row can never join two practices' places
  -- (099_tenant_scoped_keys.sql).
  foreign key (tenant_id, from_location_id) references location (tenant_id, id),
  foreign key (tenant_id, to_location_id) references location (tenant_id, id)
);
comment on table public.drive_estimate is
  'audited: no client - two places, an hour and a duration. The same drive serves '
  'whoever is behind either door, so there is no client to denormalise and '
  'deliberately none: a row naming one would be a movement log of households.';
comment on column public.drive_estimate.hour_bucket is
  'The hour of the practice''s own day the departure falls in, 0 to 23 '
  '(domain/shared/routing.ts). Part of the key, because the same pair of addresses '
  'is a different drive at eight in the morning and at midday.';
comment on column public.drive_estimate.source is
  'Which implementation answered (docs/SEAMS.md). Both are estimates; the screen '
  'says which one it is showing.';

create index drive_estimate_created_by_idx on drive_estimate (created_by);
create index drive_estimate_to_location_idx on drive_estimate (tenant_id, to_location_id);
create trigger set_updated_at before update on drive_estimate
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.drive_estimate
  for each row execute function app.audit_row();
alter table public.drive_estimate enable always trigger audit_row;

-- Row security and privileges, in the shape 090_grants_and_rls.sql uses.
-- Select, insert and update, never delete: a stale row is overwritten in
-- place by the next ask for that pair and hour, and there is no reason for a
-- route to be able to empty the cache.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.drive_estimate enable row level security;
  revoke all on public.drive_estimate from public;
  if has_api_roles then
    revoke all on public.drive_estimate from anon, authenticated;
  end if;
  grant select, insert, update on public.drive_estimate to app_role;
end
$$;

------------------------------------------------------------------------------
-- 3. The fallback's two figures, as data the owner edits.
--
-- docs/SPEC/practitioner-phone.md section 5.6: "The fallback's figures are
-- data, not code." They sit on scheduling_setting beside the notice period,
-- because they are one practice-wide answer rather than a per-service one, and
-- because 202 already gives every practice exactly one of those rows and never
-- lets it be deleted. The existing settings route
-- (app/api/appointments/settings.ts) is what edits them.
--
-- numeric rather than float: two people reading the same day sheet must see
-- the same estimate, and a binary float that renders as 1.35 on one machine
-- and 1.3500000000000001 on another is a difference nobody can explain. Money
-- is not involved, so the fils rule does not apply here.
------------------------------------------------------------------------------
alter table public.scheduling_setting
  -- Straight-line metres to road metres. One is a bird; five is a mountain
  -- pass, which the UAE does not have. The default is the spec's own 1.35.
  add column drive_road_factor numeric(4, 2) not null default 1.35
    check (drive_road_factor between 1 and 5),
  -- What the morning and evening peaks cost on top, on a working day. One is a
  -- practice that thinks the peak costs nothing, which is allowed.
  add column drive_peak_multiplier numeric(4, 2) not null default 1.50
    check (drive_peak_multiplier between 1 and 5);

comment on column public.scheduling_setting.drive_road_factor is
  'Straight-line distance to road distance, for the routing seam''s fallback '
  '(docs/SPEC/practitioner-phone.md section 5.6). Applied by '
  'domain/shared/routing.ts, which holds no figure of its own.';
comment on column public.scheduling_setting.drive_peak_multiplier is
  'What the peak hours cost on top, 06:00 to 10:00 and 16:00 to 20:00 on a working '
  'day in the practice''s zone. Applied by domain/shared/routing.ts.';

-- rollback:
--   -- The policy file db/policies/scheduling/drive_estimate.sql must be deleted
--   -- first, or the next migrate's policy pass fails creating a policy on a table
--   -- that no longer exists. Its own drops, run ahead of the table drop:
--   drop policy if exists drive_estimate_refresh on public.drive_estimate;
--   drop policy if exists drive_estimate_write on public.drive_estimate;
--   drop policy if exists drive_estimate_read on public.drive_estimate;
--   drop policy if exists tenant_isolation on public.drive_estimate;
--   alter table public.scheduling_setting
--     drop column if exists drive_peak_multiplier,
--     drop column if exists drive_road_factor;
--   revoke select, insert, update on public.drive_estimate from app_role;
--   drop table if exists public.drive_estimate;
--   drop type if exists drive_source;
