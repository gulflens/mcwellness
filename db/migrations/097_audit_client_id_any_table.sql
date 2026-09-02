-- 097_audit_client_id_any_table.sql
-- The audit row's client_id denormalisation (audit.md section 3, data model
-- section 7) stops naming tables. Every stream adds tables that carry a
-- client_id (appointment, session, goal, erasure_request, ...); rather than each
-- of them replacing this core function in parallel, which merges silently into
-- whichever copy lands last, the rule is now general: a row that has a
-- client_id key names that client; the client table names itself; a location
-- names its client only when it belongs to one. The contract that makes this
-- safe: a column called client_id references public.client and nothing else;
-- an integration's or a vendor's client identifier must be named otherwise
-- (.claude/rules/data-model.md). A value that is not a uuid yields null rather
-- than aborting the write. Restated in full, as 095 does for audit_row,
-- because create or replace resets every attribute; and executable by nobody
-- but the trigger's owner, which 080 forgot.

create or replace function app.audit_client_id(p_table text, p_row jsonb) returns uuid
language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_table = 'client'                                          then (p_row ->> 'id')::uuid
    when p_table = 'location' and p_row ->> 'owner_type' = 'client'  then (p_row ->> 'owner_id')::uuid
    when p_table = 'location'                                        then null
    when (p_row ->> 'client_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                                                                     then (p_row ->> 'client_id')::uuid
    else null
  end
$$;
revoke execute on function app.audit_client_id(text, jsonb) from public;

-- rollback:
--   -- create or replace app.audit_client_id with the body from 080_audit_triggers.sql
--   -- (create or replace, since the function exists). Audit rows written for
--   -- streams' tables meanwhile keep their client_id; nothing backfills or removes it.
--   -- The revoke stays: nothing but the trigger ever needed to call it.
