-- Who may write the client aggregate (docs/SPEC/client-record.md section 2,
-- "Client Record Plan" PR 2). Restrictive, combined with (never replacing)
-- the permissive tenant_isolation policy on the same table. Declarative and
-- idempotent: the runner re-applies this file on every migrate. Delete is
-- never granted to app_role on any of these tables (090_grants_and_rls.sql,
-- 100_client_record.sql): erasure runs through app.erase_client as the
-- table owner instead.
--
-- goal is the one table where admin is deliberately absent: section 2 gives
-- admin everything else, and lead_practitioner "all of the above, plus set
-- and close goals" — goals are the lead practitioner's (and the owner's, who
-- holds every role) alone to write, though admin may still read them
-- (readers.sql).
--
-- Note: 090_grants_and_rls.sql already floors service_type writes to owner
-- and admin (db/policies/core/role_guard.sql); that is untouched here.
-- goal_category is the same shape of table and gets the same shape of
-- policy, under the same policy names, because it is the same rule.

-- client: create and edit demographics.
drop policy if exists client_record_writers on public.client;
create policy client_record_writers on public.client as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.client;
create policy client_record_update_writers on public.client as restrictive for update to app_role using (
  status <> 'erased'
  and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
) with check (
  status <> 'erased'
  and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
);

-- contact: create and edit. A client contact's own edit of their own contact
-- details is Stage 2 (client-record.md section 2); not built here.
drop policy if exists client_record_writers on public.contact;
create policy client_record_writers on public.contact as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.contact;
create policy client_record_update_writers on public.contact as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
) with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);

-- location: creating one is staff-only; a practitioner may update one their
-- schedule reaches (app.client_visible_to_practitioner, closed for now), and
-- app.guard_location_notes() narrows that update to access_notes alone.
drop policy if exists client_record_writers on public.location;
create policy client_record_writers on public.location as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.location;
create policy client_record_update_writers on public.location as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
  or (app.actor_has_role('practitioner') and owner_type = 'client'
      and app.client_visible_to_practitioner(owner_id))
) with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
  or (app.actor_has_role('practitioner') and owner_type = 'client'
      and app.client_visible_to_practitioner(owner_id))
);

-- consent: record and withdraw. The verbal_witnessed re-confirmation a
-- practitioner may record with a second staff member's confirmation
-- (client-record.md section 7) is not built in this pull request: it needs a
-- confirmation workflow this schema does not yet model, so a practitioner
-- has no consent-write path here, only the safer default of none at all.
drop policy if exists client_record_writers on public.consent;
create policy client_record_writers on public.consent as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.consent;
create policy client_record_update_writers on public.consent as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
) with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);

-- goal: the owner and the lead practitioner alone set and close goals.
drop policy if exists client_record_writers on public.goal;
create policy client_record_writers on public.goal as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.goal;
create policy client_record_update_writers on public.goal as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
) with check (
  app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
);

-- goal_category: the owner-editable catalogue, floored the same way
-- service_type is (db/policies/core/role_guard.sql).
drop policy if exists admin_inserts_only on public.goal_category;
create policy admin_inserts_only on public.goal_category as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin')
);
drop policy if exists admin_updates_only on public.goal_category;
create policy admin_updates_only on public.goal_category as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin')
);

-- erasure_request: recording one is an admin-or-above action (section 8);
-- app.erase_client fills in performed_at and summary as the table owner,
-- bypassing this policy, so app_role itself never needs to update one.
drop policy if exists client_record_writers on public.erasure_request;
create policy client_record_writers on public.erasure_request as restrictive for insert to app_role with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
drop policy if exists client_record_update_writers on public.erasure_request;
create policy client_record_update_writers on public.erasure_request as restrictive for update to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
) with check (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
