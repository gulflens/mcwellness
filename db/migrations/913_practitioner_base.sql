-- 913_practitioner_base.sql
-- A practitioner records their own home base, and the office records anyone's
-- (docs/SPEC/route-planning.md section 5.4; decision 14, which said the field
-- would only ever be filled by a data step, is overturned by the operator's
-- instruction of 8 September 2026).
--
-- **What was actually missing, checked against the running database rather
-- than assumed.** `app_role` already holds select, insert and update on both
-- `practitioner` and `location` (090_grants_and_rls.sql), so no grant is
-- needed. Three things in the row rules were:
--
--   1. `client_record_writers` on `location` (db/policies/client/writers.sql)
--      is **restrictive** and admits an insert only to an owner, an admin or
--      the lead practitioner. A practitioner creating their own base row was
--      refused outright: SQLSTATE 42501.
--   2. `client_record_update_writers` on the same table admits a practitioner
--      only to a location whose `owner_type` is `'client'`. A practitioner
--      moving their own base updated **no rows at all** — a silent nothing,
--      which is worse than a refusal, because the screen would have said the
--      base was saved.
--   3. `app.guard_location_notes()` (100_client_record.sql) narrows any
--      non-office update of a `location` to `access_notes` alone. Even with
--      the two policies above out of the way, moving the point would raise.
--
-- A restrictive policy can only narrow, never widen, so admitting a
-- practitioner to their own base row through the ordinary path would mean
-- editing the client-record stream's own policy file — a file this round does
-- not own, and one whose subject is a household's address rather than a
-- member of staff's. The act is instead given the shape
-- `app.erase_client()` already has for a write the ordinary policies
-- deliberately refuse: **one security definer function that states the rule,
-- writes exactly the two rows, and nothing else can be persuaded to do**.
-- `app.guard_location_notes()` gains one narrow arm so the function's own
-- update reaches the row, and that arm is unreachable from outside it, since
-- the policies above still refuse a practitioner's direct update.
--
-- The fourth thing was on `practitioner` itself, and it is the one that had
-- nothing in front of it at all: the table carries only the permissive
-- `tenant_isolation` policy, so **every role in the practice — finance and a
-- client contact included — could update every practitioner row**, home base
-- and all. That floor is laid in db/policies/core/practitioner_base.sql,
-- where policies belong (090's own note), together with a narrowing of who
-- may read a practitioner-owned location at all.
--
-- Needs: 000 (schema app, app.current_tenant_id, the extensions schema's
-- PostGIS functions), 030 (location), 050 (practitioner), 095
-- (app.actor_has_role), 100 (app.current_actor_id, app.guard_location_notes).

------------------------------------------------------------------------------
-- 1. The caller's own practitioner row, read directly.
--
--    Security definer for the reason app.client_status_for and
--    app.actor_is_contact_of are (100_client_record.sql): this is consulted
--    from inside a row policy on `location`, and `practitioner`'s own policies
--    must not be the thing that answers it — that cross-reference is what
--    Postgres reports as SQLSTATE 42P17. Narrow and read-only: one id, for
--    the person acting, in their own tenant.
--
--    Null for anybody who is not a practitioner, which is the answer an owner
--    who does not treat should get. Nothing may read null as a match.
------------------------------------------------------------------------------
create function app.own_practitioner_id() returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select id from public.practitioner
   where user_id = app.current_actor_id() and tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.own_practitioner_id() from public;
grant execute on function app.own_practitioner_id() to app_role;

------------------------------------------------------------------------------
-- 2. app.guard_location_notes(), with one arm added.
--
--    The original (100_client_record.sql) lets a non-office actor change
--    `access_notes` on a location and nothing else. A practitioner moving
--    their own base changes `entrance_point` and the `emirate` it sits in,
--    which that comparison refuses.
--
--    The arm is written the same way the original is — structurally, against
--    `to_jsonb` minus the columns that may legitimately change, so a column
--    added to `location` after today is still guarded — and it is as narrow
--    as the rule it serves:
--
--      * the row is a practitioner's base before and after (an update may not
--        turn somebody's home into a household's address, or the reverse);
--      * it is **this** caller's base, by app.own_practitioner_id();
--      * only the point, the emirate and updated_at differ.
--
--    `display_address` and `access_notes` are deliberately not in that list.
--    This is a person's home: the practice keeps the coordinate and nothing
--    else, so a practitioner who tried to write an address on to their own
--    base row would be refused here even though the same actor may write
--    access notes on to a household's location.
--
--    **The office is not refused it, and never was.** The first branch below
--    returns `new` unconditionally for an owner, an admin and the lead
--    practitioner — the shape 100_client_record.sql gave this trigger, which
--    this migration does not change and should not. What stops an address
--    reaching a base row from the office is the route: no route offers the
--    field, and `app/api/clients/locations.ts` scopes every write it does
--    offer to `owner_type = 'client'`. The guard is the practitioner's
--    boundary, not the practice's. (Corrected in the fix round of 2026-09-08
--    on the review of pull request 126, finding 7: the sentence here claimed
--    the refusal held for everyone, and it holds for two thirds of the roles.)
--
--    Nothing outside app.set_practitioner_base() below can reach this arm:
--    db/policies/client/writers.sql still refuses a practitioner's direct
--    update of any location that is not a client's.
------------------------------------------------------------------------------
create or replace function app.guard_location_notes() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner') then
    return new;
  end if;

  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;

  -- A practitioner's own base: the point, the emirate, and nothing else.
  if new.owner_type = 'practitioner' and old.owner_type = 'practitioner'
     and new.owner_id = old.owner_id
     and new.owner_id = app.own_practitioner_id()
     and (to_jsonb(new) - array['entrance_point', 'emirate', 'updated_at'])
         is not distinct from (to_jsonb(old) - array['entrance_point', 'emirate', 'updated_at'])
  then
    return new;
  end if;

  if (to_jsonb(new) - array['access_notes', 'updated_at'])
     is distinct from (to_jsonb(old) - array['access_notes', 'updated_at'])
  then
    raise exception 'only access_notes may be changed here'
      using errcode = 'insufficient_privilege',
            hint    = 'A practitioner may add access notes to a location, and nothing else on it.';
  end if;

  return new;
