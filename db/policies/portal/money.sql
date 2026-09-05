-- A young person's own login sees no figure (docs/SPEC/client-portal.md
-- sections 2, 5 and 6.5). Declarative and idempotent: the runner re-applies
-- this file on every migrate.
--
-- db/policies/billing/ledger.sql already admits a client contact to their own
-- client's money. This narrows that by one case and by one only: a contact
-- whose relationship is 'self' on a client under eighteen today.
-- app.actor_is_adult_contact_of (migration 702) is the question, asked in the
-- practice's own time zone, and domain/portal/money.ts asks the identical one
-- of the same rows before the route ever reads them.
--
-- **Restrictive, and written as "not a contact, or an adult contact".** A
-- restrictive policy can only narrow what a permissive one grants, so this can
-- never widen anybody's reach; and the first half of the condition is what
-- keeps every staff role untouched, including a staff member who is also a
-- contact of some client — they keep their staff reach, because the policy
-- asks whether they hold client_contact at all rather than assuming a person
-- is only ever one thing (docs/SPEC/00-data-model.md section 2: one user may
-- be several things at once).
--
-- The six tables are the ones a figure can be read from: what was bought, what
-- credits remain, what was invoiced and on which lines, what was paid, and
-- which rendered invoice or receipt exists. `client` itself is deliberately
-- not here — a young person still sees their own record, their visits and
-- their agreements — and neither is `appointment`.

do $$
declare
  t text;
begin
  foreach t in array array[
    'package_purchase', 'entitlement', 'invoice', 'invoice_line', 'payment', 'billing_document'
  ] loop
    execute format('drop policy if exists portal_money_adults on public.%I', t);
    execute format(
      'create policy portal_money_adults on public.%I as restrictive for select to app_role '
      'using (not app.actor_has_role(''client_contact'') '
      '       or app.actor_is_adult_contact_of(client_id))', t);
  end loop;
end
$$;
