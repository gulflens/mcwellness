-- Row security for reports and their deliveries (docs/SPEC/reports-v1.md
-- sections 7.1 and 7.3). Declarative and idempotent: the runner re-applies
-- this file on every migrate.
--
-- Two layers, as everywhere else in this repository. `tenant_isolation` is
-- permissive and says only "your own practice"; every rule below is
-- restrictive, so it narrows that and never replaces it.
--
-- The audiences, from section 7.1:
--
--   owner, lead practitioner   draft, sign, issue, supersede and deliver
--   admin                      reads and delivers; never drafts, never signs
--   practitioner               drafts for a client on their own schedule, and
--                              signs only with the capability — which is a
--                              credential and not a row policy
--                              (domain/reports/canIssue.ts, app.issue_report)
--   client contact             issued reports for their own client, and a
--                              superseded version only where one was actually
--                              sent to the household
--   finance                    nothing at all, because a report is not money
--
-- **Finance is the one absence worth stating.** Every other client-scoped
-- table in this platform admits finance to a read, because money reaches
-- everywhere. A report is a household's most personal document and a
-- coordinator who records payments has no business in it; the specification
-- says so in as many words and this is where it is true.
--
-- A practitioner's reach goes through app.client_visible_to_practitioner
-- (201): ninety days back, thirty forward, confirmed visits only. A client
-- contact's goes through app.actor_is_contact_of (100). Neither is restated
-- here; both are asked.
--
-- Erasure. Both tables pass their client's status through
-- app.client_erasure_gate, exactly as db/policies/client/readers.sql does, so
-- an erased record's reports are visible only to the owner and the lead
-- practitioner. Migration 107 empties them of everything personal in any case.

------------------------------------------------------------------------------
-- 1. Tenant isolation.
------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['report', 'report_delivery', 'report_number_series'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to app_role '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())', t);
  end loop;
end
$$;

------------------------------------------------------------------------------
-- 2. Who may read a report.
--
--    The household's own line is the narrow one and it is the reason this
--    policy is not the same shape as billing's. A contact sees an issued
--    report for their own client, and a superseded one only where the practice
--    actually sent the household a copy — because "never a superseded version
--    they were not sent" is section 7.3's own sentence, and a version that was
--    delivered is one they may already be holding. `app.report_was_delivered`
--    (601) answers that as security definer, which is what keeps this out of a
--    policy loop through `report_delivery`'s own rules.
--
--    A draft is nobody's but the practice's, ever.
------------------------------------------------------------------------------
drop policy if exists report_readers on public.report;
create policy report_readers on public.report as restrictive for select to app_role using (
  app.client_erasure_gate(app.client_status_for(client_id)) and (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    or (
      app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id)
      and (status = 'issued' or (status = 'superseded' and app.report_was_delivered(id)))
    )
  )
);

------------------------------------------------------------------------------
-- 3. Who may write one.
--
--    Insert: the owner, the lead practitioner and a practitioner for a client
--    on their own schedule. An admin reads and delivers and never drafts
--    (section 7.1); finance is nowhere near it.
--
--    Update: the same three. Which updates are permitted is not this policy's
--    question — `app.guard_report_write` (600) refuses every change to an
--    issued row but filing its PDF and marking it superseded, and it raises
--    rather than hiding, because an edit that silently disappears is the one
--    thing a signed document must never allow.
--
--    Delete: granted to nobody at all (600), so it is refused at 42501 before
--    a policy is consulted.
------------------------------------------------------------------------------
drop policy if exists report_writers on public.report;
create policy report_writers on public.report as restrictive for insert to app_role
  with check (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  );

drop policy if exists report_amenders on public.report;
create policy report_amenders on public.report as restrictive for update to app_role
  using (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  )
  with check (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  );

------------------------------------------------------------------------------
-- 4. Deliveries.
--
--    Read by the practice: the delivery history sits under the report on the
--    console's own screen (section 4.3). A household is not shown the record
--    of what it was sent — it has the messages — and a delivery row carries a
--    contact id, which is the practice's bookkeeping about a family rather
--    than something the family reads back.
--
--    Written by the owner, an admin and the lead practitioner: the three
--    section 7.1 gives delivery to. A practitioner drafts and signs and does
--    not send.
--
--    Update and delete are granted to nobody (601) and refused by the guard
--    besides: a delivery happened or it did not.
------------------------------------------------------------------------------
drop policy if exists report_delivery_readers on public.report_delivery;
create policy report_delivery_readers on public.report_delivery
  as restrictive for select to app_role using (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  );

drop policy if exists report_delivery_writers on public.report_delivery;
create policy report_delivery_writers on public.report_delivery
  as restrictive for insert to app_role with check (
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin')
      or app.actor_has_role('lead_practitioner')
    )
  );
