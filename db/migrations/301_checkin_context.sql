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
-- phone, no email, no Emirates ID: the route has never needed a name to check
-- someone in, and this function makes that a property of what can be asked
-- for, not merely of what the route happens to select today. status rides
-- along for the caller to use later; this pull request adds no new refusal
-- reason from it; the route's rules are exactly as they were.
--
-- Bound to the caller's own tenant, not the row's: a client id belonging to
-- another tenant is exactly as invisible to this function as it was to the
-- old direct read, and found = false is how the route already recognises
-- "no such client here" (previously an empty result set from the direct
-- select). The function always returns exactly one row — a left join against
-- a single synthetic row, not a plain select — so found is a value the caller
-- reads, never an absent row it has to infer the meaning of.
--
-- Needs 060 (client, consent, contact — the tables this function reads) and
-- 300 (session, whose own tenant-bound, security-definer pattern this file
-- mirrors). Written to apply cleanly whether or not client-record's 100 is
-- present: nothing here reads a table or function that migration adds.

create function app.checkin_context(p_client_id uuid)
returns table (
  found                    boolean,
  status                   public.client_status,
  has_date_of_birth        boolean,
  is_minor                 boolean,
  active_consent_purposes  text[]
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    c.id is not null as found,
    c.status,
    c.date_of_birth is not null as has_date_of_birth,
    -- "Minor" is judged on today's date in the practice's own zone (Asia/Dubai,
    -- matching domain/session/canCheckIn.ts's PRACTICE_TIME_ZONE), never the
    -- server's own timezone setting or the client's. extract(year from age(...))
    -- counts whole years the same way a birthday does, the same rule
    -- domain/shared/dates.ts's ageOn implements in application code.
    coalesce(
      c.date_of_birth is not null
        and extract(year from age((now() at time zone 'Asia/Dubai')::date, c.date_of_birth)) < 18,
      false
    ) as is_minor,
    -- Filtered to the three purposes canCheckIn's gate actually reads
    -- (domain/session/types.ts's CheckInConsentPurpose): photo_video, research
    -- and marketing consent are real rows this client may have, but they are
    -- not this door's business and this function never hands them out.
    coalesce(
      (select array_agg(distinct co.purpose::text)
         from public.consent co
        where co.client_id = c.id
          and co.tenant_id = app.current_tenant_id()
          and co.status = 'active'
          and (co.expires_at is null or co.expires_at > now())
          and co.purpose = any(array['participation', 'minor_participation', 'home_visit']::public.consent_purpose[])),
      '{}'::text[]
    ) as active_consent_purposes
  from (select 1) as seed
  left join public.client c
    on c.id = p_client_id and c.tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.checkin_context(uuid) from public;
grant execute on function app.checkin_context(uuid) to app_role;

-- rollback:
--   drop function if exists app.checkin_context(uuid);
