-- 408_billing_call_out_fee.sql
-- One fee, never a session.
--
-- **The founder's decision of 2026-09-04**, restated by the operator the same
-- evening and recorded in docs/CONSENT/simple/README.md and
-- docs/CHANGE-REQUESTS/billing-05.md: moving or cancelling a visit more than
-- twenty-four hours ahead is free; inside that period a call-out fee of AED 150
-- applies; a visit that cannot go ahead once the practitioner has arrived
-- carries the same fee; and **a package's sessions are never taken for a
-- cancellation**. The wording a household signs
-- (docs/CONSENT/simple/bookings-and-packages.md) has said so since the
-- approval. Until this file, the code said the opposite:
-- `app.billing_on_appointment_charged` (404) took one of the family's prepaid
-- credits for every `cancelled_late` and every `no_show`, and the AED 150 in
-- `scheduling_setting.unfit_fee_fils` (202) was charged by nothing at all.
--
-- **What this changes.** The same trigger, on the same two transitions, now
-- writes one invoice for the fee on the household's account and leaves the
-- credit alone. The rule about which outcomes carry the fee is
-- `domain/billing/lateCancellation.ts`'s `callOutFeeFor`, and it is restated in
-- plpgsql below because this trigger has no application above it — closing or
-- calling off a visit is one transaction written by the scheduling stream, and
-- money is billing's (404's own contract, kept). The two are held together by
-- `tests/billing/db/call_out_fee.test.ts`, which walks every branch at the
-- table.
--
-- **A `practice_request` cancellation is late for the record and free for the
-- family.** Who was at fault belongs in the reason rather than in the status
-- (domain/scheduling/cancellation.ts), so the status still reads
-- `cancelled_late`; the fee is what follows the fault. `consent_withdrawn` is
-- named beside it, though it never reaches `cancelled_late` today: charging
-- somebody for exercising a right would be a penalty on exercising it, and the
-- answer should not depend on another stream's rule staying as it is.
--
-- **A no-show carries the fee too, and that is Claude's default of 2026-09-06,
-- not the founder's decision.** The practitioner drove there and no session was
-- delivered, which from the practice's side is the same event as unfit at the
-- door. It is recorded as a default in docs/CHANGE-REQUESTS/billing-05.md, and
-- reversing it is one clause in the guard below and one line in
-- `CALL_OUT_FEE_OUTCOMES`.
--
-- **Nothing is backfilled.** The triggers still key on the *transition*, so a
-- visit already called off when this migration ran is neither charged a fee nor
-- given its credit back. The credits that 404 took are facts about days that
-- have passed; giving them back is a decision for a person, through the
-- entitlement waiver that already exists, not something a migration should do
-- to a ledger while nobody is looking. `entitlement_consumption`'s
-- `late_cancellation` and `no_show` values, and `billing_exception_kind`'s
-- `uncovered_late_cancellation`, stay in their enums for the same reason: they
-- describe rows that exist.
--
-- **Why the fee is an invoice and not a new kind of row.** A `charge` on
-- `app.billing_ledger` *is* an invoice (404 section 5): the view is invoices
-- positive and payments negative, and the balance is their sum. So the fee
-- arrives the way every other charge does, with one line a family can read, and
-- every screen that shows what is owed shows it without being told to.
--
-- **And why the waiver is an update through a definer door.** `invoice` grants
-- neither update nor delete (402), and that stays true of every caller: the
-- table is append-only and a fee is not edited into a different figure.
-- `docs/SPEC/billing.md` section 4.3 asks for "a one-click waiver with a reason
-- field", and the existing one
-- (`POST /api/billing/entitlements/:id/waiver`) can only reach an entitlement —
-- there is no entitlement here any more, and the ledger has no adjustment or
-- credit-note row to reverse a charge with (`invoice.net_fils >= 0`,
-- `payment.amount_fils > 0`). So the waiver is the same act on the invoice
-- itself: `app.waive_call_out_fee`, security definer, which marks the row
-- waived with a reason and a person and nothing else. The charge stays on the
-- record and stays visible; `app.billing_ledger` stops counting it. That is
-- what `entitlement`'s own waiver does with a credit, in the shape this table
-- allows.
--
-- Needs: 010 (tenant), 020 (app_user), 080 (app.audit_row), 100
-- (app.current_actor_id), 200 (appointment), 400 (vat_setting), 402 (invoice,
-- invoice_line, app.next_invoice_number), 404 (billing_exception,
-- app.billing_on_appointment_charged, app.billing_ledger), 406
-- (app.tenant_charges_vat, invoice.supplied_on). `scheduling_setting` (202) is
-- deliberately absent: it is another stream's table and apply order across
-- ranges is not fixed (docs/SPEC/OWNERSHIP.md), so it is named only inside a
-- plpgsql body, which resolves its columns when it is called rather than when
-- it is created — the discipline 406 established for `tenant.vat_registered`.

