-- 453_journal.sql
-- The general journal: one balanced, append-only entry per movement of money,
-- and the four guards that make "append-only" and "balanced" true of every
-- connection rather than of every route (docs/SPEC/accounting.md section 4.2,
-- rules 1, 2, 3 and 9).
--
-- **Written once, for everybody.** `app_role` is granted select and insert and
-- nothing else, and `app.guard_journal_immutable` refuses an update or a delete
-- for every role including the database owner's -- so a fix to the schema
-- cannot quietly become a fix to the books. A mistake is corrected by a
-- reversing entry that names the one it reverses and says why, and both stay
-- (CLAUDE.md rule 7 applied to the books).
--
-- **Idempotency is a constraint, not a check-then-insert.** An automatic entry
-- carries the billing table, the row's id and the event it came from, and those
-- three with the practice are unique. The poster inserts with
-- `on conflict do nothing` and writes lines only when the header was written,
-- so running it twice adds nothing however many run at once.
--
-- **Balance is checked at commit, not at insert.** An entry and its lines are
-- written in one transaction and neither is complete without the other, so a
-- deferred constraint trigger on both tables is the only place the question
-- "do the debits equal the credits" has a true answer.
--
-- **The books name nobody.** There is no client_id here and there never will
-- be: a journal line carries an amount, a day, an account and the id of the
-- billing row it came from. The memo is fixed words the poster chooses
-- (domain/accounting/posting.ts), never an invoice number or a household.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user), 080 (app.audit_row),
-- 095 (app.actor_has_role), 097 (app.audit_client_id looks for the column),
-- 450 (accounting_setting, app.next_journal_entry_number), 451 (account),
-- 452 (fiscal_year).

create type journal_kind as enum ('opening', 'automatic', 'manual', 'reversal');

create table journal_entry (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id),
  number             integer not null check (number >= 1),
  reference          text generated always as ('JE-' || lpad(number::text, 6, '0')) stored,
  entered_on         date not null,
  -- Set only when the event happened on a day the books could not take
  -- (a closed year, or on or before the lock date): rule 4's true day.
  occurred_on        date,
  fiscal_year_id     uuid not null,
  kind               journal_kind not null,
  memo               text not null check (length(btrim(memo)) between 1 and 200),
  source_table       text check (source_table in ('invoice', 'payment', 'entitlement')),
  source_id          uuid,
  source_event       text check (source_event ~ '^[a-z_]+\.[a-z_]+$'),
  reverses_entry_id  uuid,
  reversal_reason    text check (reversal_reason is null or length(btrim(reversal_reason)) between 1 and 200),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references app_user (id),
  constraint journal_entry_source_is_whole check (
    (source_table is null) = (source_id is null) and (source_table is null) = (source_event is null)),
  constraint journal_entry_automatic_has_source check ((kind = 'automatic') = (source_table is not null)),
  constraint journal_entry_reversal_is_reasoned check (
    (kind = 'reversal') = (reverses_entry_id is not null)
    and (reverses_entry_id is null) = (reversal_reason is null)),
  constraint journal_entry_occurred_differs check (occurred_on is null or occurred_on <> entered_on),
  unique (tenant_id, number),
  unique (tenant_id, source_table, source_id, source_event),
  unique (tenant_id, reverses_entry_id),
  unique (tenant_id, id),
  foreign key (tenant_id, fiscal_year_id) references fiscal_year (tenant_id, id),
  foreign key (tenant_id, reverses_entry_id) references journal_entry (tenant_id, id)
);
comment on table public.journal_entry is
  'audited: no client - the general journal: one balanced, append-only entry per money event; names no household';
comment on column public.journal_entry.occurred_on is
  'The day the event really happened, when the books could not take it then (a closed year, or on '
  'or before the lock date) and it landed later instead (docs/SPEC/accounting.md rule 4).';

