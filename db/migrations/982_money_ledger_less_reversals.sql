-- 982_money_ledger_less_reversals.sql
-- "Received this month" net of payments reversed
-- (docs/superpowers/specs/2026-10-23-payment-reversal-design.md, "Received this
-- month").
--
-- app.practice_money_ledger() (952) hands the monthly figures every payment as
-- an amount and a day. A payment reversed in error (419) must stop counting as
-- received, but in the month of the reversal: May's takings were what they
-- were when May closed. So the function also hands over each reversal as a
-- negative payment dated reversed_on, and domain/billing's monthlyMoney and
-- cashCollectedBetween, which add amounts by day, need no change.
--
-- **Same signature and result shape, so `create or replace` and no drop.**
-- Everything else about 952 stands: security definer, the role check, naming
-- nobody.
--
-- Needs: 952 (app.practice_money_ledger, replaced here), 419 (payment_reversal)

create or replace function app.practice_money_ledger() returns jsonb
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
  -- A reversed payment (419) comes off "received" in the month it was
  -- reversed, not the month it arrived: history stays true and the month of
  -- the correction carries the correction. It goes in as a negative payment
  -- dated reversed_on, which monthlyMoney and cashCollectedBetween add up
  -- like any other.
  select coalesce(jsonb_agg(x.row), '[]'::jsonb)
    into v_payments
    from (
      select jsonb_build_object(
               'amountFils', p.amount_fils,
               'receivedOn', to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
             ) as row
        from public.payment p
       where p.tenant_id = v_tenant_id
      union all
      select jsonb_build_object(
               'amountFils', -p.amount_fils,
               'receivedOn', to_char(r.reversed_on, 'YYYY-MM-DD')
             )
        from public.payment_reversal r
        join public.payment p on p.tenant_id = r.tenant_id and p.id = r.payment_id
       where r.tenant_id = v_tenant_id
    ) x;

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
  'purpose and checks the caller''s role itself (migration 952); 982 takes reversed payments off the month they were reversed in.';

revoke execute on function app.practice_money_ledger() from public;
grant execute on function app.practice_money_ledger() to app_role;

comment on function app.practice_money_ledger() is
  'The practice''s whole ledger for the monthly money figures, naming no client at all, so '
  'the month''s takings are the same figure whoever asks. Steps past the erasure gate on '
  'purpose and checks the caller''s role itself (migration 952); 982 takes reversed payments off the month they were reversed in.';

revoke execute on function app.practice_money_ledger() from public;
grant execute on function app.practice_money_ledger() to app_role;

-- rollback:
--   -- Restores 952's function body.
--   create or replace function app.practice_money_ledger() returns jsonb
--   language plpgsql stable security definer
--   set search_path = pg_catalog, pg_temp
--   as $$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--     v_payments  jsonb;
--     v_credits   jsonb;
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; the takings cannot be read.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     if not (app.actor_has_role('owner')
--          or app.actor_has_role('admin')
--          or app.actor_has_role('lead_practitioner')
--          or app.actor_has_role('finance')) then
--       raise exception 'the practice''s takings are not yours to read'
--         using errcode = 'insufficient_privilege';
--     end if;
--
--     -- Every payment, with the day it arrived in the practice's own zone and
--     -- nothing that says who made it.
--     select coalesce(jsonb_agg(jsonb_build_object(
--              'amountFils', p.amount_fils,
--              'receivedOn', to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
--            )), '[]'::jsonb)
--       into v_payments
--       from public.payment p
--      where p.tenant_id = v_tenant_id;
--
--     -- Every credit, with its state and the day it was used up. `allocated_net_fils`
--     -- is its share of what was paid; the status is what decides whether it is
--     -- earned, owed or neither, and that decision is domain/billing's.
--     select coalesce(jsonb_agg(jsonb_build_object(
--              'status', e.status,
--              'allocatedNetFils', e.allocated_net_fils,
--              'consumedOn', to_char(e.consumed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
--            )), '[]'::jsonb)
--       into v_credits
--       from public.entitlement e
--      where e.tenant_id = v_tenant_id;
--
--     return jsonb_build_object('payments', v_payments, 'credits', v_credits);
--   end
--   $$;
--
--   comment on function app.practice_money_ledger() is
--     'The practice''s whole ledger for the monthly money figures, naming no client at all, so '
--     'the month''s takings are the same figure whoever asks. Steps past the erasure gate on '
--     'purpose and checks the caller''s role itself (migration 952).';
--
--   revoke execute on function app.practice_money_ledger() from public;
--   grant execute on function app.practice_money_ledger() to app_role;
--
