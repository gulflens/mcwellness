-- Row security for a brain-map report's pictures (docs/SPEC/reports-qeeg.md
-- sections 9 and 13, migration 604). Declarative and idempotent: the runner
-- re-applies this file on every migrate.
--
-- The same two layers as reports.sql beside it: a permissive
-- `tenant_isolation` that says only "your own practice", and a restrictive
-- rule that narrows it.
--
-- **Read by the practice, never by the household.** The owner, an admin and
-- the lead practitioner read every report's links; a practitioner those of a
-- client on their own schedule (201). **No `client_contact` arm, on purpose**
-- (section 13): a map reaches a household inside a signed report and in no
-- other way, and a link row names the draft a picture was uploaded to, which
-- is the practice's work in progress. Finance is absent for the reason
-- reports.sql gives: a report is not money.
--
-- An erased record's links are removed by the erasure (972); the erasure gate
-- is asked anyway, as reports.sql asks it, so a link that somehow outlived one
-- is the owner's and the lead practitioner's to see and nobody else's.
--
-- **No write policy.** app_role holds select alone on this table (604); a
-- link arrives and leaves through `app.file_report_figure`,
-- `app.borrow_report_figure` and `app.remove_report_figure`, each of which
-- asks who is calling itself.

drop policy if exists tenant_isolation on public.report_figure;
create policy tenant_isolation on public.report_figure for all to app_role
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

drop policy if exists report_figure_readers on public.report_figure;
create policy report_figure_readers on public.report_figure as restrictive for select to app_role
  using (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  );
