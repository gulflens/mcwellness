-- 095_actor.sql
-- Who is calling: resolving a verified auth id into a user, tenant, roles and
-- credential capabilities, the role helper the policies use, and the audit
-- row's actor_role. Needs 020, 050 and 080.

------------------------------------------------------------------------------
-- 1. Which roles the current request acts with. The middleware stamps
--    app.actor_roles as a comma-separated list, transaction-local.
------------------------------------------------------------------------------
create function app.actor_has_role(p_role text) returns boolean
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select p_role = any(string_to_array(coalesce(current_setting('app.actor_roles', true), ''), ','))
$$;
revoke execute on function app.actor_has_role(text) from public;
grant execute on function app.actor_has_role(text) to app_role;

------------------------------------------------------------------------------
-- 2. Actor resolution. Under app_role with no tenant set, every row is
--    invisible, so the API cannot look a user up by auth_id itself. This
--    function runs as the owner and returns at most the one active user whose
--    auth_id matches; unknown, suspended and archived users return no row, in
--    SQL, so no caller can obtain their context. Credentials come back with
--    their dates and without a validity filter: "valid on the date" is judged
--    once, in domain/shared/actor.ts.
------------------------------------------------------------------------------
create function app.resolve_actor(p_auth_id uuid)
returns table (user_id uuid, tenant_id uuid, status user_status, roles text[], capabilities jsonb)
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.id,
         u.tenant_id,
         u.status,
         coalesce(
           (select array_agg(r.role::text order by r.role)
              from public.user_role r
             where r.user_id = u.id and r.tenant_id = u.tenant_id),
           '{}'::text[]),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'serviceTypeId',     c.service_type_id,
                     'canExecuteSession', c.can_execute_session,
                     'canAuthorProtocol', c.can_author_protocol,
                     'canSignReport',     c.can_sign_report,
                     'validFrom',         c.valid_from,
                     'validTo',           c.valid_to)
                   order by c.service_type_id, c.valid_from)
              from public.practitioner p
              join public.credential c on c.practitioner_id = p.id and c.tenant_id = p.tenant_id
             where p.user_id = u.id and p.tenant_id = u.tenant_id and p.status = 'active'),
           '[]'::jsonb)
    from public.app_user u
   where u.auth_id = p_auth_id
     and u.status = 'active'
$$;
revoke execute on function app.resolve_actor(uuid) from public;
grant execute on function app.resolve_actor(uuid) to app_role;

------------------------------------------------------------------------------
-- 3. The audit row now records which roles the actor held at the time, verbatim
--    (a person may hold several; the audit must not pick one). Same signature,
--    so the eleven enable-always triggers keep their function; every attribute
--    is restated because create or replace resets them.
------------------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
set timezone = 'UTC'
set bytea_output = 'hex'
as $$
declare
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_actor   uuid  := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(v_new) as n
     where n.value is distinct from (v_old -> n.key);
  end if;

  insert into public.audit_log (
    tenant_id, actor_id, actor_type, actor_role, action, entity_type, entity_id, client_id,
    changed_fields, old_values, new_values, reason, request_id
  ) values (
    coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenant' then (v_row ->> 'id')::uuid end),
    v_actor,
    case when v_actor is null then 'system' else 'user' end,
    nullif(current_setting('app.actor_roles', true), ''),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    app.audit_client_id(tg_table_name, v_row),
    v_changed,
    app.audit_redact(v_old),
    app.audit_redact(v_new),
    nullif(current_setting('app.reason', true), ''),
    nullif(current_setting('app.request_id', true), '')::uuid
  );
  return null;
end
$$;
revoke execute on function app.audit_row() from public;

-- rollback:
--   -- Remove db/policies/core/role_guard.sql from the tree first: the runner re-applies
--   -- every policy file on each migrate, and those policies depend on actor_has_role.
--   drop policy if exists admin_inserts_only on public.app_user;
--   drop policy if exists admin_updates_only on public.app_user;
--   drop policy if exists owner_keeps_identity on public.app_user;
--   drop policy if exists admin_inserts_only on public.user_role;
--   drop policy if exists admin_updates_only on public.user_role;
--   drop policy if exists owner_grants_owner on public.user_role;
--   drop policy if exists owner_keeps_owner on public.user_role;
--   drop policy if exists admin_inserts_only on public.credential;
--   drop policy if exists admin_updates_only on public.credential;
--   drop policy if exists audit_log_readers on public.audit_log;
--   -- restore app.audit_row() from 080_audit_triggers.sql (the version without actor_role)
--   drop function if exists app.resolve_actor(uuid);
--   drop function if exists app.actor_has_role(text);
