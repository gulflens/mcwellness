-- 419_payment_reversal.sql
-- Reversing a payment recorded in error: the record, the one function that
-- writes it, and the ledger that shows it
-- (docs/superpowers/specs/2026-10-23-payment-reversal-design.md).
--
-- `payment` is append-only (402). A payment typed wrongly can never be edited,
-- so it is cancelled by a second, append-only record: `payment_reversal`, one
-- per payment, in full. The payment stays on the day it was recorded; the
-- reversal lands on the day it was made.
--
-- **The function mirrors a pure rule.** What may be reversed is
-- `domain/billing/reversal.ts`'s `reversibleFor` (CLAUDE.md rule 4). The
-- database is the only writer, so the rule is restated below in its order:
-- client_erased, then already_reversed, raised as
-- 'reversal_refused:<refusal>' for the route to map to 409.
--
-- `app_role` is granted select only (the credit-note precedent, 416); the
-- insert is the function's, which is security definer.
--
-- Needs: 000 (app.current_tenant_id), 010 (tenant.timezone), 060 (client,
-- client.status), 070 (app.audit_chain, the lock taken first), 080
-- (app.audit_row, app.set_updated_at), 095 (app.actor_has_role), 100
-- (app.current_actor_id), 402 (payment), 405 (payment.receipt_reference),
-- 413, 417 (app.billing_ledger as last written, app.issue_credit_note's
-- shape).

------------------------------------------------------------------------------
-- 1. The record.
------------------------------------------------------------------------------
create table payment_reversal (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  client_id       uuid not null references client (id),
  payment_id      uuid not null,
  reversed_on     date not null,
  -- The function enforces eight characters; the table only refuses nothing.
  reason          text not null check (length(btrim(reason)) >= 1),
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  -- A payment is reversed once. The key is on payment_id alone on purpose.
  unique (payment_id),
  -- payment's only unique key is (tenant_id, id), so the client is its own
  -- foreign key and the function copies it from the payment.
  foreign key (tenant_id, payment_id) references payment (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id)
);
comment on table public.payment_reversal is 'audited: client';
create index payment_reversal_tenant_idx on payment_reversal (tenant_id);
create index payment_reversal_client_idx on payment_reversal (tenant_id, client_id, reversed_on);
create index payment_reversal_created_by_idx on payment_reversal (created_by);
create trigger set_updated_at before update on payment_reversal
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.payment_reversal
  for each row execute function app.audit_row();
alter table public.payment_reversal enable always trigger audit_row;

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.payment_reversal enable row level security;
  revoke all on public.payment_reversal from public;
  if has_api_roles then
    revoke all on public.payment_reversal from anon, authenticated;
  end if;
  grant select on public.payment_reversal to app_role;
end
$$;

------------------------------------------------------------------------------
-- 2. The function that writes it.
------------------------------------------------------------------------------
create function app.reverse_payment(
  p_payment_id uuid, p_reason text, p_idempotency_key uuid
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_key       text := p_idempotency_key::text;
  v_existing  record;
  v_payment   public.payment%rowtype;
  v_client    text;
  v_today     date;
  v_id        uuid;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a payment cannot be reversed.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner')
       or app.actor_has_role('admin')
       or app.actor_has_role('finance')) then
    raise exception 'reversing a payment is the owner''s, an admin''s or finance''s'
      using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null then
    raise exception 'A reversal needs an idempotency key.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'A reversal needs a reason of at least eight characters.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A retry of a request already answered: the reversal it wrote.
  select r.id, r.payment_id into v_existing
    from public.payment_reversal r
   where r.tenant_id = v_tenant_id and r.idempotency_key = v_key;
  if found then
    if v_existing.payment_id <> p_payment_id then
      raise exception 'This idempotency key already reversed another payment.'
        using errcode = 'invalid_parameter_value';
    end if;
    return v_existing.id;
  end if;

  -- The audit chain first (header), then the payment.
  perform 1 from app.audit_chain where singleton for update;
  select * into v_payment
    from public.payment p
   where p.id = p_payment_id and p.tenant_id = v_tenant_id
     for no key update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'no_data_found';
  end if;

  -- Asked again under the lock: a twin of this request may have committed
  -- while this one waited.
  select r.id, r.payment_id into v_existing
    from public.payment_reversal r
   where r.tenant_id = v_tenant_id and r.idempotency_key = v_key;
  if found then
    if v_existing.payment_id <> p_payment_id then
      raise exception 'This idempotency key already reversed another payment.'
        using errcode = 'invalid_parameter_value';
    end if;
    return v_existing.id;
  end if;

  -- The refusals, in reversibleFor's order.
  select c.status::text into v_client
    from public.client c
   where c.id = v_payment.client_id and c.tenant_id = v_tenant_id;
  if v_client = 'erased' then
    raise exception 'reversal_refused:client_erased';
  end if;
  if exists (select 1 from public.payment_reversal r
              where r.tenant_id = v_tenant_id and r.payment_id = v_payment.id) then
    raise exception 'reversal_refused:already_reversed';
  end if;

  -- The practice's own today, in its own time zone.
  select (now() at time zone t.timezone)::date into v_today
    from public.tenant t where t.id = v_tenant_id;

  insert into public.payment_reversal (
    tenant_id, client_id, payment_id, reversed_on, reason, idempotency_key, created_by
  ) values (
    v_tenant_id, v_payment.client_id, v_payment.id, v_today, btrim(p_reason), v_key, v_actor_id
  ) returning id into v_id;

  return v_id;
