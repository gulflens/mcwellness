-- 456_post_payment_reversals.sql
-- A reversed payment reaches the books: `payment.reversed`, the ninth money
-- event (docs/SPEC/accounting.md section 7;
-- docs/superpowers/specs/2026-10-23-payment-reversal-design.md, "Books").
--
-- One change: app.unposted_money_events() (455) gains a branch for
-- payment_reversal (419), anti-joined against journal_entry exactly as its
-- other branches are. The entry is Dr receivable, Cr bank / cash / link
-- clearing by the payment's method, dated reversed_on.
--
-- **Same signature, same result columns, so `create or replace` and no drop**:
-- a drop would need the owner to run it by hand. The journal's source_table
-- check needs no change: the source stays the `payment`, and only its event
-- differs (`payment.reversed`), which the unique source key already tells
-- apart from `payment.received`. Grant, revoke and comment are repeated.
--
-- Needs: 454 (app.unposted_money_events), 455 (its current body, replaced
-- here), 419 (payment_reversal).

create or replace function app.unposted_money_events()
returns table (
  source_table text, source_id uuid, source_event text, occurred_on date,
  invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint,
  amount_fils bigint, method text, service_code text, has_replacement boolean,
  released_net_fils bigint
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
         null::bigint, null::text, null::text, null::boolean, null::bigint
    from public.invoice i
   where i.tenant_id = v_tenant_id
     and not exists (select 1 from posted p
                      where p.source_table = 'invoice' and p.source_id = i.id
                        and p.source_event = 'invoice.issued')
  union all
  select 'invoice', i.id, 'fee.waived', (i.waived_at at time zone v_tz)::date, i.kind::text,
         i.net_fils, i.vat_fils, i.gross_fils, null, null, null, null, null
    from public.invoice i
   where i.tenant_id = v_tenant_id and i.waived_at is not null
     and not exists (select 1 from posted p
                      where p.source_table = 'invoice' and p.source_id = i.id
                        and p.source_event = 'fee.waived')
  union all
  select 'payment', pm.id, 'payment.received', (pm.received_at at time zone v_tz)::date, null,
         null, null, null, pm.amount_fils::bigint, pm.method::text, null, null, null
    from public.payment pm
   where pm.tenant_id = v_tenant_id
     and not exists (select 1 from posted p
                      where p.source_table = 'payment' and p.source_id = pm.id
                        and p.source_event = 'payment.received')
  union all
  -- A waived credit was consumed first (403's own constraint), so its
  -- consumption posts too, and the waiver's row below is what unwinds it.
  select 'entitlement', e.id, 'credit.consumed', (e.consumed_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, st.code, null, null
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
                  where r.tenant_id = e.tenant_id and r.replaces_entitlement_id = e.id),
         null
    from public.entitlement e join public.service_type st on st.id = e.service_type_id
   where e.tenant_id = v_tenant_id and e.status = 'waived'
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.waived')
  union all
  select 'entitlement', e.id, 'credit.expired', e.expires_on, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'expired' and e.expires_on is not null
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.expired')
  union all
  select 'entitlement', e.id, 'credit.refunded', (e.updated_at at time zone v_tz)::date, null,
         e.allocated_net_fils::bigint, null, null, null, null, null, null, null
    from public.entitlement e
   where e.tenant_id = v_tenant_id and e.status = 'refunded'
     and not exists (select 1 from posted p
                      where p.source_table = 'entitlement' and p.source_id = e.id
                        and p.source_event = 'credit.refunded')
  union all
  -- A credit note (416, 417) reverses its invoice's lines: the part released
  -- from sessions owed (released_net_fils), and the rest from the income
  -- already recognised. The service is the corrected invoice's first line that
  -- names one -- package and session invoices have a single line -- so the
  -- rest of the net goes back to that service's own income account.
  select 'credit_note', cn.id, 'credit_note.issued', cn.issued_on, i.kind::text,
         cn.net_fils::bigint, cn.vat_fils::bigint, cn.gross_fils::bigint,
         null::bigint, null::text,
         (select st.code
            from public.invoice_line il join public.service_type st on st.id = il.service_type_id
           where il.invoice_id = cn.invoice_id and il.tenant_id = cn.tenant_id
           order by il.line_no limit 1),
         null::boolean, cn.released_net_fils::bigint
    from public.credit_note cn join public.invoice i on i.id = cn.invoice_id
   where cn.tenant_id = v_tenant_id
     and not exists (select 1 from posted p
                      where p.source_table = 'credit_note' and p.source_id = cn.id
                        and p.source_event = 'credit_note.issued')
  union all
  -- A payment reversed (419) is a second event on the same source: the
  -- payment's own id, the day the reversal was made, the amount and method of
  -- the payment it cancels. The journal's source key is (table, id, event), so
  -- it is offered once and gone after it is posted.
  select 'payment', r.payment_id, 'payment.reversed', r.reversed_on, null,
         null, null, null, p.amount_fils::bigint, p.method::text, null, null, null
    from public.payment_reversal r
    join public.payment p on p.tenant_id = r.tenant_id and p.id = r.payment_id
   where r.tenant_id = v_tenant_id
     and not exists (select 1 from posted q
                      where q.source_table = 'payment' and q.source_id = r.payment_id
                        and q.source_event = 'payment.reversed')
  order by 4, 1, 3, 2;
end
$$;
comment on function app.unposted_money_events() is
  'Every billing row not yet in the journal, as amounts, days and kinds and nothing that names '
  'anybody; steps past the erasure gate on purpose and checks the caller''s role itself '
  '(docs/SPEC/accounting.md section 4.3). 455 adds credit notes, 456 payment reversals.';
revoke execute on function app.unposted_money_events() from public;
grant execute on function app.unposted_money_events() to app_role;

-- rollback:
--   -- Restores 455's function body. Reversals already posted stay in the journal
--   -- (append-only); they are simply no longer offered.
--   create or replace function app.unposted_money_events()
--   returns table (
--     source_table text, source_id uuid, source_event text, occurred_on date,
--     invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint,
--     amount_fils bigint, method text, service_code text, has_replacement boolean,
--     released_net_fils bigint
--   )
--   language plpgsql stable security definer
--   set search_path = pg_catalog, pg_temp
--   as $$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--     v_tz        text;
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; the unposted events cannot be read.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     if not (app.actor_has_role('owner') or app.actor_has_role('finance')) then
--       raise exception 'the practice''s books are not yours to keep'
--         using errcode = 'insufficient_privilege';
--     end if;
--     select t.timezone into v_tz from public.tenant t where t.id = v_tenant_id;
--
--     return query
--     with posted as (
--       select je.source_table, je.source_id, je.source_event
--         from public.journal_entry je
--        where je.tenant_id = v_tenant_id and je.source_table is not null
--     )
--     select 'invoice'::text, i.id, 'invoice.issued'::text, i.issued_on, i.kind::text,
--            i.net_fils::bigint, i.vat_fils::bigint, i.gross_fils::bigint,
--            null::bigint, null::text, null::text, null::boolean, null::bigint
--       from public.invoice i
--      where i.tenant_id = v_tenant_id
--        and not exists (select 1 from posted p
--                         where p.source_table = 'invoice' and p.source_id = i.id
--                           and p.source_event = 'invoice.issued')
--     union all
--     select 'invoice', i.id, 'fee.waived', (i.waived_at at time zone v_tz)::date, i.kind::text,
--            i.net_fils, i.vat_fils, i.gross_fils, null, null, null, null, null
--       from public.invoice i
--      where i.tenant_id = v_tenant_id and i.waived_at is not null
--        and not exists (select 1 from posted p
--                         where p.source_table = 'invoice' and p.source_id = i.id
--                           and p.source_event = 'fee.waived')
--     union all
--     select 'payment', pm.id, 'payment.received', (pm.received_at at time zone v_tz)::date, null,
--            null, null, null, pm.amount_fils::bigint, pm.method::text, null, null, null
--       from public.payment pm
--      where pm.tenant_id = v_tenant_id
--        and not exists (select 1 from posted p
--                         where p.source_table = 'payment' and p.source_id = pm.id
--                           and p.source_event = 'payment.received')
--     union all
--     -- A waived credit was consumed first (403's own constraint), so its
--     -- consumption posts too, and the waiver's row below is what unwinds it.
--     select 'entitlement', e.id, 'credit.consumed', (e.consumed_at at time zone v_tz)::date, null,
--            e.allocated_net_fils::bigint, null, null, null, null, st.code, null, null
--       from public.entitlement e join public.service_type st on st.id = e.service_type_id
--      where e.tenant_id = v_tenant_id and e.status in ('consumed', 'waived') and e.consumed_at is not null
--        and not exists (select 1 from posted p
--                         where p.source_table = 'entitlement' and p.source_id = e.id
--                           and p.source_event = 'credit.consumed')
--     union all
--     -- waived_at is nullable on a waived row (403 asks only for the reason), so
--     -- the day falls back to when the row last moved.
--     select 'entitlement', e.id, 'credit.waived',
--            (coalesce(e.waived_at, e.updated_at) at time zone v_tz)::date, null,
--            e.allocated_net_fils::bigint, null, null, null, null, st.code,
--            exists (select 1 from public.entitlement r
--                     where r.tenant_id = e.tenant_id and r.replaces_entitlement_id = e.id),
--            null
--       from public.entitlement e join public.service_type st on st.id = e.service_type_id
--      where e.tenant_id = v_tenant_id and e.status = 'waived'
--        and not exists (select 1 from posted p
--                         where p.source_table = 'entitlement' and p.source_id = e.id
--                           and p.source_event = 'credit.waived')
--     union all
--     select 'entitlement', e.id, 'credit.expired', e.expires_on, null,
--            e.allocated_net_fils::bigint, null, null, null, null, null, null, null
--       from public.entitlement e
--      where e.tenant_id = v_tenant_id and e.status = 'expired' and e.expires_on is not null
--        and not exists (select 1 from posted p
--                         where p.source_table = 'entitlement' and p.source_id = e.id
--                           and p.source_event = 'credit.expired')
--     union all
--     select 'entitlement', e.id, 'credit.refunded', (e.updated_at at time zone v_tz)::date, null,
--            e.allocated_net_fils::bigint, null, null, null, null, null, null, null
--       from public.entitlement e
--      where e.tenant_id = v_tenant_id and e.status = 'refunded'
--        and not exists (select 1 from posted p
--                         where p.source_table = 'entitlement' and p.source_id = e.id
--                           and p.source_event = 'credit.refunded')
--     union all
--     -- A credit note (416, 417) reverses its invoice's lines: the part released
--     -- from sessions owed (released_net_fils), and the rest from the income
--     -- already recognised. The service is the corrected invoice's first line that
--     -- names one -- package and session invoices have a single line -- so the
--     -- rest of the net goes back to that service's own income account.
--     select 'credit_note', cn.id, 'credit_note.issued', cn.issued_on, i.kind::text,
--            cn.net_fils::bigint, cn.vat_fils::bigint, cn.gross_fils::bigint,
--            null::bigint, null::text,
--            (select st.code
--               from public.invoice_line il join public.service_type st on st.id = il.service_type_id
--              where il.invoice_id = cn.invoice_id and il.tenant_id = cn.tenant_id
--              order by il.line_no limit 1),
--            null::boolean, cn.released_net_fils::bigint
--       from public.credit_note cn join public.invoice i on i.id = cn.invoice_id
--      where cn.tenant_id = v_tenant_id
--        and not exists (select 1 from posted p
--                         where p.source_table = 'credit_note' and p.source_id = cn.id
--                           and p.source_event = 'credit_note.issued')
--     order by 4, 1, 3, 2;
--   end
--   $$;
--   comment on function app.unposted_money_events() is
--     'Every billing row not yet in the journal, as amounts, days and kinds and nothing that names '
--     'anybody; steps past the erasure gate on purpose and checks the caller''s role itself '
--     '(docs/SPEC/accounting.md section 4.3). 455 adds credit notes.';
--   revoke execute on function app.unposted_money_events() from public;
--   grant execute on function app.unposted_money_events() to app_role;
