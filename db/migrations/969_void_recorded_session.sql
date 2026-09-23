-- 969_void_recorded_session.sql
-- A visit logged from the practice's records by mistake is voided, never
-- deleted (trunk round 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md;
-- the operator's "go" of 23 September 2026).
--
-- **Why a void and not a delete.** No role holds a delete grant on `session`,
-- `appointment` or `entitlement`, the audit trail is a hashed chain, and a
-- closed visit is frozen by `app.session_refuse_update_after_close`. So the
-- wrong row stays, stamped with when, by whom and why it was withdrawn, and
-- everything that counted it stops counting it: the calendar (970), the
-- credit it took (step 5 below) and every reader that asks for
-- `status = 'completed'`. The shape is the invoice waiver's and the consent
-- withdrawal's: a stamp on an append-only record, not an edit of a fact.
--
-- **Only a `records` row.** A visit closed on the phone carries events,
-- readings and actuals the household really had; unwinding one is a credit
-- note (docs/SPEC/billing.md section 4.3), unbuilt and a different piece.
--
-- **Why two files.** A new enum value cannot be used in the transaction that
-- adds it, and the runner applies each file in its own. This file adds the
-- two values, the six columns, the guard and the function — function bodies
-- are text until they are first called, so naming 'voided' inside them is
-- safe here. Everything that must NAME the value in a constraint (the two
-- exclusion constraints, `session_closed_is_settled`, the two "void only when
-- voided" checks) is 970's.
--
-- Trunk range, second half (950-999): it alters `appointment` (scheduling,
-- 200-299) and `session` (session-capture, 300-399) and writes `entitlement`
-- (billing, 400-449), so it sorts after all three, as 966 did.
--
-- Needs: 020 (app_user, user_role), 200 (appointment, appointment_status),
--        300 (session, session_status), 302 (the close columns),
--        403 (entitlement and its waiver columns), 404 (billing_exception),
--        500 + 951 (assessment.session_id), 960 (the version of
--        app.session_refuse_update_after_close this replaces),
--        966 (session.recorded_from), 968.

alter type public.appointment_status add value if not exists 'voided';
alter type public.session_status add value if not exists 'voided';

------------------------------------------------------------------------------
-- 1. The stamp's three columns, on both rows.
--
--    All three or none, and a reason that is more than whitespace — the same
--    rule the X-Reason header has on every session route. That the stamp sits
--    only on a `voided` row is 970's check, since it has to name the value.
------------------------------------------------------------------------------
alter table public.session
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.app_user (id),
  add column void_reason text,
  add constraint session_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  );
create index session_voided_by_idx on public.session (voided_by) where voided_by is not null;

alter table public.appointment
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.app_user (id),
  add column void_reason text,
  add constraint appointment_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  );
create index appointment_voided_by_idx on public.appointment (voided_by) where voided_by is not null;

comment on column public.session.void_reason is
  'Why a visit logged from the records was withdrawn (migration 969). The row keeps its date, '
  'service, practitioner and length exactly as logged; status voided and these three columns '
  'are all a void adds.';
comment on column public.appointment.void_reason is
  'Why the appointment of a visit logged from the records was withdrawn with it (migration 969). '
  'A voided appointment no longer holds its window (970).';

