-- Who sees the website's reviews: the owner and an admin
-- (docs/SPEC/testimonials.md section 3). What goes on the practice's public
-- page is the office's call, so the lead practitioner, who sees enquiries,
-- does not see these; nor does a practitioner, finance or a household. A read
-- is logged by the route under the reader's own name.
drop policy if exists testimonial_readers on public.testimonial;
create policy testimonial_readers on public.testimonial as restrictive for select to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin')
);
