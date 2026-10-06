-- 706_portal_marketing_consent.sql
-- The marketing consent, given and withdrawn by an adult on their own portal
-- (the push memo's decision 1, docs/OPERATOR/2026-09-17-push-notifications.md,
-- answered "as recommended" on 6 October 2026; the wording is
-- docs/CONSENT/marketing.en.md and .ar.md, version 1.0, approved the same day).
--
-- **The existing `consent` table and purpose, and one new method.** The
-- `marketing` purpose has been in `consent_purpose` since 060 and was never
-- offered; the table already points every row at the exact wording shown
-- (`text_document_id`), is audited (080) and erasure already reaches it. What
-- it had no word for is how this consent is given: not a signature drawn on a
-- pad, not a paper form, not a witnessed word at a visit, but a switch the
-- person turned on their own portal beside the wording they read. So
-- `consent_method` gains `portal_switch`, and nothing else in the schema
-- changes. `signature_document_id` stays null on these rows, honestly: there
-- is no drawing to file, and the switch is the evidence the audit row keeps.
--
-- **The first consent the portal itself records and withdraws**, so it is
-- kept to this one purpose in the only way the database can promise it: the
-- household has no write on `consent` at all (db/policies/client/writers.sql
-- is the office's floor and stays so), and the two functions below are the
-- portal's whole reach. Each writes `marketing` and nothing else, as the
-- person signed in and for nobody else, and refuses a young person's own
-- login outright.
--
-- **The person's, filed per record.** The wording says "you, an adult, on your
-- own portal sign-in, and nobody else on your record", so the consent is the
-- person's; the table files consents per client. Giving it therefore writes
-- one row on each record, not erased, that the person is a contact of — a
-- mother of two files two — each `given_by_contact_id` her own contact row on
-- that record and each pointing at the one wording she read. Withdrawing
-- withdraws every standing row at once, in one statement. Whether offers may
-- reach her is read across her own rows only (domain/portal/marketing.ts,
-- `marketingStanding`; 707's `app.push_audience`), never across another
-- adult's on the same record, so a father's switch is never the mother's.
--
-- **One press, at once.** A withdrawal is an update in the request's own
-- transaction; the next send reads the rows as they are then
-- (app/api/portal/push.ts). Nothing is cached anywhere.
--
-- Needs: 060 (consent, consent_method, contact, client, document), 095
-- (app.actor_has_role), 099, 100 (app.current_actor_id), 705
-- (app.actor_reads_announcements).
--
-- **And the wording's columns, which arrive later in the numbering.**
-- `document.purpose`, `locale`, `version`, `status` and `retired_at` are the
-- trunk's 902, which sorts after this file, so on a fresh database they do not
-- exist yet when this runs. Every function below is therefore plpgsql, whose
-- statements are planned at their first execution rather than at creation —
-- by which time every migration has run on any database a request can reach
-- (703 met the same ordering and said so).

alter type consent_method add value if not exists 'portal_switch';

------------------------------------------------------------------------------
-- 1. app.portal_marketing_wording(locale) — the wording the switch stands
--    beside.
--
--    A household reads no `document` row it was not shown (the read policies
--    of 090 and 703's own note), and the current marketing wording is exactly
--    such a row until the person has read it. So this answers the one thing
--    the switch needs — the practice's current approved, unretired marketing
--    wording in this language: its id, its version and where its bytes live —
--    and nothing else. The wording is the practice's own words, published to
--    every household; there is nothing about anybody in the answer.
------------------------------------------------------------------------------
create function app.portal_marketing_wording(p_locale locale)
returns table (id uuid, version text, storage_key text)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return query
  select d.id, d.version, d.storage_key
    from public.document d
   where d.tenant_id = app.current_tenant_id()
     and d.kind = 'consent_text'
     and d.purpose = 'marketing'
     and d.locale = p_locale
     and d.status = 'approved'
     and d.retired_at is null;
end
$$;
revoke execute on function app.portal_marketing_wording(locale) from public;
grant execute on function app.portal_marketing_wording(locale) to app_role;

------------------------------------------------------------------------------
-- 2. app.portal_give_marketing_consent(wording) — the switch, turned on.
--
--    As the person signed in, and only for them:
--      * a household's login (`client_contact`), an adult of some household
--        and never a young person's own login on any record
--        (app.actor_reads_announcements, 705) — else 42501;
--      * the wording named is the practice's current approved marketing
--        wording, in either language — else 23514, hint `wording_not_current`;
--      * nothing already standing — else 23505, hint `already_given`.
--    Then one row per record, not erased, the person is a contact of. Answers
--    the ids it wrote. plpgsql, not sql, because the new enum value above may
--    not be named in a statement parsed in this migration's own transaction.
------------------------------------------------------------------------------
create function app.portal_give_marketing_consent(p_wording_id uuid)
returns setof uuid
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_actor is null or v_tenant is null
     or not app.actor_has_role('client_contact')
     or not app.actor_reads_announcements() then
    raise exception 'the marketing consent is given by an adult, on their own portal'
      using errcode = 'insufficient_privilege', hint = 'marketing_not_offered';
  end if;

  if not exists (
    select 1 from public.document d
     where d.id = p_wording_id
       and d.tenant_id = v_tenant
       and d.kind = 'consent_text'
       and d.purpose = 'marketing'
       and d.status = 'approved'
       and d.retired_at is null
  ) then
    raise exception 'that is not the practice''s current marketing wording'
      using errcode = 'check_violation', hint = 'wording_not_current';
  end if;

  -- One person's rows at a time: two presses at once end with one set.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('portal_marketing_consent:' || v_actor::text, 0));

  if exists (
    select 1
      from public.consent cs
      join public.contact ct on ct.id = cs.given_by_contact_id and ct.tenant_id = cs.tenant_id
      join public.client cl on cl.id = cs.client_id and cl.tenant_id = cs.tenant_id
     where cs.tenant_id = v_tenant
       and cs.purpose = 'marketing'
       and cs.status = 'active'
       and ct.user_id = v_actor
       and cl.status <> 'erased'
  ) then
    raise exception 'the marketing consent already stands'
      using errcode = 'unique_violation', hint = 'already_given';
  end if;

  return query
  insert into public.consent (tenant_id, client_id, given_by_contact_id, purpose, version,
                              text_document_id, status, given_at, method, created_by)
  select ct.tenant_id, ct.client_id, ct.id, 'marketing', 1, p_wording_id, 'active', now(),
         'portal_switch', v_actor
    from public.contact ct
    join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
   where ct.tenant_id = v_tenant
     and ct.user_id = v_actor
     and cl.status <> 'erased'
   order by ct.client_id
  returning id;
end
$$;
revoke execute on function app.portal_give_marketing_consent(uuid) from public;
grant execute on function app.portal_give_marketing_consent(uuid) to app_role;

------------------------------------------------------------------------------
-- 3. app.portal_withdraw_marketing_consent() — the switch, turned off.
--
--    One press: every standing marketing row the person gave, on every
--    record, withdrawn now, in one statement. Answers how many. A young
--    person's own login has nothing to withdraw and is refused like any
--    other caller who is not a household's (42501); an adult who has nothing
--    standing is answered 0, and the route says so. Withdrawing is never
--    refused for being an adult of the wrong kind: stopping is always open.
------------------------------------------------------------------------------
create function app.portal_withdraw_marketing_consent()
returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_tenant uuid := app.current_tenant_id();
  v_count integer;
begin
  if v_actor is null or v_tenant is null or not app.actor_has_role('client_contact') then
    raise exception 'the marketing consent is withdrawn by the person who gave it'
      using errcode = 'insufficient_privilege', hint = 'marketing_not_offered';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('portal_marketing_consent:' || v_actor::text, 0));

  update public.consent cs
     set status = 'withdrawn', withdrawn_at = now()
    from public.contact ct, public.client cl
   where ct.id = cs.given_by_contact_id and ct.tenant_id = cs.tenant_id
     and cl.id = cs.client_id and cl.tenant_id = cs.tenant_id
     and cs.tenant_id = v_tenant
     and cs.purpose = 'marketing'
     and cs.status = 'active'
     and ct.user_id = v_actor
     and cl.status <> 'erased';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.portal_withdraw_marketing_consent() from public;
grant execute on function app.portal_withdraw_marketing_consent() to app_role;

-- rollback:
--   drop function if exists app.portal_withdraw_marketing_consent();
--   drop function if exists app.portal_give_marketing_consent(uuid);
--   drop function if exists app.portal_marketing_wording(locale);
--   -- A value cannot be dropped from an enum. Rows written with
--   -- `portal_switch` keep it; a rollback leaves the value standing and
--   -- unused, and says so here rather than pretending otherwise.
