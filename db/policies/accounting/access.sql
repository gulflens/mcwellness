-- Who may keep the books (docs/SPEC/accounting.md sections 3 and 10). The
-- floor beneath app/api/accounting's own checks, and the same floor:
--
--   owner      reads everything, posts, closes a year, locks a date, changes
--              the settings
--   finance    reads everything and posts; closes nothing, locks nothing,
--              changes nothing
--   everyone else  nothing at all — an admin records a household's money
--              (billing) and does not keep the practice's books; piece twelve
--              admits an admin to expenses and to nothing else
--
-- No policy here mentions a client, because no table here carries one: the
-- books name nobody, so there is no erasure gate to pass through and the owner
-- and finance see the same statement to the fils (section 1).
--
-- Each loop skips a table that does not exist yet (to_regclass), for the same
-- reason tenant_isolation.sql does: the runner applies this file after every
-- migrate, including before 452 and 453 have run.

-- Readers: the owner and finance, on all five.
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounting_setting', 'account', 'fiscal_year', 'journal_entry', 'journal_line'
  ] loop
    continue when to_regclass('public.' || quote_ident(t)) is null;
    execute format('drop policy if exists books_readers on public.%I', t);
    execute format(
      'create policy books_readers on public.%I as restrictive for select to app_role '
      'using (app.actor_has_role(''owner'') or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- Writers: posting an entry, its lines, or adding an account. The owner and
-- finance. A journal row is never updated or deleted by anybody, which the
-- grants of 453 and app.guard_journal_immutable enforce rather than a policy.
do $$
declare
  t text;
begin
  foreach t in array array['journal_entry', 'journal_line', 'account'] loop
    continue when to_regclass('public.' || quote_ident(t)) is null;
    execute format('drop policy if exists books_writers on public.%I', t);
    execute format(
      'create policy books_writers on public.%I as restrictive for insert to app_role '
      'with check (app.actor_has_role(''owner'') or app.actor_has_role(''finance''))', t);
  end loop;
end
$$;

-- Amending an account: renaming one, archiving one. The owner and finance.
do $$
begin
  if to_regclass('public.account') is not null then
    drop policy if exists account_amenders on public.account;
    create policy account_amenders on public.account as restrictive for update to app_role
      using (app.actor_has_role('owner') or app.actor_has_role('finance'))
      with check (app.actor_has_role('owner') or app.actor_has_role('finance'));
  end if;
end
$$;

-- The settings row and the years: the owner alone. Closing a year, reopening
-- one and moving the lock date are the acts finance is deliberately outside of.
do $$
declare
  t text;
begin
  foreach t in array array['accounting_setting', 'fiscal_year'] loop
    continue when to_regclass('public.' || quote_ident(t)) is null;
    execute format('drop policy if exists books_owner_settings on public.%I', t);
    execute format(
      'create policy books_owner_settings on public.%I as restrictive for update to app_role '
      'using (app.actor_has_role(''owner'')) with check (app.actor_has_role(''owner''))', t);
  end loop;
end
$$;
