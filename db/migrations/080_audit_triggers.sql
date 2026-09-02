-- 080_audit_triggers.sql
-- Row-level capture for the core tables (audit.md section 5, layer 1), write-time
-- redaction (section 8) and the chain verifier (section 4). Needs 070 and the
-- core tables.

------------------------------------------------------------------------------
-- 1. Redaction: what never lands in old_values / new_values.
--    Drops the Emirates ID columns outright and replaces any string longer
--    than 200 characters with '[redacted: N chars]'. Top-level keys only: the
--    core tables have no nested jsonb.
------------------------------------------------------------------------------
-- Erasure mode: when the erasing transaction sets app.erasure = 'true', every value
-- is withheld and only the keys are kept, so an erasure never re-records the
-- identity it removes (client-record.md section 8). Honoured only when no role has
-- been assumed (set role), so the API role cannot use it to hide a write.
create function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when current_setting('app.erasure', true) = 'true'
              and coalesce(nullif(current_setting('role', true), ''), 'none') = 'none'
    then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
    else coalesce(
    (select jsonb_object_agg(
              e.key,
              case
                when jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 200
                  then to_jsonb('[redacted: ' || length(e.value #>> '{}')::text || ' chars]')
                else e.value
              end)
       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash']) as e),
    '{}'::jsonb)
  end
$$;

------------------------------------------------------------------------------
-- 2. client_id denormalisation (audit.md section 3, data model section 7).
------------------------------------------------------------------------------
create function app.audit_client_id(p_table text, p_row jsonb) returns uuid
language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_table = 'client'                                          then (p_row ->> 'id')::uuid
    when p_table in ('contact', 'consent', 'document')               then (p_row ->> 'client_id')::uuid
    when p_table = 'location' and p_row ->> 'owner_type' = 'client'  then (p_row ->> 'owner_id')::uuid
    else null
  end
$$;

------------------------------------------------------------------------------
-- 3. The write trigger.
------------------------------------------------------------------------------
create function app.audit_row() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set timezone = 'UTC'            -- to_jsonb renders timestamptz in the session zone: pin it
set bytea_output = 'hex'        -- and bytea per the session's bytea_output: pin that too
as $$
declare
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_actor   uuid  := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    -- Diff the unredacted rows, so a change inside a removed or truncated field
    -- is still named; only its value is withheld. Sorted, so deterministic.
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(v_new) as n
     where n.value is distinct from (v_old -> n.key);
  end if;

  insert into public.audit_log (
    tenant_id, actor_id, actor_type, action, entity_type, entity_id, client_id,
    changed_fields, old_values, new_values, reason, request_id
  ) values (
    -- The tenant table is its own tenant; every other audited table carries tenant_id.
    coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenant' then (v_row ->> 'id')::uuid end),
    v_actor,
    case when v_actor is null then 'system' else 'user' end,
    lower(tg_op),                                   -- insert | update | delete
    tg_table_name,
    (v_row ->> 'id')::uuid,
    app.audit_client_id(tg_table_name, v_row),
    v_changed,
    app.audit_redact(v_old),
    app.audit_redact(v_new),
    nullif(current_setting('app.reason', true), ''),
    nullif(current_setting('app.request_id', true), '')::uuid
  );
  -- id, prev_hash and row_hash are assigned by app.audit_chain_link() on audit_log.
  return null;                                      -- after trigger: the return value is ignored
end
$$;
revoke execute on function app.audit_row() from public;

------------------------------------------------------------------------------
-- 4. The verifier. Null when the chain is intact from from_id up to the anchor.
--    Otherwise the first id at which it fails: that row is missing, or its
--    prev_hash is not the previous row_hash, or its row_hash does not recompute
--    from its stored columns, or the anchor no longer matches the last row.
------------------------------------------------------------------------------
create function app.verify_audit_chain(from_id bigint default 1) returns bigint
language plpgsql stable security definer   -- stable: every query inside shares one snapshot
set search_path = pg_catalog, pg_temp
as $$
declare
  v_last_id   bigint;
  v_last_hash bytea;
  v_prev      bytea;
  v_expected  bigint := from_id;
  r           record;
begin
  if from_id < 1 then
    raise exception 'from_id must be >= 1';
  end if;

  select last_id, last_hash into strict v_last_id, v_last_hash
    from app.audit_chain where singleton;

  if from_id > 1 then
    select row_hash into v_prev from public.audit_log where id = from_id - 1;
    if not found then
      return from_id - 1;
    end if;
  end if;

  for r in
    select id, occurred_at, actor_id, action, entity_type, entity_id,
           old_values, new_values, prev_hash, row_hash
      from public.audit_log
     where id >= from_id and id <= v_last_id
     order by id
  loop
    if r.id <> v_expected
       or r.prev_hash is distinct from v_prev
       or r.row_hash <> app.audit_row_hash(r.prev_hash, r.id, r.occurred_at, r.actor_id,
                                          r.action, r.entity_type, r.entity_id,
                                          r.old_values, r.new_values)
    then
      return v_expected;
    end if;
    v_prev     := r.row_hash;
    v_expected := r.id + 1;
  end loop;

  -- Rows removed from the tail leave a valid-looking chain; the anchor catches that.
  if v_expected - 1 <> v_last_id or v_prev is distinct from v_last_hash then
    return v_expected;
  end if;

  return null;
end
$$;
revoke execute on function app.verify_audit_chain(bigint) from public;
grant  execute on function app.verify_audit_chain(bigint) to app_role;   -- the nightly job

------------------------------------------------------------------------------
-- 5. Attach to every core table, tenant included (data model section 8: every row). After, so the audited write has passed its own
--    constraints; for each row, so a bulk statement yields one audit row per row;
--    enable always, so replica mode cannot switch auditing off.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['tenant', 'app_user', 'user_role', 'practitioner', 'credential',
                           'service_type', 'location', 'client', 'contact', 'consent',
                           'document'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I '
                   'for each row execute function app.audit_row()', t);
    execute format('alter table public.%I enable always trigger audit_row', t);
  end loop;
end
$$;

-- rollback:
--   drop trigger if exists audit_row on public.tenant;
--   drop trigger if exists audit_row on public.app_user;
--   drop trigger if exists audit_row on public.user_role;
--   drop trigger if exists audit_row on public.practitioner;
--   drop trigger if exists audit_row on public.credential;
--   drop trigger if exists audit_row on public.service_type;
--   drop trigger if exists audit_row on public.location;
--   drop trigger if exists audit_row on public.client;
--   drop trigger if exists audit_row on public.contact;
--   drop trigger if exists audit_row on public.consent;
--   drop trigger if exists audit_row on public.document;
--   drop function if exists app.verify_audit_chain(bigint);
--   drop function if exists app.audit_row();
--   drop function if exists app.audit_client_id(text, jsonb);
--   drop function if exists app.audit_redact(jsonb);
