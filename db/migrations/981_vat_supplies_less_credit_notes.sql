-- 981_vat_supplies_less_credit_notes.sql
-- The figure that warns of the VAT registration threshold takes credit notes off.
--
-- **What changes.** `app.vat_taxable_supplies_fils(date)` summed
-- `invoice.net_fils` over the twelve months ending on the day given. A credit
-- note (migration 416, issued by 417) reduces a supply the practice made, so the
-- same function now subtracts `sum(credit_note.net_fils)` over the same window.
-- The window for a note is its own `issued_on`, not its invoice's: the
-- reduction belongs to the period the practice issued the note in.
--
-- **Unregistered invoices count.** A note on an invoice issued while the
-- practice was not registered for VAT still comes off. The owner's ruling is
-- that the supply was reduced, and the threshold is about what the practice
-- supplied, not about what it charged VAT on.
--
-- **Never below zero.** A note issued in the window may credit an invoice from
-- an earlier window, so the raw difference can be negative. The figure is
-- floored at zero: the practice settings read takes a non-negative integer,
-- and "no supplies in the window" is the honest reading of a net-negative one.
--
-- **Nothing else moves.** The role check, the practice in context, the waived
-- clause (957) and the security attributes are 957's word for word. `create or
-- replace` keeps the grants the function already has (953 revoked it from
-- `public` and granted it to `app_role`), so they are not restated. The
-- rollback restores 957's body verbatim.
--
-- Needs: 957 (the function this replaces), 416 (credit_note)

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

  -- A credit note undoes part of a supply, so its net comes off the same
  -- window, counted by the day the note was issued. It is not matched to the
  -- invoice's own day or registration: a note on an invoice issued while the
  -- practice was unregistered still reduces what it supplied. (A waived fee
  -- never has a note, 417 refuses one, so nothing is taken off twice.)
  -- The result is floored at zero: a note issued in the window can be on an
  -- invoice from an earlier window, and a supply total below nothing is not a
  -- figure the practice settings read (a non-negative integer) can carry.
  select greatest(v_total - coalesce(sum(c.net_fils), 0), 0) into v_total
    from public.credit_note c
   where c.tenant_id = v_tenant_id
     and c.issued_on > (p_as_of - interval '12 months')::date
     and c.issued_on <= p_as_of;

  return v_total;
end
$$;

comment on function app.vat_taxable_supplies_fils(date) is
  'The practice''s taxable supplies, net of VAT, over the twelve months ending on the day '
  'given, less the net of the credit notes issued in the same twelve months. A forgiven '
  'call-out fee is left out (migration 957). A credit note reduces the supply whether or not '
  'the practice was registered when the invoice was issued (migration 981). Names no client '
  'and no invoice; steps past the erasure gate on purpose so the practice''s tax position '
  'does not move with who is looking (migration 953).';

-- rollback:
--   -- 957's body, verbatim: the same function without the credit-note deduction.
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
--        -- A call-out fee the practice forgave is a charge nobody owes, so it is
--        -- not a supply to count towards the registration threshold.
--        and i.waived_at is null
--        and i.issued_on > (p_as_of - interval '12 months')::date
--        and i.issued_on <= p_as_of;
--
--     return v_total;
--   end
--   $fn$;
--   comment on function app.vat_taxable_supplies_fils(date) is
--     'The practice''s taxable supplies, net of VAT, over the twelve months ending on the day '
--     'given. A forgiven call-out fee is left out: the practice decided not to charge it, nobody '
--     'owes it and app.billing_ledger has already stopped counting it, so counting it here would '
--     'have the practice register for VAT earlier than the law asks (migration 957). Names no '
--     'client and no invoice; steps past the erasure gate on purpose so the practice''s tax '
--     'position does not move with who is looking (migration 953).';
