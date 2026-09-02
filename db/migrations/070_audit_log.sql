-- 070_audit_log.sql
-- Append-only, hash-chained, month-partitioned audit log (audit.md sections 3, 4, 11).
--
-- Needs from 000: schema app, role app_role, app.current_tenant_id().
-- Departures from the spec's sketch, each for a reason:
--   1. id is bigint assigned as audit_chain.last_id + 1 under the chain lock, not
--      bigserial: a sequence value taken before the lock lets two writers link in
--      the opposite order to their ids, which a verifier walking by id would
--      report as a false break. Ids are gapless, so a removed row shows as a gap.
--   2. The hash is computed by a before-insert trigger on audit_log itself, so
--      every insert path is chained by construction; nobody can insert an
--      unchained row.
--   3. Immutability is triggers that raise, not rules that do instead nothing: a
--      rule swallows the statement and reports success. They are enable always,
--      so session_replication_role = replica cannot switch them off.
--   4. audit_chain lives in schema app so PostgREST never sees it.
--   5. No created_at, updated_at, created_by or foreign keys: occurred_at and
--      actor_id are the provenance, and a log row must outlive what it describes.
-- Order matters: triggers exist before any partition, because Postgres clones a
-- parent's row triggers, with their enabled state, into each partition at creation.

------------------------------------------------------------------------------
-- 1. The chain anchor: one row holding the id and hash of the last audit row.
------------------------------------------------------------------------------
create table app.audit_chain (
  singleton  boolean primary key default true check (singleton),
  last_id    bigint not null default 0,
  last_hash  bytea                        -- null until the first row is written
);
insert into app.audit_chain default values;
revoke all on app.audit_chain from public;
alter table app.audit_chain enable row level security;   -- no policies on purpose

------------------------------------------------------------------------------
-- 2. The log. audit.md section 3 plus tenant_id.
------------------------------------------------------------------------------
create table public.audit_log (
  id              bigint      not null,   -- app.audit_chain_link(): last_id + 1
  occurred_at     timestamptz not null default now(),   -- partition key

  -- actor
  tenant_id       uuid        not null,   -- every audited row belongs to a tenant; the tenant table is its own
  actor_id        uuid,                   -- null for system actions
  actor_type      text        not null check (actor_type in ('user', 'system', 'integration', 'anonymous')),
  actor_role      text,                   -- set by the middleware in PR 3
  on_behalf_of    uuid,                   -- support impersonation

  -- action
  action          text        not null,   -- insert | update | delete from triggers; read | sign | export ... from the app
  entity_type     text        not null,   -- table name
  entity_id       uuid        not null,
  client_id       uuid,                   -- denormalised: the patient this touches, if any

  -- change
  changed_fields  text[],                 -- update only; column names, sorted
  old_values      jsonb,                  -- redacted (app.audit_redact); null for insert and reads
  new_values      jsonb,                  -- redacted; null for delete and reads

  -- context
  reason          text,
  request_id      uuid,
  session_id      uuid,
  ip_address      inet,
  user_agent      text,
  app_version     text,

  -- integrity
  prev_hash       bytea,                  -- null on the first row of the chain
  row_hash        bytea       not null,   -- app.audit_row_hash(...)

  primary key (id, occurred_at)           -- the partition key must be part of the key
) partition by range (occurred_at);

comment on table public.audit_log is
  'Append-only. Every insert is hash-chained by app.audit_chain_link(); update, delete and truncate raise. audit.md sections 3 and 4.';

-- Declared on the parent, so every partition, present or future, gets a copy.
create index audit_log_client_idx   on public.audit_log (client_id, occurred_at desc);
create index audit_log_actor_idx    on public.audit_log (actor_id, occurred_at desc);
create index audit_log_entity_idx   on public.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_tenant_idx   on public.audit_log (tenant_id, occurred_at desc);

