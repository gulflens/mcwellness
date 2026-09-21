-- 923_owner_lock_and_role_revoke.sql
-- The owner lock, and the one way a working role is taken away
-- (docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md
-- sections 3 and 4, the operator's decisions of 21 September 2026).
--
-- The practice is to have two owners, and "cannot be revoked by anyone"
-- includes each of them, an admin, and whatever code is written after today.
-- So the lock is the database's rather than a route's: `db/policies/core/
-- role_guard.sql` says the same thing a moment earlier and more politely, but
-- a policy binds `app_role` alone, and a policy is not what somebody reaches
-- for at a psql prompt or from inside a security definer function. The two
-- triggers below bind every caller, the superuser included, because they are
-- `enable always` and carry no bypass setting: a setting the API role could
-- set is not a lock. Undoing this is a migration's act.
--
-- Switching a role OFF is the third thing here. `user_role` has no delete
-- grant for the API role and gains none; `app.revoke_staff_role` is security
-- definer, states every rule in full, and is the only way a row leaves that
-- table.
--
-- **What still holds an owner's row in place that is not written here.**
-- Nothing may delete an owner's `app_user` row either, and no trigger says so:
-- `user_role.user_id` references `app_user (id)` with no `on delete`, so the
-- delete raises a foreign key violation while the ownership row stands — and
-- the ownership row is what `guard_owner_role` refuses to let go. The two facts
-- lean on each other on purpose; neither is worth a third trigger.
--
-- **Where the lock ends**, said plainly rather than left to be discovered: a
-- row trigger does not fire on TRUNCATE, and nothing here stops a caller who
-- can drop or disable the trigger. Both need the TRUNCATE privilege or the
-- table's ownership, which `app_role` holds neither of (090_grants_and_rls.sql
-- grants it select, insert and update and no more), so both are the same act
-- as this migration itself: they belong to whoever migrates the database, and
-- that is exactly where the design puts the undo.
--
-- Two things qualify that, and both are worth saying here rather than being
-- found later.
--
-- The first is the argument above, pointed the other way: `app_user.id` is held
-- in place by `user_role.user_id`'s foreign key for exactly as long as the
-- ownership row stands, and that is the reason nothing deletes an owner's
-- `app_user` row. It is also why the `id` half of section 2's first refusal is
-- defence in depth rather than the only thing standing there: with no
-- `on update cascade`, moving an owner's `id` breaks the reference and is
-- refused for that reason too, and the referencing row cannot be brought along,
-- because `guard_owner_role` will not let an ownership row be updated at all.
-- The arm is written anyway — it costs nothing, it does not depend on some later
-- reader keeping that pair of facts in mind, and the reader of this trigger is
-- exactly the person who needs to be told that an owner's row does not move.
--
-- The second is who "whoever migrates the database" is on the hosted databases,
-- where it is not one person with a psql prompt. Supabase grants its own
-- `service_role` TRUNCATE by default privileges and it bypasses row security,
-- so anything holding the service key is inside that list. This is named and
-- not fixed: it is the shape of every table in this schema rather than
-- something about this one, the service key is the key the migrations
-- themselves are applied with, and a lock that tried to bind the role that
-- installs it would be a lock nobody could install. What it means in practice
-- is that the service key is the practice's most dangerous secret and is read
-- from the host's own secret store and nowhere else (docs/SECURITY.md).
--
-- Needs: 000 (app.current_tenant_id), 020 (app_user, user_role, role_kind),
-- 080 (app.audit_row, which keeps the old values of the row this deletes).
-- Not 095: app.actor_has_role reads a session setting, and the one question
-- this file asks about the caller is answered from user_role instead (section
-- 3 below says why).

------------------------------------------------------------------------------
-- 1. An ownership row does not change.
--
--    Judged on OLD alone: what this protects is a row that already holds
--    ownership, for update and for delete alike. Granting ownership is still
--    an insert, by an audited data step (design section 3), and that is the
--    one act this file deliberately says nothing about.
------------------------------------------------------------------------------
create function app.guard_owner_role() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.role = 'owner' then
    raise exception 'an ownership row does not change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke execute on function app.guard_owner_role() from public;

create trigger guard_owner_role before update or delete on public.user_role
  for each row execute function app.guard_owner_role();
alter table public.user_role enable always trigger guard_owner_role;

------------------------------------------------------------------------------
-- 2. An owner's sign-in stays theirs and stays open.
--
--    Security definer because it must see the role row whoever is asking:
--    under `app_role` the caller's own row security would decide what this
--    trigger can see, and a guard that can be blinded by the caller is not a
--    guard. It reads and never writes.
--
--    Four refusals, and one thing that is not refused: an owner correcting
--    their own name, email address or telephone number, which is the reason
--    the actor is read at all. With no actor stamped — a data step at a psql
--    prompt — v_actor is null and is distinct from every id, so those three
--    columns are refused there too, which is the safe way round.
--
--    The first of the four is the row's own place, and it is first because
--    everything after it depends on it: this trigger asks user_role whether
--    OLD holds ownership, by (user_id, tenant_id). A row whose tenant_id moved
--    would leave its ownership row behind in the practice it came from, so the
--    NEXT update of that row would find no ownership and refuse nothing — the
--    lock would have unlocked itself, and quietly. `id` is named in the same
--    breath for the same reason, and is belt and braces beside the foreign key
--    that already holds it (the header says how). Found by the round's schema
--    review.
------------------------------------------------------------------------------
create function app.guard_owner_identity() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
begin
  if not exists (select 1 from public.user_role r
                  where r.user_id = old.id and r.tenant_id = old.tenant_id and r.role = 'owner') then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
    raise exception 'an owner''s row does not move' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status <> 'active' then
    raise exception 'an owner is not suspended or archived' using errcode = '42501';
  end if;
  -- Linking a sign-in for the first time is how an owner arrives; moving one is not.
  if old.auth_id is not null and new.auth_id is distinct from old.auth_id then
    raise exception 'an owner''s sign-in is not moved' using errcode = '42501';
  end if;
  if (new.display_name is distinct from old.display_name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone)
     and v_actor is distinct from old.id then
    raise exception 'an owner''s details are their own to change' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_owner_identity() from public;

