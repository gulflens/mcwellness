-- 300_session.sql
-- The practitioner's visit record and the append-only event log it is
-- projected from (docs/SPEC/session-capture.md sections 2 and 6). Decoupled
-- from appointment, entitlement, kit and client_protocol — none of which
-- exist in the database yet — by referencing client and service_type
-- directly and carrying no columns for the others; each is added by a later
-- migration in this range once its table exists. This pull request only
-- reaches 'in_progress': the rest of session_status and session_event_kind
-- are declared now so the vocabulary is stable, and implemented one screen
-- at a time.

create type session_status as enum (
  'scheduled', 'in_progress', 'completed', 'no_show', 'cancelled_late', 'cancelled', 'aborted'
);
create type session_event_kind as enum (
  'session_started', 'signal_checked', 'telemetry_chunk', 'rating_recorded',
  'observation_recorded', 'photo_captured', 'session_ended', 'checked_out'
);

create table session (
  id                uuid primary key,          -- client-generated (the device), not gen_random_uuid()
  tenant_id         uuid not null references tenant (id),
  client_id         uuid not null references client (id),
  practitioner_id   uuid not null references practitioner (id),
  service_type_id   uuid not null references service_type (id),
  delivery_mode     delivery_mode not null default 'home',
  location_id       uuid references location (id),
  status            session_status not null default 'in_progress',
  checked_in_at     timestamptz not null,
  -- Proof of attendance at the door: the coordinate recorded when the
  -- practitioner checked in, if they allowed it — a decline is not a block
  -- (section 7, graceful degradation). Readable within the practitioner's
  -- own scope and by the practice's oversight roles, the same reach as the
  -- row it sits on (db/policies/session/practitioner_scope.sql); it follows
  -- the session's own retention, with no separate rule of its own.
  checked_in_point  extensions.geography(point, 4326),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references app_user (id),
  -- So session_event's composite foreign key below can bind an event to the
  -- exact tenant, client and practitioner its session actually has, not
  -- merely to a session id a caller happens to know.
  unique (id, tenant_id, client_id, practitioner_id)
);
comment on table session is 'audited: client';
create index session_tenant_idx on session (tenant_id);
create index session_client_idx on session (client_id, created_at);
create index session_practitioner_idx on session (practitioner_id, created_at);
create index session_service_type_idx on session (service_type_id);
create index session_created_by_idx on session (created_by);
-- One open visit per practitioner at a time. This also stands in for "a
-- second device's check-in is refused" (section 2, section 10) until a
-- richer device-identity rule is needed.
create unique index session_one_open_per_practitioner
  on session (tenant_id, practitioner_id) where status = 'in_progress';
create trigger set_updated_at before update on session
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on session
  for each row execute function app.audit_row();
alter table session enable always trigger audit_row;

create table session_event (
  id               uuid primary key,           -- client-generated; the outbox's idempotency key
  tenant_id        uuid not null references tenant (id),
  session_id       uuid not null,               -- bound by the composite key below, not this alone
  client_id        uuid not null references client (id),        -- denormalised: 097 reads it row-local
  practitioner_id  uuid not null references practitioner (id),   -- denormalised: RLS reads it row-local
  seq              integer not null,
  kind             session_event_kind not null,
  -- Capped while the table is empty: an unbounded jsonb blob is also an
  -- unbounded, unredacted copy of itself in the audit trail (080's redaction
  -- only inspects top-level string values, not nested structure).
  payload          jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 32768),
  device_at        timestamptz not null,
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references app_user (id),
  unique (session_id, seq),
  -- Binds the event to its session's actual tenant, client and
  -- practitioner, not merely to a session id the caller happens to know: a
  -- practitioner cannot append an event under their own ids to a session
  -- that is not really theirs, nor to another tenant's.
  foreign key (session_id, tenant_id, client_id, practitioner_id)
    references session (id, tenant_id, client_id, practitioner_id)
);
comment on table session_event is 'audited: client';
create index session_event_tenant_idx on session_event (tenant_id);
-- (session_id, seq) already has an index from the unique constraint above.
create index session_event_client_idx on session_event (client_id, received_at);
create index session_event_practitioner_idx on session_event (practitioner_id);
create index session_event_created_by_idx on session_event (created_by);
-- Append-only: insert only, so the trigger covers insert alone.
create trigger audit_row after insert on session_event
  for each row execute function app.audit_row();
alter table session_event enable always trigger audit_row;

-- Privileges and RLS: 090_grants_and_rls.sql predates these tables, so this
-- migration repeats its pattern for its own two, guarding the Supabase-only
-- revoke exactly as 090 does.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table session enable row level security;
  revoke all on session from public;
  if has_api_roles then
    revoke all on session from anon, authenticated;
  end if;
  -- No delete: a session is superseded or closed, never deleted, by the API role.
  grant select, insert, update on session to app_role;

  alter table session_event enable row level security;
  revoke all on session_event from public;
  if has_api_roles then
    revoke all on session_event from anon, authenticated;
  end if;
  -- Append-only: no update, no delete.
  grant select, insert on session_event to app_role;
end
$$;

-- rollback:
--   revoke select, insert on session_event from app_role;
--   revoke select, insert, update on session from app_role;
--   drop trigger if exists audit_row on session_event;
--   drop table if exists session_event;
--   drop trigger if exists audit_row on session;
--   drop index if exists session_one_open_per_practitioner;
--   drop table if exists session;
--   drop type if exists session_event_kind;
--   drop type if exists session_status;
