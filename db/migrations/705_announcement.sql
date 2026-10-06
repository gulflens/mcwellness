-- 705_announcement.sql
-- The practice's announcements on the household's home
-- (docs/SPEC/client-portal.md sections 3.1, 5 rule 10 and 6.7; the push
-- memo's decision 4, docs/OPERATOR/2026-09-17-push-notifications.md, answered
-- "as recommended" on 6 October 2026).
--
-- A short block of practice news — the studio is closed for Eid, a new
-- practitioner has joined — written in Settings by the owner or an admin, in
-- English and in Arabic, and read by every adult of every household the next
-- time they open the portal. Nothing is sent to anybody: the practice's own
-- page says something new. So no consent is needed and no vendor is involved.
--
-- **Born published.** A row is written at the moment it is published; there
-- is no draft state. The Settings screen previews what it is about to publish
-- in the browser, and only "Publish" writes. `created_at` is therefore the
-- moment of publication and `created_by` the person who published it, and
-- there is no second timestamp to disagree with either.
--
-- **Never edited in place.** A correction is a new announcement that names
-- the one it replaces (`supersedes_id`), and the old one is withdrawn in the
-- same transaction — unless the correction names a first day still to come:
-- then the old one stays standing and shown until that day, and the read rule
-- (app.announcement_is_current below) hides it from then, so households never
-- see a gap and nothing waits on a job at midnight. The one change a row admits after it is written is its
-- withdrawal — `withdrawn_at` and `withdrawn_by`, set once, together, and
-- never cleared — and app.guard_announcement below refuses every other.
-- There is no delete grant: a withdrawn announcement is still the record of
-- what the practice said to its households, and when.
--
-- **Optional first and last days.** `visible_from` and `visible_until` are
-- the practice's own days (`tenant.timezone`), inclusive, and either may be
-- null: from the day it is published, and until it is withdrawn. An
-- announcement never shows before the day it was published, whatever first
-- day it names. `domain/portal/announcements.ts` (`isCurrentOn`) decides it
-- for the route, and app.announcement_is_current below decides the same for
-- the read policy, so a household's own query cannot reach a row the rule
-- would not show.
--
-- **Who reads it** is db/policies/portal/announcement.sql: the owner and an
-- admin, every row; a household, only the current ones, and never a young
-- person's own login (the memo's decision 3), which
-- app.actor_reads_announcements below decides.
--
-- **`audited: no client`.** An announcement is addressed to every household
-- and names none of them. Its words are the practice's own, not a person's.
--
-- **Both languages are required**, because a household reads the portal in
-- its own language and a block that fell back to the other would be the
-- practice talking past them. The lengths are the domain's
-- (`ANNOUNCEMENT_TITLE_MAX`, `ANNOUNCEMENT_BODY_MAX`), restated here as checks
-- so a row that bypassed the route still cannot be a newsletter.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user), 060 (client, contact), 080 (app.audit_row), 095
-- (app.current_actor_id), 099 (tenant-scoped keys).

create table announcement (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id),
  title_en       text not null
    constraint announcement_title_en_length check (char_length(btrim(title_en)) between 1 and 80),
  title_ar       text not null
    constraint announcement_title_ar_length check (char_length(btrim(title_ar)) between 1 and 80),
  body_en        text not null
    constraint announcement_body_en_length check (char_length(btrim(body_en)) between 1 and 600),
  body_ar        text not null
    constraint announcement_body_ar_length check (char_length(btrim(body_ar)) between 1 and 600),
  -- The practice's own days, inclusive. Null: from publication; until withdrawn.
  visible_from   date,
  visible_until  date,
  -- The announcement this one corrects, which is withdrawn as this is written.
  supersedes_id  uuid,
  withdrawn_at   timestamptz,
  withdrawn_by   uuid references app_user (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_user (id),
  unique (tenant_id, id),
  foreign key (tenant_id, supersedes_id) references announcement (tenant_id, id),
  constraint announcement_window
    check (visible_from is null or visible_until is null or visible_until >= visible_from),
  -- Withdrawn is two facts that arrive together: when, and by whom.
  constraint announcement_withdrawn_together
    check ((withdrawn_at is null) = (withdrawn_by is null)),
  constraint announcement_not_its_own_correction check (supersedes_id <> id)
);
comment on table public.announcement is
  'audited: no client - the practice''s own news on every household''s portal home, '
  'in English and Arabic; addressed to every adult household and naming none.';
comment on column public.announcement.supersedes_id is
  'The announcement this one corrects. A published announcement is never edited: a '
  'correction is a new row naming the old, and the old is withdrawn in the same transaction.';

-- One correction per announcement: a second would leave two rows each claiming
-- to be what the practice meant.
create unique index announcement_one_correction_idx on announcement (tenant_id, supersedes_id)
  where supersedes_id is not null;
create index announcement_tenant_created_idx on announcement (tenant_id, created_at);
create index announcement_created_by_idx on announcement (created_by);
create index announcement_withdrawn_by_idx on announcement (withdrawn_by);

create trigger set_updated_at before update on announcement
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.announcement
  for each row execute function app.audit_row();
alter table public.announcement enable always trigger audit_row;

