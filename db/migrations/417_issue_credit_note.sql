-- 417_issue_credit_note.sql
-- Issuing a credit note, in one transaction; the ledger that shows it; and the
-- fee waiver handing a registered invoice over to it.
--
-- 416 built the document's tables and gave `entitlement_status` the value
-- `credited`. A new enum value cannot be used in the transaction that adds it,
-- so everything that names it is here: the check that a credited credit names
-- its note, and the function that writes one.
--
-- **The function mirrors a pure rule, and a test holds them together.** What a
-- note may credit is `domain/billing/creditNote.ts`'s `creditableFor` (CLAUDE.md
-- rule 4: rules live in domain). The database is the only writer of a note —
-- the invoice must be locked with the credits behind it while the figures are
-- worked out, and that cannot be done from above the database — so the rule is
-- restated in plpgsql below, branch for branch, and
-- tests/billing/db/credit_note_issue.test.ts ("the SQL agrees with
-- creditableFor on every seeded kind") feeds both the same rows and compares
-- every figure written. 408 did the same for the call-out fee rule.
--
--   - Refusals, in creditableFor's order: client_erased, statement, waived,
--     already_credited, nothing_left. Raised as
--     'credit_note_refused:<refusal>' for the route to map to 409.
--   - A package: the allocated net of its available credits, spread over the
--     invoice's lines in order, no line more than its own net, the VAT in
--     proportion (proportionalVat: half away from zero, never more than the
--     line's VAT). All of it comes off sessions owed (released_net_fils).
--   - A sold-ahead session whose credit is unused — or a delivered visit's
--     invoice whose credit a void gave back (969 writes an available
--     replacement on the same invoice; the spec's settled answer) — the whole
--     net, proportional VAT (which is the line's own VAT at a whole credit),
--     all of it released.
--   - Anything else creditable: the whole invoice, each line's VAT copied
--     exactly, nothing released.
--
-- **Locks before arithmetic.** The invoice row is taken `for no key update`,
-- then every credit behind it `for update`, and the available credits are
-- read and locked again in the one statement that counts them. A visit
-- closing at the same moment either already holds its credit — and the note
-- waits, then reads it as consumed — or finds it locked:
-- app.oldest_available_entitlement steps over a locked credit (`skip locked`,
-- 404), so the visit charges itself instead. No credit is ever both consumed
-- and credited. Two notes on one invoice queue on the invoice row; the second
-- sees the first and is refused already_credited (and
-- credit_note_one_per_invoice is the guarantee behind the courtesy).
--
-- **Why `no key update` and not `update`.** A void (969) locks the consumed
-- credit and then writes its replacement, whose foreign key to the invoice
-- takes `for key share` on the invoice row. `for update` conflicts with that
-- and the two would deadlock — the void holding the credit and waiting on the
-- invoice, the note holding the invoice and waiting on the credit. `for no key
-- update` lets the key share through, and still conflicts with a second
-- issuer and with the waiver's own update of the row. A replacement committed
-- while the note waited is then seen, and locked, by the statement that reads
-- the available credits.
--
-- **And the audit chain before any of it.** Every audited write in the
-- database queues on app.audit_chain's one row (070, 908). The void writes
-- the session (taking the chain) before it locks the credit; a note that
-- locked the credit first and then wrote its own audited rows would wait on
-- the chain while the void waited on the credit — a second deadlock, found by
-- the concurrent test. So both doors this file writes take the chain row
-- first, the order the void and a visit's close already follow, and a note,
-- a void, a waiver and a visit closing queue one behind another instead of in
-- a circle. It costs nothing the chain was not already costing: every one of
-- them writes the trail before it commits.
--
-- **A retried request is the first one.** The idempotency key is looked up
-- before any refusal and again once the invoice is locked, so a retry returns
-- the note it already wrote and takes no number.
--
-- **Who may.** owner, admin, finance — the three who may waive a fee (408),
-- asked here through 095's app.actor_has_role because a definer function runs
-- with row security switched off; the route's check is the courtesy.
--
-- **The fee waiver.** docs/SPEC/billing.md section 4.3: "once the practice is
-- registered for VAT, a fee is reversed by a credit note and not by this flag".
-- app.waive_call_out_fee now refuses a fee whose invoice states a registered
-- supplier, with 'waiver_refused:vat_registered'. And it refuses a fee that
-- already has a credit note, with 'waiver_refused:credited': waived, the
-- charge would leave the ledger while the note's minus-gross stayed, and the
-- balance would fall by the fee twice. It locks the invoice row first, in the
-- mode the issuing function takes it, so the two cannot pass each other.
--
-- Needs: 000 (app.current_tenant_id), 010 (tenant.timezone), 060 (client,
-- client.status), 070 (app.audit_chain, the lock taken first), 095 (app.actor_has_role), 100 (app.current_actor_id), 402
-- (invoice, invoice_line), 403 (entitlement, package_purchase,
-- entitlement_status), 404 (app.billing_ledger), 408 (app.waive_call_out_fee
-- and app.billing_ledger as last written, invoice.waived_at), 411 (the
-- single_session kind and invoice.idempotency_key), 413 (invoice.locale), 416
-- (credit_note, credit_note_line, app.next_credit_note_number, `credited`,
-- entitlement.credited_by). The invoice's supplier columns come from later
-- trunk files (905, 959, 980) and are named only inside the plpgsql body
-- below, which resolves them when it is called rather than when it is created
-- — the discipline 406 set for tenant.vat_registered; checkNeeds refuses a
-- Needs above this file's own number.

------------------------------------------------------------------------------
-- 1. A credited credit names its note, and only a credited one does.
------------------------------------------------------------------------------
alter table public.entitlement add constraint entitlement_credited_is_named check (
  (status = 'credited') = (credited_by is not null)
);

------------------------------------------------------------------------------
-- 2. The issuing function.
------------------------------------------------------------------------------
create function app.issue_credit_note(
  p_invoice_id uuid, p_reason text, p_idempotency_key uuid
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id   uuid := app.current_tenant_id();
  v_actor_id    uuid := app.current_actor_id();
  v_key         text := p_idempotency_key::text;
  v_existing    record;
  v_invoice     public.invoice%rowtype;
  v_client      text;
  v_kind        text;
  v_available   uuid[];
  v_remaining   bigint;
  v_branch      text;   -- 'package', 'released' or 'whole'
  v_line        record;
  v_line_net    integer;
  v_line_vat    integer;
  v_net         integer := 0;
  v_vat         integer := 0;
  v_released    integer := 0;
  v_note_id     uuid;
  v_today       date;
  v_lines       jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a credit note cannot be issued.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('finance')) then
    raise exception 'issuing a credit note is the owner''s, an admin''s or finance''s'
      using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null then
    raise exception 'A credit note needs an idempotency key.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'A credit note needs a reason of at least eight characters.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A retry of a request already answered: the note it wrote, no new number.
  select id, invoice_id into v_existing
    from public.credit_note
   where tenant_id = v_tenant_id and idempotency_key = v_key;
  if found then
    if v_existing.invoice_id <> p_invoice_id then
      raise exception 'This idempotency key already issued a credit note for another invoice.'
        using errcode = 'invalid_parameter_value';
    end if;
    return v_existing.id;
  end if;

  -- The audit chain first (header), then the invoice, then every credit
  -- behind it, before anything is read for the figures.
  perform 1 from app.audit_chain where singleton for update;
  select * into v_invoice
    from public.invoice
   where id = p_invoice_id and tenant_id = v_tenant_id
     for no key update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'no_data_found';
  end if;
  perform 1
     from public.entitlement e
    where e.tenant_id = v_tenant_id
      and (e.invoice_id = v_invoice.id
           or (v_invoice.package_purchase_id is not null
               and e.package_purchase_id = v_invoice.package_purchase_id))
      for update;

  -- Asked again under the lock: a twin of this request may have committed
  -- while this one waited for the invoice.
  select id, invoice_id into v_existing
    from public.credit_note
   where tenant_id = v_tenant_id and idempotency_key = v_key;
  if found then
    if v_existing.invoice_id <> p_invoice_id then
      raise exception 'This idempotency key already issued a credit note for another invoice.'
        using errcode = 'invalid_parameter_value';
    end if;
    return v_existing.id;
  end if;

  -- The refusals, in creditableFor's order.
  select c.status::text into v_client
    from public.client c where c.id = v_invoice.client_id and c.tenant_id = v_tenant_id;
  if v_client = 'erased' then
    raise exception 'credit_note_refused:client_erased';
  end if;
  v_kind := v_invoice.kind::text;
  if v_kind = 'statement' then
    raise exception 'credit_note_refused:statement';
  end if;
  if v_invoice.waived_at is not null then
    raise exception 'credit_note_refused:waived';
  end if;
  if exists (select 1 from public.credit_note n where n.invoice_id = v_invoice.id) then
    raise exception 'credit_note_refused:already_credited';
  end if;

  -- The available credits, read after the locks above, so a credit a visit
  -- took while this waited reads as taken — and locked in this same
  -- statement, so a replacement a void committed meanwhile is held before it
  -- is counted.
  select coalesce(array_agg(a.id order by a.created_at, a.id), '{}'),
         coalesce(sum(a.allocated_net_fils), 0)
    into v_available, v_remaining
    from (
      select e.id, e.created_at, e.allocated_net_fils
        from public.entitlement e
       where e.tenant_id = v_tenant_id
         and e.status = 'available'
         and (case when v_kind = 'package'
                   then e.package_purchase_id = v_invoice.package_purchase_id
                   else e.invoice_id = v_invoice.id end)
         for update
    ) a;

  if v_kind = 'package' then
    if v_remaining <= 0 then
      raise exception 'credit_note_refused:nothing_left';
    end if;
    v_branch := 'package';
  elsif v_kind in ('single_session', 'session') and cardinality(v_available) > 0 then
    v_branch := 'released';
  else
    v_branch := 'whole';
    v_available := '{}';
  end if;

  -- The lines, in order: what each credits, and its VAT.
  for v_line in
    select l.id, l.line_no, l.description, l.description_ar, l.net_fils, l.vat_fils,
           l.vat_rate_basis_points, l.vat_setting_version
      from public.invoice_line l
     where l.invoice_id = v_invoice.id and l.tenant_id = v_tenant_id
     order by l.line_no
  loop
    if v_branch = 'package' then
      v_line_net := least(v_remaining, v_line.net_fils)::integer;
      v_remaining := v_remaining - v_line_net;
    else
      v_line_net := v_line.net_fils;
    end if;
    if v_branch = 'whole' then
      v_line_vat := v_line.vat_fils;
    elsif v_line.net_fils <= 0 then
      v_line_vat := 0;
    else
      -- proportionalVat: half away from zero for non-negative inputs, capped.
      v_line_vat := least(
        v_line.vat_fils::bigint,
        floor((2::numeric * v_line.vat_fils * v_line_net + v_line.net_fils)
              / (2::numeric * v_line.net_fils))::bigint
      )::integer;
    end if;
    v_net := v_net + v_line_net;
    v_vat := v_vat + v_line_vat;
    v_lines := v_lines || jsonb_build_object(
      'invoice_line_id', v_line.id, 'line_no', v_line.line_no,
      'description', v_line.description, 'description_ar', v_line.description_ar,
      'net_fils', v_line_net, 'vat_fils', v_line_vat,
      'vat_rate_basis_points', v_line.vat_rate_basis_points,
      'vat_setting_version', v_line.vat_setting_version);
  end loop;
  if v_branch <> 'whole' then
    v_released := v_net;
  end if;

  -- The practice's own today, in its own time zone.
  select (now() at time zone t.timezone)::date into v_today
    from public.tenant t where t.id = v_tenant_id;

  -- The supplier and the language are the invoice's, copied, never the
  -- tenant's as it is today (416).
  insert into public.credit_note (
    tenant_id, client_id, number, invoice_id, issued_on, reason,
    net_fils, vat_fils, gross_fils, released_net_fils,
    supplier_legal_name, supplier_legal_name_ar, supplier_trn, supplier_address,
    supplier_address_ar, supplier_licence_number, supplier_licensing_authority,
    supplier_licensing_authority_ar, supplier_vat_registered, supplier_vat_trn,
    supplier_contact_phone, supplier_contact_email, supplier_website,
    locale, idempotency_key, created_by
  ) values (
    v_tenant_id, v_invoice.client_id, app.next_credit_note_number(v_tenant_id), v_invoice.id,
    v_today, btrim(p_reason),
    v_net, v_vat, v_net + v_vat, v_released,
    v_invoice.supplier_legal_name, v_invoice.supplier_legal_name_ar, v_invoice.supplier_trn,
    v_invoice.supplier_address, v_invoice.supplier_address_ar,
    v_invoice.supplier_licence_number, v_invoice.supplier_licensing_authority,
    v_invoice.supplier_licensing_authority_ar, v_invoice.supplier_vat_registered,
    v_invoice.supplier_vat_trn, v_invoice.supplier_contact_phone,
    v_invoice.supplier_contact_email, v_invoice.supplier_website,
    v_invoice.locale, v_key, v_actor_id
  ) returning id into v_note_id;

  insert into public.credit_note_line (
    tenant_id, credit_note_id, client_id, line_no, invoice_line_id, description, description_ar,
    net_fils, vat_rate_basis_points, vat_setting_version, vat_fils, gross_fils, created_by
  )
  select v_tenant_id, v_note_id, v_invoice.client_id, (l ->> 'line_no')::integer,
         (l ->> 'invoice_line_id')::uuid, l ->> 'description', l ->> 'description_ar',
         (l ->> 'net_fils')::integer, (l ->> 'vat_rate_basis_points')::integer,
         (l ->> 'vat_setting_version')::integer, (l ->> 'vat_fils')::integer,
         (l ->> 'net_fils')::integer + (l ->> 'vat_fils')::integer, v_actor_id
    from jsonb_array_elements(v_lines) as l;

  -- The unused credits close as credited, naming this note.
  update public.entitlement
     set status = 'credited', credited_by = v_note_id
   where tenant_id = v_tenant_id and id = any(v_available) and status = 'available';

  -- A package ends: cancelled if nothing on it was ever used, else completed.
  if v_kind = 'package' then
    update public.package_purchase p
       set status = case
             when exists (select 1 from public.entitlement e
                           where e.package_purchase_id = p.id and e.status = 'consumed')
             then 'completed'::public.package_purchase_status
             else 'cancelled'::public.package_purchase_status
           end
     where p.id = v_invoice.package_purchase_id and p.tenant_id = v_tenant_id;
  end if;

  return v_note_id;
end
$$;
revoke execute on function app.issue_credit_note(uuid, text, uuid) from public;
grant execute on function app.issue_credit_note(uuid, text, uuid) to app_role;

comment on function app.issue_credit_note(uuid, text, uuid) is
  'Issues the one credit note an invoice may have, in one transaction (migration 417): locks '
  'the invoice and its credits, credits what domain/billing/creditNote.ts creditableFor says '
  'may be credited, numbers and writes the note and its lines, closes the unused credits as '
  'credited and ends a package. Owner, admin or finance only. Raises '
  'credit_note_refused:<refusal>. A repeated idempotency key returns the first note.';

------------------------------------------------------------------------------
-- 3. The ledger, with credit notes in it. 408's body plus the third branch.
------------------------------------------------------------------------------
create or replace view app.billing_ledger with (security_invoker = true) as
  select i.tenant_id,
         i.client_id,
         'charge'::text          as entry_kind,
         i.id                    as source_id,
         i.reference             as reference,
         i.kind::text            as detail,
         i.issued_on             as occurred_on,
         i.gross_fils            as amount_fils
    from public.invoice i
   where i.waived_at is null
  union all
  select p.tenant_id,
         p.client_id,
         'payment'::text,
         p.id,
         p.reference,
         p.method::text,
         (p.received_at at time zone 'Asia/Dubai')::date,
         -p.amount_fils
    from public.payment p
  union all
  -- A credit note reduces what is owed by its gross, on the day it was issued.
  select c.tenant_id,
         c.client_id,
         'credit'::text,
         c.id,
         c.reference,
         'credit_note'::text,
         c.issued_on,
         -c.gross_fils
    from public.credit_note c;
comment on view app.billing_ledger is
  'Charges, payments and credit notes per client; the balance is the sum of amount_fils. A '
  'waived call-out fee is not a charge the family owes and does not appear (migration 408). A '
  'credit note carries minus its gross (migration 417).';

------------------------------------------------------------------------------
-- 4. The fee waiver, refusing an invoice issued while registered. 408's body
--    plus the refusal.
------------------------------------------------------------------------------
create or replace function app.waive_call_out_fee(p_invoice_id uuid, p_reason text)
returns table (waived boolean, gross_fils integer)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_invoice   record;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a fee cannot be waived.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('finance')) then
    raise exception 'forgiving a charge is the owner''s, an admin''s or finance''s'
      using errcode = 'insufficient_privilege';
  end if;
  -- The audit chain, then the row, in the order and the mode
  -- app.issue_credit_note takes them: a waiver and a credit note on the same
  -- fee queue here, and the second sees the first.
  perform 1 from app.audit_chain where singleton for update;
  select i.kind::text as kind, i.supplier_vat_registered as registered into v_invoice
    from public.invoice i
   where i.id = p_invoice_id and i.tenant_id = v_tenant_id
     for no key update;
  if found and v_invoice.kind = 'call_out_fee' then
    -- A tax invoice is reversed by a credit note, not by this flag
    -- (docs/SPEC/billing.md section 4.3).
    if v_invoice.registered is true then
      raise exception 'waiver_refused:vat_registered'
        using hint = 'This fee was invoiced while the practice was registered for VAT. Issue a credit note instead.';
    end if;
    -- Already corrected by a credit note: waiving it as well would take it off
    -- the balance twice.
    if exists (select 1 from public.credit_note n where n.invoice_id = p_invoice_id) then
      raise exception 'waiver_refused:credited'
        using hint = 'This fee has a credit note already.';
    end if;
  end if;
  return query
    update public.invoice i
       set waived_at     = now(),
           waived_by     = app.current_actor_id(),
           waiver_reason = p_reason
     where i.id = p_invoice_id
       and i.tenant_id = v_tenant_id
       and i.kind::text = 'call_out_fee'
       and i.waived_at is null
    returning true, i.gross_fils;
end
$$;

comment on function app.waive_call_out_fee(uuid, text) is
  'Forgives one call-out fee, leaving the charge on the record and taking it out of the '
  'balance (migration 408). Refuses a caller who is not the owner, an admin or finance, the '
  'three roles a credit''s waiver is held to, and refuses a fee invoiced while the practice '
  'was registered for VAT with waiver_refused:vat_registered: that is a credit note''s '
  '(migration 417), and a fee that already has a credit note with waiver_refused:credited. '
  'Returns no row when there was nothing to waive: the invoice is not this '
  'practice''s, is not a fee, or has been waived already.';

-- rollback:
--   -- 408's waiver, written out: `create or replace` has no undo of its own.
--   create or replace function app.waive_call_out_fee(p_invoice_id uuid, p_reason text)
--   returns table (waived boolean, gross_fils integer)
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; a fee cannot be waived.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     if not (app.actor_has_role('owner')
--          or app.actor_has_role('admin')
--          or app.actor_has_role('finance')) then
--       raise exception 'forgiving a charge is the owner''s, an admin''s or finance''s'
--         using errcode = 'insufficient_privilege';
--     end if;
--     return query
--       update public.invoice i
--          set waived_at     = now(),
--              waived_by     = app.current_actor_id(),
--              waiver_reason = p_reason
--        where i.id = p_invoice_id
--          and i.tenant_id = v_tenant_id
--          and i.kind::text = 'call_out_fee'
--          and i.waived_at is null
--       returning true, i.gross_fils;
--   end
--   $fn$;
--   comment on function app.waive_call_out_fee(uuid, text) is
--     'Forgives one call-out fee, leaving the charge on the record and taking it out of the '
--     'balance (migration 408). Refuses a caller who is not the owner, an admin or finance, the '
--     'three roles a credit''s waiver is held to. Returns no row when there was nothing to waive: '
--     'the invoice is not this practice''s, is not a fee, or has been waived already.';
--   -- 408's ledger, written out.
--   create or replace view app.billing_ledger with (security_invoker = true) as
--     select i.tenant_id, i.client_id, 'charge'::text as entry_kind, i.id as source_id,
--            i.reference as reference, i.kind::text as detail, i.issued_on as occurred_on,
--            i.gross_fils as amount_fils
--       from public.invoice i
--      where i.waived_at is null
--     union all
--     select p.tenant_id, p.client_id, 'payment'::text, p.id, p.reference, p.method::text,
--            (p.received_at at time zone 'Asia/Dubai')::date, -p.amount_fils
--       from public.payment p;
--   comment on view app.billing_ledger is
--     'Charges and payments per client; the balance is the sum of amount_fils. A waived '
--     'call-out fee is not a charge the family owes and does not appear (migration 408).';
--   drop function if exists app.issue_credit_note(uuid, text, uuid);
--   -- No row may still read `credited` once the check below is gone; there is
--   -- no status to put one back to that would be true, so roll back only a
--   -- database that has issued no note.
--   alter table public.entitlement drop constraint if exists entitlement_credited_is_named;
