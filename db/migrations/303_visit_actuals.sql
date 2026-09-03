-- 303_visit_actuals.sql
-- What the visit actually cost and what the practitioner found when they got
-- there (00-data-model.md section 5; docs/SPEC/session-capture.md section
-- 3.6). One row per completed session, written in the same transaction as the
-- close and never afterwards.
--
-- Money is integer fils, never a float (CLAUDE.md, 00-data-model.md section
-- 1). Salik is recorded as what the practitioner can actually count — the
-- number of gantries crossed — with the cost left null for whatever resolves
-- a tariff later; a practitioner standing in a driveway should not be doing
-- arithmetic, and a tariff that changes must not silently rewrite what a
-- visit cost in March.
--
-- access_issues is free text beside typed fields, not instead of them
-- (CLAUDE.md rule 3): the drive and walk times and the two costs are
-- structured, and this is the sentence about the gate code that no schema
-- would have anticipated. Section 3.6 has it feed location.access_notes as a
-- suggestion for admin approval; the location row belongs to the client-record
-- stream and that hand-off is not built here (see
-- docs/CHANGE-REQUESTS/session-capture-02.md).
--
-- Needs: 010 (tenant), 020 (app_user, for created_by), 060 (client, for the
-- audit trail's own denormalisation), 080 (app.audit_row) and 300 (session).

create table public.visit_actuals (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant (id),
  -- One row per visit, and it belongs to that visit's tenant, not merely to a
  -- session id a caller happens to know.
  session_id            uuid not null,
  -- Denormalised so app.audit_client_id (097) finds it row-local, the same
  -- reason session_event carries one.
  client_id             uuid not null references public.client (id),
  actual_drive_seconds  integer check (actual_drive_seconds >= 0),
  actual_walk_seconds   integer check (actual_walk_seconds >= 0),
  -- What the practitioner can count at the door. The cost of those crossings
  -- is resolved from a tariff elsewhere and stays null until it is.
  salik_crossings       integer not null default 0 check (salik_crossings >= 0),
  salik_cost_fils       integer check (salik_cost_fils >= 0),
  parking_cost_fils     integer not null default 0 check (parking_cost_fils >= 0),
  access_issues         text check (access_issues is null or length(access_issues) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.app_user (id),
  unique (session_id),
  unique (tenant_id, id),
  foreign key (tenant_id, session_id) references public.session (tenant_id, id)
);
comment on table public.visit_actuals is 'audited: client';
create index visit_actuals_tenant_idx on public.visit_actuals (tenant_id);
create index visit_actuals_client_idx on public.visit_actuals (client_id, created_at);
create index visit_actuals_created_by_idx on public.visit_actuals (created_by);
create trigger set_updated_at before update on public.visit_actuals
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.visit_actuals
  for each row execute function app.audit_row();
alter table public.visit_actuals enable always trigger audit_row;

-- Privileges and row security, following 090's pattern for a table it
-- predates, and guarding the Supabase-only revoke exactly as 090 does.
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.visit_actuals enable row level security;
  revoke all on public.visit_actuals from public;
  if has_api_roles then
    revoke all on public.visit_actuals from anon, authenticated;
  end if;
  -- Written once, with the close, and never edited: no update, no delete.
  -- A correction is the session's own amendment path (302), which supersedes
  -- the visit rather than rewriting what was recorded at the door.
  grant select, insert on public.visit_actuals to app_role;
end
$$;

-- rollback:
--   revoke select, insert on public.visit_actuals from app_role;
--   drop trigger if exists audit_row on public.visit_actuals;
--   drop table if exists public.visit_actuals;
