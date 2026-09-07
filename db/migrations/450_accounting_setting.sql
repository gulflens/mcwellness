-- 450_accounting_setting.sql
-- The practice's books, in one row per practice: the day the books start, the
-- financial year end, how far the books are locked, the corporate-tax estimate
-- settings and the journal's own counter (docs/SPEC/accounting.md sections 4.4,
-- 4.5 and 8).
--
-- **Why one row and not columns on tenant.** The trunk owns `tenant`, and
-- every figure here belongs to a stream that did not exist when it was
-- written. It is the shape `vat_setting` (400) and `scheduling_setting` (202)
-- already use for a practice-wide setting: `unique (tenant_id)` makes the row
-- singular, an after-insert trigger on `tenant` gives every new practice its
-- own, and the data step at the end covers every practice that already exists.
-- `app_role` is granted select and update and never insert or delete, so the
-- row a practice has is the row it keeps.
--
-- **Why the counter lives here.** `journal_entry.number` is per practice and
-- gapless-by-intent, exactly as an invoice number is, so it is allocated the
-- way 402 allocates one: a security-definer function that takes the row under
-- the update's own lock and hands back the number it consumed. Nothing else
-- may touch the column, which is why `app_role` reads the table but the
-- counter moves only through `app.next_journal_entry_number()`.
--
-- **The tax settings are an estimate's inputs, never a filing.** Section 4.5:
-- the platform files nothing and the adviser decides the election each year.
-- Small Business Relief is elected by default at AED 3,000,000 of revenue, and
-- the rate is 9 percent above AED 375,000; all four are settings because all
-- four are the tax authority's to change and the owner's to follow.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user, for created_by), 080
-- (app.audit_row), 097 (app.audit_client_id looks for the column rather than
-- naming tables; this table deliberately has none).

create table accounting_setting (
  id                                    uuid primary key default gen_random_uuid(),
  tenant_id                             uuid not null references tenant (id),
  -- The first day the books hold anything. The opening entry is dated this day
  -- and no other (rule 9); today, for a practice starting its books now.
  books_start_on                        date not null default current_date,
  -- The financial year end: 31 December unless the owner says otherwise, and
  -- changeable only while the journal is empty (rule 10, enforced by the route
  -- rather than here, because "empty" is a question about another table).
  year_end_month                        smallint not null default 12
                                          check (year_end_month between 1 and 12),
  year_end_day                          smallint not null default 31
                                          check (year_end_day between 1 and 31),
  -- No entry may be dated on or before this day, in an open year or a closed
  -- one (section 4.4: the quarters, once a VAT return is filed). Null until
  -- the owner sets one.
  locked_through                        date,
  corporate_tax_rate_basis_points       integer not null default 900
                                          check (corporate_tax_rate_basis_points between 0 and 10000),
  corporate_tax_threshold_fils          bigint not null default 37500000
                                          check (corporate_tax_threshold_fils >= 0),
  small_business_relief_elected         boolean not null default true,
  small_business_relief_threshold_fils  bigint not null default 300000000
                                          check (small_business_relief_threshold_fils >= 0),
  -- The next journal number this practice will use. Moved only by
  -- app.next_journal_entry_number() below.
  next_entry_number                     integer not null default 1
                                          check (next_entry_number >= 1),
  created_at                            timestamptz not null default now(),
  updated_at                            timestamptz not null default now(),
  created_by                            uuid references app_user (id),
  -- A year end must be a day that exists in every year: 29 February is not one.
  constraint accounting_setting_year_end_is_a_day check (
    year_end_day <= case year_end_month
      when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end),
  unique (tenant_id),
  -- The practice-bound key every tenant-scoped table carries
  -- (099_tenant_scoped_keys.sql); tests/db/constraints.test.ts asks for it by name.
  unique (tenant_id, id)
);
comment on table public.accounting_setting is
  'audited: no client - the practice''s books: start day, year end, lock date, tax estimate settings and the journal counter';
comment on column public.accounting_setting.locked_through is
  'No journal entry may be dated on or before this day (docs/SPEC/accounting.md section 4.4). '
  'Moved forward after each VAT return; moving it back is allowed to the owner with a reason, and audited as such.';
comment on column public.accounting_setting.next_entry_number is
  'The practice''s next journal number. Moved only by app.next_journal_entry_number(); '
  'app_role holds no update path to it that does not go through the guard trigger of 453.';

create index accounting_setting_created_by_idx on accounting_setting (created_by);
create trigger set_updated_at before update on accounting_setting
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.accounting_setting
  for each row execute function app.audit_row();
alter table public.accounting_setting enable always trigger audit_row;

-- The journal's counter, in app.next_invoice_number()'s shape (402): the
-- update takes the row's own lock, so two concurrent posters queue rather than
-- collide, and the number returned is the one this caller consumed.
create function app.next_journal_entry_number() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_number    integer;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a journal number cannot be allocated.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Covers a practice created before this migration ran, and any row the
  -- trigger below could not have fired for.
  insert into public.accounting_setting (tenant_id) values (v_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.accounting_setting
     set next_entry_number = next_entry_number + 1
   where tenant_id = v_tenant_id
  returning next_entry_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_journal_entry_number() from public;
grant execute on function app.next_journal_entry_number() to app_role;

-- Every practice has its books' settings the moment it exists, so no code path
-- ever answers "what if there is no row" with a figure of its own.
create function app.default_accounting_setting() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.accounting_setting (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end
$$;
revoke execute on function app.default_accounting_setting() from public;

create trigger default_accounting_setting after insert on public.tenant
  for each row execute function app.default_accounting_setting();

-- Row security and privileges, in the shape 090_grants_and_rls.sql uses.
-- Select and update only: the row the trigger created is the row the practice
-- has. Who may perform that update is db/policies/accounting/access.sql, which
-- the runner re-applies on every migrate.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.accounting_setting enable row level security;
  revoke all on public.accounting_setting from public;
  if has_api_roles then
    revoke all on public.accounting_setting from anon, authenticated;
  end if;
  grant select, update on public.accounting_setting to app_role;
end
$$;

-- Data step: every practice that already exists gets the row the trigger now
-- gives every new one. tests/db/bootstrap-practice.test.ts scans for this
-- shape, and the trunk's 958 tells app.bootstrap_practice about it.
insert into accounting_setting (tenant_id) select id from tenant
on conflict (tenant_id) do nothing;

-- rollback:
--   -- db/policies/accounting/*.sql must be deleted first, or the next
--   -- migrate's policy pass fails creating a policy on a table that is gone.
--   drop policy if exists books_owner_settings on public.accounting_setting;
--   drop policy if exists books_readers on public.accounting_setting;
--   drop policy if exists tenant_isolation on public.accounting_setting;
--   drop trigger if exists default_accounting_setting on public.tenant;
--   drop function if exists app.default_accounting_setting();
--   drop function if exists app.next_journal_entry_number();
--   revoke select, update on public.accounting_setting from app_role;
--   drop table if exists public.accounting_setting;
