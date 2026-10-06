-- How far a helper reaches: their own few rows, and nothing else in the
-- practice (round 76; docs/SPEC/dispatch.md section 15.12; migrations 974 and
-- 213). Declarative and idempotent: the runner re-applies this file on every
-- migrate, after the migrations, so a table added by any later migration is
-- covered on its first migrate without this file changing.
--
-- **Why a floor across every table.** `helper` is named by no policy and no
-- function, so every rule written as "these roles may" already refuses it. But
-- several tables carry no rule but the practice's own (`tenant_isolation`):
-- the people who sign in, the households' addresses, the catalogue. Those
-- answer anybody signed in to the practice, a helper included, and the
-- operator's word was that a helper sees no client, no visit, no address, no
-- money, no report and no other person's position. So: two restrictive
-- policies on every table in `public`, combined with (never replacing) every
-- other policy on it, which bind a person who holds the helper role and no
-- other — exactly the person `app.name_helper` makes (213: a helper holds no
-- other role). Anybody else is untouched, because the first arm is true.
--
-- What a helper reads (`helper_reach_read`): their own sign-in row and role,
-- their own consent and switch, and whom they accompany. What a helper writes
-- (`helper_reach_write`, for every command): their own consent, switch and
-- positions — whose own rules (db/policies/dispatch/location.sql) still apply
-- on top — and the audit rows a route writes under their own name. Every
-- other table answers a helper no row and takes none.
--
-- tests/dispatch/db/helper-reach.test.ts walks every table in `public` as a
-- helper and holds both the rows and the presence of these two policies.

do $$
declare
  t      text;
  helper constant text :=
    $q$coalesce(current_setting('app.actor_roles', true), '') = 'helper'$q$;
  own_read  text;
  own_write text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    own_read := case t
      when 'app_user' then 'id = app.current_actor_id()'
      when 'user_role' then 'user_id = app.current_actor_id()'
      when 'staff_consent' then 'user_id = app.current_actor_id()'
      when 'location_sharing' then 'user_id = app.current_actor_id()'
      when 'helper_accompaniment' then 'helper_user_id = app.current_actor_id()'
      else 'false'
    end;
    own_write := case t
      when 'staff_consent' then 'user_id = app.current_actor_id()'
      when 'location_sharing' then 'user_id = app.current_actor_id()'
      when 'practitioner_position' then 'user_id = app.current_actor_id()'
      when 'audit_log' then 'actor_id = app.current_actor_id()'
      else 'false'
    end;
    execute format('drop policy if exists helper_reach_read on public.%I', t);
    execute format(
      'create policy helper_reach_read on public.%I as restrictive for select to app_role '
      'using (not (%s) or (%s))', t, helper, own_read);
    execute format('drop policy if exists helper_reach_write on public.%I', t);
    execute format(
      'create policy helper_reach_write on public.%I as restrictive for all to app_role '
      'using (not (%s) or (%s)) with check (not (%s) or (%s))',
      t, helper, own_read, helper, own_write);
  end loop;
end
$$;