------------------------------------------------------------------------------
-- 1. The two new names.
--
--    `ALTER TYPE ... ADD VALUE` may run inside a transaction on Postgres 12
--    and later, but the new label may not be *used* as a value in the same one.
--    That is why the amended check constraint below compares `kind::text`
--    against a text literal rather than casting the literal to `invoice_kind`:
--    reading a label out of the catalogue is not a use of the new value, and
--    the constraint means exactly the same thing.
------------------------------------------------------------------------------
alter type invoice_kind add value 'call_out_fee';
alter type billing_exception_kind add value 'uncharged_call_out_fee';

------------------------------------------------------------------------------
-- 2. The visit a fee is for, named on the invoice.
--
--    One invoice per appointment, ever. The trigger's own read is the
--    courtesy; this index is the guarantee, and it is what makes a second
--    status change — `cancelled_late` on to `no_show`, a genuine transition
--    rather than a replay — cost a family nothing more. One journey, one fee.
------------------------------------------------------------------------------
alter table invoice add column appointment_id uuid;
alter table invoice add constraint invoice_appointment_fkey
  foreign key (tenant_id, appointment_id) references appointment (tenant_id, id);

comment on column public.invoice.appointment_id is
  'The visit this invoice charges a call-out fee for, and null on every other kind '
  '(migration 408). One invoice per appointment: invoice_one_per_appointment.';

create index invoice_appointment_idx on invoice (appointment_id);
create unique index invoice_one_per_appointment
  on invoice (tenant_id, appointment_id) where appointment_id is not null;

-- The source rule, restated with the new kind in it. Dropped and rewritten
-- whole rather than added beside, so there is one place that says what each
-- kind of invoice must name and one place to read it.
alter table invoice drop constraint invoice_source_matches_kind;
alter table invoice add constraint invoice_source_matches_kind check (
  case kind::text
    when 'session' then
      session_id is not null and package_purchase_id is null and appointment_id is null
    when 'package' then
      package_purchase_id is not null and session_id is null and appointment_id is null
    when 'statement' then
      session_id is null and package_purchase_id is null and appointment_id is null
    when 'call_out_fee' then
      appointment_id is not null and session_id is null and package_purchase_id is null
    else false
  end
);

------------------------------------------------------------------------------
-- 3. A fee forgiven, in the shape `entitlement` already uses for a credit
--    forgiven (403): the row keeps what happened, and carries who let it go,
--    when, and why.
------------------------------------------------------------------------------
alter table invoice add column waived_at     timestamptz;
alter table invoice add column waived_by     uuid references app_user (id);
alter table invoice add column waiver_reason text
  check (length(btrim(waiver_reason)) between 1 and 200);
alter table invoice add constraint invoice_waiver_is_whole check (
  (waived_at is null) = (waived_by is null)
  and (waived_at is null) = (waiver_reason is null)
);
-- Only a call-out fee is forgivable here. A session or a package invoice is a
-- bill for something the family had; unwinding one of those is a credit note
-- and a conversation, not a switch.
alter table invoice add constraint invoice_only_a_fee_is_waived check (
  waived_at is null or kind::text = 'call_out_fee'
);

comment on column public.invoice.waived_at is
  'When the practice forgave this call-out fee, and null while it stands (migration 408). '
  'A waived charge stays on the record and stops counting in app.billing_ledger.';
create index invoice_waived_by_idx on invoice (waived_by);

