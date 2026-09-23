-- 970_voided_frees_the_window.sql
-- A voided visit no longer holds its window, and a void stamp sits only on a
-- voided row (trunk round 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md).
--
-- Everything here names 'voided' in a constraint, which the transaction that
-- added the value (969) could not do. Three things:
--
--   1. 200's two exclusion constraints, dropped and recreated exactly as 200
--      wrote them with 'voided' beside the four statuses they already ignore.
--      A visit withdrawn from the record is as gone from the calendar as a
--      cancelled one, and the right visit can be logged at the same hour.
--   2. 302's `session_closed_is_settled`, restated with 'voided' among the
--      statuses a closed row may hold. A voided session keeps its closed_at —
--      it is still closed, which is what keeps the guard in front of it.
--   3. The void columns only on a voided row, and a voided row only with
--      them, on both tables; and on `session`, `voided` only on a closed
--      row logged from the records.
--   4. The voided status written by app.void_recorded_session and by nothing
--      else, on both tables, insert or update (added 23 September 2026, as
--      the final reviews of round 60 found: 969's close guard fires only on
--      a CLOSED session, so the API role could move an OPEN session to
--      voided, insert one already voided, or void an appointment directly
--      and free its window with the visit behind it still completed).
--
-- Trunk range, second half, for 969's reason.
--
-- Needs: 200 (the exclusion constraints), 302 (session_closed_is_settled),
--        966 (session.recorded_from),
--        969 (the 'voided' values, the void columns and app.void_active).

alter table public.appointment drop constraint appointment_no_overlap_practitioner;
alter table public.appointment add constraint appointment_no_overlap_practitioner
  exclude using gist (
    practitioner_id with =,
    tstzrange(window_start, busy_end, '[)') with &&
  ) where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled', 'voided'));

alter table public.appointment drop constraint appointment_no_overlap_client;
alter table public.appointment add constraint appointment_no_overlap_client
  exclude using gist (
    client_id with =,
    tstzrange(window_start, window_end, '[)') with &&
  ) where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled', 'voided'));

alter table public.session drop constraint session_closed_is_settled;
alter table public.session add constraint session_closed_is_settled
  check (
    closed_at is null
    or status in ('completed', 'no_show', 'cancelled_late', 'cancelled', 'aborted', 'voided')
  );

-- Two-way: the stamp only on a voided row, and a voided row only with its
-- stamp (969's together-checks then require all three columns).
alter table public.session add constraint session_void_only_when_voided
  check ((status = 'voided') = (voided_at is not null));
alter table public.appointment add constraint appointment_void_only_when_voided
  check ((status = 'voided') = (voided_at is not null));

-- A void withdraws a visit logged from the records and closed: the one row
-- app.void_recorded_session admits. The table says so for every writer.
alter table public.session add constraint session_voided_is_a_closed_records_row
  check (status <> 'voided' or (closed_at is not null and recorded_from = 'records'));

------------------------------------------------------------------------------
-- 4. The one door, on both tables.
--
--    969's marker opens the close guard for one session in one transaction,
--    but the close guard stands aside for an OPEN row and has no say on an
--    insert or on `appointment` at all. So a second guard, before insert or
--    update on both tables: a row becomes `voided` only while
--    app.void_recorded_session has named it (the session by its id, the
--    appointment through the session that names it) in this transaction.
--    The function writes its marker, updates the session, then the
--    appointment, then removes the marker, so its own two writes pass and
--    nothing else does. A row that is already voided and stays voided is not
--    this guard's business: the close guard refuses every change to it.
--
--    Security definer, so it may read app.void_active, which no role but the
--    definer functions can; search_path pinned as 968's family is. `enable
--    always`, like 302's guard, so session_replication_role cannot switch it
--    off. Compared as text so this body never casts to the enum.
------------------------------------------------------------------------------
create function app.refuse_void_without_marker() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.status::text <> 'voided'
     or (tg_op = 'UPDATE' and old.status::text = 'voided') then
    return new;
  end if;
  if tg_table_name = 'session' then
    if exists (select 1 from app.void_active va
                where va.txid = txid_current() and va.session_id = new.id) then
      return new;
    end if;
  elsif exists (select 1 from app.void_active va
                  join public.session s on s.id = va.session_id
                 where va.txid = txid_current() and s.appointment_id = new.id) then
    return new;
  end if;
  raise exception 'void_needs_the_function' using errcode = 'restrict_violation';
end
$$;
revoke execute on function app.refuse_void_without_marker() from public;

create trigger refuse_void_without_marker before insert or update on public.session
  for each row execute function app.refuse_void_without_marker();
alter table public.session enable always trigger refuse_void_without_marker;
create trigger refuse_void_without_marker before insert or update on public.appointment
  for each row execute function app.refuse_void_without_marker();
alter table public.appointment enable always trigger refuse_void_without_marker;

-- rollback:
--   -- Only once no row is voided: each recreated constraint below refuses one.
--   drop trigger if exists refuse_void_without_marker on public.appointment;
--   drop trigger if exists refuse_void_without_marker on public.session;
--   drop function if exists app.refuse_void_without_marker();
--   alter table public.session drop constraint if exists session_voided_is_a_closed_records_row;
--   alter table public.appointment drop constraint if exists appointment_void_only_when_voided;
--   alter table public.session drop constraint if exists session_void_only_when_voided;
--   alter table public.session drop constraint session_closed_is_settled;
--   alter table public.session add constraint session_closed_is_settled
--     check (closed_at is null
--            or status in ('completed', 'no_show', 'cancelled_late', 'cancelled', 'aborted'));
--   alter table public.appointment drop constraint appointment_no_overlap_client;
--   alter table public.appointment add constraint appointment_no_overlap_client
--     exclude using gist (client_id with =, tstzrange(window_start, window_end, '[)') with &&)
--     where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled'));
--   alter table public.appointment drop constraint appointment_no_overlap_practitioner;
--   alter table public.appointment add constraint appointment_no_overlap_practitioner
--     exclude using gist (practitioner_id with =, tstzrange(window_start, busy_end, '[)') with &&)
--     where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled'));
