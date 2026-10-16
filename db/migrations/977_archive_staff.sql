-- 977_archive_staff.sql
-- Archiving a colleague, and restoring one (the practice asked on 6 October
-- 2026 for a way to remove a practitioner or any other member of staff should
-- it ever be needed; docs/superpowers/specs/2026-09-21-team-profiles-and-
-- access-design.md section 12).
--
-- **Never a delete.** Every row a colleague ever touched names them — as the
-- actor of an audit row, the creator of a record, the practitioner of a visit,
-- the signer of a report — and the trail is promised for five years
-- (docs/SPEC/audit.md). Deleting the person would either fail on those foreign
-- keys or, worse, be made to succeed by nulling them, and then the trail would
-- say "somebody" did what a named person did. So "remove" is an archive: the
-- person stays, named, everywhere they already are, and stops being anywhere
-- new — no sign-in, no booking picker, no board, no helper's day.
--
-- Two doors, both security definer, both owner-only, both written out in full
-- because nothing beneath them asks again (923's reasoning, unchanged):
--
--   1. `app.archive_staff(user, reason)`. Refuses, in the order a person would
--      want to be told: nobody named; not an owner (read from `user_role`, not
--      from a session setting — 923 section 3 says why); no reason; oneself; a
--      person who is not staff of this practice; an owner (the lock of 923
--      would refuse the status change anyway, and this says it as a sentence
--      first); and — with its own SQLSTATE, 55000, because it is the one
--      refusal a person can act on — a practitioner who still has visits
--      ahead. Then, all in one transaction:
--        - `app_user.status` becomes `archived`. That is the whole sign-in
--          block, and it is the same one Suspend relies on:
--          `app.resolve_actor` (095) answers no row for any status but
--          `active`, so the fence (app/api/_middleware/request-context.ts)
--          answers 403 before a single role is read. The sign-in at the
--          provider is left alone, exactly as Suspend leaves it: a token the
--          provider still issues is a token the fence refuses, and the
--          provider's account is what a restore needs to find again.
--        - their `practitioner` row, if they have one, becomes `inactive`. Every
--          booking picker, the reassign target list, the helper's list of
--          practitioners and the kit's list already read `p.status = 'active'`
--          (app/api/appointments/options.ts, reassign.ts, create.ts,
--          practitioners/routes.ts, kit/routes.ts, team/helpers.ts), and the
--          board shows an inactive practitioner only on a day they still have
--          a visit — which the refusal above has just made impossible from
--          today on. `practitioner.status` is the column 050 made for exactly
--          this; nothing new is needed.
--        - every standing accompaniment ends: theirs, if they are a helper, and
--          every helper's who went with them, if they are a practitioner. 213's
--          own shape — `ended_at` and `ended_by` stamped once, nothing else on
--          the row moves — so `guard_helper_accompaniment` is satisfied, and
--          no role row is written, so `guard_helper_alone` is never asked.
--          Naming a helper again is still the owner's act through
--          `app.name_helper`, after a restore as at any other time.
--        - every position of theirs still held is deleted, as `app.revoke_helper`
--          does: a last known location of somebody who no longer works there
--          is nothing anybody needs, and positions are unaudited by decision.
--        - one audit row, `staff_archived`, under the owner, carrying the
--          reason; and the reason is stamped on the transaction first, so the
--          trigger-written rows of the same act (the status change, the
--          practitioner row, each accompaniment ended) carry it too.
--
--   2. `app.restore_staff(user)`. The owner's alone; never oneself; only a
--      person who is archived. **Back to exactly where the archive found
--      them**, which section 0 records on the person: the status they had
--      (a suspended colleague comes back suspended — Suspend is its own
--      decision, and a restore that quietly lifted it would undo it), and
--      their practitioner row back to `active` only if the archive was what
--      made it inactive (a row already inactive for its own reasons stays
--      so). Accompaniments stay ended and positions stay gone. One audit row,
--      `staff_restored`. The reason is whatever the request stamped
--      (`X-Reason`), optional, because bringing a person back is not the act a
--      trail has to explain.
--
-- **Roles are kept.** An archived person's `user_role` rows stay as they were:
--   - the trail reads whole — "archived while holding Finance" is a fact;
--   - 968's erasure spares a colleague by asking whether they hold any role
--     but `client_contact`. Taking the roles away would turn an archived
--     colleague into an account an erasure is free to archive and rename;
--   - nothing reads a role without the status beside it. The fence resolves
--     only an active person, so `app.actor_has_role` is never stamped for an
--     archived one; the team list and every role check in this schema that
--     acts on a person other than the caller (`app.revoke_staff_role`,
--     `app.name_helper`, `app.helper_accompanies`) either reads the status
--     itself or is refused by the owner lock below it. A restore therefore
--     brings the person back with exactly the access they left with, which is
--     what "restore" says.
--
-- **The one row that could undo a deactivation.** `db/policies/core/
-- practitioner_base.sql` admits an owner, an admin and a lead practitioner to
-- update `practitioner` through the API role, and no route does so today — but
-- a policy cannot say "this column", and an archived person whose practitioner
-- row was set back to `active` would reappear in every picker above. Section 3
-- is a trigger, enabled always, that refuses exactly that: a practitioner row
-- is not active while its person is archived. `app.restore_staff` makes the
-- person active first and the row second, so it passes its own guard.
--
-- **Where this stops, said plainly.** The future-visit check and the
-- deactivation run under a `for update` lock on the practitioner row, and an
-- appointment insert takes `for key share` on that same row through its
-- foreign key, so a booking committed a moment before the archive is seen and
-- refuses it. A booking whose route read the practitioner as active just
-- before the archive committed, and inserts just after, is not refused here:
-- the key-share lock does not conflict with an update of a non-key column once
-- the archive has committed. It would land on the board under an inactive
-- practitioner, where the board shows it (board.ts keeps any practitioner with
-- a visit on the day) and it can be reassigned. Closing that needs a guard on
-- `appointment`, which is scheduling's table; recorded in the design's section
-- 12 rather than reached into from here.
--
-- Needs: 020 (app_user, user_role, user_status — and the two columns section 0
-- adds to app_user), 050 (practitioner), 070
-- (audit_log), 080 (app.audit_row), 095 (app.resolve_actor — read, not
-- changed), 200 (appointment), 211 and 213 (practitioner_position,
-- helper_accompaniment), 923 (guard_owner_identity, which still binds beneath
-- this).

------------------------------------------------------------------------------
-- 0. What an archive found, kept on the person until a restore reads it.
--
--    Two columns on `app_user` rather than a read of the trail: the restore
--    must not depend on parsing audit rows, and the facts belong to the
--    person while they are archived. Null on everybody else, and cleared by
--    the restore. An account archived some other way (an erasure closing a
--    household login, 968) carries neither, and a restore of it — which only
--    a colleague can have — returns it to `active` and touches no
--    practitioner row, because nothing says the archive made one inactive.
------------------------------------------------------------------------------
alter table public.app_user
  add column archived_from_status             public.user_status,
  add column archive_deactivated_practitioner boolean,
  add constraint app_user_archive_record_together check (
    (archived_from_status is null) = (archive_deactivated_practitioner is null)
  ),
  add constraint app_user_archive_record_only_archived check (
    archived_from_status is null
    or (status = 'archived' and archived_from_status <> 'archived')
  );

comment on column public.app_user.archived_from_status is
  'The status an archive found (active or suspended), which app.restore_staff returns the person '
  'to. Null unless archived through app.archive_staff (migration 977).';
comment on column public.app_user.archive_deactivated_practitioner is
  'Whether app.archive_staff made this person''s practitioner row inactive, so app.restore_staff '
  'reactivates it only then. Null unless archived through app.archive_staff (migration 977).';

------------------------------------------------------------------------------
-- 1. Archive.
------------------------------------------------------------------------------
create function app.archive_staff(p_user_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor        uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant       uuid := app.current_tenant_id();
  v_reason       text := nullif(btrim(p_reason), '');
  v_status       public.user_status;
  v_practitioner uuid;
  v_ahead        integer;
  v_deactivated  integer := 0;
  v_ended        integer := 0;
  v_more         integer := 0;
  v_forgotten    integer := 0;
  v_summary      jsonb;
begin
  -- Unnamed first: with no actor, the owner check below finds no row and
  -- answers "only an owner", which is true but not the reason.
  if v_actor is null then
    raise exception 'nobody archives a colleague without being named' using errcode = '42501';
  end if;
  -- A null tenant matches no row, so an unstamped caller is refused here too.
  if not exists (select 1 from public.user_role r
                  where r.user_id = v_actor and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'only an owner archives a colleague' using errcode = '42501';
  end if;
  -- The reason is the one thing the trail cannot reconstruct afterwards.
  if v_reason is null then
    raise exception 'an archive carries a reason' using errcode = '22023';
  end if;
  if p_user_id is null or p_user_id = v_actor then
    raise exception 'nobody archives themselves' using errcode = '42501';
  end if;

  -- The person's own row, locked before anything about them is read: the same
  -- lock 923's revoke and 213's two doors take, so an archive and a role
  -- switch or a helper's naming of the same person queue rather than
  -- interleave. Staff of this practice only: a household contact is ended in
  -- Settings › Portal or by an erasure, never here.
  select u.status into v_status
    from public.app_user u
   where u.id = p_user_id and u.tenant_id = v_tenant
     and exists (select 1 from public.user_role r
                  where r.user_id = u.id and r.tenant_id = u.tenant_id
                    and r.role::text <> 'client_contact')
     for update;
  if not found then
    raise exception 'no such colleague' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'an owner is not archived' using errcode = '42501';
  end if;
  if v_status = 'archived' then
    return jsonb_build_object('archived', false);
  end if;

  -- Their practitioner row, locked so a booking that is mid-flight against it
  -- (its foreign key holds `for key share`) finishes first and is counted.
  select p.id into v_practitioner
    from public.practitioner p
   where p.user_id = p_user_id and p.tenant_id = v_tenant
     for update;

  -- Visits still ahead of them: not over yet, and in a state that still means
  -- somebody is expected at the door. Everything else — completed, cancelled
  -- either way, no-show, rescheduled, voided — is history and stays theirs.
  if v_practitioner is not null then
    select count(*) into v_ahead
      from public.appointment a
     where a.practitioner_id = v_practitioner and a.tenant_id = v_tenant
       and a.status in ('proposed', 'confirmed', 'checked_in')
       and a.window_end > now();
    if v_ahead > 0 then
      raise exception 'reassign their future visits first'
        using errcode = '55000', detail = v_ahead::text || ' visit(s) still ahead';
    end if;
  end if;

  -- Every row written from here on carries the reason in its audit row.
  perform set_config('app.reason', v_reason, true);

  if v_practitioner is not null then
    update public.practitioner set status = 'inactive'
     where id = v_practitioner and tenant_id = v_tenant and status = 'active';
    get diagnostics v_deactivated = row_count;
  end if;

  -- Their own accompaniment, if they are a helper ...
  update public.helper_accompaniment
     set ended_at = now(), ended_by = v_actor
   where helper_user_id = p_user_id and tenant_id = v_tenant and ended_at is null;
  get diagnostics v_ended = row_count;
  -- ... and every helper's who went with them, if they are a practitioner.
  if v_practitioner is not null then
    update public.helper_accompaniment
       set ended_at = now(), ended_by = v_actor
     where practitioner_id = v_practitioner and tenant_id = v_tenant and ended_at is null;
    get diagnostics v_more = row_count;
    v_ended := v_ended + v_more;
  end if;

  delete from public.practitioner_position pp
   where pp.tenant_id = v_tenant
     and (pp.user_id = p_user_id
          or (v_practitioner is not null and pp.practitioner_id = v_practitioner));
  get diagnostics v_forgotten = row_count;

  -- Last, so everything above is already true when the door shuts. What was
  -- found is kept beside the status, for the restore (section 0).
  update public.app_user
     set status = 'archived',
         archived_from_status = v_status,
         archive_deactivated_practitioner = v_deactivated > 0
   where id = p_user_id and tenant_id = v_tenant;

  v_summary := jsonb_build_object(
    'archived', true,
    'practitionerDeactivated', v_deactivated > 0,
    'accompanimentsEnded', v_ended,
    'positionsForgotten', v_forgotten);

  -- The act itself, as one row a person reading the trail finds by its name.
  -- Counts only: never a name, an address or a position.
  insert into public.audit_log (
    tenant_id, actor_id, actor_type, actor_role, action, entity_type, entity_id, client_id,
    new_values, reason, request_id
  ) values (
    v_tenant, v_actor, 'user', nullif(current_setting('app.actor_roles', true), ''),
    'staff_archived', 'app_user', p_user_id, null,
    v_summary, v_reason, nullif(current_setting('app.request_id', true), '')::uuid
  );
  return v_summary;
end
$$;
revoke execute on function app.archive_staff(uuid, text) from public;
grant execute on function app.archive_staff(uuid, text) to app_role;

------------------------------------------------------------------------------
-- 2. Restore.
------------------------------------------------------------------------------
create function app.restore_staff(p_user_id uuid) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor        uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant       uuid := app.current_tenant_id();
  v_status       public.user_status;
  v_from         public.user_status;
  v_deactivated  boolean;
  v_reactivated  integer := 0;
  v_summary      jsonb;
begin
  if v_actor is null then
    raise exception 'nobody restores a colleague without being named' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_role r
                  where r.user_id = v_actor and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'only an owner restores a colleague' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_actor then
    raise exception 'nobody restores themselves' using errcode = '42501';
  end if;
  select u.status, u.archived_from_status, u.archive_deactivated_practitioner
    into v_status, v_from, v_deactivated
    from public.app_user u
   where u.id = p_user_id and u.tenant_id = v_tenant
     and exists (select 1 from public.user_role r
                  where r.user_id = u.id and r.tenant_id = u.tenant_id
                    and r.role::text <> 'client_contact')
     for update;
  if not found then
    raise exception 'no such colleague' using errcode = '42501';
  end if;
  -- Suspended comes back through Reactivate, and active needs nothing.
  if v_status <> 'archived' then
    raise exception 'that colleague is not archived' using errcode = '42501';
  end if;

  -- The person first, so section 3's guard sees them no longer archived when
  -- their practitioner row follows. Back to what the archive found; active
  -- where nothing was recorded (section 0).
  v_from := coalesce(v_from, 'active');
  update public.app_user
     set status = v_from,
         archived_from_status = null,
         archive_deactivated_practitioner = null
   where id = p_user_id and tenant_id = v_tenant;
  -- Only the row the archive itself made inactive.
  if coalesce(v_deactivated, false) then
    update public.practitioner set status = 'active'
     where user_id = p_user_id and tenant_id = v_tenant and status = 'inactive';
    get diagnostics v_reactivated = row_count;
  end if;

  v_summary := jsonb_build_object(
    'restored', true,
    'status', v_from::text,
    'practitionerReactivated', v_reactivated > 0);
  insert into public.audit_log (
    tenant_id, actor_id, actor_type, actor_role, action, entity_type, entity_id, client_id,
    new_values, reason, request_id
  ) values (
    v_tenant, v_actor, 'user', nullif(current_setting('app.actor_roles', true), ''),
    'staff_restored', 'app_user', p_user_id, null,
    v_summary, nullif(current_setting('app.reason', true), ''),
    nullif(current_setting('app.request_id', true), '')::uuid
  );
  return v_summary;
end
$$;
revoke execute on function app.restore_staff(uuid) from public;
grant execute on function app.restore_staff(uuid) to app_role;

------------------------------------------------------------------------------
-- 3. A practitioner row is not active while its person is archived.
--
--    Before insert or update, for every caller (enabled always): the policy on
--    `practitioner` admits three roles to the whole row, and this is the one
--    column of it that must not move on its own. Security definer so it reads
--    the person whoever is writing.
------------------------------------------------------------------------------
create function app.guard_archived_practitioner() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.status = 'active' and exists (
       select 1 from public.app_user u
        where u.id = new.user_id and u.tenant_id = new.tenant_id and u.status = 'archived') then
    raise exception 'an archived colleague is not an active practitioner; restore them first'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_archived_practitioner() from public;
create trigger guard_archived_practitioner before insert or update on public.practitioner
  for each row execute function app.guard_archived_practitioner();
alter table public.practitioner enable always trigger guard_archived_practitioner;

-- rollback:
--   alter table public.app_user
--     drop constraint if exists app_user_archive_record_only_archived,
--     drop constraint if exists app_user_archive_record_together,
--     drop column if exists archive_deactivated_practitioner,
--     drop column if exists archived_from_status;
--   drop trigger if exists guard_archived_practitioner on public.practitioner;
--   drop function if exists app.guard_archived_practitioner();
--   drop function if exists app.restore_staff(uuid);
--   drop function if exists app.archive_staff(uuid, text);
--   Archived people stay archived: their status is data, and `app.resolve_actor`
--   refuses them with or without these functions.
