-- Who may reach an invitation and who may reach a request
-- (docs/SPEC/client-portal.md section 6.5). Declarative and idempotent: the
-- runner re-applies this file on every migrate.
--
-- Two layers, as everywhere else. `tenant_isolation` is permissive and says
-- only "your own practice"; everything below is restrictive, so it narrows
-- that and never replaces it.
--
-- The audiences:
--
--   portal_invite    owner and admin, and nobody else at all. Not the lead
--                    practitioner, and above all not a contact — not even
--                    their own. Handing out access to a household's record is
--                    the practice's act, and a row here is the record of it;
--                    a household that could read the table could read the
--                    state of every invitation the practice has ever issued.
--   portal_request   the three office roles read and handle; a contact reads
--                    and writes their own client's, because a request is the
--                    household's own sentence and it must be able to see that
--                    the practice has it.
--
-- Erasure. Both tables pass their client's status through
-- app.client_erasure_gate, exactly as db/policies/billing/ledger.sql and
-- db/policies/client/readers.sql do, so an erased record's invitations and
-- requests are visible only to the owner and the lead practitioner.
--
-- Delete is granted to nobody on either table (700, 701): an invitation is
-- revoked and a request is handled, neither is removed.

------------------------------------------------------------------------------
-- 1. Tenant isolation.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['portal_invite', 'portal_request'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;

------------------------------------------------------------------------------
-- 2. portal_invite — the owner and an admin, for all three verbs.
------------------------------------------------------------------------------
drop policy if exists portal_access_readers on public.portal_invite;
create policy portal_access_readers on public.portal_invite
  as restrictive for select to app_role using (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  );

drop policy if exists portal_access_writers on public.portal_invite;
create policy portal_access_writers on public.portal_invite
  as restrictive for insert to app_role with check (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  );

drop policy if exists portal_access_amenders on public.portal_invite;
create policy portal_access_amenders on public.portal_invite
  as restrictive for update to app_role
  using (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  )
  with check (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  );

------------------------------------------------------------------------------
-- 3. portal_request — the office reads and handles; a household reads and
--    writes its own.
--
--    The insert arm names the three office roles as well, because a
--    coordinator taking the same ask over the telephone should record it in
--    the same place rather than in a note nobody can find.
------------------------------------------------------------------------------
drop policy if exists portal_request_readers on public.portal_request;
create policy portal_request_readers on public.portal_request
  as restrictive for select to app_role using (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
    )
  );

drop policy if exists portal_request_writers on public.portal_request;
create policy portal_request_writers on public.portal_request
  as restrictive for insert to app_role with check (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
    )
  );

-- Handling it is the office's alone. A household may ask and may see that the
-- practice has the ask; it may not mark its own request as dealt with. What an
-- update may change at all is app.guard_portal_request (701).
drop policy if exists portal_request_handlers on public.portal_request;
create policy portal_request_handlers on public.portal_request
  as restrictive for update to app_role
  using (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
    )
  )
  with check (
    app.client_erasure_gate(app.client_status_for(client_id))
    and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
    )
  );
