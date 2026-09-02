-- 098_erasure_guard.sql
-- The erasure mode of app.audit_redact (080_audit_triggers.sql) withheld every
-- value when app.erasure = 'true', but only when no role had been assumed
-- (set role) - so the API role, which always runs under "set local role
-- app_role" (096_api_role.sql), could never satisfy it. That was fine while
-- nothing erased through the API; it stops being fine once app.erase_client
-- (client-record.md section 8) is a security definer function the API calls
-- under app_role.
--
-- The role-based guard is replaced not with a flag but with a fact: a row
-- naming the current transaction. Nothing is ever stamped into a setting, so
-- there is nothing app_role can read back with current_setting and replay -
-- forged or genuine - into any other transaction. A row for a finished
-- transaction is inert on its own: that transaction id never recurs.
--
-- Needs 000 (schema app), 080 (app.audit_redact).

------------------------------------------------------------------------------
-- 1. The marker. One row per transaction currently erasing, keyed by its
--    transaction id. Nothing reads or writes it except app.begin_erasure()
--    and app.end_erasure() below and the exists check inside app.audit_redact,
--    all of which run as the table's owner (security definer, or - for
--    audit_redact - invoked only from within one): the API role gets no grant
--    at all, so it can neither see a row nor create one directly.
------------------------------------------------------------------------------
create table app.erasure_active (
  txid  bigint primary key
);
revoke all on app.erasure_active from public;
alter table app.erasure_active enable row level security;   -- no policies on purpose

------------------------------------------------------------------------------
-- 2. Enters erasure mode for the rest of the transaction: records its id.
--    txid_current() is stable for the life of the transaction, so
--    app.audit_redact's exists check later in the same transaction finds this
--    row; a different (or replayed) transaction has a different id and finds
--    nothing. on conflict do nothing, since a transaction may call this more
--    than once without harm.
--
--    Security definer, so it runs as the owner regardless of who calls it;
--    deliberately NOT granted to app_role or public. Only a function that is
--    itself security definer, owned by the same role that owns this function,
--    can call it: security definer is what makes that function's body execute
--    as its owner (current_user), and an owner implicitly holds every
--    privilege - including execute - on every object it owns, with no grant
--    needed. app.erase_client (the client-record stream's erasure entry point)
--    is written this way for exactly that reason, and must call
--    app.end_erasure() before it returns. A security invoker function calling
--    app.begin_erasure() would instead run as its actual caller - app_role,
--    for a request reaching it from the API - which holds no grant on this
--    function at all, and the call would fail with insufficient privilege.
------------------------------------------------------------------------------
create function app.begin_erasure() returns void
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
  insert into app.erasure_active (txid) values (txid_current()) on conflict do nothing
$$;
revoke execute on function app.begin_erasure() from public;

------------------------------------------------------------------------------
-- 3. Leaves erasure mode: removes this transaction's row, so a further write
--    in the same transaction after app.erase_client returns is not withheld.
--    Same grants as app.begin_erasure() above, and the same reasoning for who
--    can call it.
------------------------------------------------------------------------------
create function app.end_erasure() returns void
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
  delete from app.erasure_active where txid = txid_current()
$$;
revoke execute on function app.end_erasure() from public;

------------------------------------------------------------------------------
-- 4. Restated in full, as 095 and 097 do for the functions they change,
--    because create or replace resets every attribute. Three changes from 080:
--    a) the erasure condition withholds only when this transaction has a row
--       in app.erasure_active, not when a setting reads 'true', and not
--       conditioned on which role is assumed. Because app.audit_row (080) is
--       security definer, this exists check - like the statements in
--       app.begin_erasure() and app.end_erasure() above - runs as the table's
--       owner no matter which role wrote the row; app_role has no grant on
--       app.erasure_active regardless.
--    b) 'checked_in_point' joins the dropped keys (audit.md section 8):
--       session-capture's household geography column, which must not outlive
--       an erasure inside the immutable log any more than the Emirates ID
--       columns do.
--    c) The revoke is new: 080 forgot it.
------------------------------------------------------------------------------
create or replace function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when exists (select 1 from app.erasure_active where txid = txid_current())
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
--   create or replace function app.audit_redact(p_row jsonb) returns jsonb
--   language sql stable strict
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select case when current_setting('app.erasure', true) = 'true'
--                 and coalesce(nullif(current_setting('role', true), ''), 'none') = 'none'
--       then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
--       else coalesce(
--       (select jsonb_object_agg(
--                 e.key,
--                 case
--                   when jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 200
--                     then to_jsonb('[redacted: ' || length(e.value #>> '{}')::text || ' chars]')
--                   else e.value
--                 end)
--          from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   -- 080's version never had its execute revoked; uncomment for strict parity:
--   -- grant execute on function app.audit_redact(jsonb) to public;
--   drop function if exists app.end_erasure();
--   drop function if exists app.begin_erasure();
--   drop table if exists app.erasure_active;
