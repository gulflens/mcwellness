-- 500_assessment.sql
-- The measurement a brain-map visit produces, and the questionnaire totals
-- beside it (docs/SPEC/assessment.md sections 1, 5, 6 and 7.2;
-- docs/SPEC/00-data-model.md section 4).
--
-- **A measurement is a fact about a day, and a fact about a day does not
-- change.** So this table is append-only in the strongest sense the database
-- can state it: app_role is granted select and insert and nothing else, and a
-- guard trigger refuses an update or a delete to anybody at all — the owner
-- included — outside an erasure. A figure entered wrongly is corrected by
-- recording a new version of the old one, with a reason, and both stay
-- (CLAUDE.md rule 7).
--
-- **The columns that differ from `00-data-model.md` section 4** are each a
-- change request, written and not applied (docs/CHANGE-REQUESTS/assessment-01.md
-- item 1): `supersede_reason`, `condition_note`, `reference_age_years`,
-- `reference_sex`, and `raw_document_id` dropped in favour of the link table
-- migration 501 adds. There is deliberately **no `session_id`**: the honest
-- link is to `session`, in the 300 range, and apply order across ranges is not
-- fixed (docs/SPEC/OWNERSHIP.md), so a 500 migration must not assume that
-- table is there. The trunk's `950-999` half exists for exactly that, and the
-- link is a change request for a `95x` migration once both ranges are on main.
-- `performed_at` and the client are enough meanwhile.
--
-- **Nothing here interprets a figure.** There is no reference range in this
-- schema, no cut-off and no word. Where the equipment's software compared a
-- recording against its own database, what it reported is kept in `derived`
-- with the age and sex it used snapshotted beside it, and the platform
-- computes no comparison of its own (spec section 3.4).
--
-- Needs: 010 (tenant), 020 (app_user, for created_by), 050 (practitioner),
-- 060 (client, and the `sex_at_birth` enum this table's reference column
-- reuses), 070/080 (app.audit_row, app.set_updated_at), 095
-- (app.current_actor_id), 098 (app.erasure_active, which the append-only guard
-- must not stand in front of), 099 (the tenant-scoped keys the composite
-- foreign keys below reference on client and practitioner), 100
-- (app.client_visible_to_practitioner, which the context function at the foot
-- of this file calls; every database that can run db:migrate already has it,
-- because db/policies/client/readers.sql calls it too and the policies are
-- re-applied on every migrate).

------------------------------------------------------------------------------
-- 1. The measurement.
------------------------------------------------------------------------------
create table assessment (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references tenant (id),
  client_id                     uuid not null references client (id),
  -- When the measurement was taken, which is not when it was typed in: a brain
  -- map is recorded at the household and entered from a laptop afterwards
  -- (spec section 9, "offline working" is deliberately out).
  performed_at                  timestamptz not null,
  performed_by_practitioner_id  uuid not null references practitioner (id),
  -- An open set (00-data-model.md section 1: open sets are reference tables or
  -- text, closed sets are enums). Which instruments the platform actually has
  -- a declared shape for is domain/assessment/shapes' question, and a new one
  -- is a shape and a scoring function rather than a migration.
  instrument                    text not null,
  -- Which edition of that instrument was administered. Beside it, inside
  -- `derived`, every payload names the software and the version that produced
  -- the figures (spec decision 6), so a figure can always be traced to what
  -- computed it.
  instrument_version            text not null,
  -- The figures. Validated at the edge against the instrument's declared shape
  -- (domain/assessment/validateDerived.ts), where a bad one can be refused
  -- with the field named; the database checks only that it is an object and
  -- that it is not unbounded, for the reason 300_session.sql caps a payload —
  -- an unbounded jsonb blob is also an unbounded copy of itself in the trail.
  derived                       jsonb not null,
  -- Recording conditions, beside the typed fields and never instead of them
  -- (CLAUDE.md rule 3): eyes open or closed is a typed field in the payload,
  -- and this is the room, the artefact, the thing worth mentioning.
  condition_note                text,
  -- What the software's own reference comparison was made against, as it was
  -- made. A birthday and a corrected record both move the live answer; the
  -- comparison that was actually made does not.
  reference_age_years           integer,
  reference_sex                 sex_at_birth,
  version                       integer not null default 1,
  supersedes_id                 uuid,
  -- Required the moment a row replaces another. Every other append-only entity
  -- in the data model requires one (`client_protocol` is the precedent);
  -- section 4 omits it here by oversight, and the correction is a change
  -- request rather than an edit of the model.
  supersede_reason              text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid references app_user (id),
  constraint assessment_tenant_id_id_key unique (tenant_id, id),
  -- So migration 501's link row can bind a document to the assessment's own
  -- client rather than to an assessment id a caller happens to know.
  constraint assessment_tenant_id_id_client_id_key unique (tenant_id, id, client_id),
  constraint assessment_client_fk
    foreign key (tenant_id, client_id) references client (tenant_id, id),
  constraint assessment_practitioner_fk
    foreign key (tenant_id, performed_by_practitioner_id)
    references practitioner (tenant_id, id),
  constraint assessment_supersedes_fk
    foreign key (tenant_id, supersedes_id) references assessment (tenant_id, id),
  constraint assessment_version_positive check (version >= 1),
  -- A first recording supersedes nothing and needs no reason; anything else
  -- names what it replaced and says why.
  constraint assessment_supersede_is_reasoned check (
    (version = 1 and supersedes_id is null and supersede_reason is null)
    or (version > 1 and supersedes_id is not null and supersede_reason is not null)
  ),
  constraint assessment_instrument_present check (
    length(btrim(instrument)) > 0 and length(btrim(instrument_version)) > 0
  ),
  constraint assessment_derived_is_an_object check (jsonb_typeof(derived) = 'object'),
  constraint assessment_derived_bounded check (pg_column_size(derived) <= 262144),
  -- The two free-text columns, bounded here as domain/assessment/types.ts
  -- bounds them at the edge.
  constraint assessment_condition_note_bounded check (length(condition_note) <= 500),
  constraint assessment_supersede_reason_bounded check (length(supersede_reason) <= 500),
  -- A snapshot of an age, not a computation: a figure outside a human lifetime
  -- is a typing mistake in a measurement, which is worth refusing.
  constraint assessment_reference_age_plausible check (
    reference_age_years is null or reference_age_years between 0 and 130
  )
);
comment on table public.assessment is 'audited: client';
comment on column public.assessment.derived is
  'The figures, validated at the edge against the instrument''s declared shape. '
  'Carries the software and version that produced them (spec decision 6). Never an '
  'interpretation: no band, no cut-off, no word.';
