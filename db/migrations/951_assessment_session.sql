-- 951_assessment_session.sql
-- The link from a measurement to the visit that produced it
-- (docs/SPEC/assessment.md section 6; request 2 of
-- docs/CHANGE-REQUESTS/assessment-01.md).
--
-- **Why the assessment stream could not write this itself.** A brain map is
-- recorded during a visit, and the honest link is a foreign key to `session`
-- — which lives in the 300 range while `assessment` lives in the 500s. Apply
-- order across ranges is not fixed (docs/SPEC/OWNERSHIP.md), so a 500
-- migration must never assume the 300s are on the database, and `checkNeeds`
-- refuses a `-- Needs:` naming a higher number for the same reason. Migration
-- 500 therefore shipped with no `session_id` at all and wrote the ask down.
-- This is the trunk's `950-999` half doing exactly what it exists for: a
-- migration that builds on two streams' tables at once and sorts after both.
--
-- **Nullable, and it stays nullable.** A measurement is a fact about a day,
-- and the day it was taken is not always a day the practice booked: a
-- questionnaire is filled in at the household's own pace, a re-map may be
-- typed up from an outside clinic's export, and every measurement recorded
-- before this migration names no visit and never will. The column says which
-- visit produced the figures **when the person recording them says so**, and
-- is silent otherwise. Nothing reads it as proof of anything.
--
-- **It is not a snapshot and it is not history.** It names a row, not a copy
-- of one, because it answers "which visit" rather than "what the visit said" —
-- `assessment.performed_at` is already the fact about the day, and the visit's
-- own service name and practitioner belong to the visit's own record
-- (CLAUDE.md section 3's snapshot rule is about what a document *displays*,
-- and no document displays this).
--
-- **The visit must be this client's own.** `session` carries
-- `unique (id, tenant_id, client_id, practitioner_id)` — four columns, in that
-- order — which no three-column foreign key can point at, so this migration
-- adds the client-scoped key in the shape every other table in this platform
-- uses (`invoice_tenant_id_client_key` in 402, `contact_tenant_id_client_key`
-- in 601, `assessment_tenant_id_id_client_id_key` in 500) and binds to it. A
-- measurement can then never name another household's visit; without the third
-- column it could name any visit in the practice.
--
-- The key is additive and cannot fail: `id` is already the primary key, so
-- `(tenant_id, id, client_id)` is a superset of a uniqueness that already
-- holds.
--
-- Needs: 300 (session, and its client_id), 500 (assessment)

------------------------------------------------------------------------------
-- 1. The key on the visit, so the link below can bind to the client too.
------------------------------------------------------------------------------
alter table public.session
  add constraint session_tenant_id_client_key unique (tenant_id, id, client_id);

comment on constraint session_tenant_id_client_key on public.session is
  'The client-scoped key a composite foreign key points at, so a row naming a visit names '
  'that visit''s own client and cannot name another household''s (migration 951).';

------------------------------------------------------------------------------
-- 2. The link itself.
--
--    MATCH SIMPLE, which is the default and is what is wanted here: with
--    `session_id` null the foreign key is not checked at all, so an
--    unlinked measurement is ordinary rather than a row that has to name a
--    visit it does not have.
------------------------------------------------------------------------------
alter table public.assessment add column session_id uuid;

alter table public.assessment add constraint assessment_session_fk
  foreign key (tenant_id, session_id, client_id)
  references public.session (tenant_id, id, client_id);

comment on column public.assessment.session_id is
  'The visit that produced the figures, where the person recording them named one. Null is '
  'ordinary: a questionnaire filled in at home, a measurement typed up from an outside '
  'export, and everything recorded before migration 951 name no visit. Bound to the '
  'assessment''s own client, so it can never name another household''s visit.';

-- Partial: the rows worth finding by visit are the ones that name one, and
-- most do not.
create index assessment_session_idx on public.assessment (session_id)
  where session_id is not null;

-- rollback:
--   drop index if exists assessment_session_idx;
--   alter table public.assessment drop constraint if exists assessment_session_fk;
--   alter table public.assessment drop column if exists session_id;
--   alter table public.session drop constraint if exists session_tenant_id_client_key;
