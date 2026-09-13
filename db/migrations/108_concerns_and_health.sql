-- 108_concerns_and_health.sql
-- What a household is worried about, and the six things the agreement asks
-- them to tell the practice before the first session.
--
-- **Why.** `docs/SPEC/client-record.md` section 4.2 has always said the record
-- holds "the client's goals **and concerns**", and nothing has ever held a
-- concern: it went into `goal.description`, 2,000 characters of free text
-- beside a category chosen from a list of goals. And `docs/CONSENT/agreement.en.md`
-- asks every household, in the wording they sign, to tell the practice about
-- epilepsy or any seizure, a pacemaker or any implanted electrical device, a
-- head injury at any time, pregnancy, medication that affects mood, sleep or
-- attention, and a skin condition or sensitivity on the scalp. **Nothing stored
-- the answers.** They were told to somebody and remembered by that person.
--
-- **Why a concern is not a goal with a flag on it.** `goal` is read by
-- `app/api/reports/gather.ts` and printed into progress reports, which are
-- signed documents a household reads: a concern that leaked into that table
-- would appear in somebody's report as a goal they never set. A separate table
-- costs one more route and removes a whole class of that mistake. Its status is
-- its own for the same reason — a concern is 'open' or 'resolved', never
-- "achieved", which is a word for goals and reads badly about a worry.
--
-- **Why the health answers are a table of rows and not columns on the client.**
-- The agreement says "before the first session, **and if it changes**", so the
-- answers have a history: what was true in September is not an edit to what was
-- true in March. Each asking is a row, the newest is current, and nothing is
-- updated in place (CLAUDE.md rule 7's principle, applied where the rule does
-- not name the table). No update is granted at all.
--
-- **The operator's three decisions, 2026-09-14.** Who may read them: whoever
-- may open the client's record — the owner, an admin, the lead practitioner and
-- a practitioner for a client on their own schedule; not finance, who books and
-- takes money. What a "yes" does: it shows on the record and on the
-- practitioner's own card for that visit, so it is seen at the door; it blocks
-- nothing. When they are asked: at enrolment, and editable on the record
-- whenever the household says something has changed.
--
-- **This is a wellness practice and these are not diagnoses** (CLAUDE.md rule
-- 1). The columns record what a household chose to tell the practice, in the
-- agreement's own words, so the person at the door is not surprised. Nothing
-- here is assessed, scored or interpreted.
--
-- Needs: 060 (client, app_user), 097 (app.audit_row), 100 (goal_category).
--
-- The erasure step is not here — see section 5 — and neither is the audit
-- redaction of the six answers, which is 965's; 108 creates two tables and
-- redefines no function.

------------------------------------------------------------------------------
-- 1. concern — what the household is worried about, in the same shape a goal
--    has: a category from the owner-editable list, free text beside it.
------------------------------------------------------------------------------
create type concern_status as enum ('open', 'resolved');

create table concern (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  client_id    uuid not null references client (id),
  category_id  uuid not null references goal_category (id),
  description  text not null,          -- free text beside the typed category, never instead of it
  noted_at     timestamptz not null default now(),
  status       concern_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  -- A ceiling and no floor, exactly as `goal.description` has none. The
  -- erasure empties this column rather than deleting the row (964), so a floor
  -- here would make an erased concern unrepresentable and the erasure would
  -- fail on a check constraint — which is how this was found, in
  -- tests/client/db/concerns_and_health.test.ts, before it could reach anyone.
  -- "Not blank" belongs where a person types it: the route refuses empty text
  -- (app/api/clients/concerns.ts), which is where goal's own rule lives too.
  constraint concern_description_is_short check (length(description) <= 2000),
  -- Every tenant-scoped table carries this, so a foreign key from another
  -- table can be scoped to the tenant as well (099_tenant_scoped_keys.sql,
  -- held by tests/db/constraints.test.ts).
  constraint concern_tenant_id_id_key unique (tenant_id, id)
);
create index concern_tenant_idx on concern (tenant_id);
create index concern_client_idx on concern (client_id, noted_at desc);
create index concern_category_idx on concern (category_id);
create index concern_created_by_idx on concern (created_by);
create trigger set_updated_at before update on concern
  for each row execute function app.set_updated_at();

