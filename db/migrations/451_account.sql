-- 451_account.sql
-- The chart of accounts: a per-practice list of the accounts every journal
-- line names, created by trigger the moment a practice exists and by a data
-- step for every practice that already does (docs/SPEC/accounting.md section
-- 4.1).
--
-- **Why a role and not a code in the code.** The poster and the statements
-- must find "the bank account", "the account sessions owed sit in", "where VAT
-- payable goes". Naming them by code would put a constant in TypeScript that
-- the owner could rename or renumber underneath it; naming them by role puts
-- the question in the database, where `unique (tenant_id, role)` makes the
-- answer singular and `app.default_chart_rows()` sets it once. An account the
-- owner adds has no role at all, which is why the column is nullable
-- (rule 6, domain/accounting/journal.ts's accountByRole).
--
-- **Why the code's first digit is a check constraint.** An accountant reads a
-- chart by its ranges: 1 asset, 2 liability, 3 equity, 4 income, 5 or 6
-- expense. Rule 7 states it, domain/accounting/journal.ts refuses it before
-- the request arrives, and the constraint here is the floor under both.
--
-- **Nothing deletes an account.** An account with a role or a balance is not
-- even archived (rule 8, asked by the route because a balance is a question
-- about journal_line); an account that is archived carries the reason it was.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user, for created_by), 080
-- (app.audit_row), 097 (app.audit_client_id looks for the column; this table
-- deliberately has none).

create type account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type account_role as enum (
  'bank', 'cash', 'link_clearing', 'receivable', 'refunds_payable', 'contract_liability',
  'vat_payable', 'opening_balance', 'income_sessions', 'income_assessments', 'income_fees',
  'income_expired'
);
comment on type account_role is
  'The accounts the poster and the statements must find by name rather than by code '
  '(docs/SPEC/accounting.md section 4.1). Later pieces add values with alter type ... add value '
  'in their own migrations: payables and vat_receivable in twelve, the pay and distribution roles in fourteen.';

create table account (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  code            text not null check (code ~ '^[1-6][0-9]{3}$'),
  name            text not null check (length(btrim(name)) between 1 and 80),
  name_ar         text check (name_ar is null or length(btrim(name_ar)) between 1 and 80),
  type            account_type not null,
  role            account_role,
  archived_at     timestamptz,
  archive_reason  text check (archive_reason is null or length(btrim(archive_reason)) between 1 and 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  constraint account_code_matches_type check (
    case type
      when 'asset' then left(code, 1) = '1'
      when 'liability' then left(code, 1) = '2'
      when 'equity' then left(code, 1) = '3'
      when 'income' then left(code, 1) = '4'
      else left(code, 1) in ('5', '6')
    end),
  constraint account_archive_is_reasoned check ((archived_at is null) = (archive_reason is null)),
  constraint account_with_a_role_stays check (role is null or archived_at is null),
  unique (tenant_id, code),
  unique (tenant_id, role),
  unique (tenant_id, id)
);
comment on table public.account is 'audited: no client - the practice''s chart of accounts';
comment on column public.account.role is
  'What the poster and the statements find this account by, when they must find it at all '
  '(docs/SPEC/accounting.md rule 6). Unique per practice; null on an account the owner added.';

-- The default chart, written once and used twice: by the trigger for every new
-- practice and by the data step for every practice that already exists.
-- The body's search_path is pg_catalog, pg_temp, as every function in this
-- schema sets it, so the two enums are named with their schema: unqualified,
-- they would not resolve at all from inside here.
create function app.default_chart_rows()
returns table (code text, name text, type public.account_type, role public.account_role)
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  values
    ('1010', 'Bank, operating',                   'asset'::public.account_type,     'bank'::public.account_role),
    ('1020', 'Cash box',                          'asset',                   'cash'),
    ('1030', 'Payment link clearing',             'asset',                   'link_clearing'),
    ('1200', 'Accounts receivable',               'asset',                   'receivable'),
    ('1500', 'Equipment, at cost',                'asset',                   null),
    ('2100', 'Refunds payable',                   'liability',               'refunds_payable'),
    ('2400', 'Contract liability, sessions owed', 'liability',               'contract_liability'),
    ('2500', 'VAT payable',                       'liability',               'vat_payable'),
    ('3000', 'Share capital',                     'equity',                  null),
    ('3100', 'Opening balance equity',            'equity',                  'opening_balance'),
    ('4000', 'Session income',                    'income',                  'income_sessions'),
    ('4100', 'Brain map income',                  'income',                  'income_assessments'),
    ('4300', 'Call-out fee income',               'income',                  'income_fees'),
    ('4400', 'Income from expired credits',       'income',                  'income_expired'),
    ('6000', 'General expenses',                  'expense',                 null),
    ('6200', 'Bank and payment fees',             'expense',                 null)
$$;
revoke execute on function app.default_chart_rows() from public;

create function app.default_chart_of_accounts() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.account (tenant_id, code, name, type, role)
    select new.id, r.code, r.name, r.type, r.role from app.default_chart_rows() r
  on conflict (tenant_id, code) do nothing;
  return new;
end
$$;
revoke execute on function app.default_chart_of_accounts() from public;

create trigger default_chart_of_accounts after insert on public.tenant
  for each row execute function app.default_chart_of_accounts();

create index account_created_by_idx on account (created_by);
create index account_tenant_type_idx on account (tenant_id, type);
create trigger set_updated_at before update on account
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.account
  for each row execute function app.audit_row();
alter table public.account enable always trigger audit_row;

-- Row security and privileges. Select, insert and update: an account is added
-- and renamed and archived, and never deleted. Who may do each is
-- db/policies/accounting/access.sql.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.account enable row level security;
  revoke all on public.account from public;
  if has_api_roles then
    revoke all on public.account from anon, authenticated;
  end if;
  grant select, insert, update on public.account to app_role;
end
$$;

-- Data step: every practice that already exists gets the chart the trigger now
-- gives every new one. tests/db/bootstrap-practice.test.ts scans for the
-- "from tenant" shape, and the trunk's 958 tells app.bootstrap_practice about it.
insert into account (tenant_id, code, name, type, role)
  select t.id, r.code, r.name, r.type, r.role
    from tenant t cross join app.default_chart_rows() r
on conflict (tenant_id, code) do nothing;

-- rollback:
--   -- db/policies/accounting/*.sql must be deleted first, or the next
--   -- migrate's policy pass fails creating a policy on a table that is gone.
--   drop policy if exists account_amenders on public.account;
--   drop policy if exists books_writers on public.account;
--   drop policy if exists books_readers on public.account;
--   drop policy if exists tenant_isolation on public.account;
--   drop trigger if exists default_chart_of_accounts on public.tenant;
--   drop function if exists app.default_chart_of_accounts();
--   drop function if exists app.default_chart_rows();
--   revoke select, insert, update on public.account from app_role;
--   drop table if exists public.account;
--   drop type if exists account_role;
--   drop type if exists account_type;
