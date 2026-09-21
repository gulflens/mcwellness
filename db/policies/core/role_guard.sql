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

-- **Ownership is not written by the API role at all**, whoever is asking. Not an
-- admin, and not an owner either: these two policies admitted an owner until the
-- round's security review of 22 September 2026 pointed out what that left
-- standing. `isStaffRole` — one line of TypeScript in `app/api/team/roles.ts` —
-- was then the whole barrier between a screen and a permanent grant of full
-- access to the practice, and the row it would write is permanent in the strict
-- sense: migration 923's `guard_owner_role` refuses every later update and
-- delete of it, for every caller, so a mistake here is corrected by a migration
-- and by nothing smaller.
--
-- Ownership is granted where the design puts it: by an audited data step, under
-- the founder's own id, rehearsed first (docs/RUNBOOK/second-owner.md). Nothing
-- legitimate loses anything by the narrowing — that step is a `do` block run as
-- the connecting role and never `set local role app_role`, so no policy is in
-- its way, and `app.bootstrap_practice` (956) is security definer and writes the
-- first owner as its own owner.
drop policy if exists owner_grants_owner on public.user_role;
create policy owner_grants_owner on public.user_role as restrictive for insert to app_role
  with check (role <> 'owner');
-- And an existing row is not turned into an ownership row, which is the same act
-- from the other side. `guard_owner_role` says nothing about it: that trigger
-- judges OLD, so a finance row becoming an owner row is this policy's to refuse
-- and nothing else's.
drop policy if exists owner_keeps_owner on public.user_role;
create policy owner_keeps_owner on public.user_role as restrictive for update to app_role
  using (role <> 'owner')
  with check (role <> 'owner');

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
-- owner_grants_owner is the one with nothing beneath it, and that is why it is
-- unconditional: ownership is granted by an insert, and an insert is the one act
-- on an ownership row that migration 923 deliberately says nothing about, so
-- this policy is the whole of the floor rather than the polite half of it.
