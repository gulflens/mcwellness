-- Who may write and who may read an appointment row (scheduling-manual.md
-- section 2). These are restrictive, so they combine with (never replace) the
-- permissive tenant_isolation policy on the same table. Declarative and
-- idempotent: the runner re-applies this file on every migrate.
--
-- The read scope resolves the acting practitioner from app.actor_id directly:
-- the client-record stream's app.client_visible_to_practitioner (its
-- migration 100) is a different door, about which clients a practitioner may
-- see, and this stream does not reference it until its own second pull
-- request redefines it for appointments, after 100 has merged.

-- Only the roles who run the calendar create or change an appointment; a
-- practitioner "cannot create" (scheduling-manual.md section 2).
drop policy if exists scheduling_write on public.appointment;
create policy scheduling_write on public.appointment as restrictive for insert to app_role
  with check (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
  );

drop policy if exists scheduling_update on public.appointment;
create policy scheduling_update on public.appointment as restrictive for update to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
  );

-- Owner, admin, lead practitioner and finance see every appointment; anyone
-- else sees only the rows for the practitioner row they themselves are. This
-- is the same floor a later practitioner "Today" screen will read from, laid
-- down now so nothing has to widen access retroactively.
drop policy if exists scheduling_read_scope on public.appointment;
create policy scheduling_read_scope on public.appointment as restrictive for select to app_role
  using (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner') or app.actor_has_role('finance')
    or practitioner_id in (
      select p.id from public.practitioner p
      where p.user_id = nullif(current_setting('app.actor_id', true), '')::uuid
        and p.tenant_id = app.current_tenant_id()
    )
  );