create table journal_line (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  entry_id     uuid not null,
  line_no      integer not null check (line_no >= 1),
  account_id   uuid not null,
  debit_fils   bigint not null default 0 check (debit_fils >= 0),
  credit_fils  bigint not null default 0 check (credit_fils >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  constraint journal_line_has_one_side check ((debit_fils > 0) <> (credit_fils > 0)),
  unique (tenant_id, entry_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id) references journal_entry (tenant_id, id),
  foreign key (tenant_id, account_id) references account (tenant_id, id)
);
comment on table public.journal_line is 'audited: no client - one side of one journal entry';

-- Before an entry is written: the year is the practice's, open, and contains
-- the day; the day is after the lock; an opening entry is dated the books'
-- start; and the number is taken from the counter when none was given. A
-- before-insert trigger runs ahead of the not-null check on `number`, which is
-- what lets the column stay not null while the caller never sets it.
-- Security definer, in app.fiscal_year_for's pattern (452): the guard must read
-- the practice's own year and settings to judge the day, whoever is inserting,
-- and a reader who may not see those rows must still be refused by the row
-- policy rather than by a guard that could not find them. It reads only rows of
-- new.tenant_id and returns nothing, so it hands nothing back to its caller.
create function app.guard_journal_entry() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_year     public.fiscal_year%rowtype;
  v_setting  public.accounting_setting%rowtype;
begin
  select * into v_year from public.fiscal_year
   where id = new.fiscal_year_id and tenant_id = new.tenant_id;
  if v_year.id is null then
    raise exception 'the entry names a financial year the practice does not have'
      using errcode = 'foreign_key_violation';
  end if;
  if new.entered_on < v_year.starts_on or new.entered_on > v_year.ends_on then
    raise exception 'the entry''s day is outside its financial year' using errcode = 'check_violation';
  end if;
  if v_year.status = 'closed' then
    raise exception 'the financial year is closed; the books take no entry dated inside it'
      using errcode = 'check_violation';
  end if;
  select * into v_setting from public.accounting_setting where tenant_id = new.tenant_id;
  if v_setting.locked_through is not null and new.entered_on <= v_setting.locked_through then
    raise exception 'the books are locked through %; the entry''s day is not open',
      v_setting.locked_through using errcode = 'check_violation';
  end if;
  if new.kind = 'opening' and new.entered_on <> v_setting.books_start_on then
    raise exception 'an opening entry is dated the books'' start day, %',
      v_setting.books_start_on using errcode = 'check_violation';
  end if;
  if new.number is null then
    new.number := app.next_journal_entry_number();
  end if;
  return new;
end
$$;
revoke execute on function app.guard_journal_entry() from public;
-- Named to sort first: a before trigger's order is alphabetical, and this one
-- fills the number every other check reads.
create trigger aa_guard_journal_entry before insert on public.journal_entry
  for each row execute function app.guard_journal_entry();

-- A journal row is never edited and never deleted, by anybody.
create function app.guard_journal_immutable() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'a journal entry is never edited or deleted; post a reversing entry'
    using errcode = 'insufficient_privilege';
end
$$;
revoke execute on function app.guard_journal_immutable() from public;
create trigger guard_journal_immutable before update or delete on public.journal_entry
  for each row execute function app.guard_journal_immutable();
create trigger guard_journal_immutable before update or delete on public.journal_line
  for each row execute function app.guard_journal_immutable();
alter table public.journal_entry enable always trigger guard_journal_immutable;
alter table public.journal_line enable always trigger guard_journal_immutable;

-- At commit: at least two lines, debits equal credits, and every line's account
-- belongs to the entry's practice and is not archived.
create function app.check_journal_balanced() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  -- One function for both tables, so `new` is read through jsonb: plpgsql
  -- resolves a record's fields when it compiles the function, not when it runs
  -- the branch, so `new.entry_id` would not compile against journal_entry.
  v_row      jsonb   := to_jsonb(new);
  v_entry_id uuid    := coalesce(v_row ->> 'entry_id', v_row ->> 'id')::uuid;
  v_lines    integer;
  v_debit    bigint;
  v_credit   bigint;
begin
  select count(*), coalesce(sum(l.debit_fils), 0), coalesce(sum(l.credit_fils), 0)
    into v_lines, v_debit, v_credit
    from public.journal_line l where l.entry_id = v_entry_id;
  if v_lines < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = 'check_violation';
  end if;
  if v_debit <> v_credit then
    raise exception 'the entry does not balance: debits % against credits %', v_debit, v_credit
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.journal_line l join public.account a on a.id = l.account_id
     where l.entry_id = v_entry_id and a.archived_at is not null
  ) then
    raise exception 'an archived account takes no new line' using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke execute on function app.check_journal_balanced() from public;
create constraint trigger check_journal_balanced after insert on public.journal_entry
  deferrable initially deferred for each row execute function app.check_journal_balanced();
create constraint trigger check_journal_balanced after insert on public.journal_line
  deferrable initially deferred for each row execute function app.check_journal_balanced();

create index journal_entry_tenant_day_idx on journal_entry (tenant_id, entered_on);
create index journal_entry_tenant_year_idx on journal_entry (tenant_id, fiscal_year_id);
create index journal_entry_created_by_idx on journal_entry (created_by);
create index journal_entry_reverses_idx on journal_entry (reverses_entry_id);
create index journal_line_tenant_account_idx on journal_line (tenant_id, account_id);
create index journal_line_entry_idx on journal_line (entry_id);
create index journal_line_created_by_idx on journal_line (created_by);

-- Both tables carry updated_at and the set_updated_at trigger like every table
-- in this schema, even though the immutable guard means the column never moves
-- (docs/CHANGE-REQUESTS/accounting-01.md item 9: an exemption would be a second
-- rule to keep in step for no gain).
create trigger set_updated_at before update on journal_entry
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on journal_line
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.journal_entry
  for each row execute function app.audit_row();
alter table public.journal_entry enable always trigger audit_row;
create trigger audit_row after insert or update or delete on public.journal_line
  for each row execute function app.audit_row();
alter table public.journal_line enable always trigger audit_row;

do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['journal_entry', 'journal_line'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
    execute format('grant select, insert on public.%I to app_role', t);
  end loop;
end
$$;

-- rollback:
--   -- db/policies/accounting/*.sql must be deleted first, or the next
--   -- migrate's policy pass fails creating a policy on a table that is gone.
--   drop policy if exists books_writers on public.journal_line;
--   drop policy if exists books_readers on public.journal_line;
--   drop policy if exists tenant_isolation on public.journal_line;
--   drop policy if exists books_writers on public.journal_entry;
--   drop policy if exists books_readers on public.journal_entry;
--   drop policy if exists tenant_isolation on public.journal_entry;
--   revoke select, insert on public.journal_line from app_role;
--   revoke select, insert on public.journal_entry from app_role;
--   drop table if exists public.journal_line;
--   drop table if exists public.journal_entry;
--   drop function if exists app.check_journal_balanced();
--   drop function if exists app.guard_journal_immutable();
--   drop function if exists app.guard_journal_entry();
--   drop type if exists journal_kind;
