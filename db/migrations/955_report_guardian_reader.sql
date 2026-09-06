-- 955_report_guardian_reader.sql
-- Who, of a household, may read a report about one of its people.
--
-- **The operator's decision of 2026-09-06, 06:15**, reversing default 4 of
-- pull request 83: a young person with their own portal login no longer reads
-- a practitioner's written summary of themselves. The first build showed it to
-- them, reasoning that `docs/SPEC/reports-v1.md` section 7.3 says "issued
-- reports for their own client" without narrowing, and named the reading as a
-- decision for the operator to take rather than one for the build. She has
-- taken it the other way: a report is a document a guardian receives and talks
-- a child through, and the portal is not where a child meets it alone.
--
-- **A guardian, or the person themselves once they are an adult.** That is the
-- whole of the rule. It is narrower than `app.actor_is_adult_contact_of` (702),
-- which the money screens ask: money admits every contact who is not a minor's
-- own login, because the household pays and a grandparent who settles an
-- invoice has business with a balance. A report is not the same kind of thing,
-- and a contact the practice has not recorded as a legal guardian has no
-- standing to read one.
--
-- **Age is decided in the practice's own time zone**, from `tenant.timezone`,
-- exactly as 702 decides it: "today" in Dubai is not "today" in UTC for four
-- hours of every day, and a birthday must not arrive early or late. A client
-- with no date of birth on file is treated as an adult, which is 702's rule
-- too and the same reasoning — the column is optional
-- (`docs/SPEC/00-data-model.md` section 3), and inventing a birthday to
-- withhold a document from an adult is the worse mistake.
--
-- **Security definer**, like `app.actor_is_contact_of` (100) beside it, so
-- `db/policies/reports/reports.sql` can ask it without `contact`'s and
-- `client`'s own restrictive policies being evaluated as part of answering —
-- which is what Postgres reports as SQLSTATE 42P17, infinite recursion
-- detected in policy.
--
-- **Why the trunk's range and not the reports stream's.** The policy file it
-- serves is `reports`', and the function could have lived in a `6xx`; but this
-- is an operator decision taken during the trunk's round and applied in the
-- trunk's pull request, and a stream's range is not the trunk's to write in.
-- The 950-999 half is where the trunk's work on another range's tables goes
-- (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 060 (client, contact), 600 (report)

create function app.actor_may_read_reports_of(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.contact ct
      join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
      join public.tenant t on t.id = cl.tenant_id
     where ct.client_id = p_client_id
       and ct.user_id = app.current_actor_id()
       and (
         -- A legal guardian, whoever they are to the child.
         ct.is_legal_guardian
         -- Or the person themselves, once they are an adult.
         or (
           ct.relationship = 'self'
           and (
             cl.date_of_birth is null
             or cl.date_of_birth
                <= ((now() at time zone t.timezone)::date - interval '18 years')::date
           )
         )
       )
  )
$$;
revoke execute on function app.actor_may_read_reports_of(uuid) from public;
grant execute on function app.actor_may_read_reports_of(uuid) to app_role;

comment on function app.actor_may_read_reports_of(uuid) is
  'Whether the calling contact may read a report about this client: a legal guardian, or the '
  'person themselves once they are an adult (operator decision 2026-09-06, reversing default 4 '
  'of pull request 83). Narrower than app.actor_is_adult_contact_of, which the money screens ask.';

-- rollback:
--   -- Put db/policies/reports/reports.sql back to the form that asks
--   -- app.actor_is_contact_of first: the runner re-applies every policy file
--   -- on each migrate and the policy below names the function dropped here.
--   drop policy if exists report_readers on public.report;
--   drop function if exists app.actor_may_read_reports_of(uuid);