create trigger guard_owner_identity before update on public.app_user
  for each row execute function app.guard_owner_identity();
alter table public.app_user enable always trigger guard_owner_identity;

------------------------------------------------------------------------------
-- 3. The one way a working role is taken away. The API role holds no delete on
--    user_role and gains none. Deleted, not marked: a reader that forgot a
--    revoked_at column would treat a revoked role as live, and a row that is
--    gone fails closed. app.audit_row keeps the old values.
--
--    Security definer, so the rules below are the boundary rather than a
--    courtesy; they are therefore written out in full and never delegated to
--    the caller. The tenant is named on every row this reads and on the row it
--    writes, because row security is not underneath it here, and a null tenant
--    matches nothing: the function fails closed rather than open.
--
--    **Who is an owner is read from user_role, not from app.actor_roles.**
--    Everywhere else in this schema app.actor_has_role is the right question,
--    because it is asked underneath a policy that the API role cannot reach
--    around. Here it would be the whole boundary, and it would be asked of a
--    session setting while the very next line asks a DIFFERENT setting,
--    app.actor_id, who the caller is. Two settings that can disagree are two
--    answers to one question, and this one has to have a single answer: the
--    row that says somebody owns the practice.
------------------------------------------------------------------------------
create function app.revoke_staff_role(p_user_id uuid, p_role public.role_kind) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor  uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant uuid := app.current_tenant_id();
  v_gone   integer;
begin
  -- Unnamed first, because everything below is asked about somebody: with no
  -- actor the owner check would find no row and answer "only an owner", which
  -- is true but not the reason.
  if v_actor is null then
    raise exception 'nobody takes a role away without being named' using errcode = '42501';
  end if;
  -- A null tenant matches no row here either, so an unstamped caller is
  -- refused by this check rather than reaching the practice's rows.
  if not exists (select 1 from public.user_role r
                  where r.user_id = v_actor and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'only an owner takes a role away' using errcode = '42501';
  end if;
  -- `p_role is null` said out loud, because `null not in (...)` is null and not
  -- false: without it every rule below reads as unknown too, the function
  -- reaches its own delete, removes nothing and answers `false` — which is the
  -- same word it uses for "they did not hold that role". A null role is not a
  -- working role, and a caller that sent one should be told so.
  if p_role is null or p_role not in ('admin', 'finance', 'practitioner', 'lead_practitioner') then
    raise exception 'not a working role' using errcode = '42501';
  end if;
  if v_actor = p_user_id then
    raise exception 'nobody changes their own access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_user u where u.id = p_user_id and u.tenant_id = v_tenant) then
    raise exception 'no such colleague' using errcode = '42501';
  end if;
  -- The colleague's own row is locked before the count below is read, and the
  -- lock is what makes that count true at the moment it is acted on. Nothing
  -- in this repository sets an isolation level, so every request runs READ
  -- COMMITTED: without this line two owners taking two DIFFERENT roles from
  -- the same person at the same moment would each read the other's role as
  -- still there, delete different rows, conflict over nothing, and leave that
  -- person with no working role at all — the one state the rule below exists
  -- to prevent, and the one the app cannot undo. Locking the person, rather
  -- than the role rows, serialises every revoke against the same colleague
  -- and leaves revokes against different colleagues concurrent.
  perform 1 from public.app_user u
   where u.id = p_user_id and u.tenant_id = v_tenant
     for update;
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'an owner''s access does not change' using errcode = '42501';
  end if;
  -- A person with no working role falls out of the team list and is refused
  -- everything by canActor's first line, so they could never be found again to
  -- be given one back. Shutting somebody out is what Suspend is for.
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = p_role)
     and not exists (select 1 from public.user_role r
                      where r.user_id = p_user_id and r.tenant_id = v_tenant
                        and r.role in ('admin', 'finance', 'practitioner', 'lead_practitioner')
                        and r.role <> p_role) then
    raise exception 'a person keeps at least one working role' using errcode = '42501';
  end if;
  delete from public.user_role r
   where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = p_role;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end
$$;
revoke execute on function app.revoke_staff_role(uuid, public.role_kind) from public;
grant execute on function app.revoke_staff_role(uuid, public.role_kind) to app_role;

-- rollback:
--   drop function if exists app.revoke_staff_role(uuid, public.role_kind);
--   drop trigger if exists guard_owner_identity on public.app_user;
--   drop function if exists app.guard_owner_identity();
--   drop trigger if exists guard_owner_role on public.user_role;
--   drop function if exists app.guard_owner_role();