comment on column public.assessment.reference_age_years is
  'The age the equipment''s software compared this recording against, snapshotted as it '
  'was made. The live answer moves with a birthday; the comparison that was made does not.';

create index assessment_tenant_idx on assessment (tenant_id);
create index assessment_client_idx on assessment (client_id, performed_at desc);
create index assessment_practitioner_idx on assessment (performed_by_practitioner_id);
create index assessment_created_by_idx on assessment (created_by);
create index assessment_supersedes_idx on assessment (supersedes_id);
-- One successor per version, ever. `canSupersede` says the same at the edge
-- (domain/assessment/canSupersede.ts), and this is what binds: a chain with
-- two tips has no current version at all.
create unique index assessment_one_successor
  on assessment (tenant_id, supersedes_id) where supersedes_id is not null;

create trigger set_updated_at before update on assessment
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on assessment
  for each row execute function app.audit_row();
alter table public.assessment enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. Append-only, enforced rather than granted away.
--
-- app_role holds no update and no delete (section 4 below), so this trigger is
-- not about the API: it is about everything else that can reach the table —
-- the owner at a psql prompt, a job, a migration written in a hurry. A
-- measurement corrected in place is a measurement whose earlier reading is
-- gone, and the whole point of a version chain is that both readings stay.
--
-- A trigger that raises, not a policy that hides: a policy would make the
-- update disappear silently and report success, which is the one thing a
-- record of a measurement must never do. `enable always`, so
-- session_replication_role = replica cannot switch it off, matching the audit
-- triggers' own treatment in 070.
--
-- The one exception is an erasure, which runs as the owner through
-- app.erase_client and must be able to clear the free text inside these rows
-- (migration 106). A record frozen against its own author is right; a record
-- frozen against a person's right to be forgotten is not. security definer,
-- because app_role holds no grant on app.erasure_active at all
-- (098_erasure_guard.sql), exactly as app.session_refuse_update_after_close is.
------------------------------------------------------------------------------
create function app.assessment_refuse_rewrite() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a measurement is never deleted; assessment %', old.id
      using errcode = 'restrict_violation',
            hint = 'Correct it by recording a new version of it, with a reason.';
  end if;
  raise exception 'a measurement is never changed; assessment %', old.id
    using errcode = 'restrict_violation',
          hint = 'Correct it by recording a new version of it, with a reason.';
end
$$;
revoke execute on function app.assessment_refuse_rewrite() from public;

create trigger refuse_rewrite before update or delete on public.assessment
  for each row execute function app.assessment_refuse_rewrite();
alter table public.assessment enable always trigger refuse_rewrite;

