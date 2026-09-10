-- 210_appointment_reassigned_from.sql
-- Who a reassigned visit was taken from (docs/SPEC/dispatch.md section 6.3).
--
-- A reassignment is a move that also changes hands: the old row becomes
-- `rescheduled` and keeps the practitioner the household was promised, and a
-- new row stands beside it carrying `rescheduled_from_id` and the new
-- practitioner (203). Walking that link answers "who was it taken from", but
-- the trail should answer it without walking anything, so the new row also
-- names the practitioner it was taken from. Nullable: a plain move sets
-- nothing here. The check says a reassignment is always also a reschedule,
-- which is what makes the old row's promise recoverable.
--
-- Needs: 203 (rescheduled_from_id), 200 (appointment, practitioner)

alter table public.appointment
  add column reassigned_from_practitioner_id uuid references public.practitioner (id);

comment on column public.appointment.reassigned_from_practitioner_id is
  'The practitioner this visit was taken from by a reassignment; null on any other row (docs/SPEC/dispatch.md 6.3).';

alter table public.appointment
  add constraint appointment_reassigned_implies_rescheduled
  check (reassigned_from_practitioner_id is null or rescheduled_from_id is not null);

-- The key is indexed, as every other foreign key on this table is (200), and
-- partially, as 203 indexed `rescheduled_from_id`: a reassignment is the rare
-- act and only the rows it wrote carry a value, so the index is kept to them
-- rather than to a column that is null on nearly every appointment.
create index appointment_reassigned_from_practitioner_idx
  on public.appointment (reassigned_from_practitioner_id)
  where reassigned_from_practitioner_id is not null;

-- rollback:
-- drop index if exists appointment_reassigned_from_practitioner_idx;
-- alter table public.appointment drop constraint appointment_reassigned_implies_rescheduled;
-- alter table public.appointment drop column reassigned_from_practitioner_id;
