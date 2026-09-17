-- 704_portal_review_prompt.sql
-- A household's answer to the review line (docs/SPEC/client-portal.md
-- sections 3.1 and 6.6; docs/superpowers/specs/2026-09-17-review-prompt-design.md).
--
-- The portal home shows one quiet line after a brain map or a finished
-- package: leave us a review, or not now. Either answer writes one row here,
-- and the line is never shown again for that milestone. The milestone itself
-- is not stored anywhere — `domain/portal/reviewPrompt.ts` reads it off the
-- visits and the credits — so this table is the only state the feature has:
-- which milestones a household has already been asked about.
--
-- **Why a row and not a browser setting.** The portal remembers the language
-- switch in the browser and the practitioner's phone remembers its install
-- note the same way. An answer here is a fact about the household: a line
-- that came back on a second phone would be the nudge the spec forbids.
--
-- **One answer per milestone per client**, whichever adult of the household
-- gave it, by the unique key below. `milestone_id` is the appointment or the
-- purchase and is a plain uuid rather than a foreign key: it names one of two
-- tables, and the answer must outlive neither row.
--
-- **Why `contact_id` beside `created_by`, and why `outcome`.** `created_by`
-- is a sign-in; `contact_id` is the person on the record who answered, which
-- is what the household's own timeline sentence and the office's reading of
-- the trail attribute the answer to (the pattern of 701's `portal_request`),
-- and the policy binds it to the person signed in. `outcome` is kept for one
-- purpose: the narrative sentence says whether the household opened the page
-- or said not now, and nothing else reads it. Both are ids and an enum, and
-- neither leaves this server.
--
-- **Two closed sets as text with a check** rather than enum types, the
-- shape 916's `enquiry` takes: each may gain a word when the owner names a
-- third milestone, and a check is amended in a migration where an enum is
-- extended in a way a rollback cannot undo.
--
-- **Append-only.** An answer is a statement about a moment. No update grant,
-- no delete grant, and no guard trigger because nothing may change.
-- `created_at` is therefore also when the answer was given; there is no
-- second timestamp to disagree with it.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user), 060 (client, contact), 080 (app.audit_row), 097
-- (client_id attribution), 099 (tenant-scoped keys).

create table portal_review_prompt (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  client_id       uuid not null references client (id),
  -- Who answered. A contact of that client, bound to it by the composite key.
  contact_id      uuid not null references contact (id),
  milestone_kind  text not null
    constraint portal_review_prompt_kind_check
    check (milestone_kind in ('brain_map', 'package_complete')),
  -- The appointment (a brain map) or the package purchase (a finished package).
  milestone_id    uuid not null,
  outcome         text not null
    constraint portal_review_prompt_outcome_check
    check (outcome in ('opened', 'dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  unique (tenant_id, id),
  -- Asked once per milestone, whoever in the household answered.
  constraint portal_review_prompt_once_per_milestone
    unique (tenant_id, client_id, milestone_kind, milestone_id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, contact_id) references contact (tenant_id, id)
);
comment on table public.portal_review_prompt is 'audited: client - carries client_id directly';

create index portal_review_prompt_client_idx on portal_review_prompt (client_id, created_at);
create index portal_review_prompt_contact_idx on portal_review_prompt (contact_id);
create index portal_review_prompt_created_by_idx on portal_review_prompt (created_by);

create trigger set_updated_at before update on portal_review_prompt
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.portal_review_prompt
  for each row execute function app.audit_row();
alter table public.portal_review_prompt enable always trigger audit_row;

------------------------------------------------------------------------------
-- Grants. Select and insert; never update, never delete. Which rows, and to
-- whom, is db/policies/portal/access.sql.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.portal_review_prompt enable row level security;
  revoke all on public.portal_review_prompt from public;
  if has_api_roles then
    revoke all on public.portal_review_prompt from anon, authenticated;
  end if;
  grant select, insert on public.portal_review_prompt to app_role;
end
$$;

-- rollback:
--   -- Remove the portal_review_prompt section from db/policies/portal/access.sql
--   -- first, and its entry in that file's tenant-isolation loop, as 700's own
--   -- rollback says: the runner re-applies every policy file on each migrate.
--   drop policy if exists tenant_isolation on public.portal_review_prompt;
--   drop policy if exists portal_review_prompt_readers on public.portal_review_prompt;
--   drop policy if exists portal_review_prompt_writers on public.portal_review_prompt;
--   revoke select, insert on public.portal_review_prompt from app_role;
--   drop trigger if exists audit_row on public.portal_review_prompt;
--   drop table if exists portal_review_prompt;
