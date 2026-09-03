-- 404_billing_consumption.sql
-- Where the ledger meets the practice's day: a completed visit consumes a
-- credit, a visit called off too late consumes one too, and what neither can
-- account for lands in a queue somebody looks at.
--
-- **The contract with the session-capture stream.** Closing a visit is one
-- transaction, written by `app/api/sessions`, and it does not touch a single
-- billing row. Money is this stream's, so the consumption hangs off the
-- status change as a trigger rather than as a line of somebody else's route.
-- The practitioner closing the visit holds no billing role and needs none:
-- the trigger runs security definer, so the practice writes the row, not the
-- person. The same goes for the appointment trigger and the coordinator.
--
-- **Exactly once, twice over.** Each trigger first looks for the credit or
-- invoice its visit already has and stops if it finds one, so an ordinary
-- replay does nothing. Beneath that, `entitlement_one_per_session`,
-- `entitlement_one_per_appointment` and `invoice_one_per_session` (403, 402)
-- are unique indexes: two concurrent transactions cannot both succeed,
-- whatever the read said. The read is the courtesy; the index is the
-- guarantee. Proved in tests/billing/db/consumption.test.ts.
--
-- **What happens when there is no credit.** A completed visit with no credit
-- left is charged at the current single-visit price, and that charge creates
-- its own credit, consumed on the spot — one mechanism, not two (billing.md
-- section 1). If the service has no price at all, nothing is invented: the
-- visit still closes, and a row goes into `billing_exception` for the
-- practice to settle. A visit that quietly bills nothing is how a solo
-- operator delivers six free sessions before noticing.
--
-- Needs: 000, 010, 020, 040 (service_type), 060 (client), 080
-- (app.audit_row), 100 (app.current_actor_id), 200 (appointment), 300
-- (session), 400 (price), 402 (invoice, invoice_line, payment,
-- app.next_invoice_number), 403 (entitlement, app.oldest_available_entitlement).

create type billing_exception_kind as enum (
  'unpriced_session',            -- delivered, no credit and no price to charge at
  'uncovered_late_cancellation'  -- called off late, but the client held no credit to take
);

