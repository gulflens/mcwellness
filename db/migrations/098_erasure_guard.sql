-- 098_erasure_guard.sql
-- The erasure mode of app.audit_redact (080_audit_triggers.sql) withheld every
-- value when app.erasure = 'true', but only when no role had been assumed
-- (set role) - so the API role, which always runs under "set local role
-- app_role" (096_api_role.sql), could never satisfy it. That was fine while
-- nothing erased through the API; it stops being fine once app.erase_client
-- (client-record.md section 8) is a security definer function the API calls
-- under app_role. The role-based guard is replaced with a secret token: a flag
-- worth honouring only when it carries the value held in a table the API role
-- can neither read nor derive.
--
-- Needs 000 (schema app, extensions.gen_random_bytes), 080 (app.audit_redact).

------------------------------------------------------------------------------
-- 1. The token. One row, one 32-byte value, generated once at migration time.
--    Nothing reads or writes it except app.begin_erasure() below, which runs
--    as the table's owner (security definer): the API role gets no grant at
--    all, so it can neither see the key nor forge the setting that matches it.
------------------------------------------------------------------------------
create table app.erasure_key (
  singleton  boolean primary key default true check (singleton),
  key        bytea not null
);
insert into app.erasure_key (key) values (extensions.gen_random_bytes(32));
revoke all on app.erasure_key from public;
alter table app.erasure_key enable row level security;   -- no policies on purpose

------------------------------------------------------------------------------
-- 2. Enters erasure mode for the rest of the transaction. Security definer, so
--    it runs as the owner regardless of who calls it; deliberately NOT granted
--    to app_role or public. Only a security definer function that shares this
--    one's owner - app.erase_client, the client-record stream's erasure entry
--    point - can call it: Postgres lets a function call another it does not
--    hold an explicit grant for when both share an owner, which is how a
--    request running as app_role reaches this without ever being granted
--    execute on it itself.
------------------------------------------------------------------------------
create function app.begin_erasure() returns void
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
  select set_config('app.erasure', encode(key, 'hex'), true) from app.erasure_key
$$;
revoke execute on function app.begin_erasure() from public;

------------------------------------------------------------------------------
-- 3. Restated in full, as 095 and 097 do for the functions they change,
--    because create or replace resets every attribute. Two changes from 080:
--    a) the erasure condition withholds only when app.erasure carries the
--       hex-encoded value from app.erasure_key, not the literal 'true' a
--       forged setting can produce, and not conditioned on which role is
--       assumed. Because app.audit_row (080) is security definer, this
--       subselect - like the one in app.begin_erasure() above - runs as the
--       table's owner no matter which role wrote the row; app_role has no
--       grant on app.erasure_key regardless.
--    b) 'checked_in_point' joins the dropped keys (audit.md section 8):
--       session-capture's household geography column, which must not outlive
--       an erasure inside the immutable log any more than the Emirates ID
--       columns do.
--    The revoke is new: 080 forgot it.
------------------------------------------------------------------------------
create or replace function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when current_setting('app.erasure', true) is not null
              and current_setting('app.erasure', true) = (select encode(key, 'hex') from app.erasure_key)
    then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
    else coalesce(
    (select jsonb_object_agg(
              e.key,
              case
                when jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 200
                  then to_jsonb('[redacted: ' || length(e.value #>> '{}')::text || ' chars]')
                else e.value
              end)
       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash', 'checked_in_point']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   -- restore app.audit_redact from 080_audit_triggers.sql (the version guarded
--   -- by "no role assumed" rather than the token), with create or replace since
--   -- the function exists; 080's version never had its execute revoked, so drop
--   -- that revoke too if strict parity with 080 is wanted.
--   drop function if exists app.begin_erasure();
--   drop table if exists app.erasure_key;
