-- Who may read the client aggregate (docs/SPEC/client-record.md section 2,
-- "Client Record Plan" PR 2). Restrictive, so each is combined with (never
-- replaces) the permissive tenant_isolation policy on the same table.
-- Declarative and idempotent: the runner re-applies this file on every
-- migrate.
--
-- Cross-table lookups go through app.client_status_for() and
-- app.actor_is_contact_of() (100_client_record.sql), not a raw subquery into
-- client or contact: a policy on contact that queried client directly, while
-- client's own policy queries contact back, is exactly what Postgres reports
-- as SQLSTATE 42P17, "infinite recursion detected in policy" — found the hard
-- way running the existing client and timeline database tests against this
-- file's first draft. Both helpers run through security definer, bypassing
-- row security themselves, which is what breaks the cycle.
--
-- Corrected after the compliance review of PR 2 round 2: finance reads client
-- and contact rows only, never location — the plan's note once said "client,
-- contact, location", but section 2 never granted locations and this is the
-- version that stands.

drop policy if exists client_record_readers on public.client;
create policy client_record_readers on public.client as restrictive for select to app_role using (
  app.client_erasure_gate(status) and (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or app.actor_has_role('finance')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(id))
    or (app.actor_has_role('client_contact') and app.actor_is_contact_of(id))
  )
);

drop policy if exists client_record_readers on public.contact;
create policy client_record_readers on public.contact as restrictive for select to app_role using (
  app.client_erasure_gate(app.client_status_for(client_id)) and (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or app.actor_has_role('finance')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
  )
);

-- Locations owned by a client follow the client aggregate rule below (finance
-- excluded); a tenant- or practitioner-owned location (the studio, a home
-- base) is operational, not client-sensitive, and finance still has no
-- business with it — only the four staff roles who work from it do.
drop policy if exists client_record_readers on public.location;
create policy client_record_readers on public.location as restrictive for select to app_role using (
  case owner_type
    when 'client' then
      app.client_erasure_gate(app.client_status_for(owner_id)) and (
        app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
        or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(owner_id))
        or (app.actor_has_role('client_contact') and app.actor_is_contact_of(owner_id))
      )
    else
      app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
      or app.actor_has_role('practitioner')
  end
);

-- Consent: no goals or session data for finance (section 2); everyone else
-- who may see the client's brief may see what they consented to.
drop policy if exists client_record_readers on public.consent;
create policy client_record_readers on public.consent as restrictive for select to app_role using (
  app.client_erasure_gate(app.client_status_for(client_id)) and (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
    or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
  )
);

-- Documents: the same scope as consent — owner, admin and the lead
-- practitioner all; finance none (section 2 gives finance demographics and
-- contacts only); a practitioner through the scheduling door; a client
-- contact their own. client_id is nullable here (a practice document, such as
-- a practitioner's certificate or a purpose's consent wording, files against
-- no client at all): app.client_status_for(null) finds no client row and
-- returns null, and null <> 'erased' is null, not true, so
-- app.client_erasure_gate would silently exclude every role but owner and
-- lead_practitioner from a document that was never client-sensitive in the
-- first place. A practice document is instead the same not-client-sensitive
-- case location.sql already has for a tenant- or practitioner-owned location:
-- visible to the same four staff roles who work from it, never finance, never
-- a client contact reading someone else's practice, whether erased or not.
drop policy if exists client_record_readers on public.document;
create policy client_record_readers on public.document as restrictive for select to app_role using (
  case when client_id is null then
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or app.actor_has_role('practitioner')
  else
    app.client_erasure_gate(app.client_status_for(client_id)) and (
      app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
      or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
      or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))
    )
  end
);

-- Goals: admin may view all (section 2) even though only the owner and the
-- lead practitioner may set or close one (writers.sql); finance and a client
-- contact see neither — a goal is practice-side, not portal-visible.
drop policy if exists client_record_readers on public.goal;
create policy client_record_readers on public.goal as restrictive for select to app_role using (
  app.client_erasure_gate(app.client_status_for(client_id)) and (
    app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
    or (app.actor_has_role('practitioner') and app.client_visible_to_practitioner(client_id))
  )
);

-- Erasure requests: the same short list as an erased client itself, plus
-- admin (recording one is an admin action, section 8; reading one's own
-- record of it follows).
drop policy if exists client_record_readers on public.erasure_request;
create policy client_record_readers on public.erasure_request as restrictive for select to app_role using (
  app.actor_has_role('owner') or app.actor_has_role('admin') or app.actor_has_role('lead_practitioner')
);