------------------------------------------------------------------------------
-- 2. health_declaration — the agreement's six questions, as answered on one day.
--
--    **The name.** The consent that covers these calls them "the health
--    answers you gave us" (docs/CONSENT/health-data.en.md), and a row is one
--    declaration of the six, made on one day. It was `health_screening` for a
--    draft, and the review of pull request 177 refused the word: screening is
--    an act of assessing somebody's health, which is a clinical act, and the
--    comment above says in so many words that nothing here is assessed. A
--    regulator reading the schema should find a practice recording what it was
--    told, not one running screenings. Renamed before merge, when a rename is
--    a word; after it, it is a migration.
--
--    One row per asking. The newest row for a client is the current answer;
--    the older ones are what was true before, which is why nothing here is
--    updated. `wording_version` records which version of the agreement asked,
--    so an answer is readable against the words the household actually signed
--    (docs/CONSENT/agreement.en.md, versioned in consent_wording).
------------------------------------------------------------------------------
create table health_declaration (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant (id),
  client_id             uuid not null references client (id),
  asked_at              timestamptz not null default now(),
  wording_version       text,
  -- The six, in the agreement's own order and its own words.
  seizures              boolean not null,   -- epilepsy or any seizure
  seizures_note         text,
  implanted_device      boolean not null,   -- a pacemaker or any implanted electrical device
  implanted_device_note text,
  head_injury           boolean not null,   -- a head injury at any time
  head_injury_note      text,
  pregnancy             boolean not null,
  pregnancy_note        text,
  medication            boolean not null,   -- medication that affects mood, sleep or attention
  medication_note       text,
  scalp                 boolean not null,   -- a skin condition or sensitivity on the scalp
  scalp_note            text,
  created_at            timestamptz not null default now(),
  -- Present because .claude/rules/data-model.md asks every table for it and
  -- lists what is exempt, ending "nothing else is exempt". No update is granted
  -- on this table, so it never moves from created_at; the column is here so
  -- there is no exemption to record and nothing for a later grant to add.
  updated_at            timestamptz not null default now(),
  created_by            uuid references app_user (id),
  constraint health_declaration_notes_are_short check (
    coalesce(length(seizures_note), 0) <= 500
    and coalesce(length(implanted_device_note), 0) <= 500
    and coalesce(length(head_injury_note), 0) <= 500
    and coalesce(length(pregnancy_note), 0) <= 500
    and coalesce(length(medication_note), 0) <= 500
    and coalesce(length(scalp_note), 0) <= 500
  ),
  constraint health_declaration_tenant_id_id_key unique (tenant_id, id)
);
create index health_declaration_tenant_idx on health_declaration (tenant_id);
create index health_declaration_client_idx on health_declaration (client_id, asked_at desc);
create index health_declaration_created_by_idx on health_declaration (created_by);
create trigger set_updated_at before update on health_declaration
  for each row execute function app.set_updated_at();

comment on table public.health_declaration is
  'audited: client - carries client_id directly. What a household told the practice about their health, in the signed agreement''s own words; one row per asking, the newest current. Never assessed, scored or interpreted (CLAUDE.md rule 1). The six answers and their notes are dropped from the audit trail by app.audit_redact (965).';
comment on column public.health_declaration.wording_version is
  'Which version of the signed agreement asked these questions, so an answer is read against the words the household signed.';

------------------------------------------------------------------------------
-- 3. RLS, grants and revokes, matching 090_grants_and_rls.sql for tables it
--    does not know about. **No update on health_declaration**: a change is a new
--    row, and there is no case for editing what somebody said in March.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.concern enable row level security;
  revoke all on public.concern from public;
  alter table public.health_declaration enable row level security;
  revoke all on public.health_declaration from public;
  if has_api_roles then
    revoke all on public.concern from anon, authenticated;
    revoke all on public.health_declaration from anon, authenticated;
  end if;
  grant select, insert, update on public.concern to app_role;
  grant select, insert on public.health_declaration to app_role;
end
$$;

------------------------------------------------------------------------------
-- 4. Audit triggers, and the classification tests/db/audit.test.ts reads.
--    Both carry client_id directly, so migration 097's general rule attributes
--    them without anything further here.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['concern', 'health_declaration'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I '
                   'for each row execute function app.audit_row()', t);
    execute format('alter table public.%I enable always trigger audit_row', t);
  end loop;
end
$$;

comment on table public.concern is 'audited: client - carries client_id directly';
-- health_declaration's classification comment is set with the table above,
-- where it says what the table is as well.

------------------------------------------------------------------------------
-- 5. The erasure reaches both — and not from this file.
--
--    `app.erase_client` is defined last by 954_drop_invoice_document_id.sql,
--    in the trunk's range. A fresh database applies migrations in numeric
--    order, so a redefinition here, at 108, is overwritten by 954 a moment
--    later and its steps disappear without a word. That is not a theory: it
--    was written here first, and tests/client/db/concerns_and_health.test.ts
--    failed with a summary carrying every key but the two new ones.
--
--    The step therefore lives in 964_erasure_reaches_concerns_and_health.sql,
--    which is 954's body with two steps added — the same "read it as a diff"
--    shape 105, 106 and 107 use. And 965_audit_redact_health_answers.sql keeps
--    the six answers out of the audit trail, so that when 964 deletes the rows
--    nothing of them is left in the one table nothing can be taken out of.
--    Both recorded in docs/CHANGE-REQUESTS/trunk-notes.md, since 900-999 is
--    the trunk's range and this stream is only passing through.
--
--    tests/client/db/concerns_and_health.test.ts reads the live body of
--    app.erase_client and fails if it no longer names these tables — the
--    guard against the next redefinition landing below 964.
------------------------------------------------------------------------------

-- rollback:
--   The two tables and the enum, in that order; the audit triggers and the
--   classification comments go with the tables they are on.
--
--   drop table public.health_declaration;
--   drop table public.concern;
--   drop type concern_status;
--
--   The policies name both tables in db/policies/client/readers.sql,
--   writers.sql and tenant_isolation.sql, and the runner re-applies those
--   files on every migrate — so their blocks come out in the same change, or
--   the next migrate fails on a policy for a table that is no longer there.
