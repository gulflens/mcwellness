-- 454_unposted_money_events.sql
-- Every movement of money the platform has recorded and the journal has not yet
-- written down: amounts, days, kinds — and nothing that names anybody
-- (docs/SPEC/accounting.md section 4.3).
--
-- **Why security definer, and why that is what makes the books complete.**
-- Read as the caller, `invoice`, `payment` and `entitlement` pass through
-- `app.client_erasure_gate` (db/policies/billing/ledger.sql): finance would
-- never see an erased household's rows, so finance's poster would skip them and
-- the owner's would post them later, and what the books said would depend on
-- who ran the job. The practice's takings are a fact about the practice. So
-- this function steps past that gate on purpose, in the pattern 952 and 953
-- already use — and, like them, checks the caller's role itself, because a
-- definer function that trusts its caller is a hole with a comment on it.
--
-- **Why it names nobody.** It returns amounts, days, an invoice kind, a payment
-- method, a service code and the billing row's own id. No client id, no name,
-- no invoice number, no payment reference: there is nothing here for a journal
-- line to carry that it should not (section 1).
--
-- **Why the anti-join is the idempotency read back.** `journal_entry` is unique
-- on (practice, source table, source id, event); this function is that
-- constraint asked as a question. Nothing is marked as posted anywhere, so
-- there is no flag to fall out of step with the journal, and running the poster
-- twice writes nothing the second time because the row it would write is
-- already the one being anti-joined against.
--
-- **Days are the practice's own.** Each timestamp is rendered in
-- `tenant.timezone` before it becomes a date, as 952 renders its own: a payment
-- taken at nine in the morning in Dubai belongs to that day and not to the day
-- before it in UTC.
--
-- Needs: 010 (tenant, its timezone), 040 (service_type, for the code a consumed
-- credit is recognised by), 095 (app.actor_has_role), 000
-- (app.current_tenant_id), 402 (invoice, payment), 403 (entitlement),
-- 408 (invoice.waived_at and the call_out_fee kind), 453 (journal_entry).

create function app.unposted_money_events()
returns table (
  source_table text, source_id uuid, source_event text, occurred_on date,
  invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint,
  amount_fils bigint, method text, service_code text, has_replacement boolean
)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_tz        text;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; the unposted events cannot be read.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner') or app.actor_has_role('finance')) then
    raise exception 'the practice''s books are not yours to keep'
      using errcode = 'insufficient_privilege';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant_id;

  return query
  with posted as (
    select je.source_table, je.source_id, je.source_event
      from public.journal_entry je
     where je.tenant_id = v_tenant_id and je.source_table is not null
  )
  select 'invoice'::text, i.id, 'invoice.issued'::text, i.issued_on, i.kind::text,
         i.net_fils::bigint, i.vat_fils::bigint, i.gross_fils::bigint,
         null::bigint, null::text, null::text, null::boolean
    from public.invoice i
   where i.tenant_id = v_tenant_id
     and not exists (select 1 from posted p
                      where p.source_table = 'invoice' and p.source_id = i.id
                        and p.source_event = 'invoice.issued')
  union all
  select 'invoice', i.id, 'fee.waived', (i.waived_at at time zone v_tz)::date, i.kind::text,
         i.net_fils, i.vat_fils, i.gross_fils, null, null, null, null
    from public.invoice i
   where i.tenant_id = v_tenant_id and i.waived_at is not null
     and not exists (select 1 from posted p
                      where p.source_table = 'invoice' and p.source_id = i.id
                        and p.source_event = 'fee.waived')
  union all
  select 'payment', pm.id, 'payment.received', (pm.received_at at time zone v_tz)::date, null,
         null, null, null, pm.amount_fils::bigint, pm.method::text, null, null
    from public.payment pm
   where pm.tenant_id = v_tenant_id
     and not exists (select 1 from posted p
                      where p.source_table = 'payment' and p.source_id = pm.id
                        and p.source_event = 'payment.received')
  union all
  -- A waived credit was consumed first (403's own constraint), so its
  -- consumption posts too, and the waiver's row below is what unwinds it.
  select 'entitlement', e.id, 'credit.consumed', (e.consumed_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, st.code, null
    from public.entitlement e join public.service_type st on st.id = e.service_type_id
   where e.tenant_id = v_tenant_id and e.status in ('consumed', 'waived') and e.consumed_at is not null
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.consumed')
  union all
  -- waived_at is nullable on a waived row (403 asks only for the reason), so
  -- the day falls back to when the row last moved.
  select 'entitlement', e.id, 'credit.waived',
         (coalesce(e.waived_at, e.updated_at) at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, st.code,
         exists (select 1 from public.entitlement r
                  where r.tenant_id = e.tenant_id and r.replaces_entitlement_id = e.id)
    from public.entitlement e join public.service_type st on st.id = e.service_type_id
   where e.tenant_id = v_tenant_id and e.status = 'waived'
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.waived')
  union all
  select 'entitlement', e.id, 'credit.expired', e.expires_on, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'expired' and e.expires_on is not null
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.expired')
  union all
  select 'entitlement', e.id, 'credit.refunded', (e.updated_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'refunded'
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.refunded')
  order by 4, 1, 3, 2;
end
$$;
comment on function app.unposted_money_events() is
  'Every billing row not yet in the journal, as amounts, days and kinds and nothing that names '
  'anybody; steps past the erasure gate on purpose and checks the caller''s role itself '
  '(docs/SPEC/accounting.md section 4.3).';
revoke execute on function app.unposted_money_events() from public;
grant execute on function app.unposted_money_events() to app_role;

-- rollback:
--   drop function if exists app.unposted_money_events();
