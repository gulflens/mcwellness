-- 304_session_reads.sql
-- The two narrow reads the session runner needs that ordinary row security
-- will not give a practitioner mid-visit (docs/SPEC/session-capture.md
-- sections 3.5 and 5 rule 4).
--
-- Both are security definer doors in the shape 301_checkin_context.sql
-- already set, and both are bound the same way: they answer only about a
-- session that is the caller's own, in the caller's own tenant, and they
-- hand back a fact rather than a row — never a name, a contact detail, a
-- date of birth or a consent record. A session that is not the caller's is
-- indistinguishable from one that does not exist.
--
-- Why they are needed at all: db/policies/client/readers.sql gates a
-- practitioner's read of `consent` behind app.client_visible_to_practitioner
-- (201), whose window turns on the *appointment's status* — 'confirmed'
-- onwards, never 'proposed'. That is the right rule for browsing a client's
-- record and the wrong one for the practitioner standing in the room running
-- the visit; db/policies/session/practitioner_scope.sql, similarly and
-- correctly, shows a practitioner only their own sessions, which is exactly
-- the wrong scope for counting how many visits of this service the client
-- has had in total.
--
-- Needs: 060 (client, consent), 050 (practitioner), 095 (app.current_actor_id)
-- and 300 (session).

------------------------------------------------------------------------------
-- Is a consent purpose active for the client of the caller's own session?
--
-- The setup photo needs an active `photo_video` consent at the moment it is
-- taken (section 3.5, .claude/rules/compliance.md: check the specific purpose
-- at execution time, never a cached flag). The practitioner's own read of
-- `consent` goes through db/policies/client/readers.sql, which asks
-- app.client_visible_to_practitioner — a window (201) that turns on the
-- appointment's *status*, and a visit still sitting at 'proposed' is outside
-- it. That is the right rule for browsing a client's record and the wrong one
-- for a practitioner standing in the room running the visit.
--
-- So: one more narrow definer door, in the shape 301 already set. It answers
-- a single boolean about a single purpose, only for a session that is the
-- caller's own, and never hands back a consent row, a date, a contact or a
-- name. A session that is not the caller's, or a purpose with no active
-- consent, are the same answer — false — for the same reason found = false is
-- one answer in app.checkin_context.
------------------------------------------------------------------------------
-- Three narrowings beyond "an active consent row exists", each from the
-- security and compliance review of pull request 41:
--
--  * the session must still be open. A door that serves a closed visit is a
--    door into a record nobody is standing in front of any more.
--  * the practitioner must be active. An account the practice has stopped
--    keeps no reach.
--  * for a minor, the consent must have been given by a contact who may
--    actually give it. `contact.can_consent` is the practice's own record of
--    who that is (00-data-model.md section 3); a photograph of a child
--    agreed to by somebody with no standing to agree is not consent, and
--    this is the same shape of check canCheckIn already makes when it takes
--    `isMinor` from app.checkin_context. Minority is judged on today's date
--    in the practice's own zone, matching that function exactly.
--    For an adult the contact rule does not apply: an adult client may
--    consent for themselves, and the practice records that as it records
--    every other consent.
create function app.session_consent_active(p_session_id uuid, p_purpose text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.session s
      join public.practitioner p on p.id = s.practitioner_id
      join public.client cl on cl.id = s.client_id and cl.tenant_id = s.tenant_id
      join public.consent c on c.client_id = s.client_id and c.tenant_id = s.tenant_id
      join public.contact ct on ct.id = c.given_by_contact_id and ct.tenant_id = c.tenant_id
     where s.id = p_session_id
       and s.tenant_id = app.current_tenant_id()
       and s.closed_at is null
       and s.status = 'in_progress'
       and p.tenant_id = app.current_tenant_id()
       and p.user_id = app.current_actor_id()
       and p.status = 'active'
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
       and c.purpose::text = p_purpose
       and (
         -- An adult: the consent stands on its own.
         cl.date_of_birth is not null
         and cl.date_of_birth
             <= ((date_trunc('day', now() at time zone 'Asia/Dubai'))::date
                 - interval '18 years')::date
         -- A minor, or a client with no date of birth on file (which
         -- canCheckIn already treats as a minor by default): the contact who
         -- gave it must be one the practice records as able to.
         or ct.can_consent
       )
  )
$$;
revoke execute on function app.session_consent_active(uuid, text) from public;
grant execute on function app.session_consent_active(uuid, text) to app_role;

------------------------------------------------------------------------------
-- The client's own completed visits, for "Session 12 of 30".
--
-- domain/session/sessionNumber.ts is the rule; this is the rows it folds.
-- Across every practitioner, because a programme is the client's and not one
-- practitioner's — which is precisely what practitioner_scope will not show,
-- and the one reason this door exists. It returns four columns and no fifth:
-- an id, a service, a status and a time. Nothing here identifies anybody.
--
-- Bounded at 500 rows: a wellness programme is 20 to 40 visits, so this is
-- three lifetimes of one, and a client with an implausible history cannot
-- turn one screen into an unbounded read.
------------------------------------------------------------------------------
-- Narrowed the same way as the door above: it serves the visit the
-- practitioner is standing in, so the session must still be open and the
-- practitioner must still be one the practice has working. "Session 12 of 30" is a line on a running
-- screen; nothing else has any business asking this.
create function app.session_history_for(p_session_id uuid)
returns table (
  id              uuid,
  service_type_id uuid,
  status          text,
  checked_in_at   timestamptz
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select h.id, h.service_type_id, h.status::text, h.checked_in_at
    from public.session s
    join public.practitioner p on p.id = s.practitioner_id
    join public.session h on h.client_id = s.client_id and h.tenant_id = s.tenant_id
   where s.id = p_session_id
     and s.tenant_id = app.current_tenant_id()
     and s.closed_at is null
     and s.status = 'in_progress'
     and p.tenant_id = app.current_tenant_id()
     and p.user_id = app.current_actor_id()
     and p.status = 'active'
   order by h.checked_in_at, h.id
   limit 500
$$;
revoke execute on function app.session_history_for(uuid) from public;
grant execute on function app.session_history_for(uuid) to app_role;

-- rollback:
--   drop function if exists app.session_history_for(uuid);
--   drop function if exists app.session_consent_active(uuid, text);
