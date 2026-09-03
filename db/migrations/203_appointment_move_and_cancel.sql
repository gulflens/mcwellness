-- 203_appointment_move_and_cancel.sql
-- The three columns db/migrations/200_appointment.sql deliberately left out,
-- now that the pull request they belong to has arrived: why a visit was called
-- off, when, and — when a visit moved rather than ended — which appointment
-- replaced which.
--
-- **A move is a link between two rows, never an edit to one.**
-- docs/SPEC/scheduling-manual.md section 3: "Rescheduling creates a new
-- appointment with `rescheduled_from_id`; the old one becomes `rescheduled`.
-- Never edit times on a confirmed appointment in place." So the window a
-- household was originally promised, and the practitioner who was originally
-- coming, both survive on the old row exactly as they were agreed. Nothing
-- has to snapshot them anywhere else, because nothing overwrites them: the
-- client's record can always show what was arranged as well as what happened,
-- which is the whole reason the data model prefers the link to a status
-- (docs/CHANGE-REQUESTS/scheduling-03.md and the note carried since the
-- Flutter app's own stage plan).
--
-- **Why `cancellation_reason` is an enum and not free text.** The words a
-- coordinator types about a cancellation belong in the audit trail's `reason`,
-- which every write already carries from the X-Reason header
-- (app/api/_middleware/request-context.ts). What belongs in a column is the
-- category, because two things read it: the notice rule
-- (domain/scheduling/cancellation.ts — `unfit_to_attend` is late whatever the
-- clock says, `consent_withdrawn` never is) and, later, the unfit fee. An open
-- set would make both of those string comparisons against something nobody
-- controls (.claude/rules/data-model.md: "Enums for closed sets").
--
-- **One narrow door for the practitioner.** The calendar stays the office's:
-- db/policies/scheduling/appointment_access.sql is not widened by this
-- migration, and a practitioner still cannot update an appointment row.
-- `app.cancel_own_appointment` is the exception, in exactly the shape
-- `app.complete_appointment_for_session` (302_session_close.sql) and
-- `app.checkin_context` (301) already set: a security definer function that
-- can do one thing, to one row, for the one person whose stop it is. The
-- alternative — granting a practitioner update on their own rows and fencing
-- the columns with a trigger — would have opened the whole row to reach one
-- column of it.
--
-- **And one for a withdrawn consent.** `app.cancel_future_appointments` is
-- what the client-record stream's withdrawal route calls when a consent the
-- visits depend on is withdrawn (docs/SPEC/client-record.md section 7,
-- docs/CHANGE-REQUESTS/client-record-03.md CR-10). It cancels forward only,
-- never late, and stamps the caller's reason on every audit row it causes.
--
-- Needs: 000 (schema app, app.current_tenant_id), 020 (app_user), 050
-- (practitioner), 080 (app.audit_row, already on appointment), 100
-- (app.current_actor_id), 200 (appointment, its statuses and its
-- practice-bound key). Named here rather than assumed from this file's own
-- number, per docs/SPEC/OWNERSHIP.md ("Apply order across these ranges is not
-- fixed").

------------------------------------------------------------------------------
-- 1. Why a visit was called off.
------------------------------------------------------------------------------
create type appointment_cancellation_reason as enum (
  'client_request',     -- the family called it off
  'practice_request',   -- the practice called it off
  'unfit_to_attend',    -- the practitioner arrived and the visit could not go ahead
  'consent_withdrawn'   -- a consent the visit depended on was withdrawn
);

alter table appointment
  add column cancellation_reason  appointment_cancellation_reason,
  add column cancelled_at         timestamptz,
  add column rescheduled_from_id  uuid;

comment on column public.appointment.cancellation_reason is
  'Why the visit was called off. The category, not the words: the coordinator''s own '
  'sentence is the audit row''s reason. Read by domain/scheduling/cancellation.ts.';
comment on column public.appointment.rescheduled_from_id is
  'The appointment this one replaced. The old row keeps the window and the practitioner '
  'that were originally agreed, and becomes ''rescheduled'' (scheduling-manual.md section 3).';

-- A cancellation is whole or absent: a row cannot say when without saying why,
-- or why without saying when.
alter table appointment add constraint appointment_cancellation_is_whole
  check ((cancelled_at is null) = (cancellation_reason is null));

-- And it belongs to a cancelled visit. One direction only, deliberately: a
-- row that carries a cancellation must be in one of the two cancelled
-- statuses — a no-show did not cancel (the practitioner was genuinely sent to
-- that door) and a rescheduled visit did not either, it moved — but a
-- cancelled row is not required to carry one.
--
-- The biconditional was written first and taken out again, because it is a
-- rule about this stream's own routes masquerading as a rule about the table.
-- Every write here stamps both, and so should anything that follows. But an
-- appointment can legitimately be *created* cancelled or late-cancelled by
-- something that is recording history rather than calling a visit off —
-- billing's own consumption tests do exactly that, and the trigger they
-- exercise (404_billing_consumption.sql) fires on such an insert on purpose —
-- and rows written before this migration have no stamp to offer. A
-- constraint that makes another stream's legitimate write impossible is a
-- constraint that is wrong, not a stream that is.
alter table appointment add constraint appointment_cancellation_belongs_to_a_cancellation
  check (cancelled_at is null or status in ('cancelled', 'cancelled_late'));

-- The link is to another appointment of this same practice, and never to
-- itself. The composite key 200 added (appointment_tenant_id_id_key) is what
-- lets the foreign key bind the practice as well as the row.
alter table appointment add constraint appointment_not_moved_from_itself
  check (rescheduled_from_id is null or rescheduled_from_id <> id);
alter table appointment add constraint appointment_rescheduled_from_fk
  foreign key (tenant_id, rescheduled_from_id) references appointment (tenant_id, id);

-- A visit is replaced once. Moving a visit twice is two moves in a chain —
-- A superseded by B, B superseded by C — not two rows both claiming to
-- replace A, which would leave the client's record unable to say what
-- actually happened.
create unique index appointment_one_move_per_source
  on appointment (rescheduled_from_id) where rescheduled_from_id is not null;

-- Postgres does not index a foreign key's own side; this serves the constraint
-- above and the "what did this become" read from the client's record.
create index appointment_rescheduled_from_idx on appointment (rescheduled_from_id);

------------------------------------------------------------------------------
-- 2. The practitioner's own door onto calling off their own stop.
--
--    Everything it needs is checked inside it, because security definer means
--    this body runs with the owner's privileges and row security will not be
--    checking anything on its behalf. The status is an argument rather than a
--    decision made here: which of the two cancelled statuses a visit takes is
--    a business rule, business rules live in domain/ (CLAUDE.md rule 4), and
--    domain/scheduling/cancellation.ts is where this one is written and
--    tested. What this function will not do is take any other status, or
--    touch any other column, or reach a stop that is not the caller's own.
------------------------------------------------------------------------------
create function app.cancel_own_appointment(
  p_appointment_id uuid,
  p_status         text,
  p_reason         appointment_cancellation_reason
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_updated integer;
begin
  -- Two statuses, and nothing else, whatever a caller passes.
  if p_status not in ('cancelled', 'cancelled_late') then
    raise exception 'a visit is called off as cancelled or cancelled_late, not as %', p_status
      using errcode = 'invalid_parameter_value';
  end if;
  -- A withdrawn consent is not a practitioner's cancellation: it is
  -- app.cancel_future_appointments's, below, and it runs for a whole client.
  if p_reason = 'consent_withdrawn' then
    raise exception 'a withdrawn consent cancels through app.cancel_future_appointments'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.appointment a
     set status = p_status::public.appointment_status,
         cancellation_reason = p_reason,
         cancelled_at = now()
   where a.id = p_appointment_id
     and a.tenant_id = app.current_tenant_id()
     -- The caller's own stop, and the caller still working here. A
     -- practitioner the practice has made inactive is not who this door opens
     -- for, the same clause app.complete_appointment_for_session (302) and
     -- app.client_visible_to_practitioner (201) both carry.
     and exists (
       select 1 from public.practitioner p
        where p.id = a.practitioner_id
          and p.tenant_id = app.current_tenant_id()
          and p.user_id = app.current_actor_id()
          and p.status = 'active'
     )
     -- A visit still owed, and no other. Already delivered, already called
     -- off, already missed or already moved is a fact about a day that has
     -- passed. 'checked_in' is left out too, and deliberately: the
     -- practitioner is inside the house and how that visit ends is the
     -- session's to say — completed, or a no-show — not a cancellation
     -- written underneath an open session.
     and a.status in ('proposed', 'confirmed');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end
$$;
revoke execute on function app.cancel_own_appointment(uuid, text, appointment_cancellation_reason)
  from public;
grant execute on function app.cancel_own_appointment(uuid, text, appointment_cancellation_reason)
  to app_role;

------------------------------------------------------------------------------
-- 3. A withdrawn consent takes the diary with it.
--
--    docs/SPEC/client-record.md section 7: "existing sessions in progress
--    complete, future appointments cancelled with notification".
--    docs/CHANGE-REQUESTS/client-record-03.md CR-10 left this undone because
--    `appointment` is this stream's table and cancelling somebody's visits is
--    not a thing to do across an ownership line. This is that door, written on
--    this side of the line for the client-record stream's withdrawal route to
--    call; the exact call is in docs/CHANGE-REQUESTS/scheduling-04.md.
--
--    Never late, whatever the clock says. Withdrawing a consent is a right,
--    and taking a credit for the visits that right cancels would be a penalty
--    on exercising it. The same rule is in NEVER_LATE_REASONS
--    (domain/scheduling/cancellation.ts), so the two sides say one thing.
------------------------------------------------------------------------------
create function app.cancel_future_appointments(p_client_id uuid, p_reason text)
returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_previous_reason text := coalesce(current_setting('app.reason', true), '');
  v_cancelled       integer;
begin
  -- The office's, not a practitioner's and not a household's. Withdrawing a
  -- consent is `client.write` (domain/shared/actor.ts), which is the owner and
  -- an admin; this door is exactly as wide as the decision that opens it, and
  -- no wider. Row security is not standing behind this check — security
  -- definer means this is the check.
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'only an owner or an admin may cancel a client''s future visits'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'cancelling a client''s future visits needs a reason'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The caller's reason, on every audit row this causes, then put back. The
  -- audit trigger reads app.reason from the transaction's own settings
  -- (080_audit_triggers.sql) and takes no argument, so this is how a
  -- withdrawal's own words reach the trail rather than the withdrawal
  -- request's generic one.
  perform set_config('app.reason', left(btrim(p_reason), 500), true);

  update public.appointment a
     set status = 'cancelled',
         cancellation_reason = 'consent_withdrawn',
         cancelled_at = now()
   where a.client_id = p_client_id
     and a.tenant_id = app.current_tenant_id()
     -- Forward only. A visit already delivered, already called off, already
     -- missed or already moved is a fact about a day that has passed, and a
     -- withdrawal today does not reach back and rewrite it. A visit whose
     -- window has opened is in progress and completes (section 7's own words).
     and a.window_start > now()
     and a.status in ('proposed', 'confirmed');
  get diagnostics v_cancelled = row_count;

  perform set_config('app.reason', v_previous_reason, true);
  return v_cancelled;
end
$$;
revoke execute on function app.cancel_future_appointments(uuid, text) from public;
grant execute on function app.cancel_future_appointments(uuid, text) to app_role;

-- rollback:
--   revoke execute on function app.cancel_future_appointments(uuid, text) from app_role;
--   drop function if exists app.cancel_future_appointments(uuid, text);
--   revoke execute on function app.cancel_own_appointment(uuid, text, appointment_cancellation_reason)
--     from app_role;
--   drop function if exists app.cancel_own_appointment(uuid, text, appointment_cancellation_reason);
--   drop index if exists appointment_rescheduled_from_idx;
--   drop index if exists appointment_one_move_per_source;
--   alter table appointment drop constraint if exists appointment_rescheduled_from_fk;
--   alter table appointment drop constraint if exists appointment_not_moved_from_itself;
--   alter table appointment drop constraint if exists appointment_cancellation_belongs_to_a_cancellation;
--   alter table appointment drop constraint if exists appointment_cancellation_is_whole;
--   alter table appointment drop column if exists rescheduled_from_id;
--   alter table appointment drop column if exists cancelled_at;
--   alter table appointment drop column if exists cancellation_reason;
--   drop type if exists appointment_cancellation_reason;