------------------------------------------------------------------------------
-- 1. app.guard_announcement() — withdrawn, once, and nothing else.
--
--    Compared structurally with to_jsonb, the shape of
--    app.guard_contact_self_service (702), so a column added later is
--    guarded without anyone remembering to name it here. Applies to every
--    caller, the table owner included: no role has a reason to rewrite what
--    the households were told.
------------------------------------------------------------------------------
create function app.guard_announcement() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'announcement % is withdrawn and cannot change', old.id
      using errcode = 'check_violation', hint = 'announcement_withdrawn';
  end if;
  if (to_jsonb(new) - array['withdrawn_at', 'withdrawn_by', 'updated_at'])
     is distinct from (to_jsonb(old) - array['withdrawn_at', 'withdrawn_by', 'updated_at']) then
    raise exception 'a published announcement is never edited; publish a correction'
      using errcode = 'check_violation', hint = 'announcement_published';
  end if;
  return new;
end
$$;

create trigger guard_announcement before update on public.announcement
  for each row execute function app.guard_announcement();

------------------------------------------------------------------------------
-- 2. app.announcement_is_current() — the domain's rule, for the policy.
--
--    Security definer so the read policy may ask the practice's time zone,
--    and whether a correction of this row has begun, without `tenant`'s or
--    this table's own policies being evaluated as part of answering
--    (SQLSTATE 42P17, as 702 explains). Today is the practice's day. The row
--    is current when it is not withdrawn, has been published on or before
--    today, today falls within its first and last days where set, and no
--    standing correction of it has begun — a correction with a first day
--    still to come leaves the row it corrects shown until that day
--    (`correctionTakesOverNow` and `announcementsFor` in
--    domain/portal/announcements.ts).
------------------------------------------------------------------------------
create function app.announcement_is_current(
  p_id uuid,
  p_published_at timestamptz,
  p_withdrawn_at timestamptz,
  p_visible_from date,
  p_visible_until date
) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select p_withdrawn_at is null
     and exists (
       select 1
         from public.tenant t
        cross join lateral (select (now() at time zone t.timezone)::date as today) d
        where t.id = app.current_tenant_id()
          and (p_published_at at time zone t.timezone)::date <= d.today
          and (p_visible_from is null or p_visible_from <= d.today)
          and (p_visible_until is null or p_visible_until >= d.today)
          and not exists (
            select 1
              from public.announcement c
             where c.tenant_id = t.id
               and c.supersedes_id = p_id
               and c.withdrawn_at is null
               and (c.created_at at time zone t.timezone)::date <= d.today
               and (c.visible_from is null or c.visible_from <= d.today)
          )
     )
$$;
revoke execute on function app.announcement_is_current(uuid, timestamptz, timestamptz, date, date)
  from public;
grant execute on function app.announcement_is_current(uuid, timestamptz, timestamptz, date, date)
  to app_role;

------------------------------------------------------------------------------
-- 3. app.actor_reads_announcements() — an adult of some household, and never
--    a young person's own login.
--
--    The domain's announcementsVisibleTo: the person is a contact of at least
--    one client in this practice that has not been erased, and on no record is
--    their contact row `self` on a client under eighteen today in the
--    practice's time zone — app.actor_is_adult_contact_of's own test (702),
--    asked of every record at once, because an announcement is about the
--    person reading and not about one record. Security definer for the reason
--    that function is.
------------------------------------------------------------------------------
create function app.actor_reads_announcements() returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
           select 1
             from public.contact ct
             join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
            where ct.tenant_id = app.current_tenant_id()
              and ct.user_id = app.current_actor_id()
              and cl.status <> 'erased'
         )
     and not exists (
           select 1
             from public.contact ct
             join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
             join public.tenant t on t.id = cl.tenant_id
            where ct.tenant_id = app.current_tenant_id()
              and ct.user_id = app.current_actor_id()
              and ct.relationship = 'self'
              and cl.date_of_birth is not null
              and cl.date_of_birth
                  > ((now() at time zone t.timezone)::date - interval '18 years')::date
         )
$$;
revoke execute on function app.actor_reads_announcements() from public;
grant execute on function app.actor_reads_announcements() to app_role;

------------------------------------------------------------------------------
-- 4. Grants. Select, insert and update (the withdrawal); never delete. Which
--    rows, and to whom, is db/policies/portal/announcement.sql.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.announcement enable row level security;
  revoke all on public.announcement from public;
  if has_api_roles then
    revoke all on public.announcement from anon, authenticated;
  end if;
  grant select, insert, update on public.announcement to app_role;
end
$$;

-- rollback:
--   -- Remove db/policies/portal/announcement.sql from the tree first: the
--   -- runner re-applies every policy file on each migrate, and its policies
--   -- name the table and the two functions dropped below.
--   drop policy if exists tenant_isolation on public.announcement;
--   drop policy if exists announcement_readers on public.announcement;
--   drop policy if exists announcement_writers on public.announcement;
--   drop policy if exists announcement_withdrawers on public.announcement;
--   revoke select, insert, update on public.announcement from app_role;
--   drop trigger if exists guard_announcement on public.announcement;
--   drop trigger if exists audit_row on public.announcement;
--   drop table if exists announcement;
--   drop function if exists app.guard_announcement();
--   drop function if exists app.announcement_is_current(uuid, timestamptz, timestamptz, date, date);
--   drop function if exists app.actor_reads_announcements();
