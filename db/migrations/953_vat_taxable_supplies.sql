-- 953_vat_taxable_supplies.sql
-- What the practice has supplied over the trailing twelve months, so the
-- settings page can say where it stands against the two VAT registration
-- marks (docs/PLAN/pieces-seven-to-nine.md, "Small things folded into the
-- shared rounds", the VAT threshold watch).
--
-- **Net of VAT, from issued invoices.** Prices in this platform are net and
-- VAT is added on top (migration 406), so `invoice.net_fils` is the supply and
-- `vat_fils` is the tax on it. An invoice row is the moment a supply is made
-- as far as the practice's own books are concerned: `invoice` grants no update
-- and no delete, so a row is issued once and never unsaid.
--
-- **Every kind of invoice counts.** The practice writes two today — a visit
-- and a package sale (404, and the sale route) — and a `statement` kind exists
-- that nothing writes. Counting all of them is the conservative way round for
-- a warning: over-counting brings the warning early, and under-counting brings
-- it late, which is the one that costs a penalty. If a `statement` ever
-- becomes a re-presentation of charges already invoiced, it has to be excluded
-- here, and that is a change to this function with a reason.
--
-- **The date is an argument.** No clock is read inside: the caller says which
-- day it is asking about, so the figure is testable and so that the practice's
-- own time zone is decided in one place rather than in a function nobody
-- looks at. The window is the twelve months *before* that day, up to and
-- including it, which is the authority's "previous twelve months".
--
-- **security definer, for the same reason 952 is.** `invoice` passes through
-- `app.client_erasure_gate` when it is read as the caller
-- (db/policies/billing/ledger.sql), so an erased household's invoices would
-- drop out of an admin's figure and the practice's own tax position would
-- quietly move with who was looking at it. It names nobody: one integer comes
-- back and nothing else. The role check is here as well as in the route,
-- because a security definer function that trusts its caller is a hole with a
-- comment on it — the audience is the settings screen's, the owner and an
-- admin, and finance beside them because the figure is a bookkeeper's
-- question even though the screen is not theirs.
--
-- **It decides nothing.** The switch stays a hand's act (migration 905, and
-- the plan): an invoice may not carry VAT until the authority has issued the
-- number the row requires, and the thirty-day forward test cannot be computed
-- from a ledger at all.
--
-- **Why the second half of the trunk's range.** It reads `invoice`, which is
-- billing's own table (docs/SPEC/OWNERSHIP.md), so it must sort after it.
--
-- Needs: 010 (tenant), 095 (app.actor_has_role, app.current_tenant_id), 402
-- (invoice, and its net_fils and issued_on)

create function app.vat_taxable_supplies_fils(p_as_of date) returns bigint
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_total     bigint;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; the taxable supplies cannot be read.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_as_of is null then
    raise exception 'The day to count back from is required.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('finance')) then
    raise exception 'the practice''s taxable supplies are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(i.net_fils), 0)::bigint into v_total
    from public.invoice i
   where i.tenant_id = v_tenant_id
     and i.issued_on > (p_as_of - interval '12 months')::date
     and i.issued_on <= p_as_of;

  return v_total;
end
$$;

comment on function app.vat_taxable_supplies_fils(date) is
  'The practice''s taxable supplies, net of VAT, over the twelve months ending on the day '
  'given. Names no client and no invoice; steps past the erasure gate on purpose so the '
  'practice''s tax position does not move with who is looking (migration 953).';

revoke execute on function app.vat_taxable_supplies_fils(date) from public;
grant execute on function app.vat_taxable_supplies_fils(date) to app_role;

-- rollback:
--   drop function if exists app.vat_taxable_supplies_fils(date);