------------------------------------------------------------------------------
-- 1. billing_exception — the queue billing.md section 6 asks for, in its
--    smallest honest form: something the practice owes an answer on.
------------------------------------------------------------------------------
create table billing_exception (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  client_id       uuid not null references client (id),
  kind            billing_exception_kind not null,
  session_id      uuid,
  appointment_id  uuid,
  service_type_id uuid,
  -- A sentence a coordinator can act on. Never a stack trace, never a value
  -- from the client's record.
  detail          text not null check (length(btrim(detail)) between 1 and 300),
  resolved_at     timestamptz,
  resolved_by     uuid references app_user (id),
  resolution_note text check (length(btrim(resolution_note)) between 1 and 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_user (id),
  constraint billing_exception_resolution_is_whole check (
    (resolved_at is null) = (resolved_by is null)
  ),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, session_id) references session (tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointment (tenant_id, id),
  foreign key (tenant_id, service_type_id) references service_type (tenant_id, id)
);
comment on table public.billing_exception is 'audited: client';
create index billing_exception_tenant_idx on billing_exception (tenant_id);
create index billing_exception_open_idx
  on billing_exception (tenant_id, created_at) where resolved_at is null;
create index billing_exception_client_idx on billing_exception (client_id);
create index billing_exception_session_idx on billing_exception (session_id);
create index billing_exception_appointment_idx on billing_exception (appointment_id);
create index billing_exception_service_type_idx on billing_exception (service_type_id);
create index billing_exception_created_by_idx on billing_exception (created_by);
create index billing_exception_resolved_by_idx on billing_exception (resolved_by);
-- One open exception per visit: a replayed completion must not queue the
-- same problem twice.
create unique index billing_exception_one_per_session
  on billing_exception (tenant_id, session_id) where session_id is not null;
create unique index billing_exception_one_per_appointment
  on billing_exception (tenant_id, appointment_id) where appointment_id is not null;
create trigger set_updated_at before update on billing_exception
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.billing_exception
  for each row execute function app.audit_row();
alter table public.billing_exception enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. The single-visit charge. Called only when a delivered visit found no
--    credit to consume: it prices the visit at today's rate, writes the
--    invoice and its one line, and creates the credit that visit consumes —
--    so a single visit and a package visit leave the same shape of ledger
--    behind them. Returns the new credit's id, or null when the service has
--    no price and the caller should queue an exception instead.
------------------------------------------------------------------------------
create function app.charge_single_visit(
  p_client_id uuid, p_service_type_id uuid, p_session_id uuid, p_on date
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id     uuid := app.current_tenant_id();
  v_actor_id      uuid := app.current_actor_id();
  v_price         public.price%rowtype;
  v_service_name  text;
  v_service_ar    text;
  v_vat_fils      integer;
  v_invoice_id    uuid;
  v_entitlement_id uuid;
begin
  -- The price in force on the day of the visit, for that service: the row
  -- with the greatest valid_from at or before it (domain/billing/price.ts's
  -- currentPriceFor, in SQL).
  select * into v_price from public.price
   where tenant_id = v_tenant_id and service_type_id = p_service_type_id
     and jurisdiction = 'AE' and recipient_type = 'individual'
     and valid_from <= p_on
   order by valid_from desc limit 1;
  if not found then
    return null;
  end if;

  select name, name_ar into v_service_name, v_service_ar
    from public.service_type where id = p_service_type_id and tenant_id = v_tenant_id;

  -- VAT on top of a net price, from the rate the price row itself was
  -- stamped with, rounded half up to the fils — the same arithmetic
  -- domain/billing/vat.ts runs, and never a rate typed here.
  v_vat_fils := round(v_price.unit_price_fils::numeric * v_price.vat_rate_basis_points / 10000);

  insert into public.invoice (
    tenant_id, client_id, number, kind, issued_on, session_id,
    net_fils, vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, p_client_id, app.next_invoice_number(), 'session', p_on, p_session_id,
    v_price.unit_price_fils, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
  ) returning id into v_invoice_id;

  insert into public.invoice_line (
    tenant_id, invoice_id, client_id, line_no, description, description_ar, service_type_id,
    quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version,
    vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, v_invoice_id, p_client_id, 1, v_service_name, v_service_ar, p_service_type_id,
    1, v_price.unit_price_fils, v_price.unit_price_fils, v_price.vat_rate_basis_points,
    v_price.vat_setting_version, v_vat_fils, v_price.unit_price_fils + v_vat_fils, v_actor_id
  );

  insert into public.entitlement (
    tenant_id, client_id, service_type_id, source_type, invoice_id, allocated_net_fils,
    vat_rate_basis_points, vat_setting_version, status, consumption_kind,
    consumed_by_session_id, consumed_at, created_by
  ) values (
    v_tenant_id, p_client_id, p_service_type_id, 'single', v_invoice_id, v_price.unit_price_fils,
    v_price.vat_rate_basis_points, v_price.vat_setting_version, 'consumed', 'session',
    p_session_id, now(), v_actor_id
  ) returning id into v_entitlement_id;

  return v_entitlement_id;
end
$$;
revoke execute on function app.charge_single_visit(uuid, uuid, uuid, date) from public;

------------------------------------------------------------------------------
-- 3. A completed visit consumes a credit.
------------------------------------------------------------------------------
create function app.billing_on_session_completed() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_today          date := (now() at time zone 'Asia/Dubai')::date;
  v_entitlement_id uuid;
  v_attempt        integer;
begin
  -- Already accounted for. An ordinary replay stops here; two at once are
  -- stopped by entitlement_one_per_session and invoice_one_per_session.
  if exists (select 1 from public.entitlement where consumed_by_session_id = new.id)
     or exists (select 1 from public.billing_exception where session_id = new.id) then
    return null;
  end if;

  -- Take a credit, or find there is none to take. Three things make this safe
  -- under two visits completing at the same moment:
  --   1. app.oldest_available_entitlement locks the row it returns and skips
  --      one another transaction is holding, so the two visits are handed two
  --      different credits.
  --   2. `and status = 'available'` on the update is the second lock. If the
  --      row moved between the read and the write, no row is updated and this
  --      falls through to the charge rather than overwriting a consumption
  --      that has already happened — the fault this shape exists to prevent,
  --      where one credit paid for two visits and the second was never
  --      invoiced at all.
  --   3. A miss is re-read once before giving up, because the credit that
  --      moved may not have been the only one.
  for v_attempt in 1..2 loop
    v_entitlement_id :=
      app.oldest_available_entitlement(new.client_id, new.service_type_id, v_today);
    exit when v_entitlement_id is null;
    update public.entitlement
       set status = 'consumed', consumption_kind = 'session',
           consumed_by_session_id = new.id, consumed_at = now()
     where id = v_entitlement_id and status = 'available';
    if found then
      return null;
    end if;
  end loop;

  if app.charge_single_visit(new.client_id, new.service_type_id, new.id, v_today) is null then
    insert into public.billing_exception (
      tenant_id, client_id, kind, session_id, service_type_id, detail, created_by
    ) values (
      new.tenant_id, new.client_id, 'unpriced_session', new.id, new.service_type_id,
      'This visit was delivered with no credit left and no price on the list for its service, '
        || 'so nothing was charged. Set a price, then invoice it.',
      app.current_actor_id()
    );
  end if;
  return null;
end
$$;
revoke execute on function app.billing_on_session_completed() from public;

-- Two triggers, not one, and keyed on the *transition* rather than the state.
-- OLD cannot be read in an insert trigger's WHEN clause, so the two cases are
-- declared separately: a session written straight in as completed is a visit
-- becoming completed and is charged, while an update that leaves a completed
-- session completed — correcting a note a week later — is not a second visit
-- and must not be a second charge. It also means a session already completed
-- when this migration ran is never charged at today's price by a later edit:
-- nothing here backfills, deliberately, because a price from months ago is
-- not a price this can invent.
create trigger billing_on_completed after insert on public.session
  for each row when (new.status = 'completed')
  execute function app.billing_on_session_completed();
alter table public.session enable always trigger billing_on_completed;
create trigger billing_on_completing after update on public.session
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function app.billing_on_session_completed();
alter table public.session enable always trigger billing_on_completing;

------------------------------------------------------------------------------
-- 4. A visit called off too late, or not attended, consumes one too
--    (billing.md section 4.3; the twenty-four-hour rule itself is
--    domain/billing/lateCancellation.ts, applied by whoever writes the
--    status). The coordinator's waiver is a route, not a trigger:
--    POST /api/billing/entitlements/:id/waiver.
------------------------------------------------------------------------------
create function app.billing_on_appointment_charged() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_today          date := (now() at time zone 'Asia/Dubai')::date;
  v_entitlement_id uuid;
  v_attempt        integer;
  v_kind           public.entitlement_consumption :=
    case new.status when 'cancelled_late' then 'late_cancellation' else 'no_show' end;
begin
  if exists (select 1 from public.entitlement where consumed_by_appointment_id = new.id)
     or exists (select 1 from public.billing_exception where appointment_id = new.id) then
    return null;
  end if;

  -- The same three guards as the session trigger above, for the same reason.
  for v_attempt in 1..2 loop
    v_entitlement_id :=
      app.oldest_available_entitlement(new.client_id, new.service_type_id, v_today);
    exit when v_entitlement_id is null;
    update public.entitlement
       set status = 'consumed', consumption_kind = v_kind,
           consumed_by_appointment_id = new.id, consumed_at = now()
     where id = v_entitlement_id and status = 'available';
    if found then
      return null;
    end if;
  end loop;

  -- No credit to take. Nothing is invoiced on the practice's own initiative
  -- here — charging a family for a visit they never had is a decision, not a
  -- default — so it goes to the queue with the visit named.
  insert into public.billing_exception (
    tenant_id, client_id, kind, appointment_id, service_type_id, detail, created_by
  ) values (
    new.tenant_id, new.client_id, 'uncovered_late_cancellation', new.id, new.service_type_id,
    'This visit was called off inside the notice period, but the client held no credit to take. '
      || 'Decide whether to charge for it.',
    app.current_actor_id()
  );
  return null;
end
$$;
revoke execute on function app.billing_on_appointment_charged() from public;

-- The same split, for the same reason: a visit that was already called off
-- late does not become newly called off because somebody edited the row.
create trigger billing_on_charged after insert on public.appointment
  for each row when (new.status in ('cancelled_late', 'no_show'))
  execute function app.billing_on_appointment_charged();
alter table public.appointment enable always trigger billing_on_charged;
create trigger billing_on_charging after update on public.appointment
  for each row when (new.status in ('cancelled_late', 'no_show')
                     and old.status is distinct from new.status)
  execute function app.billing_on_appointment_charged();
alter table public.appointment enable always trigger billing_on_charging;

------------------------------------------------------------------------------
-- 5. billing_ledger — what a household has been charged and what it has paid,
--    in one list. A view, so the balance is derived on every read and stored
--    nowhere (billing.md section 1). security_invoker, so it is the caller's
--    own row security that decides which rows they see, not the view owner's.
--
--    In schema `app`, not `public`: the recorded convention is that the
--    public schema holds only tables (00-data-model.md section 11), and the
--    trunk's own schema tests read that literally — a view in public with a
--    tenant_id column is asked for a unique (tenant_id, id) key it cannot
--    have, and for an audit trigger it cannot carry.
------------------------------------------------------------------------------
create view app.billing_ledger with (security_invoker = true) as
  select i.tenant_id,
         i.client_id,
         'charge'::text          as entry_kind,
         i.id                    as source_id,
         i.reference             as reference,
         i.kind::text            as detail,
         i.issued_on             as occurred_on,
         i.gross_fils            as amount_fils
    from public.invoice i
  union all
  select p.tenant_id,
         p.client_id,
         'payment'::text,
         p.id,
         p.reference,
         p.method::text,
         (p.received_at at time zone 'Asia/Dubai')::date,
         -- A payment reduces what is owed, so it carries the opposite sign and
         -- the balance is a plain sum.
         -p.amount_fils
    from public.payment p;
comment on view app.billing_ledger is
  'Charges and payments per client; the balance is the sum of amount_fils.';
grant select on app.billing_ledger to app_role;

------------------------------------------------------------------------------
-- Privileges and row security on the new table.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.billing_exception enable row level security;
  revoke all on public.billing_exception from public;
  if has_api_roles then
    revoke all on public.billing_exception from anon, authenticated;
  end if;
  -- Update, so an exception can be resolved; never delete.
  grant select, insert, update on public.billing_exception to app_role;
end
$$;

-- rollback:
--   revoke select, insert, update on public.billing_exception from app_role;
--   revoke select on app.billing_ledger from app_role;
--   drop view if exists app.billing_ledger;
--   drop trigger if exists billing_on_charging on public.appointment;
--   drop trigger if exists billing_on_charged on public.appointment;
--   drop function if exists app.billing_on_appointment_charged();
--   drop trigger if exists billing_on_completing on public.session;
--   drop trigger if exists billing_on_completed on public.session;
--   drop function if exists app.billing_on_session_completed();
--   drop function if exists app.charge_single_visit(uuid, uuid, uuid, date);
--   drop trigger if exists audit_row on public.billing_exception;
--   drop table if exists billing_exception;
--   drop type if exists billing_exception_kind;