------------------------------------------------------------------------------
-- 2. The close guard, restated as a diff of 960.
--
--    One transition is admitted on a closed row, and only one: `completed` to
--    `voided`, on a `records` row, with the three void columns filled and
--    every other column standing still. Anything else on a closed row is
--    refused as it always was — and a voided row is closed and not
--    `completed`, so every change to one is refused too.
--
--    Trigger order on an update of `session` (name order, 302's own note):
--    close_stamps_itself, then this one, then set_updated_at. So this guard
--    runs BEFORE updated_at is stamped and sees the caller's value, which is
--    the old one; `updated_at` is in the excluded keys only so a writer that
--    sets it explicitly is not refused for it.
------------------------------------------------------------------------------
create or replace function app.session_refuse_update_after_close() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_void_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if old.closed_at is null
     or exists (select 1 from app.erasure_active where txid = txid_current()) then
    return new;
  end if;
  -- to_jsonb rather than `new is not distinct from old`: the row carries a
  -- geography column, and this comparison must not depend on which types
  -- happen to have an equality operator today.
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return null;
  end if;
  -- The one change a closed visit admits (969): withdrawn from the record, a
  -- visit logged from the records by mistake. Compared as text so this body
  -- never has to cast a literal to the enum value 969 adds.
  if old.status::text = 'completed'
     and old.recorded_from = 'records'
     and new.status::text = 'voided'
     and new.voided_at is not null
     and new.voided_by is not null
     and length(btrim(new.void_reason)) > 0
     and (to_jsonb(new) - v_void_keys) is not distinct from (to_jsonb(old) - v_void_keys)
  then
    return new;
  end if;
  raise exception 'session % is closed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation';
end
$$;

------------------------------------------------------------------------------
-- 3. The door.
--
--    Security definer, because no role may otherwise move a closed session or
--    touch a consumed credit; so the rules are the boundary and are written
--    out in full, tenant named on every row, and who may call it is read from
--    user_role rather than from the session's claim — 923's reason, and 968's
--    family. The owner, an admin and the lead practitioner: the three who may
--    log such a visit (`session.record_past`), and the three `session.void`
--    admits in domain/shared/actor.ts.
--
--    Every refusal is `restrict_violation` with the code as its message, so
--    the route maps the message and never the sentence. The credit comes back
--    the way app/api/billing/waivers.ts gives one back: the consumed row is
--    marked `waived` and a replacement written pointing at it, so the books
--    post "credit restored" (454's `credit.waived`) against income already
--    recognised and the purchase's credits still total what was paid (403's
--    deferred check counts the replacement in the waived row's place). A visit
--    settled before the app took no credit and gets none back.
--
--    The reason on the credit is cut to the 200 characters 403 allows a
--    waiver; the session and the appointment carry it whole.
------------------------------------------------------------------------------
create function app.void_recorded_session(p_session_id uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor    uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant   uuid := app.current_tenant_id();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_session  public.session%rowtype;
  v_credit   public.entitlement%rowtype;
  v_restored boolean := false;
begin
  if v_actor is null or not exists (
       select 1 from public.user_role r
        where r.user_id = v_actor and r.tenant_id = v_tenant
          and r.role in ('owner', 'admin', 'lead_practitioner')) then
    raise exception 'wrong_role' using errcode = 'restrict_violation';
  end if;
  if length(v_reason) = 0 then
    raise exception 'reason_required' using errcode = 'restrict_violation';
  end if;

  -- The session's row first, and held to the end: two voids of the same
  -- visit queue here, and the second finds it already voided.
  select * into v_session
    from public.session s
   where s.id = p_session_id and s.tenant_id = v_tenant
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'restrict_violation';
  end if;
  if v_session.voided_at is not null then
    raise exception 'already_voided' using errcode = 'restrict_violation';
  end if;
  if v_session.recorded_from <> 'records' then
    raise exception 'not_a_records_row' using errcode = 'restrict_violation';
  end if;
  if v_session.status::text <> 'completed' then
    raise exception 'not_completed' using errcode = 'restrict_violation';
  end if;
  -- A figure, a bill or an open question still names the visit: withdrawing
  -- it would leave that row pointing at something the record no longer has.
  if exists (select 1 from public.assessment a
              where a.tenant_id = v_tenant and a.session_id = p_session_id)
     or exists (select 1 from public.invoice i
                 where i.tenant_id = v_tenant and i.session_id = p_session_id)
     or exists (select 1 from public.billing_exception b
                 where b.tenant_id = v_tenant and b.session_id = p_session_id) then
    raise exception 'session_in_use' using errcode = 'restrict_violation';
  end if;

  update public.session
     set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
   where id = p_session_id and tenant_id = v_tenant;
  -- The appointment it fulfils, the same way: this is what frees the window.
  update public.appointment
     set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
   where id = v_session.appointment_id and tenant_id = v_tenant;

  select * into v_credit
    from public.entitlement e
   where e.tenant_id = v_tenant and e.consumed_by_session_id = p_session_id
     and e.status = 'consumed'
     for update;
  if found then
    update public.entitlement
       set status = 'waived', waiver_reason = left(v_reason, 200),
           waived_at = now(), waived_by = v_actor
     where id = v_credit.id;
    insert into public.entitlement (
      tenant_id, client_id, service_type_id, source_type, package_purchase_id, invoice_id,
      allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on,
      replaces_entitlement_id, created_by
    ) values (
      v_credit.tenant_id, v_credit.client_id, v_credit.service_type_id, v_credit.source_type,
      v_credit.package_purchase_id, v_credit.invoice_id, v_credit.allocated_net_fils,
      v_credit.vat_rate_basis_points, v_credit.vat_setting_version, v_credit.expires_on,
      v_credit.id, v_actor
    );
    v_restored := true;
  end if;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'appointmentId', v_session.appointment_id,
    'creditRestored', v_restored
  );
end
$$;
revoke execute on function app.void_recorded_session(uuid, text) from public;
grant execute on function app.void_recorded_session(uuid, text) to app_role;

-- rollback:
--   -- Postgres cannot remove an enum value: 'voided' stays on both types,
--   -- unused once 970 is rolled back and nothing writes it.
--   drop function if exists app.void_recorded_session(uuid, text);
--   -- re-create app.session_refuse_update_after_close as
--   -- 960_retire_the_setup_photograph.sql defines it.
--   drop index if exists public.appointment_voided_by_idx;
--   drop index if exists public.session_voided_by_idx;
--   alter table public.appointment
--     drop constraint if exists appointment_void_columns_together,
--     drop column if exists void_reason,
--     drop column if exists voided_by,
--     drop column if exists voided_at;
--   alter table public.session
--     drop constraint if exists session_void_columns_together,
--     drop column if exists void_reason,
--     drop column if exists voided_by,
--     drop column if exists voided_at;
--   -- A row already voided cannot survive this: roll 970 back first, and
--   -- decide what each voided row should read as before dropping its stamp.
