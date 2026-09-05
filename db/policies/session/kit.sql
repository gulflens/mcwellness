-- Who sees and who changes the practice's equipment register
-- (db/migrations/306_kit_and_setup_photo.sql, docs/SPEC/practitioner-phone.md
-- section 6.2). The same rule `canActor`'s `kit.manage` and `kit.read` state
-- in code; this is the one that binds. Declarative and idempotent: the runner
-- re-applies this file on every migrate.

-- Tenant isolation, as every table in this schema carries it
-- (docs/SPEC/00-data-model.md section 1).
drop policy if exists tenant_isolation on public.kit;
create policy tenant_isolation on public.kit for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- Reading: the owner, an admin and the lead practitioner see the whole
-- register; a practitioner sees the items assigned to them and nothing else.
--
-- That second half is not a courtesy. The check-in block tells a practitioner
-- their amplifier's calibration has lapsed, and a person stopped at a
-- household's door should be able to see which instrument it is without
-- telephoning the practice — but the rest of the register, including what
-- everybody else is carrying, is the practice's business and not theirs.
--
-- Finance is deliberately absent: an instrument is an asset, and the register
-- is not how finance reads the practice's assets. A client contact is absent
-- for the plainer reason that the equipment is nothing to do with them.
drop policy if exists kit_read on public.kit;
create policy kit_read on public.kit as restrictive for select to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (
      app.actor_has_role('practitioner')
      and assigned_practitioner_id in (
        select id from public.practitioner
         where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
           and tenant_id = app.current_tenant_id()
      )
    )
  );

-- Writing: the three who manage the register, and nobody else. Adding an item,
-- editing one, assigning it and recording a calibration are all the same act —
-- deciding what the register says — and a practitioner recording their own
-- calibration would be the instrument certifying itself.
--
-- Insert and update; delete needs no policy at all, because 306 grants
-- app_role none. An item leaves the register by being set inactive, since a
-- visit that ran on it still names it.
drop policy if exists kit_write on public.kit;
create policy kit_write on public.kit as restrictive for insert to app_role
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
  );

drop policy if exists kit_amend on public.kit;
create policy kit_amend on public.kit as restrictive for update to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
  )
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
  );
