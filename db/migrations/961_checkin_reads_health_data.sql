-- 961_checkin_reads_health_data.sql
-- Needs: 060 (consent, consent_purpose), 098 (app.erasure_active, reached
--        through the same schema), 300 (session), 301 (app.checkin_context's first definition), 306
--        (its current definition, the one this replaces), 915 (the health_data value it reads)
--
-- The check-in door reads the health-data consent too.
--
-- Migration 915 made `health_data` required before a client can be activated.
-- Activation is a status, though, not a standing permission: a household may
-- withdraw the day after they are activated, and the page they signed says in
-- its own words that sessions cannot continue if they do, because there would
-- be nothing left to train on (docs/CONSENT/health-data.en.md).
--
-- `app.checkin_context` filtered the purposes it returned to the three the
-- gate used to read, so a withdrawal of `health_data` was invisible at the
-- door: `canCheckIn` cannot refuse what it is never told about, and the
-- practitioner's phone would have opened a visit on a household that had
-- taken its agreement back. Reading the consent at execution time rather than
-- trusting the client's status is `.claude/rules/compliance.md`'s rule, and
-- this is the half of it that lives in SQL.
--
-- **Only the filter changes.** The body below is migration 306's own, copied
-- whole so the two can be diffed, with one purpose added to one array and the
-- comment above it brought up to date. 306 replaced 301's version and added
-- the two kit columns, so 306 is the definition to copy: taking 301's would
-- have changed the return type back, which `create or replace` refuses.
--
-- Trunk file in the 950–999 half: it builds on `session` and on a function in
-- session-capture's range, so it must sort last (docs/SPEC/OWNERSHIP.md).

create or replace function app.checkin_context(p_client_id uuid, p_mrn text)
returns table (
  found                    boolean,
  client_id                uuid,
  has_date_of_birth        boolean,
  is_minor                 boolean,
  active_consent_purposes  text[],
  kit_calibration_overdue  boolean,
  kit_id                   uuid
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  with today_dubai as (
    -- Local midnight today, and tomorrow's, as real instants. See 301's own
    -- header for why day_end is derived from `today + 1` as a date rather than
    -- by adding a calendar interval to a timestamptz.
    select
      t.today,
      t.today::timestamp at time zone 'Asia/Dubai' as day_start,
      (t.today + 1)::timestamp at time zone 'Asia/Dubai' as day_end
    from (select (date_trunc('day', now() at time zone 'Asia/Dubai'))::date as today) as t
  ),
  caller as (
    select pr.id
      from public.practitioner pr
     where pr.user_id = nullif(current_setting('app.actor_id', true), '')::uuid
       and pr.tenant_id = app.current_tenant_id()
  ),
  carried as (
    -- Everything active the caller has with them. An unassigned item is not
    -- here at all, which is how "no item assigned is no block" is written.
    select k.id, k.kind, k.calibration_due_at
      from public.kit k
     where k.tenant_id = app.current_tenant_id()
       and k.status = 'active'
       and k.assigned_practitioner_id = (select id from caller)
  ),
  resolved as (
    select c.id, c.date_of_birth
      from public.client c
     where c.tenant_id = app.current_tenant_id()
       and (
         (p_client_id is not null and c.id = p_client_id)
         or (p_client_id is null and p_mrn is not null and c.mrn = p_mrn)
       )
  )
  select
    resolved_ctx.found as found,
    case when resolved_ctx.found then resolved_ctx.client_id end as client_id,
    resolved_ctx.found and resolved_ctx.has_date_of_birth as has_date_of_birth,
    resolved_ctx.found and resolved_ctx.is_minor as is_minor,
    case when resolved_ctx.found then resolved_ctx.active_consent_purposes else '{}'::text[] end
      as active_consent_purposes,
    -- The caller's own instruments, answered whatever found says.
    exists (
      select 1 from carried where carried.calibration_due_at < now()
    ) as kit_calibration_overdue,
    (
      -- Exactly one, or nothing: a second amplifier makes this null rather
      -- than making the record choose between them.
      select k.id from carried k
       where k.kind = 'amplifier'
         and (select count(*) from carried c where c.kind = 'amplifier') = 1
    ) as kit_id
  from (
    select
      resolved.id is not null and exists (
        select 1
          from public.appointment a, today_dubai t
         where a.tenant_id = app.current_tenant_id()
           and a.client_id = resolved.id
           and a.status in ('proposed', 'confirmed', 'checked_in')
           and a.practitioner_id = (select id from caller)
           and a.window_start < t.day_end
           and a.window_end > t.day_start
      ) as found,
      resolved.id as client_id,
      resolved.date_of_birth is not null as has_date_of_birth,
      coalesce(
        resolved.date_of_birth is not null
          and resolved.date_of_birth
              > ((select today from today_dubai) - interval '18 years')::date,
        false
      ) as is_minor,
      coalesce(
        (select array_agg(distinct co.purpose::text)
           from public.consent co
          where co.client_id = resolved.id
            and co.tenant_id = app.current_tenant_id()
            and co.status = 'active'
            and (co.expires_at is null or co.expires_at > now())
            and co.purpose = any(array['participation', 'minor_participation', 'home_visit', 'health_data']::public.consent_purpose[])),
        '{}'::text[]
      ) as active_consent_purposes
    from (select 1) as seed
    left join resolved on true
  ) as resolved_ctx
$$;

revoke execute on function app.checkin_context(uuid, text) from public;
grant execute on function app.checkin_context(uuid, text) to app_role;

-- rollback:
--   Re-apply db/migrations/301_checkin_context.sql's own definition of
--   app.checkin_context, which is the body above with 'health_data' absent
--   from the purpose filter. Nothing else here to undo: no table, no column,
--   no row, no grant that 301 did not also make.
--
--   Note what rolling back restores: a household that has withdrawn its
--   health-data consent becomes checkin-able again, because the door stops
--   being told. Pair it with reverting domain/session/canCheckIn.ts, or the
--   gate will look for a purpose the context never returns and refuse every
--   visit instead.