end
$$;
revoke execute on function app.reverse_payment(uuid, text, uuid) from public;
grant execute on function app.reverse_payment(uuid, text, uuid) to app_role;

comment on function app.reverse_payment(uuid, text, uuid) is
  'Reverses one payment in full, in one transaction (migration 419): locks the audit chain '
  'and the payment, refuses as domain/billing/reversal.ts reversibleFor says (client_erased, '
  'then already_reversed) and writes the reversal dated the practice''s today. Owner, admin or '
  'finance only. Raises reversal_refused:<refusal>. A repeated idempotency key returns the '
  'first reversal.';

------------------------------------------------------------------------------
-- 3. The ledger, with reversals in it. 417's body plus the fourth branch.
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
    from public.credit_note c
  union all
  -- A reversal cancels its payment: plus the amount, on the day it was made.
  -- source_id is the payment, so a reader can join it.
  select r.tenant_id,
         r.client_id,
         'reversal'::text,
         r.payment_id,
         p.reference,
         p.method::text,
         r.reversed_on,
         p.amount_fils
    from public.payment_reversal r
    join public.payment p on p.tenant_id = r.tenant_id and p.id = r.payment_id;
comment on view app.billing_ledger is
  'Charges, payments, credit notes and payment reversals per client; the balance is the sum of amount_fils. A '
  'waived call-out fee is not a charge the family owes and does not appear (migration 408). A '
  'credit note carries minus its gross (migration 417). A reversal carries plus the amount of its payment on the day it was made, and names that payment as its source (migration 419).';

-- rollback:
--   -- 417's ledger, written out: `create or replace` has no undo of its own.
--   create or replace view app.billing_ledger with (security_invoker = true) as
--     select i.tenant_id,
--            i.client_id,
--            'charge'::text          as entry_kind,
--            i.id                    as source_id,
--            i.reference             as reference,
--            i.kind::text            as detail,
--            i.issued_on             as occurred_on,
--            i.gross_fils            as amount_fils
--       from public.invoice i
--      where i.waived_at is null
--     union all
--     select p.tenant_id,
--            p.client_id,
--            'payment'::text,
--            p.id,
--            p.reference,
--            p.method::text,
--            (p.received_at at time zone 'Asia/Dubai')::date,
--            -p.amount_fils
--       from public.payment p
--     union all
--     -- A credit note reduces what is owed by its gross, on the day it was issued.
--     select c.tenant_id,
--            c.client_id,
--            'credit'::text,
--            c.id,
--            c.reference,
--            'credit_note'::text,
--            c.issued_on,
--            -c.gross_fils
--       from public.credit_note c;
--   comment on view app.billing_ledger is
--     'Charges, payments and credit notes per client; the balance is the sum of amount_fils. A '
--     'waived call-out fee is not a charge the family owes and does not appear (migration 408). A '
--     'credit note carries minus its gross (migration 417).';
--   drop function if exists app.reverse_payment(uuid, text, uuid);
--   revoke select on public.payment_reversal from app_role;
--   drop trigger if exists audit_row on public.payment_reversal;
--   drop table if exists payment_reversal;
