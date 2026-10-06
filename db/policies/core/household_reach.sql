-- How far a household's login reaches into the sign-in and staff tables
-- (trunk round 77; docs/CHANGE-REQUESTS/dispatch-03.md item 18). Declarative
-- and idempotent: the runner re-applies this file on every migrate, after the
-- migrations. No migration: a policy change never needs one.
--
-- **The gap.** `app_user`, `user_role`, `practitioner`, `credential`,
-- `service_type`, `goal_category`, `scheduling_setting` and `tenant` carry no
-- read rule but the practice's own (`tenant_isolation`). So a household
-- contact could read, at the database, every sign-in row in the practice:
-- other households' and the staff's, with names, emails and phones. The
-- portal's routes never asked for them, so nothing was shown; the floor
-- beneath was missing. helper_reach.sql closed the same gap for a helper.
--
-- **Who is bound.** A person who holds `client_contact` and no other role —
-- the stamp the middleware writes is then exactly `client_contact` — which is
-- every household's own account and nobody else's. A member of staff who is
-- also a household's contact (migration 968's colleague) is stamped with both
-- roles on every request, portal or console, so the first arm below is true
-- for them and their staff reach is untouched: the portal is already the
-- narrower of their two views, and a restrictive policy on the wider one would
-- cut the console they work in. A request with no stamp (a migration, the
-- seed, the runner) is not bound either.
--
-- **What a household reads**, from every query the portal's routes
-- (app/api/portal/**) and `GET /api/me` make against these tables:
--   app_user            its own row (the name and language on /api/me, the
--                       language on every portal screen's practice line);
--   user_role           its own role rows;
--   service_type        the services on its own visits (Visits names them,
--                       Home reads their code for the review line), decided by
--                       `app.actor_is_contact_of` exactly as its visits are;
--   tenant              its practice's own row (the name, the WhatsApp number,
--                       the review page and the time zone);
--   practitioner,
--   credential,
--   goal_category,
--   scheduling_setting  nothing. The portal never names the practitioner
--                       (docs/SPEC/client-portal.md section 3.2), so there is
--                       no name to return and no definer function to write.
--
-- **What a household writes** to these tables: nothing. Every portal write that
-- touches one (accepting an invite, which links the sign-in) is a security
-- definer function and passes over row security entirely, as do
-- `app.resolve_actor`, `app.portal_client_ids` and the rest.
--
-- tests/db/household-reach.test.ts walks every table in `public` as a
-- household and as the colleague who is one, and holds these policies' presence.

do $$
declare
  t         text;
  household constant text :=
    $q$coalesce(current_setting('app.actor_roles', true), '') = 'client_contact'$q$;
  own_read  text;
begin
  foreach t in array array['app_user', 'user_role', 'practitioner', 'credential',
                           'service_type', 'goal_category', 'scheduling_setting',
                           'tenant'] loop
    own_read := case t
      when 'app_user' then 'id = app.current_actor_id()'
      when 'user_role' then 'user_id = app.current_actor_id()'
      when 'service_type' then
        'exists (select 1 from public.appointment a '
        'where a.service_type_id = service_type.id and a.tenant_id = service_type.tenant_id '
        'and app.actor_is_contact_of(a.client_id))'
      when 'tenant' then 'id = app.current_tenant_id()'
      else 'false'
    end;
    execute format('drop policy if exists household_reach_read on public.%I', t);
    execute format(
      'create policy household_reach_read on public.%I as restrictive for select to app_role '
      'using (not (%s) or (%s))', t, household, own_read);
    execute format('drop policy if exists household_reach_write on public.%I', t);
    execute format(
      'create policy household_reach_write on public.%I as restrictive for all to app_role '
      'using (not (%s) or (%s)) with check (not (%s))',
      t, household, own_read, household);
  end loop;
end
$$;
