-- 966_session_from_records.sql
-- Needs: 300 (session), 302 (the close columns and constraints),
--        403 (entitlement, app.oldest_available_entitlement),
--        404 (app.billing_on_session_completed, app.charge_single_visit,
--        billing_exception)
--
-- A visit that happened before the app, logged from the practice's records
-- (docs/superpowers/specs/2026-09-16-past-sessions-design.md; the owner's
-- decisions of 16 September 2026, docs/CHANGE-REQUESTS/trunk-round-51.md).
-- The clients the practice already has were seen on paper, and their history
-- belongs on their record: the office logs each visit from the day schedule
-- for a day that has passed, as one completed session.
--
-- **Two facts the row carries.** `recorded_from` says how the row came to be:
-- `device`, the practitioner's phone at the door, which every row until now
-- was; or `records`, the office typing it up afterwards. `settled_outside_app`
-- says the visit was paid for before the app existed and nothing is to be
-- charged for it; it is only ever true on a `records` row, by constraint.
--
-- **What billing does with a `records` row.** Migration 404's trigger fires on
-- any insert that says `completed`, and it prices at today: for a visit from
-- a day that has passed that is exactly the invented price 404's own header
-- says would be worse than leaving it to a person. So the function gains one
-- branch ahead of its existing body, and the body itself is 404's word for
-- word. A `records` row settled outside the app charges nothing and writes
-- nothing. A `records` row not so marked takes the oldest credit that was
-- valid on the visit's own date — a package bought for those visits and since
-- run out still covers them — and if there is none the insert is refused
-- with `restrict_violation`, which the route answers as "no credit
-- available: record the package sale first, or mark the visit settled"; the
-- session is never written and no invoice is invented. A `device` row runs
-- 404's body unchanged.
--
-- **Replacing the function whole, not editing 404.** 404 is merged and
-- `create or replace function` has no patch form, so the body below is 404's
-- with the branch added ahead of it, the way 957 carries 953's. `create or
-- replace` keeps the privileges the function already has, so 404's revoke
-- from `public` is not restated and not lost. A future migration that changes
-- this function starts from **this** body.
--
-- Trunk range, second half (950-999): it alters `session`, a stream's table
-- (session-capture, 300-399), and replaces a function of another stream's
-- (billing, 400-449), so it sorts after both and is the last thing applied.

alter table public.session
  add column recorded_from text not null default 'device'
    constraint session_recorded_from_check check (recorded_from in ('device', 'records')),
  add column settled_outside_app boolean not null default false,
  add constraint session_settled_only_from_records
    check (settled_outside_app = false or recorded_from = 'records');

comment on column public.session.recorded_from is
  'How the row came to be: ''device'', the practitioner''s phone at the door; or ''records'', the office logging a visit that happened before the app, from the practice''s records (2026-09-16).';
comment on column public.session.settled_outside_app is
  'True when the visit was paid for before the app existed and nothing is to be charged for it. Only ever true on a records row: billing charges nothing and writes nothing for such a row.';

create or replace function app.billing_on_session_completed() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_today          date := (now() at time zone 'Asia/Dubai')::date;
  v_visit_day      date;
  v_entitlement_id uuid;
  v_attempt        integer;
begin
  -- Already accounted for. An ordinary replay stops here; two at once are
  -- stopped by entitlement_one_per_session and invoice_one_per_session.
  if exists (select 1 from public.entitlement where consumed_by_session_id = new.id)
     or exists (select 1 from public.billing_exception where session_id = new.id) then
    return null;
  end if;

  -- A visit logged from the practice's records (966): settled before the app,
  -- nothing is charged; otherwise a credit valid on the visit's own day, or
  -- a refusal — never an invoice at today's price for a day that has passed.
  if new.recorded_from = 'records' then
    if new.settled_outside_app then
      return null;
    end if;
    v_visit_day := (new.checked_in_at at time zone 'Asia/Dubai')::date;
    for v_attempt in 1..2 loop
      v_entitlement_id :=
        app.oldest_available_entitlement(new.client_id, new.service_type_id, v_visit_day);
      exit when v_entitlement_id is null;
      update public.entitlement
         set status = 'consumed', consumption_kind = 'session',
             consumed_by_session_id = new.id, consumed_at = now()
       where id = v_entitlement_id and status = 'available';
      if found then
        return null;
      end if;
    end loop;
    raise exception 'no credit is available for this visit on %', v_visit_day
      using errcode = 'restrict_violation';
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

-- rollback:
--   -- Restore app.billing_on_session_completed as 404 wrote it
--   -- (db/migrations/404_billing_consumption.sql, the `create function
--   -- app.billing_on_session_completed` block: no v_visit_day, no records
--   -- branch), then:
--   alter table public.session drop constraint session_settled_only_from_records;
--   alter table public.session drop column settled_outside_app;
--   alter table public.session drop column recorded_from;
--   -- A session row logged from records survives as an ordinary completed
--   -- row; its credit, if one was taken, stays consumed.
