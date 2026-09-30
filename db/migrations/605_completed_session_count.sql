-- 605_completed_session_count.sql
-- How many sessions a client completed between two recording days: the
-- figure a brain-map follow-up prints as "sessions completed, counted from
-- visits" (docs/SPEC/reports-qeeg.md section 10, the last paragraph; brief S,
-- fix round 1).
--
-- **Why a function, and why the rule is in SQL.** CLAUDE.md rule 4 keeps
-- business rules in `domain/`, and the rule is there:
-- `domain/reports/qeeg/sessionsCompleted.ts` (`countCompletedSessions`) is
-- its reference and its tests. This is the exception the review of brief S
-- recorded, and it is an access boundary answering one number. Session row
-- security (db/policies/session/practitioner_scope.sql) shows a practitioner
-- only the visits on her own row, so a count read as the caller depended on
-- who asked: a practitioner's save printed "counted from visits" over her
-- own visits alone, and the owner's next save changed the figure on the same
-- page. The count is the practice's, whoever asks. So it is made here, as the
-- definer, behind the same gate as drafting the report, and a test runs one
-- fixture through this function and through `countCompletedSessions` and
-- holds them to the same answer.
--
-- **Security definer means row security is not standing behind it.** Every
-- table is read on `tenant_id = app.current_tenant_id()`, and the practice's
-- time zone is read from its own tenant row, never taken from the caller.
-- These predicates are the only tenant isolation on this path.
--
-- **The gate, and a refusal is never 0.** The client must be this tenant's
-- and not erased (`app.client_status_for`), and the caller must hold
-- `report.draft` for the client, restated as 604's
-- `app.may_touch_report_figures` restates it: the owner, the lead
-- practitioner, or a practitioner the client is visible to
-- (`app.client_visible_to_practitioner`). An admin, finance, a household and
-- anyone else is refused with `insufficient_privilege`. A 0 would read as
-- "no visits", which is a statement about the client.
--
-- **What counts.** The client's `session` rows that are `completed` and
-- closed, whose day (the practice's day of `checked_in_at`) falls strictly
-- after `p_after` and strictly before `p_before`. A voided visit's status is
-- `voided`, so the status test leaves it out; no column newer than 302 is
-- named, because on a fresh database this file runs before 969 adds
-- `voided_at`. The route passes the new recording day as `p_before`, or the
-- day after today while the recording has no day, so "up to today, today
-- included" holds. Bounds that hold no day answer 0.
--
-- **plpgsql, not sql.** A `language sql` body cannot raise, and the refusal
-- must be an error and never a number. The body is one query behind the
-- gate; it is stable, and changes nothing.
--
-- Needs: 010 (tenant.timezone), 095 (app.actor_has_role), 100
-- (app.current_tenant_id, app.client_status_for), 201
-- (app.client_visible_to_practitioner), 300 (session), 302 (closed_at).

create function app.completed_session_count(p_client_id uuid, p_after date, p_before date)
returns integer
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_zone   text;
  v_count  integer;
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
    raise exception 'the sessions of that client are not yours to count'
      using errcode = 'insufficient_privilege';
  end if;

  select t.timezone into v_zone from public.tenant t where t.id = v_tenant;

  select count(*)::integer into v_count
    from public.session s
   where s.tenant_id = v_tenant
     and s.client_id = p_client_id
     and s.status::text = 'completed'
     and s.closed_at is not null
     and (s.checked_in_at at time zone coalesce(v_zone, 'Asia/Dubai'))::date > p_after
     and (s.checked_in_at at time zone coalesce(v_zone, 'Asia/Dubai'))::date < p_before;
  return v_count;
end
$$;
revoke execute on function app.completed_session_count(uuid, date, date) from public;
grant execute on function app.completed_session_count(uuid, date, date) to app_role;

-- rollback:
--   drop function if exists app.completed_session_count(uuid, date, date);
