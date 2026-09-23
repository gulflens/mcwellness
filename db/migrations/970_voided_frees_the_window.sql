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
--   3. The void columns only on a voided row, on both tables.
--
-- Trunk range, second half, for 969's reason.
--
-- Needs: 200 (the exclusion constraints), 302 (session_closed_is_settled),
--        969 (the 'voided' values and the void columns).

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

alter table public.session add constraint session_void_only_when_voided
  check (voided_at is null or status = 'voided');
alter table public.appointment add constraint appointment_void_only_when_voided
  check (voided_at is null or status = 'voided');

-- rollback:
--   -- Only once no row is voided: each recreated constraint below refuses one.
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