------------------------------------------------------------------------------
-- 4. The waiver itself.
--
--    security definer because `invoice` grants no update to anybody: the
--    practice writes the row, not the person, and this is the one transition
--    the table has. The row is scoped to the caller's own practice here, so a
--    definer function cannot become a way to reach another tenant's ledger.
--
--    **And the caller's role is asked for here, not only in the route.** A
--    definer function runs with row security switched off, so the route's
--    `mayWaive` (app/api/billing/waivers.ts) is the courtesy and this is the
--    boundary — the same three roles `ledger_amenders`
--    (db/policies/billing/ledger.sql) holds a credit's waiver to, asked the
--    way the erasure doors ask it (104_erasure_the_act.sql) through 095's
--    `app.actor_has_role`. Who may forgive a charge is a question about money,
--    and a route is never the only thing standing between a practitioner and a
--    family's ledger (security review of this pull request).
------------------------------------------------------------------------------
create function app.waive_call_out_fee(p_invoice_id uuid, p_reason text)
returns table (waived boolean, gross_fils integer)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
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
revoke execute on function app.waive_call_out_fee(uuid, text) from public;
grant execute on function app.waive_call_out_fee(uuid, text) to app_role;

comment on function app.waive_call_out_fee(uuid, text) is
  'Forgives one call-out fee, leaving the charge on the record and taking it out of the '
  'balance (migration 408). Refuses a caller who is not the owner, an admin or finance, the '
  'three roles a credit''s waiver is held to. Returns no row when there was nothing to waive: '
  'the invoice is not this practice''s, is not a fee, or has been waived already.';

