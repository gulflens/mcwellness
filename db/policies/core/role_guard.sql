-- Who may change who people are. auth_id is the identity link, roles are what
-- a person is, credentials are what they may do: only the owner or an admin
-- writes any of them. These policies are restrictive, so they are combined with
-- (never replace) the permissive tenant_isolation policy on the same tables.
-- Delete is not granted to the API role at all. Declarative and idempotent:
-- the runner re-applies this file on every migrate.

do $$
declare
  t text;
begin
  foreach t in array array['app_user', 'user_role', 'credential'] loop
    execute format('drop policy if exists admin_inserts_only on public.%I', t);
    execute format(
      'create policy admin_inserts_only on public.%I as restrictive for insert to app_role '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''admin''))', t);
    execute format('drop policy if exists admin_updates_only on public.%I', t);
    execute format(
      'create policy admin_updates_only on public.%I as restrictive for update to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''admin''))', t);
  end loop;
end
$$;

-- Only the owner hands out ownership. An admin may grant every other role.
drop policy if exists owner_grants_owner on public.user_role;
create policy owner_grants_owner on public.user_role as restrictive for insert to app_role
  with check (role <> 'owner' or app.actor_has_role('owner'));
