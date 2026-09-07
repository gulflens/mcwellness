-- Who may write a practitioner row, and who may see where a practitioner
-- lives (docs/SPEC/route-planning.md section 5.4, migration 913).
-- Declarative and idempotent: the runner re-applies this file on every migrate.
--
-- Both policies are **restrictive**, so each narrows what the permissive
-- `tenant_isolation` policy on the same table already allows and neither
-- widens anything. Both call `app.own_practitioner_id()` (migration 913),
-- which is security definer and reads `practitioner` directly, so a policy on
-- `location` never asks `practitioner`'s own policies to answer it.

------------------------------------------------------------------------------
-- 1. practitioner — writing the row.
--
--    Until this file the table carried the permissive `tenant_isolation`
--    policy and nothing else, which is `for all` and admits every role in the
--    practice to every row. **Finance and a client contact could change any
--    practitioner's home base, vehicle or status**, and one practitioner could
--    change another's. Nothing in the API did so, which is why it had gone
--    unnoticed; the floor is not the API's to keep.
--
--    The rule is `practitioner.base.write` in domain/shared/actor.ts, stated
--    here as the boundary: the office roles write any row, a practitioner
--    writes their own, nobody else writes at all. `app.set_practitioner_base`
--    (913) runs as the tables' owner and so passes over this, which is the
--    point of it — it asks the same question itself before it writes.
--
--    Creating a practitioner is the office's act and nothing in the platform
--    does it through the API yet; the insert arm says so rather than leaving
--    the one command in the pair unguarded.
------------------------------------------------------------------------------
drop policy if exists practitioner_row_writers on public.practitioner;
create policy practitioner_row_writers on public.practitioner as restrictive for insert to app_role
with check (
  app.actor_has_role('owner') or app.actor_has_role('admin')
  or app.actor_has_role('lead_practitioner')
);

drop policy if exists practitioner_row_update_writers on public.practitioner;
create policy practitioner_row_update_writers on public.practitioner as restrictive for update to app_role
using (
  app.actor_has_role('owner') or app.actor_has_role('admin')
  or app.actor_has_role('lead_practitioner')
  or (app.actor_has_role('practitioner') and id = app.own_practitioner_id())
) with check (
  app.actor_has_role('owner') or app.actor_has_role('admin')
  or app.actor_has_role('lead_practitioner')
  or (app.actor_has_role('practitioner') and id = app.own_practitioner_id())
);

------------------------------------------------------------------------------
-- 2. location — a practitioner's base is a practitioner's home.
--
--    `client_record_readers` (db/policies/client/readers.sql) gives every
--    location that is not a client's to all four staff roles at once, on the
--    ground that "a tenant- or practitioner-owned location (the studio, a
--    home base) is operational, not client-sensitive". That is true of the
--    studio and false of a home base: it is the coordinate of a colleague's
--    front door, and until this policy every practitioner in the practice
--    could read every other practitioner's.
--
--    So this narrows one owner type and leaves the rest exactly as they were.
--    A tenant-owned location — the studio, which the seed still gives every
--    practitioner as their base — is untouched, and so is a client's: this
--    policy answers `true` for both and lets `client_record_readers` decide,
--    as it does today.
--
--    The office roles read every base, because the day map draws the whole
--    practice's day from them (app/api/routing/practice-day.ts) and somebody
--    has to be able to correct one. A practitioner reads their own and no
--    other. Finance and a client contact read none, which `client_record_readers`
--    already said of finance and says again here.
------------------------------------------------------------------------------
drop policy if exists practitioner_base_is_private on public.location;
create policy practitioner_base_is_private on public.location as restrictive for select to app_role
using (
  owner_type <> 'practitioner'
  or app.actor_has_role('owner') or app.actor_has_role('admin')
  or app.actor_has_role('lead_practitioner')
  or owner_id = app.own_practitioner_id()
);
