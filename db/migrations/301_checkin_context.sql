-- 301_checkin_context.sql
-- The one narrow read app/api/sessions/checkin.ts needs from the client
-- aggregate, now that the client-record stream's own restrictive read
-- policies (pull request 21, branch client-record, not yet merged into this
-- worktree) gate a practitioner's direct select on client and consent behind
-- app.client_visible_to_practitioner() — which today always answers false,
-- because the scheduling stream that fills it in has not landed either. Once
-- client-record merges, checkin.ts's old direct reads of client.status,
-- client.date_of_birth and consent.purpose see zero rows for every client, and
-- canCheckIn (domain/session/canCheckIn.ts) can never be evaluated at all.
--
-- This function is the fix: a security definer door, owned outside app_role
-- exactly as app.client_status_for is in 100_client_record.sql, so it reads
-- straight through row level security rather than being subject to it. It
-- hands back only what canCheckIn's gate consumes — whether a date of birth
-- is on file, whether the client is a minor as of today in the practice's own
-- zone (matching canCheckIn's own PRACTICE_TIME_ZONE), and the active consent
-- purposes canCheckIn actually branches on. No given_name, no family_name, no
-- phone, no email, no Emirates ID, no status: the route has never needed a
-- name to check someone in, and this function makes that a property of what
-- can be asked for, not merely of what the route happens to select today —
-- status was dropped from the return row entirely once nothing downstream
-- read it (a column the gate does not use is not this door's to hand out,
-- the same reasoning that keeps a name off it).
--
-- Bound to the caller's own tenant, not the row's: a client id (or record
-- number) belonging to another tenant is exactly as invisible to this
-- function as it was to the old direct read, and found = false is how the
-- route already recognises "no such client here" (previously an empty result
-- set from the direct select). The function always returns exactly one row —
-- a left join against a single synthetic row, not a plain select — so found
-- is a value the caller reads, never an absent row it has to infer the
-- meaning of.
--
-- Takes p_client_id and p_mrn, resolving by whichever the caller actually
-- has: the check-in screen (pull request 24) lets a practitioner type a
-- client's record number (MW-000000, docs/SPEC/00-data-model.md) as well as
-- pick a client by id, and this is the one door either path reads through.
-- Exactly one is expected to be non-null (app/api/sessions/schema.ts's
-- CheckInRequest enforces that at the edge); when both are null, or neither
-- resolves a row, found is false, the same as any other unknown client. Since
-- an MRN alone does not carry the id the rest of the route needs to write the
-- session and session_event rows (or to name the client in a later refusal),
-- the resolved client_id rides back out alongside found — still not a name
-- or a contact detail, just the row's own key.
--
-- found is now tied to today's booked visit, not merely to the client
-- existing in the caller's tenant: "check in" only makes sense at the door
-- of a visit someone actually booked, and section 3.1 of
-- docs/SPEC/session-capture.md blocks check-in when "appointment not today".
-- Concretely, found is true only when there exists an appointment for the
-- resolved client, in the caller's own tenant, whose practitioner_id is the
-- caller's own practitioner row (resolved from app.actor_id, the same
-- lookup db/policies/scheduling/appointment_access.sql and
-- db/policies/session/practitioner_scope.sql use), whose window overlaps
-- today — the half-open Dubai-day range [today 00:00, tomorrow 00:00),
-- compared directly against window_start and window_end as plain
-- timestamptz, never a per-row (window_start at time zone ...)::date cast —
-- and whose status is 'proposed', 'confirmed' or 'checked_in'; a cancelled,
-- no-show, rescheduled or already-completed appointment does not open the
-- door. Comparing the raw columns keeps the check sargable against
-- appointment_practitioner_window_idx (practitioner_id, window_start)
-- (200_appointment.sql), and the overlap form (rather than testing
-- window_start's calendar date alone) is what correctly finds a visit
-- starting at 23:30 Dubai and ending after midnight, or, symmetrically, one
-- that began just before midnight and is still running when the day turns
-- over. There is no role exception here: the lead practitioner and the owner
-- check in against their own appointment exactly as an ordinary practitioner
-- does, unlike the broad "see everything in the tenant" role carve-out
-- db/policies/scheduling/appointment_access.sql grants those roles for
-- reading the calendar — a different question with a different answer. The
-- appointment check is an exists() rather than a join, so a client with two
-- non-overlapping visits today for the same practitioner still yields
-- exactly one row, not two. Appointment is read only inside this function;
-- nothing here imports from or defers to the scheduling domain. When found
-- is false, every other column comes back null (or its empty value) rather
-- than whatever the client row happened to hold: a same-tenant client with
-- no qualifying appointment today must look identical to one that does not
-- exist at all, so a caller can never probe an id and learn "this one is at
-- least in my tenant" from a client_id riding along beside a false found —
-- the route's own refusal for every found = false case is the same generic
-- not_booked_today, for exactly this reason (app/api/sessions/checkin.ts).
--
-- Needs 050 (practitioner, to resolve the caller's own row), 060 (client and
-- consent — the tables this function reads) and 200 (appointment). Written
-- to apply cleanly whether or not client-record's 100 is present: nothing
-- here reads a table or function that migration adds.

create function app.checkin_context(p_client_id uuid, p_mrn text)
returns table (
  found                    boolean,
  client_id                uuid,
  has_date_of_birth        boolean,
  is_minor                 boolean,
  active_consent_purposes  text[]
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  with today_dubai as (
    -- Local midnight today, and tomorrow's, as real instants (timestamptz),
    -- computed once so every comparison below reads the same "today" rather
    -- than each re-deriving it from a fresh now(). `today` is a plain date,
    -- found via at time zone 'Asia/Dubai' (never the server's or session's
    -- own zone); day_start and day_end are each derived from it by casting
    -- back to timestamp and reinterpreting that in Dubai — the same
    -- idiom, run twice, once for today's date and once for tomorrow's
    -- (ordinary integer-day arithmetic on a date, never a calendar
    -- interval added to a timestamptz). That second form matters:
    -- `day_start + interval '1 day'` would ask Postgres to add a
    -- calendar day to an instant, which it resolves through whichever
    -- zone the *session's* TimeZone setting names, not 'Asia/Dubai' —
    -- Asia/Dubai's own lack of DST is beside the point the moment the
    -- session's zone has one. Computing day_end from `today + 1`
    -- (a date) and only then converting to a timestamptz, explicitly in
    -- Dubai, never touches the session's zone at all.
    select
      t.today,
      t.today::timestamp at time zone 'Asia/Dubai' as day_start,
      (t.today + 1)::timestamp at time zone 'Asia/Dubai' as day_end
    from (select (date_trunc('day', now() at time zone 'Asia/Dubai'))::date as today) as t
  ),
  caller as (
    -- The caller's own practitioner row, resolved once: found never
    -- substitutes a role for it (see the header above), so this is the one
    -- row every appointment check below is bound to — or, for a caller with
    -- no practitioner row at all, zero rows, so found stays false for every
    -- client without the exists() below needing its own separate guard.
    select pr.id
      from public.practitioner pr
     where pr.user_id = nullif(current_setting('app.actor_id', true), '')::uuid
       and pr.tenant_id = app.current_tenant_id()
  ),
  resolved as (
    select c.id, c.date_of_birth
      from public.client c
     where c.tenant_id = app.current_tenant_id()
       and (
         -- p_client_id wins when both are somehow supplied: a caller-typed
         -- MRN is never used to override an id the route already trusts.
         (p_client_id is not null and c.id = p_client_id)
         or (p_client_id is null and p_mrn is not null and c.mrn = p_mrn)
       )
  )
  -- found is computed once, in resolved_ctx below, so the outer select can
  -- null out every other column when it is false: a same-tenant client who
  -- merely has no qualifying appointment must be indistinguishable from a
  -- client that does not exist at all — otherwise a caller could probe
  -- arbitrary ids and learn "this one exists in my tenant" from client_id
  -- riding back out beside a false found. (A plain top-level "as found"
  -- alias cannot be reread by its neighbouring select-list expressions in
  -- the same query — SQL does not allow that — hence the subquery.)
  select
    resolved_ctx.found as found,
    case when resolved_ctx.found then resolved_ctx.client_id end as client_id,
    resolved_ctx.found and resolved_ctx.has_date_of_birth as has_date_of_birth,
    resolved_ctx.found and resolved_ctx.is_minor as is_minor,
    case when resolved_ctx.found then resolved_ctx.active_consent_purposes else '{}'::text[] end
      as active_consent_purposes
  from (
    select
      resolved.id is not null and exists (
        select 1
          from public.appointment a, today_dubai t
         where a.tenant_id = app.current_tenant_id()
           and a.client_id = resolved.id
           and a.status in ('proposed', 'confirmed', 'checked_in')
           and a.practitioner_id = (select id from caller)
           -- Half-open overlap with today's Dubai day, against the plain
           -- timestamptz columns (see the header above for why: sargable,
           -- and correct at both midnight edges).
           and a.window_start < t.day_end
           and a.window_end > t.day_start
      ) as found,
      resolved.id as client_id,
      resolved.date_of_birth is not null as has_date_of_birth,
      -- "Minor" is judged on today's date in the practice's own zone
      -- (Asia/Dubai, matching domain/session/canCheckIn.ts's own
      -- PRACTICE_TIME_ZONE), never the server's own timezone setting or the
      -- client's. A direct date comparison against "18 years before today",
      -- rather than age(): age() promotes both its arguments through
      -- timestamp to build an interval this would then have to pull years
      -- back out of, all to answer a question a single date comparison
      -- already answers directly.
      coalesce(
        resolved.date_of_birth is not null
          and resolved.date_of_birth
              > ((select today from today_dubai) - interval '18 years')::date,
        false
      ) as is_minor,
      -- Filtered to the three purposes canCheckIn's gate actually reads
      -- (domain/session/types.ts's CheckInConsentPurpose): photo_video, research
      -- and marketing consent are real rows this client may have, but they are
      -- not this door's business and this function never hands them out.
      coalesce(
        (select array_agg(distinct co.purpose::text)
           from public.consent co
          where co.client_id = resolved.id
            and co.tenant_id = app.current_tenant_id()
            and co.status = 'active'
            and (co.expires_at is null or co.expires_at > now())
            and co.purpose = any(array['participation', 'minor_participation', 'home_visit']::public.consent_purpose[])),
        '{}'::text[]
      ) as active_consent_purposes
    from (select 1) as seed
    left join resolved on true
  ) as resolved_ctx
$$;
revoke execute on function app.checkin_context(uuid, text) from public;
grant execute on function app.checkin_context(uuid, text) to app_role;

-- rollback:
--   drop function if exists app.checkin_context(uuid, text);
