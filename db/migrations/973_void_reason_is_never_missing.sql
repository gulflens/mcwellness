-- 973_void_reason_is_never_missing.sql
-- A voided visit always carries its reason, even past the function (trunk
-- round 68; added 30 September 2026).
--
-- 969's together-checks read `length(btrim(void_reason)) > 0` on the voided
-- side. For a reason that is NULL that expression is NULL, not false, and a
-- CHECK only refuses a row whose expression is false: a session or an
-- appointment stamped with who and when but no reason at all passed the
-- check as "unknown". Nothing reaches that today (`app.void_recorded_session`
-- refuses an empty reason and 970's guards refuse every void written outside
-- it), and no voided row exists without one, so this restates both checks
-- with `coalesce(..., 0)`, making the second line hold on its own as it was
-- meant to. Both constraints keep their names, so the route's and the tests'
-- reading of them is unchanged.
--
-- Validated in place: the table is scanned once under the lock `add
-- constraint` takes; every existing row satisfies the stricter form (a voided
-- row without a reason could only come from a write the guards refuse).
--
-- Needs: 969, 970, 971.

alter table public.session
  drop constraint session_void_columns_together,
  add constraint session_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
        and coalesce(length(btrim(void_reason)), 0) > 0)
  );

alter table public.appointment
  drop constraint appointment_void_columns_together,
  add constraint appointment_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
        and coalesce(length(btrim(void_reason)), 0) > 0)
  );

-- rollback:
--   -- Restores 969's form, which admits a void stamp with a NULL reason.
--   alter table public.appointment
--     drop constraint appointment_void_columns_together,
--     add constraint appointment_void_columns_together check (
--       (voided_at is null and voided_by is null and void_reason is null)
--       or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
--     );
--   alter table public.session
--     drop constraint session_void_columns_together,
--     add constraint session_void_columns_together check (
--       (voided_at is null and voided_by is null and void_reason is null)
--       or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
--     );
