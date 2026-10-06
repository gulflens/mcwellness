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
--   client contact             issued reports for the client they are a legal
--                              guardian of — or their own, once they are an
--                              adult — and a superseded version only where one
--                              was actually sent to the household
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
-- contact's goes through app.actor_may_read_reports_of (955). Neither is
-- restated here; both are asked.
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
--    report for a client they are a legal guardian of, or their own once they
--    are an adult, and a superseded one only where the practice actually sent
--    the household a copy — because "never a superseded version they were not
--    sent" is section 7.3's own sentence, and a version that was delivered is
--    one they may already be holding. `app.report_was_delivered` (601) answers
--    that as security definer, which is what keeps this out of a policy loop
--    through `report_delivery`'s own rules.
--
--    **A minor's own login reads no report about themselves** (operator
--    decision 2026-09-06, reversing default 4 of pull request 83). It is
--    `app.actor_may_read_reports_of` (955) that says so, and not a screen that
--    leaves a row out: a report is a document a guardian receives and talks a
--    child through, and hiding it in a browser while the row is still readable
--    is the pattern this repository refuses everywhere else.
--
--    A draft is nobody's but the practice's, ever. So is a past record brought
--    in from the old tool (status `imported`, docs/SPEC/reports-qeeg.md section
--    11): it was printed once, by that tool, and is kept so a follow-up can be
--    compared with it, never to be read here. It is left out by the same
--    clause that leaves a draft out — the household's line names the two
--    statuses it may read, and `imported` is neither.
--
--    An uploaded report (kind `external`, migration 608) needs no line of its
--    own: it is filed `issued`, so a guardian reads it as any issued report
--    of their client, and every arm here is asked of it unchanged. Its title
--    sits in `content`, on this row, so the portal reads it without joining
--    any table the household's reach leaves out.
------------------------------------------------------------------------------
drop policy if exists report_readers on public.report;
create policy report_readers on public.report as restrictive for select to app_role using (
  app.client_erasure_gate(app.client_status_for(client_id)) and (
    app.actor_has_role('owner') or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    or (
      app.actor_has_role('client_contact') and app.actor_may_read_reports_of(client_id)
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
--    **Bringing a file in is the owner's and the lead practitioner's**
--    (docs/CHANGE-REQUESTS/reports-02.md, request 6: `report.import`). A row
--    that carries a source — a draft read from the old tool's file — is
--    written, inserted or updated, by those two alone, so the rule is not only
--    the route's. A practitioner drafts and edits the brain maps written here.
--    The rule stands on both sides of an update: in USING, so a practitioner
--    cannot reach a row that carries a source at all — not even to clear the
--    source and turn the old file's content into an ordinary draft she could
--    sign (section 11 forbids it) — and in WITH CHECK, so she cannot write a
--    source onto a draft of her own. Row security answers the first by
--    leaving the row out (the update touches nothing), the second by refusing
--    at 42501.
--
--    **Never a past record in one step.** A row brought in from the old tool
--    is saved as a draft, read over, and kept by `app.keep_imported_report`
--    (603), which the guard lets only the owner and the lead practitioner
--    through. Inserting one already `imported` would walk round both, so the
--    API role may not.
--
--    **Never an uploaded report by hand.** A PDF made in another tool is
--    filed already issued, with its document, through
--    `app.file_external_report` (608), which asks the same three roles and the
--    same reach as this policy and writes the document row a practitioner may
--    not write herself. A direct insert of one would skip the number, the
--    snapshots and the document, so the API role may not (`kind <>
--    'external'`), as it may not insert a past record already kept.
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
    status <> 'imported'
    and kind <> 'external'
    and (imported_from is null or app.actor_has_role('owner')
         or app.actor_has_role('lead_practitioner'))
    and app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  );

drop policy if exists report_amenders on public.report;
create policy report_amenders on public.report as restrictive for update to app_role
  using (
    (imported_from is null or app.actor_has_role('owner')
     or app.actor_has_role('lead_practitioner'))
    and app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    )
  )
  with check (
    (imported_from is null or app.actor_has_role('owner')
     or app.actor_has_role('lead_practitioner'))
    and app.client_erasure_gate(app.client_status_for(client_id)) and (
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
