-- 096_api_role.sql
-- The login role the API connects as. It owns nothing, bypasses nothing and
-- inherits nothing: every request runs "set local role app_role" inside its
-- transaction, and a request that forgets to fails on its first query instead
-- of running unfenced. The role is created without a password, so it cannot
-- authenticate until one is set out of band: locally by the runner from
-- API_DATABASE_URL, on Supabase once by the owner in the SQL editor. No
-- password ever appears in a migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mcwellness_api') then
    create role mcwellness_api login noinherit nobypassrls;
  end if;
end
$$;

-- Unconditional, so a role created by hand with other attributes is corrected.
alter role mcwellness_api login noinherit nobypassrls;
grant app_role to mcwellness_api;

-- Role-level settings apply when a pooled backend starts for this role, so they
-- hold under transaction pooling too.
alter role mcwellness_api set search_path = public, extensions;
alter role mcwellness_api set statement_timeout = '10s';
alter role mcwellness_api set lock_timeout = '5s';
alter role mcwellness_api set idle_in_transaction_session_timeout = '30s';

-- rollback:
--   revoke app_role from mcwellness_api;
--   alter role mcwellness_api nologin;          -- it keeps whatever password was set out of band
--   alter role mcwellness_api reset all;        -- the search_path and timeouts above
--   -- The role itself is cluster-wide; drop it only when no database still references it:
--   -- drop role if exists mcwellness_api;