end
$$;

------------------------------------------------------------------------------
-- 3. app.set_practitioner_base() — the whole act, in one place.
--
--    Creates or moves the practitioner's base and points
--    `practitioner.home_base_location_id` at it, in one transaction, and
--    returns the location id.
--
--    Security definer, so it runs as the tables' owner and is not stopped by
--    the restrictive policies on `location` described at the top of this file.
--    That makes the checks inside it the boundary rather than a courtesy, so
--    they are written out in full and never delegated to the caller:
--
--      * the rule — the office roles for anybody, a practitioner for their
--        own row alone, and no one else. `domain/shared/actor.ts` asks the
--        same question at the edge; this is the answer that binds.
--      * the tenant, on every row it reads and every row it writes. RLS is
--        bypassed here, so `app.current_tenant_id()` is named explicitly and
--        a practitioner from another practice is simply not found.
--
--    **The existing row is moved only when it is this practitioner's own
--    base.** `home_base_location_id` may point at a location that is not one
--    — the synthetic seed points every practitioner at the studio, and a
--    practice may well start that way — and moving *that* row would move the
--    address every invoice is issued from. A base that is not the
--    practitioner's own is left exactly where it is and a new row is created
--    beside it.
--
--    `display_address` and `access_notes` are never written. This is
--    somebody's home; the practice needs the coordinate and nothing else, and
--    a column that is never written cannot be leaked by a screen that forgets
--    to hide it. `makani_number` likewise: a Makani is how a household is
--    found, and a practitioner's base is not somewhere anybody is sent.
--
--    The coordinate this does write reaches the audit trail like every other
--    column, and there it would have stayed for the trail's own five years,
--    with a history of every previous home beside it and no erasure path for a
--    member of staff. Migration 914 drops `entrance_point`, `parking_point` and
--    `community_gate` from what `app.audit_redact` keeps, so the trail says a
--    location changed and stops short of saying where (the review of this pull
--    request, finding 5).
--
--    The audit trail is the row triggers' own (080_audit_triggers.sql): they
--    fire here as they do anywhere, and they read the actor, the roles and
--    the reason off the transaction's settings, which security definer does
--    not change. The route requires `X-Reason` before it calls this.
------------------------------------------------------------------------------
create function app.set_practitioner_base(
  p_practitioner_id uuid,
  p_lng             double precision,
  p_lat             double precision,
  p_emirate         public.emirate
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_own      uuid := app.own_practitioner_id();
  v_existing uuid;
  v_reusable uuid;
  v_new      uuid;
begin
  if v_tenant is null then
    raise exception 'no practice is in scope'
      using errcode = 'insufficient_privilege';
  end if;

  if not (app.actor_has_role('owner') or app.actor_has_role('admin')
          or app.actor_has_role('lead_practitioner')) then
    if not (app.actor_has_role('practitioner') and v_own is not null and v_own = p_practitioner_id) then
      raise exception 'a home base is the practitioner''s own to set'
        using errcode = 'insufficient_privilege',
              hint    = 'A practitioner may set their own base; the owner, an admin '
                        'and the lead practitioner may set anyone''s.';
    end if;
  end if;

  select home_base_location_id into v_existing
    from public.practitioner
   where id = p_practitioner_id and tenant_id = v_tenant
     for update;
  if not found then
    raise exception 'no such practitioner in this practice'
      using errcode = 'no_data_found';
  end if;

  -- Only a row that is already this practitioner's own base is moved; see the
  -- note above about the studio.
  select id into v_reusable
    from public.location
   where id = v_existing and tenant_id = v_tenant
     and owner_type = 'practitioner' and owner_id = p_practitioner_id;

  if v_reusable is not null then
    update public.location
       set entrance_point = extensions.st_setsrid(
             extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
           emirate = p_emirate
     where id = v_reusable;
    return v_reusable;
  end if;

  insert into public.location (
    tenant_id, owner_type, owner_id, label, emirate, entrance_point,
    display_address, access_notes, is_primary, created_by
  ) values (
    v_tenant, 'practitioner', p_practitioner_id, 'base', p_emirate,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    null, null, true, app.current_actor_id()
  ) returning id into v_new;

  update public.practitioner
     set home_base_location_id = v_new
   where id = p_practitioner_id and tenant_id = v_tenant;

  return v_new;
end
$$;
revoke execute on function app.set_practitioner_base(uuid, double precision, double precision, public.emirate) from public;
grant execute on function app.set_practitioner_base(uuid, double precision, double precision, public.emirate) to app_role;

-- rollback:
--   -- **Order matters, and this is the order.** `practitioner_base_is_private`
--   -- (db/policies/core/practitioner_base.sql) holds a hard catalogue
--   -- dependency on app.own_practitioner_id(), so dropping the function first
--   -- raises "cannot drop function ... because other objects depend on it" and
--   -- the rollback stops there. Deleting the policy file from the tree does not
--   -- drop the policy from a database that already has it; the statement does.
--   -- Delete the file as well, in the same step, or the runner re-applies it on
--   -- the next migrate and re-creates the dependency.
--   --
--   -- Run on 2026-09-08 against a database with this migration applied, inside
--   -- a transaction that was then rolled back: in this order the block reaches
--   -- the end and leaves both functions dropped, all three policies gone and
--   -- app.guard_location_notes() back to 100's body. With the function drops
--   -- first it stops at the second statement with SQLSTATE 2BP01, "cannot drop
--   -- function app.own_practitioner_id() because other objects depend on it".
--
--   drop policy if exists practitioner_base_is_private on public.location;
--   drop policy if exists practitioner_row_update_writers on public.practitioner;
--   drop policy if exists practitioner_row_writers on public.practitioner;
--
--   drop function if exists app.set_practitioner_base(uuid, double precision, double precision, public.emirate);
--   drop function if exists app.own_practitioner_id();
--
--   -- app.guard_location_notes() goes back to 100_client_record.sql's body,
--   -- restated here verbatim the way 904 and 908 restate theirs: a rollback
--   -- comment is read when something has already gone wrong, and one that sends
--   -- the reader to another file to reconstruct a function by hand is not there
--   -- when it is needed. It is a create or replace either way, and the trigger
--   -- on public.location is untouched.
--   create or replace function app.guard_location_notes() returns trigger
--   language plpgsql
--   set search_path = pg_catalog, pg_temp
--   as $$
--   begin
--     if app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner') then
--       return new;
--     end if;
--
--     if nullif(current_setting('app.actor_roles', true), '') is null then
--       return new;
--     end if;
--
--     if (to_jsonb(new) - array['access_notes', 'updated_at'])
--        is distinct from (to_jsonb(old) - array['access_notes', 'updated_at'])
--     then
--       raise exception 'only access_notes may be changed here'
--         using errcode = 'insufficient_privilege',
--               hint    = 'A practitioner may add access notes to a location, and nothing else on it.';
--     end if;
--
--     return new;
--   end
--   $$;
--   revoke execute on function app.guard_location_notes() from public;
