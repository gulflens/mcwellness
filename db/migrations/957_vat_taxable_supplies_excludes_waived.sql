-- 957_vat_taxable_supplies_excludes_waived.sql
-- A fee the practice forgave is not a taxable supply
-- (docs/CHANGE-REQUESTS/billing-06.md request 2, and docs/SPEC/billing.md
-- section 4.3).
--
-- **What changes.** One clause, `and i.waived_at is null`, in the `where` of
-- `app.vat_taxable_supplies_fils(date)`. Everything else in the function --
-- the window, the role check, the practice in context, the security definer
-- reasoning -- is 953's, word for word.
--
-- **Why a forgiven fee does not count.** The function sums `invoice.net_fils`
-- over twelve months to say how close the practice is to the AED 375,000
-- registration threshold. A call-out fee the practice decided not to charge is
-- money nobody owes and nobody will pay: `app.billing_ledger` already stops
-- counting it (migration 408), and the invoice book shows it as waived. If it
-- counted here the practice would be pushed towards registering earlier than
-- the law asks, on the strength of charges it chose not to make. Round 31's
-- own default said over-counting is the safe way round for a warning; that
-- holds for a charge that stands and is unpaid, and not for one the practice
-- has forgiven, because forgiving it is the practice saying no supply was
-- charged for.
--
-- **It touches nothing else.** `waived_at` can only ever be set on a
-- `call_out_fee` invoice (`invoice_only_a_fee_is_waived`, migration 408), so
-- the clause is false for every session, package and statement invoice there
-- has ever been and the figure moves only where a fee was forgiven.
--
-- **Once the practice is registered for VAT this is not the mechanism.** A
-- taxable supply is undone by a credit note with its own number and its own
-- entry in the return, never by a flag (docs/SPEC/billing.md section 4.3).
-- `waived_at` is honest bookkeeping for an unregistered practice, and this
-- function is the watch that says when that period is ending.
--
-- **Replacing the function whole, not editing 953.** 953 is merged, and
-- `create or replace function` has no patch form, so the body below is 953's
-- with one clause added and the rollback carries 953's verbatim -- the way 408
-- carries 404's. A future migration that changes this function starts from
-- **this** body. `create or replace` keeps the privileges the function already
-- has, so 953's revoke from `public` and grant to `app_role` are not restated
-- here and are not lost: that is 954's precedent, which restated neither when
-- it replaced `app.erase_client`.
--
-- **Why the second half of the trunk's range.** It reads `invoice`, which is
-- billing's own table (docs/SPEC/OWNERSHIP.md), so it must sort after it, as
-- 953 does.
--
-- Needs: 953 (the function this replaces), 408 (invoice.waived_at)

create or replace function app.vat_taxable_supplies_fils(p_as_of date) returns bigint
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
     -- A call-out fee the practice forgave is a charge nobody owes, so it is
     -- not a supply to count towards the registration threshold.
     and i.waived_at is null
     and i.issued_on > (p_as_of - interval '12 months')::date
     and i.issued_on <= p_as_of;

  return v_total;
end
$$;

comment on function app.vat_taxable_supplies_fils(date) is
  'The practice''s taxable supplies, net of VAT, over the twelve months ending on the day '
  'given. A forgiven call-out fee is left out: the practice decided not to charge it, nobody '
  'owes it and app.billing_ledger has already stopped counting it, so counting it here would '
  'have the practice register for VAT earlier than the law asks (migration 957). Names no '
  'client and no invoice; steps past the erasure gate on purpose so the practice''s tax '
  'position does not move with who is looking (migration 953).';

-- rollback:
--   -- 953's body, verbatim: the same function without the waiver clause.
--   create or replace function app.vat_taxable_supplies_fils(p_as_of date) returns bigint
--   language plpgsql stable security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--     v_total     bigint;
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; the taxable supplies cannot be read.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     if p_as_of is null then
--       raise exception 'The day to count back from is required.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     if not (app.actor_has_role('owner')
--          or app.actor_has_role('admin')
--          or app.actor_has_role('finance')) then
--       raise exception 'the practice''s taxable supplies are not yours to read'
--         using errcode = 'insufficient_privilege';
--     end if;
--
--     select coalesce(sum(i.net_fils), 0)::bigint into v_total
--       from public.invoice i
--      where i.tenant_id = v_tenant_id
--        and i.issued_on > (p_as_of - interval '12 months')::date
--        and i.issued_on <= p_as_of;
--
--     return v_total;
--   end
--   $fn$;
--   comment on function app.vat_taxable_supplies_fils(date) is
--     'The practice''s taxable supplies, net of VAT, over the twelve months ending on the day '
--     'given. Names no client and no invoice; steps past the erasure gate on purpose so the '
--     'practice''s tax position does not move with who is looking (migration 953).';
