-- 202_scheduling_setting.sql
-- The two figures the practice's cancellation policy turns on, in one row per
-- practice: how much notice a family must give, and what a visit costs when
-- the practitioner arrives and it cannot go ahead.
--
-- **Why a table of this stream's own rather than columns on service_type.**
-- docs/SPEC/scheduling-manual.md section 7 lists what this module owns and
-- what it must ask core for: `service_type.min_gap_hours` and
-- `max_sessions_per_week` are named as change requests to core, because
-- spacing genuinely differs between a neurofeedback session and a brain map.
-- A notice period does not. It is one promise the practice makes to every
-- household about every visit (docs/SPEC/billing.md section 4.3, and the
-- operator's decision of 2026-09-03: twenty-four hours), and so is the fee
-- for a wasted journey. Putting either on `service_type` would be six copies
-- of one policy, five of which would eventually disagree; putting them on
-- `tenant` would be a change request against the trunk's own table for a
-- setting only this stream reads. So: a small practice-wide table in this
-- stream's own range, in the shape `vat_setting` (400_billing_catalogue.sql)
-- already uses for the practice's one tax rate.
--
-- **One row, and the practice can never be without it.** `unique (tenant_id)`
-- makes the row singular and `app.default_scheduling_setting()` gives every
-- new practice its own the moment the tenant row exists, exactly as
-- `app.default_vat_setting()` does; the data step at the end covers every
-- practice that existed before this migration ran. `app_role` is granted
-- select and update and never insert or delete, so the row a practice has is
-- the row it keeps: there is no path by which a coordinator can end up with
-- two notice periods, or none.
--
-- **No amendment lineage, deliberately.** `price` and `vat_setting` are
-- versioned because history reads them: an invoice issued in March must still
-- render at March's rate. Nothing reads a notice period after the fact — the
-- rule is applied once, at the moment a visit is called off, and what it
-- decided is then a fact on the appointment row itself (its status, and from
-- migration 203 its `cancellation_reason` and `cancelled_at`). A superseded
-- notice period would be history nothing consults. The audit trail records
-- every change to this row, which is what "who moved it, when, and why"
-- actually needs.
--
-- Needs: 000 (schema app, role app_role, app.set_updated_at,
-- app.current_tenant_id), 010 (tenant), 020 (app_user, for created_by), 080
-- (app.audit_row; this table carries no client_id, so app.audit_client_id —
-- generalised in 097 to look for the column rather than name tables —
-- correctly denormalises null, as it already does for tenant and price).

create table scheduling_setting (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  -- How many hours before the arrival window a visit must be called off for
  -- the client's credit to survive it. Twenty-four is the operator's decision
  -- of 2026-09-03 and docs/SPEC/billing.md section 4.3; the rule that reads
  -- it is domain/scheduling/cancellation.ts, which takes it as an argument
  -- and holds no figure of its own. Zero is a practice that charges for no
  -- cancellation at all, and is allowed; the ceiling is a fortnight, which is
  -- past any notice period a home visit could honestly ask for and well
  -- inside a typo.
  notice_hours    integer not null default 24 check (notice_hours between 0 and 336),
  -- What the practice charges when the practitioner has driven to the door
  -- and the visit cannot go ahead (the operator's decision of 2026-09-03:
  -- AED 150). Integer fils, like every other amount in this schema
  -- (docs/SPEC/00-data-model.md section 1); the ceiling is AED 10,000, which
  -- is more than a single visit has ever cost.
  unfit_fee_fils  integer not null default 15000 check (unfit_fee_fils between 0 and 1000000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  -- One notice period per practice, not one per anything else.
  unique (tenant_id),
  -- The practice-bound key every tenant-scoped table carries
  -- (099_tenant_scoped_keys.sql), so a later row can name this one and the
  -- practice together. Redundant against unique (tenant_id) above and kept
  -- anyway: tests/db/constraints.test.ts asks every such table for it by name.
  unique (tenant_id, id)
);
comment on table public.scheduling_setting is
  'audited: no client - the practice''s notice period and its unfit-to-attend fee';
comment on column public.scheduling_setting.notice_hours is
  'Hours of notice a visit must be called off with for the client''s credit to survive it '
  '(docs/SPEC/billing.md section 4.3). Read by app/api/appointments/cancel.ts and applied by '
  'domain/scheduling/cancellation.ts; nothing in SQL decides it.';
comment on column public.scheduling_setting.unfit_fee_fils is
  'What a visit costs the household when the practitioner arrives and it cannot go ahead, in '
  'integer fils. Recorded here; nothing charges it yet (docs/CHANGE-REQUESTS/scheduling-04.md).';

create index scheduling_setting_created_by_idx on scheduling_setting (created_by);
create trigger set_updated_at before update on scheduling_setting
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.scheduling_setting
  for each row execute function app.audit_row();
alter table public.scheduling_setting enable always trigger audit_row;

-- Every practice has a notice period the moment it exists, so no code path
-- ever has to answer "what if there is no row" with a number of its own.
create function app.default_scheduling_setting() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.scheduling_setting (tenant_id) values (new.id);
  return new;
end
$$;
revoke execute on function app.default_scheduling_setting() from public;

create trigger default_scheduling_setting after insert on public.tenant
  for each row execute function app.default_scheduling_setting();

-- Row security and privileges, in the shape 090_grants_and_rls.sql uses:
-- security on, every default privilege stripped, then exactly what app_role
-- needs. Select and update only — never insert, never delete — so the one row
-- the trigger above created is the one row the practice has, whatever a route
-- or a bug asks for. Who may perform that update is the tenant_isolation and
-- scheduling_setting_write policies in db/policies/scheduling/, which the
-- runner re-applies on every migrate.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.scheduling_setting enable row level security;
  revoke all on public.scheduling_setting from public;
  if has_api_roles then
    revoke all on public.scheduling_setting from anon, authenticated;
  end if;
  grant select, update on public.scheduling_setting to app_role;
end
$$;

-- Data step: every practice that already exists the moment this migration
-- runs gets the same row the trigger now gives every new one. The trigger
-- fires only from here on, so this is what covers a real practice already
-- live on staging, and every worktree's own seeded database.
insert into scheduling_setting (tenant_id) select id from tenant
on conflict (tenant_id) do nothing;

-- rollback:
--   -- The policy file db/policies/scheduling/scheduling_setting_access.sql must be
--   -- deleted first, or the next migrate's policy pass fails creating a policy on a
--   -- table that no longer exists. Its own drops, run ahead of the table drop:
--   drop policy if exists scheduling_setting_write on public.scheduling_setting;
--   drop policy if exists tenant_isolation on public.scheduling_setting;
--   drop trigger if exists default_scheduling_setting on public.tenant;
--   drop function if exists app.default_scheduling_setting();
--   revoke select, update on public.scheduling_setting from app_role;
--   drop table if exists public.scheduling_setting;
