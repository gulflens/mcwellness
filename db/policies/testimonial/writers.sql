-- Deciding: the same two roles, and only on a row still open to a decision.
-- A waiting review may be approved or declined; an approved one may be moved
-- on the page or withdrawn to declined. A declined review admits nothing.
-- What may change within those moves — never the words — is the trigger's to
-- say (migration 978, app.testimonial_guard), because a `with check` cannot
-- see the row as it was.
--
-- The API role holds no insert grant (978), and the policy below says the
-- same in its own terms so the intent survives a grant made later: the one
-- way in is app.submit_testimonial. There is no delete grant either; the
-- retention sweep removes rows through its own definer.
drop policy if exists testimonial_no_direct_insert on public.testimonial;
create policy testimonial_no_direct_insert on public.testimonial as restrictive for insert to app_role
  with check (false);

drop policy if exists testimonial_deciders on public.testimonial;
create policy testimonial_deciders on public.testimonial as restrictive for update to app_role
  using (
    status in ('pending', 'approved')
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  )
  with check (
    status in ('approved', 'declined')
    and (app.actor_has_role('owner') or app.actor_has_role('admin'))
  );