------------------------------------------------------------------------------
-- 5. An invoice number for a named practice, rather than for the one in
--    context.
--
--    `app.next_invoice_number()` reads `app.current_tenant_id()`, which is
--    right for every caller that is a route. The trigger below is not one: it
--    fires on a row that knows its own tenant, in a transaction opened by the
--    scheduling stream, and asking that transaction which practice it is
--    working for is asking the wrong thing of the wrong caller. It also
--    genuinely fails — `tests/session/db/doors.test.ts` calls a visit off
--    without a tenant in context on purpose, and a charge that depends on a
--    setting somebody else remembered to make is a charge that will go missing.
--
--    One counter, one implementation: the no-argument form is replaced by a
--    wrapper that resolves the practice and hands over, so gapless numbering
--    (402 section 1) still has exactly one place it happens.
------------------------------------------------------------------------------
create function app.next_invoice_number(p_tenant_id uuid) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_number integer;
begin
  if p_tenant_id is null then
    raise exception 'No practice named; an invoice number cannot be allocated.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Covers a practice created before 402's trigger existed, and any row it
  -- could not have fired for.
  insert into public.invoice_number_series (tenant_id) values (p_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.invoice_number_series
     set next_number = next_number + 1
   where tenant_id = p_tenant_id
  returning next_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_invoice_number(uuid) from public;
grant execute on function app.next_invoice_number(uuid) to app_role;

create or replace function app.next_invoice_number() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; an invoice number cannot be allocated.'
      using errcode = 'invalid_parameter_value';
  end if;
  return app.next_invoice_number(v_tenant_id);
end
$$;

------------------------------------------------------------------------------
-- 6. What a visit called off too late, or not attended, now costs.
--
--    Replaced whole rather than patched, and 404's version is written out in
--    this file's rollback, because `create or replace` has no undo of its own
--    (the discipline 406 set when it replaced `app.charge_single_visit`). The
--    two triggers that call it are untouched: the same two transitions, the
--    same guard against an edit to a settled row being read as a second visit.
------------------------------------------------------------------------------
create or replace function app.billing_on_appointment_charged() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id  uuid    := new.tenant_id;
  v_actor_id   uuid    := app.current_actor_id();
  v_today      date    := (now() at time zone 'Asia/Dubai')::date;
  v_visit_on   date    := (new.window_start at time zone 'Asia/Dubai')::date;
  v_fee_fils   integer;
  v_rate       integer;
  v_version    integer;
  v_vat_fils   integer;
  v_invoice_id uuid;
begin
  -- Already charged. An ordinary replay stops here; two at once are stopped by
  -- invoice_one_per_appointment, and so is a second fee outcome on the same
  -- visit. The read is the courtesy; the index is the guarantee.
  if exists (
    select 1 from public.invoice
     where tenant_id = v_tenant_id and appointment_id = new.id
  ) then
    return null;
  end if;

  -- The reasons that carry no fee (domain/billing/lateCancellation.ts's
  -- FEE_EXEMPT_REASONS). A practice does not bill a family for its own change
  -- of plan, and nobody is billed for exercising a right.
  if new.cancellation_reason is not null
     and new.cancellation_reason::text in ('practice_request', 'consent_withdrawn') then
    return null;
  end if;

  -- The practice's own figure, at this moment, snapshotted into the rows below
  -- and never read again. `scheduling_setting` is named only here, inside a
  -- body resolved when it is called (see the header).
  select s.unfit_fee_fils into v_fee_fils
    from public.scheduling_setting s
   where s.tenant_id = v_tenant_id;
  if not found then
    insert into public.billing_exception (
      tenant_id, client_id, kind, appointment_id, service_type_id, detail, created_by
    ) values (
      v_tenant_id, new.client_id, 'uncharged_call_out_fee', new.id, new.service_type_id,
      'This visit did not go ahead, but the practice''s cancellation policy could not be read, '
        || 'so no call-out fee was charged. Set the policy, then invoice it.',
      v_actor_id
    );
    return null;
  end if;

  -- A practice that has set its fee to zero has said the visit costs nothing.
  -- A charge of nothing is a line on a family's account telling them they owe
  -- nothing, which is noise rather than a record.
  if v_fee_fils <= 0 then
    return null;
  end if;

  -- The standard rate in force today, and the version of the setting that
  -- produced it, so the line records which setting was consulted even at a
  -- zero rate (406's own reasoning, kept).
  select v.rate_basis_points, v.version into v_rate, v_version
    from public.vat_setting v
   where v.tenant_id = v_tenant_id and v.effective_from <= v_today
   order by v.effective_from desc, v.version desc
   limit 1;
  if not found then
    insert into public.billing_exception (
      tenant_id, client_id, kind, appointment_id, service_type_id, detail, created_by
    ) values (
      v_tenant_id, new.client_id, 'uncharged_call_out_fee', new.id, new.service_type_id,
      'This visit did not go ahead, but the practice has no VAT setting to invoice under, '
        || 'so no call-out fee was charged. Set one, then invoice it.',
      v_actor_id
    );
    return null;
  end if;

  -- VAT on top of a net figure, and only while the practice is registered to
  -- charge it (406). The fee is published net like every other price, so an
  -- unregistered practice's gross is its net and a family pays the AED 150 the
  -- wording it signed named.
  if not app.tenant_charges_vat(v_tenant_id) then
    v_rate := 0;
  end if;
  v_vat_fils := round(v_fee_fils::numeric * v_rate / 10000);

  -- The day of supply is the day of the visit that did not happen, written
  -- only when it differs from the day this is billed (406's own rule: null
  -- means "the same day", never "nobody filled it in").
  insert into public.invoice (
    tenant_id, client_id, number, kind, issued_on, supplied_on, appointment_id,
    net_fils, vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, new.client_id, app.next_invoice_number(v_tenant_id), 'call_out_fee', v_today,
    case when v_visit_on = v_today then null else v_visit_on end, new.id,
    v_fee_fils, v_vat_fils, v_fee_fils + v_vat_fils, v_actor_id
  ) returning id into v_invoice_id;

  -- The words a family reads, in both languages, with the visit's date so they
  -- know which one it was. They are also
  -- `domain/billing/document/strings.ts`'s `callOutFeeDescription`, and
  -- tests/billing/db/call_out_fee.test.ts asserts the row this writes is
  -- exactly what that returns — the database is the only writer here, so the
  -- words have to exist in SQL, and that test is what stops the two drifting
  -- apart. An ISO date rather than the long form the rest of a rendered page
  -- uses: a trigger has no month names, and a second month table in plpgsql
  -- would be a second implementation of a rule that already has one.
  insert into public.invoice_line (
    tenant_id, invoice_id, client_id, line_no, description, description_ar,
    quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version,
    vat_fils, gross_fils, created_by
  ) values (
    v_tenant_id, v_invoice_id, new.client_id, 1,
    'Call-out fee — visit on ' || to_char(v_visit_on, 'YYYY-MM-DD'),
    'رسوم الاستدعاء — زيارة بتاريخ ' || to_char(v_visit_on, 'YYYY-MM-DD'),
    1, v_fee_fils, v_fee_fils, v_rate, v_version,
    v_vat_fils, v_fee_fils + v_vat_fils, v_actor_id
  );

  return null;
end
$$;
revoke execute on function app.billing_on_appointment_charged() from public;

------------------------------------------------------------------------------
-- 7. The ledger, with a forgiven fee taken out of it.
--
--    Replaced whole for the same reason as the function above, and 404's
--    version is in the rollback. Nothing else about it moves: charges are
--    invoices, payments carry the opposite sign, and the balance is the sum.
--    `waived_at is null` is the only new word, and it can only ever be false
--    for a call-out fee (invoice_only_a_fee_is_waived).
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
    from public.payment p;
comment on view app.billing_ledger is
  'Charges and payments per client; the balance is the sum of amount_fils. A waived '
  'call-out fee is not a charge the family owes and does not appear (migration 408).';

-- rollback:
--   drop function if exists app.waive_call_out_fee(uuid, text);
--   -- 402's numbering, written out: the wrapper above replaced it.
--   create or replace function app.next_invoice_number() returns integer
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_tenant_id uuid := app.current_tenant_id();
--     v_number    integer;
--   begin
--     if v_tenant_id is null then
--       raise exception 'No practice in context; an invoice number cannot be allocated.'
--         using errcode = 'invalid_parameter_value';
--     end if;
--     insert into public.invoice_number_series (tenant_id) values (v_tenant_id)
--       on conflict (tenant_id) do nothing;
--     update public.invoice_number_series
--        set next_number = next_number + 1
--      where tenant_id = v_tenant_id
--     returning next_number - 1 into v_number;
--     return v_number;
--   end
--   $fn$;
--   revoke execute on function app.next_invoice_number(uuid) from app_role;
--   drop function if exists app.next_invoice_number(uuid);
--   -- 404's ledger, written out: `create or replace view` has no undo either.
--   create or replace view app.billing_ledger with (security_invoker = true) as
--     select i.tenant_id, i.client_id, 'charge'::text as entry_kind, i.id as source_id,
--            i.reference as reference, i.kind::text as detail, i.issued_on as occurred_on,
--            i.gross_fils as amount_fils
--       from public.invoice i
--     union all
--     select p.tenant_id, p.client_id, 'payment'::text, p.id, p.reference, p.method::text,
--            (p.received_at at time zone 'Asia/Dubai')::date, -p.amount_fils
--       from public.payment p;
--   alter table invoice drop constraint if exists invoice_only_a_fee_is_waived;
--   alter table invoice drop constraint if exists invoice_waiver_is_whole;
--   drop index if exists invoice_waived_by_idx;
--   alter table invoice drop column if exists waiver_reason;
--   alter table invoice drop column if exists waived_by;
--   alter table invoice drop column if exists waived_at;
--   alter table invoice drop constraint if exists invoice_source_matches_kind;
--   alter table invoice add constraint invoice_source_matches_kind check (
--     case kind
--       when 'session' then session_id is not null and package_purchase_id is null
--       when 'package' then package_purchase_id is not null and session_id is null
--       when 'statement' then session_id is null and package_purchase_id is null
--     end
--   );
--   drop index if exists invoice_one_per_appointment;
--   drop index if exists invoice_appointment_idx;
--   alter table invoice drop constraint if exists invoice_appointment_fkey;
--   alter table invoice drop column if exists appointment_id;
--   -- 404's consumption, written out: going back means taking a family's
--   -- session for a cancellation again, which is the thing the founder ended.
--   create or replace function app.billing_on_appointment_charged() returns trigger
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_today          date := (now() at time zone 'Asia/Dubai')::date;
--     v_entitlement_id uuid;
--     v_attempt        integer;
--     v_kind           public.entitlement_consumption :=
--       case new.status when 'cancelled_late' then 'late_cancellation' else 'no_show' end;
--   begin
--     if exists (select 1 from public.entitlement where consumed_by_appointment_id = new.id)
--        or exists (select 1 from public.billing_exception where appointment_id = new.id) then
--       return null;
--     end if;
--     for v_attempt in 1..2 loop
--       v_entitlement_id :=
--         app.oldest_available_entitlement(new.client_id, new.service_type_id, v_today);
--       exit when v_entitlement_id is null;
--       update public.entitlement
--          set status = 'consumed', consumption_kind = v_kind,
--              consumed_by_appointment_id = new.id, consumed_at = now()
--        where id = v_entitlement_id and status = 'available';
--       if found then
--         return null;
--       end if;
--     end loop;
--     insert into public.billing_exception (
--       tenant_id, client_id, kind, appointment_id, service_type_id, detail, created_by
--     ) values (
--       new.tenant_id, new.client_id, 'uncovered_late_cancellation', new.id,
--       new.service_type_id,
--       'This visit was called off inside the notice period, but the client held no credit '
--         || 'to take. Decide whether to charge for it.',
--       app.current_actor_id()
--     );
--     return null;
--   end
--   $fn$;
--   -- The two enum values cannot be dropped; Postgres has no ALTER TYPE ...
--   -- DROP VALUE. They are harmless once nothing writes them.
