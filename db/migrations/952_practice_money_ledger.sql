-- 952_practice_money_ledger.sql
-- The takings figure that is the same whoever asks
-- (docs/PLAN/pieces-seven-to-nine.md, "Small things folded into the shared
-- rounds", the first of them).
--
-- **What was wrong.** `GET /api/billing/summary` answers three facts about the
-- practice — cash collected in a month, revenue recognised in it, and what is
-- still owed in sessions — by reading `payment` and `entitlement` as the
-- caller and handing the rows to `monthlyMoney` (domain/billing/recognition.ts).
-- Read as the caller, those tables pass through `app.client_erasure_gate`
-- (db/policies/billing/ledger.sql), which shows an erased household's money to
-- the owner and the lead practitioner and to nobody else. So in any month
-- holding an erased household, finance was shown a smaller month's takings
-- than the owner, with nothing on the screen to say why.
--
-- That is the wrong answer for a figure about the practice. The rows are kept
-- for five years precisely because tax law asks it of the business
-- (CLAUDE.md rule 8), and a total that quietly moves with who is looking is
-- worse than one that is refused.
--
-- **The rule the gate is protecting is about the household, not the total.**
-- What must not leak after an erasure is *whose* money it was. So this
-- function names nobody: no client id, no invoice, no reference, nothing but
-- an amount and the day it belongs to. Adding those amounts up is what a
-- month's takings is.
--
-- **It reads the ledger and adds up nothing.** The three figures are
-- `monthlyMoney`'s arithmetic and stay there (CLAUDE.md rule 4: business rules
-- live in `domain/` as pure functions with tests). Restating recognition and
-- deferral in SQL would be a second implementation of a rule that already has
-- one, and the two would disagree the first time either changed. A month is
-- not an argument here either, and deliberately: the deferred balance is a
-- position at a moment rather than a total for a period, so the caller needs
-- the whole ledger and `monthlyMoney` does the filtering.
--
-- **security definer, and checked.** The definer is what steps past the
-- erasure gate; the role check below is what keeps that from being a way for
-- anybody at all to read the practice's takings. The audience is
-- `billing.invoice.read`'s — the owner, an admin, the lead practitioner and
-- finance — said here as well as in the route, because a security definer
-- function that trusts its caller is a hole with a comment on it.
--
-- **Why the second half of the trunk's range.** It reads `payment` and
-- `entitlement`, which are billing's own tables (docs/SPEC/OWNERSHIP.md), so
-- it must sort after them.
--
-- Needs: 010 (tenant), 095 (app.actor_has_role, app.current_tenant_id), 402
-- (payment), 403 (entitlement)

create function app.practice_money_ledger() returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_payments  jsonb;
  v_credits   jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; the takings cannot be read.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('lead_practitioner')
       or app.actor_has_role('finance')) then
    raise exception 'the practice''s takings are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;

  -- Every payment, with the day it arrived in the practice's own zone and
  -- nothing that says who made it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'amountFils', p.amount_fils,
           'receivedOn', to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
         )), '[]'::jsonb)
    into v_payments
    from public.payment p
   where p.tenant_id = v_tenant_id;

  -- Every credit, with its state and the day it was used up. `allocated_net_fils`
  -- is its share of what was paid; the status is what decides whether it is
  -- earned, owed or neither, and that decision is domain/billing's.
  select coalesce(jsonb_agg(jsonb_build_object(
           'status', e.status,
           'allocatedNetFils', e.allocated_net_fils,
           'consumedOn', to_char(e.consumed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
         )), '[]'::jsonb)
    into v_credits
    from public.entitlement e
   where e.tenant_id = v_tenant_id;

  return jsonb_build_object('payments', v_payments, 'credits', v_credits);
end
$$;

comment on function app.practice_money_ledger() is
  'The practice''s whole ledger for the monthly money figures, naming no client at all, so '
  'the month''s takings are the same figure whoever asks. Steps past the erasure gate on '
  'purpose and checks the caller''s role itself (migration 952).';

revoke execute on function app.practice_money_ledger() from public;
grant execute on function app.practice_money_ledger() to app_role;

-- rollback:
--   drop function if exists app.practice_money_ledger();
