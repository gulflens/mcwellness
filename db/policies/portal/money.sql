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
-- **Restrictive, and written as "not a household, or an adult of this one".**
-- A restrictive policy can only narrow what a permissive one grants, so this
-- can never widen anybody's reach.
--
-- The condition names the staff roles as well as asking whether the actor
-- holds client_contact, because one user may be several things at once
-- (docs/SPEC/00-data-model.md section 2) and the founder's own record is the
-- obvious case: a person who is both an admin and a contact of her own
-- child's record must keep her admin reach over every other household's
-- money. The spec's section 6.5 says exactly that — "a staff member who is
-- also a contact keeps their staff reach" — and the two-term predicate
-- printed beside the sentence does not deliver it: `not
-- actor_has_role('client_contact')` is false for such a person, so the
-- remaining term would narrow them to the households they are a contact of.
-- The sentence is the requirement and this is what satisfies it. The only
-- actor this policy narrows is one who holds client_contact and no practice
-- role at all, which is the household, which is the rule.
--
-- The seven tables are the ones a figure can be read from: what was bought,
-- what credits remain, what was invoiced and on which lines, what was paid,
-- which rendered invoice or receipt exists, and how long a programme was given
-- (`package_extension`, migration 410 — two dates and the sentence somebody
-- wrote about why the family asked for longer, which is exactly the kind of
-- sentence this gate exists for). `client` itself is deliberately not here — a
-- young person still sees their own record, their visits and their agreements
-- — and neither is `appointment`.
--
-- One source for one rule: a table that carries a figure or the reason behind
-- one joins this array rather than growing a second restrictive policy of its
-- own in whichever module happens to own it.

do $$
declare
  t text;
begin
  foreach t in array array[
    'package_purchase', 'entitlement', 'invoice', 'invoice_line', 'payment', 'billing_document',
    'package_extension'
  ] loop
    execute format('drop policy if exists portal_money_adults on public.%I', t);
    execute format(
      'create policy portal_money_adults on public.%I as restrictive for select to app_role '
      'using (not app.actor_has_role(''client_contact'') '
      '       or app.actor_has_role(''owner'') or app.actor_has_role(''admin'') '
      '       or app.actor_has_role(''lead_practitioner'') '
      '       or app.actor_has_role(''practitioner'') or app.actor_has_role(''finance'') '
      '       or app.actor_is_adult_contact_of(client_id))', t);
  end loop;
end
$$;
