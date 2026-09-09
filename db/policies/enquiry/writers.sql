-- Actioning: the same three roles, and the only change a row admits is from
-- `new` to `converted` or `dismissed`. The API role holds no insert grant
-- (916), and the policy below says the same in its own terms so the intent
-- survives a grant made later: the one way in is app.lodge_enquiry.
drop policy if exists enquiry_no_direct_insert on public.enquiry;
create policy enquiry_no_direct_insert on public.enquiry as restrictive for insert to app_role
  with check (false);

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
