-- 302_session_close.sql
-- The rest of the visit record, and the moment it stops being writable
-- (docs/SPEC/session-capture.md sections 3 and 4; 00-data-model.md section 4).
--
-- Migration 300 built the session row as far as check-in reached: who, where,
-- and when the practitioner arrived. This one adds everything the run itself
-- produces — the pre-flight checklist, the two ratings, the telemetry, the
-- observations, the signal score, the setup photo and the check-out — plus
-- the guard that makes a closed session immutable.
--
-- Every one of these columns is a *projection* of session_event, which stays
-- the source of truth (section 2, section 6). Nothing is written here that
-- was not first written as an event, so a device that replays its outbox
-- rebuilds the row exactly; the columns exist because reading a visit should
-- not mean folding an event stream every time.
--
-- Deliberately absent: entitlement_id. Completing a session consumes exactly
-- one credit (section 4.2), and that is the billing stream's own trigger on
-- the transition this migration defines — not this stream's column and not
-- this stream's write. What this migration owes billing is that the
-- transition to 'completed' happens once, atomically, and can be depended on.
--
-- Needs: 010 (tenant), 020 (app_user, for closed_by), 060 (document, for the
-- setup photo), 080 (app.audit_row, already on session from 300), 095
-- (app.current_actor_id, which the appointment door below calls), 098
-- (app.erasure_active, which the immutability guard must not stand in front
-- of), 200 (appointment, for the visit this session fulfils and for the
-- close's own status flip) and 300 (session, session_event).

------------------------------------------------------------------------------
-- 1. The visit's own body.
------------------------------------------------------------------------------
alter table public.session
  -- The slot this visit fulfils. Nullable, because migration 300 shipped
  -- rows without it and because a walk-up visit that no appointment covers is
  -- a real thing the practice may one day do; the check-in route fills it in
  -- from the appointment that admitted the check-in (app.checkin_context,
  -- 301). Bound to the tenant as well as to the row, so a session can never
  -- name another practice's appointment.
  add column appointment_id          uuid,
  add column started_at              timestamptz,
  add column ended_at                timestamptz,
  add column checked_out_at          timestamptz,
  -- Recorded at check-out only when sharing was switched on at check-in
  -- (section 3.6), under the rule 300's checked_in_point carries: proof of
  -- attendance, the practitioner's own scope plus the practice's oversight
  -- roles, the session's own retention.
  --
  -- It is NOT yet excluded from the audit trail. 098_erasure_guard.sql's
  -- redaction names checked_in_point and nothing else, so until the trunk's
  -- migration 904 adds this column to that list, a check-out coordinate
  -- reaches audit_log.new_values in full. Written down here rather than
  -- assumed: an earlier draft of this comment claimed the exclusion already
  -- applied, which was false, and a false comment about where personal data
  -- goes is worse than no comment. This stream's own half of the fix — never
  -- letting the coordinate ride inside session_event.payload, where the
  -- redaction cannot see it at all — is done: the check-out point is carried
  -- session-level, exactly as check-in carries its own, and
  -- CheckedOutPayload holds no point.
  add column checked_out_point       extensions.geography(point, 4326),
  -- The pre-flight checklist as the practitioner left it: an array of
  -- { key, done }, keys from service_type.preflight_checklist (section 3.2).
  add column preflight               jsonb not null default '[]'::jsonb,
  -- The signal check the practitioner entered from the amplifier's own
  -- software (section 3.3): { sites: [{ site, quality }], overridden, at }.
  -- Not in 00-data-model.md's sketch of this table, which names the derived
  -- signal_quality_score and not the reading behind it; the reading is what
  -- section 3.3 asks a person to type, and a score with no working shown is
  -- a number nobody can check.
  add column signal_check            jsonb,
  -- The 0-10 answers, before and after: an array of { key, value }
  -- (section 3.2, section 3.5).
  add column pre_rating              jsonb not null default '[]'::jsonb,
  add column post_rating             jsonb not null default '[]'::jsonb,
  -- The run: an array of chunks, each { seconds, artefactPercent,
  -- timeInRewardPercent, bands, threshold, at } (section 3.4).
  add column telemetry               jsonb not null default '[]'::jsonb,
  -- The structured after-session record: chips, tolerance, engagement and
  -- the note beside them (section 3.5). Null until the visit reaches it.
  add column observations            jsonb,
  -- True when any chip other than 'none' was ticked
  -- (domain/session/deriveObservationFlag.ts): the lead practitioner's queue
  -- reads this rather than re-deriving it from jsonb.
  add column observation_flag        boolean not null default false,
  -- 0.000 to 1.000, computed at close by domain/session/scoreSignalQuality.ts
  -- and snapshotted here. Numeric, not float: the ribbon's slice height and a
  -- report figure must not drift between two readers of the same row.
  add column signal_quality_score    numeric(4, 3),
  add column setup_photo_document_id uuid references public.document (id),
  add column closed_at               timestamptz,
  add column closed_by               uuid references public.app_user (id),
  -- Amendment lineage (.claude/rules/data-model.md). A correction after close
  -- is a new version authored from the admin console (section 4), never an
  -- edit; nothing in this pull request writes any of the three.
  add column version                 integer not null default 1,
  add column supersedes_id           uuid,
  add column amendment_reason        text,
  add constraint session_appointment_fk
    foreign key (tenant_id, appointment_id) references public.appointment (tenant_id, id),
  add constraint session_supersedes_fk
    foreign key (tenant_id, supersedes_id) references public.session (tenant_id, id),
  add constraint session_version_positive check (version >= 1),
  add constraint session_amendment_reason_with_version
    check ((version = 1 and supersedes_id is null) or amendment_reason is not null),
  add constraint session_signal_quality_range
    check (signal_quality_score is null or signal_quality_score between 0 and 1),
  -- closed_at is the moment a visit stopped being writable, and every
  -- terminal status can reach it: an aborted visit (a lost phone, closed by
  -- an admin with a reason) and a no-show are as finished as a completed one,
  -- and the immutability trigger below freezes whichever of them sets it. A
  -- completed visit must always be closed; the others may be closed and,
  -- until the admin console that settles them exists, are not.
  add constraint session_closed_is_settled
    check (
      closed_at is null
      or status in ('completed', 'no_show', 'cancelled_late', 'cancelled', 'aborted')
    ),
  add constraint session_completed_is_closed
    check (status <> 'completed' or closed_at is not null),
  add constraint session_closed_by_with_closed_at
    check ((closed_at is null) = (closed_by is null)),
  add constraint session_ends_after_it_starts
    check (ended_at is null or started_at is null or ended_at >= started_at);

comment on column public.session.checked_out_point is
  'Proof the practitioner was at the door when they checked out, recorded only when '
  'sharing was switched on at check-in. Same reach and retention as checked_in_point '
  '(300_session.sql). Pending exclusion from the audit trail: 098_erasure_guard.sql '
  'names checked_in_point only, and the trunk migration 904 adds this one.';

-- Foreign keys Postgres does not index for us, and the two reads the day
-- sheet and the close route actually make.
create index session_appointment_idx on public.session (appointment_id);
create index session_setup_photo_idx on public.session (setup_photo_document_id);
create index session_closed_by_idx on public.session (closed_by);
create index session_supersedes_idx on public.session (supersedes_id);
-- "Which of this client's visits of this service are already completed" —
-- domain/session/sessionNumber.ts's own question, asked once per run screen.
create index session_client_service_completed_idx
  on public.session (client_id, service_type_id, checked_in_at)
  where status = 'completed';

------------------------------------------------------------------------------
-- 2. Immutability after close (section 4.1, CLAUDE.md rule 7).
--
-- A trigger that raises, not a policy that hides: a policy would make the
-- update disappear silently and report success, which is the one thing a
-- record of a visit must never do. `enable always`, so
-- session_replication_role = replica cannot switch it off, matching the audit
-- triggers' own treatment in 070.
--
-- The amendment path (a new session row with supersedes_id and
-- amendment_reason, authored from the admin console) is deliberately NOT
-- opened here: it inserts, it does not update, so this guard never stands in
-- its way and nothing about it needs an exception.
------------------------------------------------------------------------------
-- security definer, so the guard can see app.erasure_active, which app_role
-- holds no grant on at all (098_erasure_guard.sql). Erasure runs as the
-- owner through app.erase_client and must be able to reach these columns: a
-- record frozen against its own author is right, and a record frozen against
-- a person's right to be forgotten is not.
create function app.session_refuse_update_after_close() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.closed_at is not null
     and not exists (select 1 from app.erasure_active where txid = txid_current()) then
    raise exception 'session % is closed and cannot be changed; correct it with a new version',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
revoke execute on function app.session_refuse_update_after_close() from public;

create trigger refuse_update_after_close before update on public.session
  for each row execute function app.session_refuse_update_after_close();
alter table public.session enable always trigger refuse_update_after_close;

-- The event log stops with the visit. An outbox flushing after close is not
-- an error on the device's part — it may have been offline through the whole
-- close — but the row it would append can no longer change anything, and
-- accepting it silently would make the log disagree with the projection.
-- The route answers this as a plain refusal the device can stop retrying on.
-- security definer, so the lookup below reads the session row itself rather
-- than whatever row security would have shown the caller: a guard that fails
-- open because it could not see what it was guarding is not a guard. The
-- same erasure exemption as above, for the same reason.
create function app.session_event_refuse_after_close() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_closed_at timestamptz;
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return new;
  end if;
  select s.closed_at into v_closed_at from public.session s where s.id = new.session_id;
  if v_closed_at is not null then
    raise exception 'session % is closed and accepts no further events', new.session_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
revoke execute on function app.session_event_refuse_after_close() from public;

create trigger refuse_event_after_close before insert on public.session_event
  for each row execute function app.session_event_refuse_after_close();
alter table public.session_event enable always trigger refuse_event_after_close;

------------------------------------------------------------------------------
-- 3. The appointment's own status, flipped by the visit that fulfilled it.
--
-- Section 4.3 makes "appointment.status = completed" part of the close, and
-- the practitioner is who closes. But an appointment is the scheduling
-- stream's row, and its policy (db/policies/scheduling/appointment_access.sql)
-- gives update to the owner, the admin and the lead practitioner alone — a
-- practitioner "cannot create" or change the calendar, which is the right
-- rule for the calendar and the wrong one for this single transition.
--
-- Rather than widen that policy from outside the stream that owns it, this is
-- one narrow security definer door, the precedent app.checkin_context (301)
-- and app.client_status_for (100) already set. It can do exactly one thing:
-- set 'completed' on the appointment its own session names, when the caller
-- is that session's own practitioner, when the session is closed, and when
-- the appointment is not already settled. It takes no status argument, so
-- there is no second thing it could ever be asked to do.
--
-- Recorded as a note to scheduling in
-- docs/CHANGE-REQUESTS/session-capture-02.md: if that stream would rather own
-- this transition itself, this function is the shape of what it needs to
-- replace, and dropping it is a one-line rollback.
------------------------------------------------------------------------------
create function app.complete_appointment_for_session(p_session_id uuid) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_updated        integer;
begin
  -- The session must be this caller's own, closed, and in the caller's own
  -- tenant. Every one of those is checked here rather than trusted from the
  -- caller, because security definer means this body runs with the owner's
  -- privileges and row security is not going to check them for us.
  select s.appointment_id into v_appointment_id
    from public.session s
    join public.practitioner p on p.id = s.practitioner_id
   where s.id = p_session_id
     and s.tenant_id = app.current_tenant_id()
     and p.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id()
     -- A suspended or archived practitioner is not who this door opens for,
     -- any more than they are who checkin.ts's own lookup opens for.
     and p.status = 'active'
     and s.closed_at is not null;

  if v_appointment_id is null then
    return false;
  end if;

  update public.appointment a
     set status = 'completed'
   where a.id = v_appointment_id
     and a.tenant_id = app.current_tenant_id()
     -- 'confirmed' and 'checked_in' only, not 'proposed'. The schema review
     -- of this pull request asked for the narrower set while the scheduling
     -- stream has not answered the question in
     -- docs/CHANGE-REQUESTS/session-capture-02.md section 3b (its own two
     -- doors disagree about whether a proposed appointment counts). Narrow
     -- is the safe side of that disagreement: a proposed visit nobody
     -- confirmed is not one this door completes, and the coordinator can
     -- still settle it from the calendar.
     and a.status in ('confirmed', 'checked_in');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end
$$;
revoke execute on function app.complete_appointment_for_session(uuid) from public;
grant execute on function app.complete_appointment_for_session(uuid) to app_role;

-- rollback:
--   drop function if exists app.complete_appointment_for_session(uuid);
--   drop trigger if exists refuse_event_after_close on public.session_event;
--   drop function if exists app.session_event_refuse_after_close();
--   drop trigger if exists refuse_update_after_close on public.session;
--   drop function if exists app.session_refuse_update_after_close();
--   drop index if exists session_client_service_completed_idx;
--   drop index if exists session_supersedes_idx;
--   drop index if exists session_closed_by_idx;
--   drop index if exists session_setup_photo_idx;
--   drop index if exists session_appointment_idx;
--   alter table public.session
--     drop constraint if exists session_ends_after_it_starts,
--     drop constraint if exists session_closed_by_with_closed_at,
--     drop constraint if exists session_completed_is_closed,
--     drop constraint if exists session_closed_is_settled,
--     drop constraint if exists session_signal_quality_range,
--     drop constraint if exists session_amendment_reason_with_version,
--     drop constraint if exists session_version_positive,
--     drop constraint if exists session_supersedes_fk,
--     drop constraint if exists session_appointment_fk,
--     drop column if exists amendment_reason,
--     drop column if exists supersedes_id,
--     drop column if exists version,
--     drop column if exists closed_by,
--     drop column if exists closed_at,
--     drop column if exists setup_photo_document_id,
--     drop column if exists signal_quality_score,
--     drop column if exists observation_flag,
--     drop column if exists observations,
--     drop column if exists telemetry,
--     drop column if exists post_rating,
--     drop column if exists pre_rating,
--     drop column if exists signal_check,
--     drop column if exists preflight,
--     drop column if exists checked_out_point,
--     drop column if exists checked_out_at,
--     drop column if exists ended_at,
--     drop column if exists started_at,
--     drop column if exists appointment_id;
