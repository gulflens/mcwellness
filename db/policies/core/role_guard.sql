-- Who may change who people are, and what the practice offers. auth_id is the
-- identity link, roles are what a person is, credentials are what they may do,
-- and the service catalogue gates credentials. These policies are restrictive,
-- so they are combined with (never replace) the permissive tenant_isolation
-- policy on the same tables. Delete is not granted to the API role at all.
-- Declarative and idempotent: the runner re-applies this file on every migrate.
--
-- `credential` and `service_type` keep the rule they have always had — the
-- owner or an admin — because Settings › Practitioners is not this piece.
-- `app_user` and `user_role` came out of that loop on 21 September 2026 and
-- are written below, table by table, because the rule on them is no longer the
-- same for both verbs or for both tables.

do $$
declare
  t text;
begin
  foreach t in array array['credential', 'service_type'] loop
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

-- Who works at the practice is the owner's to say (operator, 21 September 2026).
-- One carve-out the portal depends on: an admin invites a household, which
-- inserts an app_user and a client_contact role row and later suspends that row
-- (app/api/portal/access.ts).
drop policy if exists admin_inserts_only on public.app_user;
create policy admin_inserts_only on public.app_user as restrictive for insert to app_role
  with check (app.actor_has_role('owner') or app.actor_has_role('admin'));  -- a row with no role is inert

-- `with check` is spelled out on both policies below with the same expression
-- Postgres would have reused from `using` anyway, because owner_keeps_identity
-- further down spells both out and an asymmetry between neighbours reads as a
-- decision somebody made.
drop policy if exists admin_updates_only on public.app_user;
create policy admin_updates_only on public.app_user as restrictive for update to app_role
  using (app.actor_has_role('owner')
         or (app.actor_has_role('admin')
             and not exists (select 1 from public.user_role r
                              where r.user_id = app_user.id and r.tenant_id = app_user.tenant_id
                                and r.role <> 'client_contact')))
  with check (app.actor_has_role('owner')
         or (app.actor_has_role('admin')
             and not exists (select 1 from public.user_role r
                              where r.user_id = app_user.id and r.tenant_id = app_user.tenant_id
                                and r.role <> 'client_contact')));

drop policy if exists admin_inserts_only on public.user_role;
create policy admin_inserts_only on public.user_role as restrictive for insert to app_role
  with check (app.actor_has_role('owner')
              or (role = 'client_contact' and app.actor_has_role('admin')));

drop policy if exists admin_updates_only on public.user_role;
create policy admin_updates_only on public.user_role as restrictive for update to app_role
  using (app.actor_has_role('owner'))
  with check (app.actor_has_role('owner'));

-- Only the owner hands out or keeps ownership. Said twice on purpose: the two
-- policies above already leave every role row but a household's to the owner,
-- and these two say the narrower thing that must stay true whatever those are
-- later widened to — nobody but an owner turns a row into an owner row, and
-- nobody but an owner touches one.
drop policy if exists owner_grants_owner on public.user_role;
create policy owner_grants_owner on public.user_role as restrictive for insert to app_role
  with check (role <> 'owner' or app.actor_has_role('owner'));
drop policy if exists owner_keeps_owner on public.user_role;
create policy owner_keeps_owner on public.user_role as restrictive for update to app_role
  using (role <> 'owner' or app.actor_has_role('owner'))
  with check (role <> 'owner' or app.actor_has_role('owner'));

-- The row that holds ownership is the owner's alone: no admin may edit it, so
-- the identity link cannot be moved onto someone else and the owner cannot be
-- suspended or renamed by anyone but themselves.
drop policy if exists owner_keeps_identity on public.app_user;
create policy owner_keeps_identity on public.app_user as restrictive for update to app_role
  using (app.actor_has_role('owner')
         or not exists (select 1 from public.user_role r
                         where r.user_id = app_user.id
                           and r.tenant_id = app_user.tenant_id
                           and r.role = 'owner'))
  with check (app.actor_has_role('owner')
         or not exists (select 1 from public.user_role r
                         where r.user_id = app_user.id
                           and r.tenant_id = app_user.tenant_id
                           and r.role = 'owner'));

-- owner_keeps_owner and owner_keeps_identity are the courtesy above the
-- triggers of migration 923 (guard_owner_role, guard_owner_identity) and they
-- agree with them: an ownership row and an owner's sign-in are refused here for
-- app_role, and refused there for everybody. Row security answers a refusal as
-- "nothing to update", which is what a screen should show; the trigger answers
-- it as an error, which is what a lock must do. Neither layer is enough alone.
-- owner_grants_owner is the one with nothing beneath it, and that is deliberate:
-- ownership is granted by an insert, from an audited data step and never from a
-- screen (design section 3), so there is no trigger to refuse it.
