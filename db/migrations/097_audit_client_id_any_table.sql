-- 097_audit_client_id_any_table.sql
-- The audit row's client_id denormalisation (audit.md section 3, data model
-- section 7) stops naming tables. Every stream adds tables that carry a
-- client_id (appointment, session, goal, erasure_request, ...); rather than each
-- of them replacing this core function in parallel, which merges silently into
-- whichever copy lands last, the rule is now general: a row that has a
-- client_id key names that client; the client table names itself; a location
-- names its client only when it belongs to one. Restated in full, as 095 does
-- for audit_row, because create or replace resets every attribute.

create or replace function app.audit_client_id(p_table text, p_row jsonb) returns uuid
language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_table = 'client'                                          then (p_row ->> 'id')::uuid
    when p_table = 'location' and p_row ->> 'owner_type' = 'client'  then (p_row ->> 'owner_id')::uuid
    when p_table = 'location'                                        then null
    when p_row ? 'client_id'                                         then (p_row ->> 'client_id')::uuid
    else null
  end
$$;

-- rollback:
--   -- restore app.audit_client_id from 080_audit_triggers.sql (the version naming contact, consent and document)
