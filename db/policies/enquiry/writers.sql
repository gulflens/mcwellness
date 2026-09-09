-- Actioning: the same three roles, and the only change a row admits is from
-- `new` to `converted` or `dismissed`. There is no insert policy at all: the
-- one way in is app.lodge_enquiry, and the API role never inserts directly.
drop policy if exists enquiry_actioners on public.enquiry;
create policy enquiry_actioners on public.enquiry as restrictive for update to app_role
  using (
    status = 'new'
    and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
  )
  with check (
    status in ('converted', 'dismissed')
    and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
  );