------------------------------------------------------------------------------
-- 3. The gates, read at the moment of writing (spec section 7.2).
--
-- One narrow security definer door, in the shape app.checkin_context (301)
-- sets, handing back exactly what the record and the file routes need to
-- decide and nothing else: no name, no contact detail, no record number. The
-- route asks it inside its own transaction, immediately before it writes, so
-- nothing about a credential or a consent is ever cached on a device
-- (.claude/rules/compliance.md).
--
-- **Why not app.checkin_context itself.** That door answers about a visit
-- booked *today*, because checking in only makes sense at the door of one
-- (301's own comment). An assessment is recorded from a laptop after the
-- visit, sometimes days after, so the same door would refuse every honest
-- recording. What is shared is the rule rather than the function: the same
-- three consent purposes, the same Dubai-zone arithmetic for whether the
-- client is a minor, and the same "re-check the credential's dates now".
--
-- Reading the credential here rather than from the token's capabilities is the
-- whole point: a certification that lapsed this morning must refuse this
-- afternoon's recording, whatever a session begun yesterday was told.
-- p_service_code null means the instrument has no service of its own
-- (a questionnaire), and the question becomes whether this person may execute
-- any of the practice's services at all.
------------------------------------------------------------------------------
create function app.assessment_context(p_client_id uuid, p_service_code text)
returns table (
  -- Named `client_found` rather than `found`: plpgsql keeps a special variable
  -- of that name for whether the last statement touched a row, and an output
  -- column would shadow it inside this very body.
  client_found             boolean,
  visible                  boolean,
  practitioner_id          uuid,
  credential_ok            boolean,
  has_date_of_birth        boolean,
  is_minor                 boolean,
  active_consent_purposes  text[]
)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id      uuid := app.current_tenant_id();
  v_actor_id       uuid := app.current_actor_id();
  v_today          date;
  v_dob            date;
  v_client_found   boolean := false;
  v_practitioner   uuid;
  v_credential_ok  boolean := false;
  v_purposes       text[] := '{}'::text[];
begin
  -- Today in the practice's own zone, never the server's or the session's
  -- (the idiom 301_checkin_context.sql sets out, and for the reason its
  -- comment gives).
  v_today := (date_trunc('day', now() at time zone 'Asia/Dubai'))::date;

  select true, c.date_of_birth into v_client_found, v_dob
    from public.client c
   where c.id = p_client_id and c.tenant_id = v_tenant_id;

  if coalesce(v_client_found, false) then
    select p.id into v_practitioner
      from public.practitioner p
     where p.user_id = v_actor_id
       and p.tenant_id = v_tenant_id
       and p.status = 'active';

    if v_practitioner is not null then
      select exists (
        select 1
          from public.credential cr
          join public.service_type st on st.id = cr.service_type_id
         where cr.practitioner_id = v_practitioner
           and cr.tenant_id = v_tenant_id
           and st.tenant_id = v_tenant_id
           and cr.can_execute_session
           and cr.valid_from <= v_today
           and (cr.valid_to is null or cr.valid_to >= v_today)
           and (p_service_code is null or st.code = p_service_code)
      ) into v_credential_ok;
    end if;

    -- The three purposes the recording gate branches on, and no others: a
    -- household's photo, research or marketing answers are real rows and are
    -- not this door's business.
    select coalesce(array_agg(distinct co.purpose::text), '{}'::text[])
      into v_purposes
      from public.consent co
     where co.client_id = p_client_id
       and co.tenant_id = v_tenant_id
       and co.status = 'active'
       and co.purpose in ('participation', 'minor_participation', 'home_visit');
  end if;

  client_found := coalesce(v_client_found, false);
  practitioner_id := case when client_found then v_practitioner end;
  -- Who may reach this record at all: the practice's three oversight roles,
  -- and a practitioner for a client on their own schedule (ninety days back,
  -- thirty forward, confirmed visits only —
  -- 201_client_visible_to_practitioner.sql).
  visible := client_found and (
    app.actor_has_role('owner')
    or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (v_practitioner is not null and app.client_visible_to_practitioner(p_client_id))
  );
  credential_ok := client_found and v_credential_ok;
  has_date_of_birth := client_found and v_dob is not null;
  -- "Minor" is judged on today's date in the practice's own zone, matching
  -- domain/session/canCheckIn.ts's own PRACTICE_TIME_ZONE.
  is_minor := client_found
    and coalesce(v_dob is not null and v_dob > (v_today - interval '18 years')::date, false);
  -- A client of another practice is exactly as absent as one that does not
  -- exist: every other column comes back empty, so a caller can never probe an
  -- id and learn that it is at least one of theirs (301's own rule).
  active_consent_purposes := case when client_found then v_purposes else '{}'::text[] end;

  return next;
end
$$;
revoke execute on function app.assessment_context(uuid, text) from public;
grant execute on function app.assessment_context(uuid, text) to app_role;

------------------------------------------------------------------------------
-- 4. Privileges. Select and insert; never update, never delete.
--
-- 090_grants_and_rls.sql predates this table, so this migration repeats its
-- pattern for its own, guarding the Supabase-only revoke exactly as 090 does.
-- The policies themselves live in db/policies/assessment/ and are re-applied
-- on every migrate (.claude/rules/data-model.md).
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.assessment enable row level security;
  revoke all on public.assessment from public;
  if has_api_roles then
    revoke all on public.assessment from anon, authenticated;
  end if;
  grant select, insert on public.assessment to app_role;
end
$$;

-- rollback:
--   revoke select, insert on public.assessment from app_role;
--   drop function if exists app.assessment_context(uuid, text);
--   drop trigger if exists refuse_rewrite on public.assessment;
--   drop function if exists app.assessment_refuse_rewrite();
--   drop trigger if exists audit_row on public.assessment;
--   drop trigger if exists set_updated_at on public.assessment;
--   drop index if exists assessment_one_successor;
--   drop table if exists public.assessment;
