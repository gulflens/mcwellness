-- 200_appointment.sql
-- A promise of a session at a time and place (00-data-model.md section 5,
-- scheduling-manual.md). No route solver in this stream: a coordinator places
-- appointments by hand and this table, its two exclusion constraints and
-- domain/scheduling/conflicts.ts stop them double-booking anyone.

-- Needed for the exclusion constraints below: an equality operator class for
-- uuid usable inside a GiST index, alongside the range-overlap operator.
create extension if not exists btree_gist with schema extensions;

create type appointment_status as enum (
  'proposed', 'confirmed', 'checked_in', 'completed',
  'cancelled', 'cancelled_late', 'no_show', 'rescheduled'
);
-- The full lifecycle (scheduling-manual.md section 3) is declared now, even
-- though this stream's first pull request only ever writes 'proposed': adding
-- an enum value later is its own migration and awkward mid-transaction, so
-- the complete set is cheaper to name upfront than to grow piecemeal.

create table appointment (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  client_id              uuid not null references client (id),
  practitioner_id        uuid not null references practitioner (id),
  service_type_id        uuid not null references service_type (id),
  location_id            uuid not null references location (id),
  delivery_mode          delivery_mode not null,
  window_start           timestamptz not null,
  window_end             timestamptz not null,
  travel_buffer_minutes  integer not null default 15,
  -- The practitioner's busy interval (window padded by its own travel buffer,
  -- both sides), kept in step by set_busy_window below. timestamptz +/- interval
  -- is only STABLE, not IMMUTABLE (it is timezone-aware in general), so it
  -- cannot appear inside the exclusion constraint's index expression directly;
  -- these columns let the constraint reference plain, already-computed values.
  busy_start             timestamptz not null,
  busy_end               timestamptz not null,
  status                 appointment_status not null default 'proposed',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint appointment_window_45min check (window_end = window_start + interval '45 minutes'),
  constraint appointment_travel_buffer_range check (travel_buffer_minutes between 15 and 90)
);
comment on table appointment is 'audited: client';

create function app.appointment_set_busy_window() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.busy_start := new.window_start - (new.travel_buffer_minutes * interval '1 minute');
  new.busy_end   := new.window_end   + (new.travel_buffer_minutes * interval '1 minute');
  return new;
end
$$;
create trigger set_busy_window before insert or update on appointment
  for each row execute function app.appointment_set_busy_window();

-- Belt and braces beneath domain/scheduling/conflicts.ts: even a bug, or a
-- write that bypasses the API entirely, cannot double-book a practitioner or
-- a client. Only the "live" statuses hold the slot; a cancelled, no-show or
-- rescheduled row no longer occupies it. The range matches the domain
-- function's half-open overlap test ('[)': touching at the edge is not a clash).
alter table appointment add constraint appointment_no_overlap_practitioner
  exclude using gist (
    practitioner_id with =,
    tstzrange(busy_start, busy_end, '[)') with &&
  ) where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled'));

alter table appointment add constraint appointment_no_overlap_client
  exclude using gist (
    client_id with =,
    tstzrange(window_start, window_end, '[)') with &&
  ) where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled'));

create index appointment_tenant_idx on appointment (tenant_id);
create index appointment_practitioner_window_idx on appointment (practitioner_id, window_start);
create index appointment_client_window_idx on appointment (client_id, window_start);
create index appointment_service_type_idx on appointment (service_type_id);
create index appointment_location_idx on appointment (location_id);
create index appointment_created_by_idx on appointment (created_by);
create trigger set_updated_at before update on appointment
  for each row execute function app.set_updated_at();

-- Row-level capture (compliance.md: every table holding personal data carries
-- the audit trigger). app.audit_client_id (097) already denormalises
-- client_id for any table that carries the column, appointment included.
create trigger audit_row after insert or update or delete on appointment
  for each row execute function app.audit_row();
alter table appointment enable always trigger audit_row;

-- Row level security and the API role's privileges, guarded exactly as
-- 090_grants_and_rls.sql guards them: anon/authenticated only exist on
-- Supabase, never on a plain local Postgres image.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table appointment enable row level security;
  revoke all on appointment from public;
  if has_api_roles then
    revoke all on appointment from anon, authenticated;
  end if;
  -- No delete: an appointment is superseded, cancelled or completed, never removed.
  grant select, insert, update on appointment to app_role;
end
$$;

-- rollback:
--   alter table appointment disable trigger audit_row;
--   drop table if exists appointment;
--   drop function if exists app.appointment_set_busy_window();
--   drop type if exists appointment_status;
--   -- btree_gist left in place: another stream's table may come to depend on it.
