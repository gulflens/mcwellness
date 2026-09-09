-- Who sees enquiries: the owner, an admin and the lead practitioner — the
-- operator's decision of 9 September 2026. A practitioner or finance account
-- never does. A read is logged by the route under the reader's own name.
drop policy if exists enquiry_readers on public.enquiry;
create policy enquiry_readers on public.enquiry as restrictive for select to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
