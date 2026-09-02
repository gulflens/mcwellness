-- 000_foundation.sql
-- Extensions, the app helper schema, the API role and the local auth shim.
-- Everything else in the core range (000 to 099) builds on this file.

-- Extensions live in their own schema, as on Supabase, so the public schema holds
-- only tables. The search path is widened so unqualified names keep working on a
-- plain Postgres image too; Supabase already has this setting.
create schema if not exists extensions;
grant usage on schema extensions to public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
do $$
begin
  execute format('alter database %I set search_path to "$user", public, extensions', current_database());
end
$$;
select set_config('search_path', '"$user", public, extensions', false);

-- The API role. It stands in for the API identity until PR 3 decides between
-- Supabase's authenticated role and a server role. Nologin: it is only ever
-- assumed (set role) by a connection that has already authenticated.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_role') then
    create role app_role nologin;
  end if;
end
$$;

-- Let the migrating user assume the role, so tests and later maintenance can
-- prove what the API can and cannot see.
do $$
begin
  execute format('grant app_role to %I', current_user);
end
$$;

-- Helpers live in their own schema so PostgREST never exposes them and the
-- public schema holds only tables.
create schema if not exists app;
grant usage on schema app to app_role;

-- Keeps updated_at honest on every table that has one.
create or replace function app.set_updated_at() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- The tenant the current request acts for. PR 3's middleware sets it with
-- set_config('app.tenant_id', ..., true) next to the audit context; every
-- tenant_isolation policy compares against it. Null when unset, which makes
-- every tenant-scoped row invisible.
create or replace function app.current_tenant_id() returns uuid
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
grant execute on function app.current_tenant_id() to app_role;

-- Local shim for auth.uid(). On Supabase the auth schema and this function
-- already exist and belong to another role, so nothing is touched there.
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create schema if not exists auth;
    execute $f$
      create function auth.uid() returns uuid
      language sql stable
      as $b$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $b$
    $f$;
  end if;
end
$$;

-- rollback:
--   drop function if exists app.current_tenant_id();
--   drop function if exists app.set_updated_at();
--   drop schema if exists app;
--   -- auth.uid() and schema auth: drop only where this file created them (never on Supabase).
--   -- app_role: leave in place; roles are cluster-wide and may be referenced elsewhere.
--   drop extension if exists postgis;
--   drop extension if exists pgcrypto;
--   -- schema extensions and the database search_path: leave in place (Supabase owns them in production).