------------------------------------------------------------------------------
-- 3. The hash. One definition, shared by the chain trigger and the verifier.
------------------------------------------------------------------------------
-- Canonical encoding (audit.md section 4, made byte-exact):
--
--   row_hash = sha256( prev_hash_bytes || utf8(payload) )
--
--   prev_hash_bytes  the 32 raw bytes of prev_hash; no bytes when prev_hash is null
--   payload          id LF occurred_at LF actor_id LF action LF entity_type LF entity_id LF old_values LF new_values
--   LF               one 0x0A byte between fields, none at the end
--   id               decimal digits, no sign, no padding                         1234
--   occurred_at      UTC, ISO 8601, six fractional digits, literal Z             2026-09-02T06:15:30.123456Z
--   actor_id, entity_id   lower-case hyphenated uuid text
--   action, entity_type   the stored text, unchanged
--   old_values, new_values   Postgres' own jsonb text (jsonb::text): keys sorted by
--                    (length, bytes), duplicates removed, one space after ':' and ','.
--   SQL null         the empty string (none of these fields can otherwise be empty)
--
-- Session settings cannot change the result: the timestamp is formatted with an
-- explicit pattern and zone, bigint and uuid have one output form, and jsonb text
-- is canonical. A verifier in any language needs sha256 and byte concatenation.
create function app.audit_row_hash(
  p_prev_hash   bytea,
  p_id          bigint,
  p_occurred_at timestamptz,
  p_actor_id    uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old_values  jsonb,
  p_new_values  jsonb
) returns bytea
language sql stable                       -- stable, not immutable: to_char() is stable
set search_path = pg_catalog, pg_temp
as $$
  select sha256(
    coalesce(p_prev_hash, '\x'::bytea)
    || convert_to(
         p_id::text                                                                   || E'\n'
      || to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')    || E'\n'
      || coalesce(p_actor_id::text, '')                                               || E'\n'
      || p_action                                                                     || E'\n'
      || p_entity_type                                                                || E'\n'
      || p_entity_id::text                                                            || E'\n'
      || coalesce(p_old_values::text, '')                                             || E'\n'
      || coalesce(p_new_values::text, ''),
      'UTF8'))
$$;

------------------------------------------------------------------------------
-- 4. The chain trigger. Runs on every insert, whoever performs it.
------------------------------------------------------------------------------
create function app.audit_chain_link() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_last_id   bigint;
  v_last_hash bytea;
begin
  -- Serialisation point. Every audit insert in the database queues on this one
  -- row until the previous writer commits or rolls back. At a few hundred rows
  -- a day the wait is microseconds, and the guarantee it buys (id order equals
  -- chain order, no scan of partitions for prev_hash) is worth far more than
  -- the concurrency it costs. Revisit only if volume grows by orders of magnitude.
  select last_id, last_hash
    into strict v_last_id, v_last_hash
    from app.audit_chain
   where singleton
     for update;

  new.id        := v_last_id + 1;        -- overrides anything the caller supplied
  new.prev_hash := v_last_hash;
  new.row_hash  := app.audit_row_hash(
    new.prev_hash, new.id, new.occurred_at, new.actor_id, new.action,
    new.entity_type, new.entity_id, new.old_values, new.new_values);

  update app.audit_chain
     set last_id = new.id, last_hash = new.row_hash
   where singleton;

  return new;
end
$$;
revoke execute on function app.audit_chain_link() from public;

------------------------------------------------------------------------------
-- 5. Immutability.
------------------------------------------------------------------------------
create function app.audit_log_immutable() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege',   -- SQLSTATE 42501, the same code the grant layer gives
          hint    = 'Audit rows are never changed or removed. Record a new row instead.';
end
$$;
revoke execute on function app.audit_log_immutable() from public;

create trigger audit_chain_link before insert on public.audit_log
  for each row execute function app.audit_chain_link();
create trigger audit_no_update before update on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_no_delete before delete on public.audit_log
  for each row execute function app.audit_log_immutable();

