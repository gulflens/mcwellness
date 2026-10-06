-- Who may read and write live location (db/migrations/211_live_location.sql,
-- docs/SPEC/dispatch.md section 15). Declarative and idempotent: the runner
-- re-applies this file on every migrate. The restrictive policies combine with
-- (never replace) the permissive tenant isolation on the same table.

do $$
declare
  t text;
begin
  foreach t in array array['staff_consent', 'location_sharing', 'practitioner_position'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;

-- The consent and the switch are the person's own. Nobody gives, withdraws or
-- turns on for somebody else — the owner included, which is the whole of the
-- plan's promise "nobody can turn it on for them". The owner and an admin may
-- read who has consented and who is sharing, because the practice has to be
-- able to answer "who agreed to what"; nobody else may read anybody's.
drop policy if exists own_consent_read on public.staff_consent;
create policy own_consent_read on public.staff_consent as restrictive for select to app_role
  using (
    user_id = app.current_actor_id()
    or app.actor_has_role('owner') or app.actor_has_role('admin')
  );

drop policy if exists own_consent_give on public.staff_consent;
create policy own_consent_give on public.staff_consent as restrictive for insert to app_role
  with check (user_id = app.current_actor_id());

drop policy if exists own_consent_withdraw on public.staff_consent;
create policy own_consent_withdraw on public.staff_consent as restrictive for update to app_role
  using (user_id = app.current_actor_id())
  with check (user_id = app.current_actor_id());

drop policy if exists own_switch_read on public.location_sharing;
create policy own_switch_read on public.location_sharing as restrictive for select to app_role
  using (
    user_id = app.current_actor_id()
    or app.actor_has_role('owner') or app.actor_has_role('admin')
  );

drop policy if exists own_switch_set on public.location_sharing;
create policy own_switch_set on public.location_sharing as restrictive for insert to app_role
  with check (user_id = app.current_actor_id());

drop policy if exists own_switch_turn on public.location_sharing;
create policy own_switch_turn on public.location_sharing as restrictive for update to app_role
  using (user_id = app.current_actor_id())
  with check (user_id = app.current_actor_id());

-- A position is written by the person it is about, for their own practitioner
-- row, while their consent stands and their switch is on. The shift is the
-- route's to check, because what a shift is is a business rule
-- (domain/scheduling/locationSharing.ts); this is the floor under it.
--
-- A helper's position (round 76, migration 213) is the same rule asked of a
-- helper: `user_id` is the caller's own, they accompany somebody now, and
-- their consent stands and their switch is on (`app.helper_position_writable`).
-- Exactly one of the two columns is set (the table's own check), so each row
-- is judged by one arm alone.
drop policy if exists own_position_write on public.practitioner_position;
create policy own_position_write on public.practitioner_position as restrictive
  for insert to app_role
  with check (
    case when practitioner_id is not null then app.position_writable(practitioner_id)
         else app.helper_position_writable(user_id)
    end
  );

-- Read by the board's three roles alone (docs/SPEC/dispatch.md section 3),
-- only for somebody who is sharing now, and only their last position: a
-- history of somebody's movements is the thing two days was chosen to
-- prevent, and the board has no use for one. A practitioner — the person
-- themselves included — finance and a household read nothing here.
--
-- A helper's last position is read by the same three roles on the same terms:
-- only while they accompany somebody and are sharing now
-- (`app.helper_position_visible`), and only their latest row.
drop policy if exists board_reads_last_position on public.practitioner_position;
create policy board_reads_last_position on public.practitioner_position as restrictive
  for select to app_role
  using (
    (app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner'))
    and case when practitioner_id is not null then
               app.position_visible(practitioner_id)
               and id = app.latest_position_id(practitioner_id)
             else
               app.helper_position_visible(user_id)
               and id = app.latest_helper_position_id(user_id)
        end
  );

-- Whom a helper accompanies (migration 213). Read by the board's three roles,
-- who show a helper's position beside the practitioner they go with, and by
-- the helper themselves. Written by nobody through the API role: the table
-- grants it select alone, and `app.name_helper` and `app.revoke_helper` are
-- the two doors, each asking whether the caller is an owner — Team access is
-- the owner's alone (the operator's rule of 21 September 2026).
drop policy if exists tenant_isolation on public.helper_accompaniment;
create policy tenant_isolation on public.helper_accompaniment for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists accompaniment_readers on public.helper_accompaniment;
create policy accompaniment_readers on public.helper_accompaniment as restrictive
  for select to app_role
  using (
    helper_user_id = app.current_actor_id()
    or app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
  );
