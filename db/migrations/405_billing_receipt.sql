-- 405_billing_receipt.sql
-- A number a coordinator can quote for money received.
--
-- A payment had no readable identity at all: the drawer recorded it and said
-- so, and if a family rang the next day to ask what had been received against
-- what, there was nothing to name. An invoice number was the wrong answer —
-- a payment settles an invoice, it is not one, and the FTA sequence in
-- 402_billing_document.sql must stay a sequence of tax invoices and nothing
-- else. So payments get their own book, in the same shape and for the same
-- reason: a per-practice counter taken with one locking `update ...
-- returning`, because a sequence burns a number on every rolled-back
-- transaction and gapless is the point.
--
-- The **receipt document** is still not here. This is the number, allocated
-- at the moment the money is recorded so it can never be assigned twice or
-- assigned later; rendering a receipt to give to a family is the same piece
-- of work as rendering an invoice, and that is the next pull request.
--
-- Allocated by a before-insert trigger rather than by the route, for the
-- reason the supplier snapshot is: there are already two callers (the payment
-- route and the sale that takes money at the same moment), and one of them
-- forgetting would not show until somebody went looking for a receipt.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user), 080 (app.audit_row), 402 (payment).

create table payment_receipt_series (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  next_number  integer not null default 1 check (next_number >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id),
  unique (tenant_id, id)
);
comment on table public.payment_receipt_series is
  'audited: no client - the per-practice receipt number counter';
create index payment_receipt_series_created_by_idx on payment_receipt_series (created_by);
create trigger set_updated_at before update on payment_receipt_series
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.payment_receipt_series
  for each row execute function app.audit_row();
alter table public.payment_receipt_series enable always trigger audit_row;

-- Takes the practice from the row rather than from the session. A receipt
-- belongs to the payment's own practice, which the row already knows; reading
-- it from the connection instead would make the number depend on who happened
-- to be writing, and would fail outright for anything that writes a payment
-- without a request context around it.
create function app.next_receipt_number(p_tenant_id uuid) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_number integer;
begin
  if p_tenant_id is null then
    raise exception 'A receipt number needs a practice to belong to.'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.payment_receipt_series (tenant_id) values (p_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.payment_receipt_series
     set next_number = next_number + 1
   where tenant_id = p_tenant_id
  returning next_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_receipt_number(uuid) from public;
grant execute on function app.next_receipt_number(uuid) to app_role;

create function app.default_receipt_series() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.payment_receipt_series (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end
$$;
revoke execute on function app.default_receipt_series() from public;
create trigger default_receipt_series after insert on public.tenant
  for each row execute function app.default_receipt_series();

alter table public.payment
  add column receipt_number integer,
  -- The number as a person reads it. Generated, so it can never drift from
  -- the number it renders, and distinct from INV- so nobody can mistake a
  -- receipt for a tax invoice.
  add column receipt_reference text
    generated always as ('RCP-' || lpad(receipt_number::text, 6, '0')) stored;

create unique index payment_receipt_number_key on payment (tenant_id, receipt_number);

create function app.stamp_payment_receipt() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.receipt_number is null then
    new.receipt_number := app.next_receipt_number(new.tenant_id);
  end if;
  return new;
end
$$;
revoke execute on function app.stamp_payment_receipt() from public;
create trigger stamp_receipt before insert on public.payment
  for each row execute function app.stamp_payment_receipt();
alter table public.payment enable always trigger stamp_receipt;

-- Every practice that already exists gets its counter, as 402 did for
-- invoices; the payments that predate this column keep a null number rather
-- than being handed one out of order.
insert into payment_receipt_series (tenant_id) select id from tenant
  on conflict (tenant_id) do nothing;

-- rollback:
--   drop trigger if exists stamp_receipt on public.payment;
--   drop function if exists app.stamp_payment_receipt();
--   drop index if exists payment_receipt_number_key;
--   alter table public.payment drop column if exists receipt_reference,
--     drop column if exists receipt_number;
--   drop trigger if exists default_receipt_series on public.tenant;
--   drop function if exists app.default_receipt_series();
--   drop function if exists app.next_receipt_number(uuid);
--   drop trigger if exists audit_row on public.payment_receipt_series;
--   drop table if exists payment_receipt_series;
