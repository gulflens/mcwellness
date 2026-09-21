-- 922_staff_profile.sql
-- A member of staff's own profile: what app_user does not hold, because
-- app_user is read practice-wide and names appear on every screen
-- (docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md
-- section 6, the operator's decisions of 21 September 2026). Settings ›
-- Team (round 39, 10 September) can add a person, add a role, mint a
-- temporary password and suspend a sign-in; it cannot say who they are
-- beyond a name, or who to call if something happens to them alone in a
-- household's home.
--
-- job_title and started_on; an emergency contact — a third person's name
-- and number, kept for the safety of somebody working alone; and the
-- owners' own private notes. Owners only, for reading and for writing, the
-- person themselves excluded on purpose: a note about somebody that they
-- can read is a different thing from the one the operator asked for. Private
-- on the screen is not private in law — a member of staff has the same
-- right of access and correction as anybody the practice holds data about,
-- and a request from them reaches these notes — but that is the field's own
-- label to say (design section 6), a screen's concern and not this
-- migration's.
--
-- Trunk range, first half (900-949): a new table nothing else yet builds on,
-- so it is free to sit here rather than in the second half
-- (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 010 (tenant), 020 (app_user), 080 (app.audit_row), 090 (app_role)

create table staff_profile (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenant (id),
  user_id                  uuid not null unique references app_user (id),
  job_title                text check (job_title is null or char_length(job_title) between 1 and 120),
  started_on               date,
  emergency_contact_name   text check (emergency_contact_name is null or char_length(emergency_contact_name) between 1 and 120),
  emergency_contact_phone  text check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  private_notes            text check (private_notes is null or char_length(private_notes) <= 4000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references app_user (id),
  -- Every tenant-scoped table's key (099_tenant_scoped_keys.sql), so a later
  -- composite foreign key into this table is possible; its own index leads
  -- with tenant_id, so no separate tenant-only index is added beside it.
  unique (tenant_id, id)
);
create index staff_profile_created_by_idx on staff_profile (created_by);

comment on table public.staff_profile is
  'What the practice keeps about a member of its own staff beyond the sign-in: a job title, a '
  'start date, who to call if something happens to them on a home visit, and the owners'' own '
  'notes. Owners only, the person themselves excluded, because app_user is read practice-wide '
  '(docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md section 6). An '
  'emergency contact is a third person''s data, kept for the safety of somebody working alone.';

create trigger set_updated_at before update on staff_profile
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.staff_profile
  for each row execute function app.audit_row();
alter table public.staff_profile enable always trigger audit_row;

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.staff_profile enable row level security;
  revoke all on public.staff_profile from public;
  if has_api_roles then
    revoke all on public.staff_profile from anon, authenticated;
  end if;
  grant select, insert, update on public.staff_profile to app_role;
end
$$;

-- rollback:
--   drop table if exists public.staff_profile;
