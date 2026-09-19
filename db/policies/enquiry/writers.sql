-- Actioning: the same three roles, and the changes a row admits are two. A
-- `new` row may become `converted` or `dismissed`. A dismissed row that still
-- names its person may be updated once more, to erase them (migration 921,
-- the operator's decision of 19 September 2026); what that update may and may
-- not alter is the trigger's to say, because a `with check` cannot see the row
-- as it was. A converted row, and a row with nobody left on it, admit nothing,
-- as before.
--
-- The API role holds no insert grant (916), and the policy below says the same
-- in its own terms so the intent survives a grant made later: the one way in
-- is app.lodge_enquiry.
drop policy if exists enquiry_no_direct_insert on public.enquiry;
create policy enquiry_no_direct_insert on public.enquiry as restrictive for insert to app_role
  with check (false);

drop policy if exists enquiry_actioners on public.enquiry;
create policy enquiry_actioners on public.enquiry as restrictive for update to app_role
  using (
    (status = 'new' or (status = 'dismissed' and name is not null))
    and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
  )
  with check (
    status in ('converted', 'dismissed')
    and (app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner'))
  );
