-- 452_fiscal_year.sql
-- The practice's financial years, and whether each is closed
-- (docs/SPEC/accounting.md section 4.4).
--
-- **A year exists because something was posted into it.** There is no yearly
-- job and no calendar to keep in step: `app.fiscal_year_for(day)` returns the
-- row containing the day and makes it from the settings row's year end when it
-- is absent. So there is never a year with no row, and never a row for a year
-- with nothing in it.
--
-- **Closing is a lock, not a posting.** Retained earnings and the year's result
-- are computed by domain/accounting/statements.ts, so there are no closing
-- entries to write and closing a year does exactly one thing: refuse further
-- entries dated inside it (453's guard). The owner may reopen a year with a
-- reason, which is why both acts carry one and both are audited.
--
-- **Why a trigger rather than an exclusion constraint for the overlap.** An
-- exclusion constraint over a daterange wants btree_gist, which no migration in
-- this schema installs and which is another extension to have to be present on
-- every database (tests/db/extension.test.ts pins the list). Years are made one
-- at a time by one function, so a before-trigger reading the practice's own
-- rows is enough and costs nothing.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user), 080 (app.audit_row),
-- 095 (app.actor_has_role), 097 (app.audit_client_id looks for the column),
-- 100 (app.current_actor_id), 450 (accounting_setting, for the year end).

create type fiscal_year_status as enum ('open', 'closed');

create table fiscal_year (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id),
  starts_on      date not null,
  ends_on        date not null,
  status         fiscal_year_status not null default 'open',
  closed_at      timestamptz,
  closed_by      uuid references app_user (id),
  close_reason   text check (close_reason is null or length(btrim(close_reason)) between 1 and 200),
  reopened_at    timestamptz,
  reopened_by    uuid references app_user (id),
  reopen_reason  text check (reopen_reason is null or length(btrim(reopen_reason)) between 1 and 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_user (id),
  check (ends_on > starts_on),
  constraint fiscal_year_closed_is_dated check (status <> 'closed' or closed_at is not null),
  constraint fiscal_year_close_is_reasoned check ((closed_at is null) = (close_reason is null)),
  constraint fiscal_year_reopen_is_reasoned check ((reopened_at is null) = (reopen_reason is null)),
  unique (tenant_id, starts_on),
  unique (tenant_id, id)
);
comment on table public.fiscal_year is
  'audited: no client - the practice''s financial years and whether each is closed';
comment on column public.fiscal_year.close_reason is
  'Why the year was closed. Closing refuses while any money event dated inside it is unposted '
  '(docs/SPEC/accounting.md rule 11), which the route asks; this column is what the feed reads.';

-- No two of a practice's years may overlap: a day belongs to one year or none.
create function app.guard_fiscal_year_overlap() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (
    select 1 from public.fiscal_year f
     where f.tenant_id = new.tenant_id and f.id <> new.id
       and f.starts_on <= new.ends_on and f.ends_on >= new.starts_on
  ) then
    raise exception 'financial years may not overlap' using errcode = 'exclusion_violation';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_fiscal_year_overlap() from public;
create trigger guard_fiscal_year_overlap
  before insert or update of starts_on, ends_on on public.fiscal_year
  for each row execute function app.guard_fiscal_year_overlap();

-- The row for a day, made on demand from the practice's own year end. Security
-- definer because `app_role` is granted no insert on the table at all: a year
-- is made here or not at all. It asks the caller's role itself, because a
-- definer function that trusts its caller is a hole with a comment on it (952).
create function app.fiscal_year_for(p_on date) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_id        uuid;
  v_month     smallint;
  v_day       smallint;
  v_end       date;
  v_start     date;
begin
  if v_tenant_id is null or p_on is null then
    raise exception 'No practice in context, or no day; a financial year cannot be found.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner') or app.actor_has_role('finance')) then
    raise exception 'the practice''s financial years are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from public.fiscal_year
   where tenant_id = v_tenant_id and p_on between starts_on and ends_on;
  if v_id is not null then
    return v_id;
  end if;
  select year_end_month, year_end_day into v_month, v_day
    from public.accounting_setting where tenant_id = v_tenant_id;
  if v_month is null then
    raise exception 'the practice has no books settings; a financial year cannot be made'
      using errcode = 'foreign_key_violation';
  end if;
  v_end := make_date(extract(year from p_on)::int, v_month, v_day);
  if v_end < p_on then
    v_end := make_date(extract(year from p_on)::int + 1, v_month, v_day);
  end if;
  v_start := make_date(extract(year from v_end)::int - 1, v_month, v_day) + 1;
  insert into public.fiscal_year (tenant_id, starts_on, ends_on, created_by)
    values (v_tenant_id, v_start, v_end, app.current_actor_id())
  on conflict (tenant_id, starts_on) do nothing;
  select id into v_id from public.fiscal_year
   where tenant_id = v_tenant_id and p_on between starts_on and ends_on;
  return v_id;
end
$$;
comment on function app.fiscal_year_for(date) is
  'The practice''s financial year containing the day, made from the books settings'' year end '
  'when it does not exist yet (docs/SPEC/accounting.md section 4.4). Definer because app_role '
  'holds no insert on fiscal_year; checks the caller''s role itself.';
revoke execute on function app.fiscal_year_for(date) from public;
grant execute on function app.fiscal_year_for(date) to app_role;

create index fiscal_year_created_by_idx on fiscal_year (created_by);
create index fiscal_year_tenant_range_idx on fiscal_year (tenant_id, starts_on, ends_on);
create trigger set_updated_at before update on fiscal_year
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.fiscal_year
  for each row execute function app.audit_row();
alter table public.fiscal_year enable always trigger audit_row;

-- Row security and privileges. Select and update: a year is closed and
-- reopened, and never deleted; the insert path is the definer function above.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.fiscal_year enable row level security;
  revoke all on public.fiscal_year from public;
  if has_api_roles then
    revoke all on public.fiscal_year from anon, authenticated;
  end if;
  grant select, update on public.fiscal_year to app_role;
end
$$;

-- rollback:
--   -- db/policies/accounting/*.sql must be deleted first, or the next
--   -- migrate's policy pass fails creating a policy on a table that is gone.
--   drop policy if exists books_owner_settings on public.fiscal_year;
--   drop policy if exists books_readers on public.fiscal_year;
--   drop policy if exists tenant_isolation on public.fiscal_year;
--   revoke select, update on public.fiscal_year from app_role;
--   drop function if exists app.fiscal_year_for(date);
--   drop trigger if exists guard_fiscal_year_overlap on public.fiscal_year;
--   drop function if exists app.guard_fiscal_year_overlap();
--   drop table if exists public.fiscal_year;
--   drop type if exists fiscal_year_status;
