-- 606_client_completed_visits.sql
-- A client's completed visits, as a progress report reads them, the same
-- whoever of the practice writes the report (round 71; the operator's decision
-- of 6 October 2026).
--
-- A progress report reads a client's completed visits (the day, the signal
-- quality, the training figures) in app/api/reports/gather.ts. It read them as
-- the caller, under `practitioner_scope` (db/policies/session), so a
-- practitioner's report held only the visits she had run herself. The
-- practice has one practitioner and her family help; the operator decided a
-- report covers every visit of the client. This function reads them on the
-- practice's behalf, behind the same gate as drafting a report, as 605 counts
-- them for a brain-map report.
--
-- **Business logic in SQL, by exception** (CLAUDE.md rule 4), as 605: the
-- rule is only "this client's completed visits", the one the query in
-- gather.ts already held; it moves here because row security would otherwise
-- make the answer depend on who asks.
--
-- **The gate** restates `report.draft` as 604's `may_touch_report_figures`
-- and 605 do: the owner, a lead practitioner, or a practitioner with the
-- client on her schedule (`app.client_visible_to_practitioner`). An admin,
-- finance, a coordinator and a household never pass. The client must be of
-- the caller's practice and not erased. A refusal is `insufficient_privilege`,
-- never an empty answer, so a report is never written over visits it was not
-- allowed to see.
--
-- **The day** is the check-in's day in the zone the caller names, as the query
-- it replaces did (the practice's own zone, passed by the route).
--
-- Needs: 000 (app.current_tenant_id), 095 (app.actor_has_role), 100
-- (app.client_status_for, app.client_visible_to_practitioner), 302
-- (session.signal_quality_score, telemetry), 605 (the gate's shape).

create function app.client_completed_visits(p_client_id uuid, p_zone text)
returns table (id uuid, on_day text, signal_quality_score numeric, telemetry jsonb)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null
     or app.client_status_for(p_client_id) is null
     or app.client_status_for(p_client_id)::text = 'erased'
     or not (
       app.actor_has_role('owner')
       or app.actor_has_role('lead_practitioner')
       or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(p_client_id))
     )
  then
    raise exception 'the visits of that client are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id,
           to_char(s.checked_in_at at time zone p_zone, 'YYYY-MM-DD'),
           s.signal_quality_score,
           s.telemetry
      from public.session s
     where s.tenant_id = v_tenant
       and s.client_id = p_client_id
       and s.status::text = 'completed'
     order by s.checked_in_at, s.id;
end
$$;

revoke execute on function app.client_completed_visits(uuid, text) from public;
grant execute on function app.client_completed_visits(uuid, text) to app_role;

-- rollback:
--   drop function if exists app.client_completed_visits(uuid, text);
