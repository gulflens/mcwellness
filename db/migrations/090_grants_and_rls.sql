-- 090_grants_and_rls.sql
-- Row level security on every core table and the API role's privileges.
-- Policies are not here: they live in db/policies/core and the runner
-- re-applies them on every migrate. RLS is enabled, not forced, so the runner
-- as table owner can migrate and PR 4 can seed.

grant usage on schema public to app_role;
grant usage on schema extensions to app_role;

do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['tenant', 'app_user', 'user_role', 'location', 'service_type',
                           'practitioner', 'credential', 'client', 'contact', 'consent',
                           'document'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      -- Supabase: default privileges grant every new table in public to these roles.
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
    -- No delete anywhere: PHI is never deleted, it is superseded or locked.
    execute format('grant select, insert, update on public.%I to app_role', t);
  end loop;

  -- The runner's bookkeeping table is nobody's business but the owner's.
  execute 'revoke all on public.schema_migration from public';
  if has_api_roles then
    execute 'revoke all on public.schema_migration from anon, authenticated';
  end if;
end
$$;

-- rollback:
--   revoke select, insert, update on all tables in schema public from app_role;
--   revoke usage on schema public, extensions from app_role;
--   -- RLS stays enabled: disabling it is never a rollback step.