-- enable always: still fires under session_replication_role = replica.
-- Partitions created later inherit this state with the cloned trigger.
alter table public.audit_log enable always trigger audit_chain_link;
alter table public.audit_log enable always trigger audit_no_update;
alter table public.audit_log enable always trigger audit_no_delete;

-- Per-table hardening, applied to the parent now and to every partition as it is
-- created: the truncate trigger (statement-level triggers are not cloned), RLS,
-- and the removal of any privilege that arrived by default.
create function app.audit_harden_table(p_name text) returns void
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  execute format('create or replace trigger audit_no_truncate before truncate on public.%I '
                 'for each statement execute function app.audit_log_immutable()', p_name);
  execute format('alter table public.%I enable always trigger audit_no_truncate', p_name);
  execute format('alter table public.%I enable row level security', p_name);
  execute format('revoke all on public.%I from public', p_name);
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- Supabase: default privileges grant every new table in public to these roles.
    execute format('revoke all on public.%I from anon, authenticated', p_name);
  end if;
end
$$;
revoke execute on function app.audit_harden_table(text) from public;

select app.audit_harden_table('audit_log');

------------------------------------------------------------------------------
-- 6. Grants on the parent (audit.md section 4). app_role has no privilege on
--    any partition: it reads and writes through the parent, where RLS applies.
--    Policies live in db/policies/core/audit_log.sql.
------------------------------------------------------------------------------
revoke update, delete, truncate on public.audit_log from app_role;
grant  select, insert            on public.audit_log to   app_role;

------------------------------------------------------------------------------
-- 7. Partitions: one per month, UTC boundaries, named audit_log_YYYY_MM.
------------------------------------------------------------------------------
create function app.ensure_audit_partitions(months_ahead int default 24)
returns setof text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_first date := date_trunc('month', now() at time zone 'UTC')::date;
  v_from  date;
  v_name  text;
begin
  if months_ahead < 0 or months_ahead > 60 then
    raise exception 'months_ahead must be between 0 and 60, received %', months_ahead;
  end if;
  for i in 0 .. months_ahead loop
    v_from := (v_first + make_interval(months => i))::date;
    v_name := 'audit_log_' || to_char(v_from, 'YYYY_MM');

    -- Bounds carry an explicit +00: a timestamptz literal without a zone is read
    -- in the session's TimeZone, which would move every boundary by four hours
    -- when the runner happens to sit in Asia/Dubai.
    execute format(
      'create table if not exists public.%I partition of public.audit_log for values from (%L) to (%L)',
      v_name,
      v_from::text || ' 00:00:00+00',
      (v_from + interval '1 month')::date::text || ' 00:00:00+00');

    perform app.audit_harden_table(v_name);   -- idempotent
    return next v_name;
  end loop;
end
$$;
revoke execute on function app.ensure_audit_partitions(int) from public;
grant  execute on function app.ensure_audit_partitions(int) to app_role;   -- the nightly job

select app.ensure_audit_partitions(24);

-- Safety net, created last so the monthly partitions above never had to scan it.
-- A row here means the nightly job has not run for two years. Alert on
-- count(*) > 0: a month whose rows sit in the default partition can no longer
-- receive its own partition without moving rows, which immutability forbids.
create table public.audit_log_default partition of public.audit_log default;
select app.audit_harden_table('audit_log_default');

-- rollback:
--   Roll back 080 first: its triggers call app.audit_row(), which inserts here.
--   drop table if exists public.audit_log cascade;      -- drops every partition and their triggers
--   drop function if exists app.ensure_audit_partitions(int);
--   drop function if exists app.audit_harden_table(text);
--   drop function if exists app.audit_log_immutable();
--   drop function if exists app.audit_chain_link();
--   drop function if exists app.audit_row_hash(bytea, bigint, timestamptz, uuid, text, text, uuid, jsonb, jsonb);
--   drop table if exists app.audit_chain;
