-- Who may read a measurement, and who may record one
-- (docs/SPEC/assessment.md sections 4, 7 and 11).
--
-- **The household sees nothing, and that is a rule in the database rather than
-- a screen with no link on it.** No policy here grants `client_contact`
-- anything, so a contact reading their own client's assessments sees an empty
-- result — not a refusal that tells them something is there. A qEEG export
-- means nothing without the practitioner's reading of it, and the route by
-- which a measurement reaches a family is a signed report and only that
-- (docs/SPEC/reports-v1.md).
--
-- **Finance sees nothing either.** `docs/SPEC/client-record.md` section 2
-- gives that role demographics and contacts; a brain map is neither.
--
-- Restrictive, so these narrow the permissive tenant_isolation policy rather
-- than replacing it — the same layering db/policies/core uses. Declarative and
-- idempotent: the runner re-applies this file on every db:migrate, and a
-- policy change never needs a migration.

------------------------------------------------------------------------------
-- Reading. The practice's three oversight roles see every measurement; a
-- practitioner sees those of a client on their own schedule — ninety days
-- back, thirty forward, confirmed visits only
-- (201_client_visible_to_practitioner.sql). A practitioner off that client's
-- schedule sees nothing, and the route writes the attempt to the trail.
------------------------------------------------------------------------------
drop policy if exists assessment_read on public.assessment;
create policy assessment_read on public.assessment as restrictive for select to app_role
  using (
    app.actor_has_role('owner')
    or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
  );

------------------------------------------------------------------------------
-- Recording. A practitioner, for a client on their own schedule, or the lead
-- practitioner for any client of the practice — and either way, writing the
-- measurement against their own practitioner row.
--
-- Two halves, and both are needed. The reach half is the same door reading
-- uses. The own-row half is what stops one practitioner recording a
-- measurement in another's name: `performed_by_practitioner_id` says who took
-- it, and a record of who did a thing that anybody may write is not a record.
--
-- **The lead practitioner reaches every client of the practice**, as they
-- already do for reading, and this was the narrowing the fix round removed
-- (review gap 12, docs/CHANGE-REQUESTS/assessment-01.md, the amendment to
-- spec section 7). Oversight is what the role is for: a lead who has not
-- visited a household inside the ninety-day window could not correct a figure
-- in that household's record, nor type up a measurement they took on the
-- ninety-first day, which is the opposite of what an oversight role means.
-- What does not move with it: the own-row half above, so the correction still
-- names the lead as the person answerable for the new figures; the
-- credential, which `app.assessment_context` asks for the assessment's own
-- service at the moment of writing, because a new version is a recording; and
-- the household's consents, asked the same way.
--
-- An admin is deliberately absent: section 7.2 lets an admin file an export
-- against an assessment a practitioner recorded, and lets nobody who did not
-- take a measurement say that they did. The owner reaches this door as a
-- practitioner — a practitioner row and their own credential — not as a role.
--
-- The credential itself is not asked here: row security asks which rows, and
-- "does this person hold a valid certification for this service today" is a
-- different question, asked by `app.assessment_context` (migration 500) at the
-- moment of writing and refused with the reason named.
------------------------------------------------------------------------------
drop policy if exists assessment_record on public.assessment;
create policy assessment_record on public.assessment as restrictive for insert to app_role
  with check (
    (app.actor_has_role('lead_practitioner') or app.client_visible_to_practitioner(client_id))
    and performed_by_practitioner_id in (
      select id from public.practitioner
       where user_id = nullif(current_setting('app.actor_id', true), '')::uuid
         and tenant_id = app.current_tenant_id()
         and status = 'active'
    )
  );

------------------------------------------------------------------------------
-- The files behind a measurement follow the measurement: whoever may read the
-- assessment may see that a file is attached to it and ask for a link to it,
-- and nobody else. There is no insert policy at all — migration 501 grants
-- app_role none, and `app.file_assessment_document` is the only door.
------------------------------------------------------------------------------
drop policy if exists assessment_document_read on public.assessment_document;
create policy assessment_document_read on public.assessment_document
  as restrictive for select to app_role
  using (
    app.actor_has_role('owner')
    or app.actor_has_role('admin')
    or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
  );
