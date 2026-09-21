-- The owners' alone, for reading and for writing. Restrictive, so it is combined
-- with (never replaces) tenant_isolation on the same table. Not the person
-- themselves: a note about somebody that they can read is a different thing from
-- the one the operator asked for on 21 September 2026. Declarative and idempotent.
drop policy if exists owners_only on public.staff_profile;
create policy owners_only on public.staff_profile as restrictive for all to app_role
  using (app.actor_has_role('owner'))
  with check (app.actor_has_role('owner'));
