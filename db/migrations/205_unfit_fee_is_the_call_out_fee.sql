-- 205_unfit_fee_is_the_call_out_fee.sql
-- The column comment on the fee, brought up to what the platform now does
-- (docs/CHANGE-REQUESTS/billing-06.md request 4).
--
-- **What was wrong.** Migration 202 commented
-- `scheduling_setting.unfit_fee_fils` "Recorded here; nothing charges it yet
-- (docs/CHANGE-REQUESTS/scheduling-04.md)". That was true when it was written.
-- Migration 408 charges it. A column comment saying nothing charges a figure
-- that is charged on every late cancellation is the kind of wrong that reads
-- as authoritative, and `billing-05.md` claimed the comment had already been
-- put right when it had not — 408 comments `invoice.appointment_id` and
-- `invoice.waived_at`, which are billing's own columns, and cannot comment
-- another stream's table without editing that stream's migration.
--
-- **Why a new file rather than an edit to 202.** 202 is merged, and a merged
-- migration is never edited (.claude/rules/data-model.md). `comment on column`
-- replaces whatever comment the column carries, so a new file in this stream's
-- range says the new thing and the rollback below restores 202's words exactly.
--
-- **Why `Needs: 202` only, though the comment names migration 408.**
-- `checkNeeds` refuses a `-- Needs:` naming a number at or above the file's
-- own, and 408 is higher than 205 — rightly, because apply order across the
-- ranges is not fixed and a later number is no proof a later file is on this
-- database (docs/SPEC/OWNERSHIP.md). Nothing here depends on 408: a comment
-- describes, it does not reference. This file needs the column to exist, which
-- is 202, and nothing else. On a database that somehow carried 202 and not 408
-- the comment would be describing a charge that had not arrived yet, which is
-- a documentation question and not a broken migration.
--
-- Needs: 202 (scheduling_setting, and the column)

comment on column public.scheduling_setting.unfit_fee_fils is
  'The practice''s call-out fee, net of VAT, in integer fils: what one wasted journey costs '
  'the household when the practitioner has set out and no session is delivered '
  '(docs/SPEC/billing.md section 4.3, the founder''s decision of 4 September 2026). '
  'app.billing_on_appointment_charged (migration 408) snapshots this figure onto a '
  'call_out_fee invoice on a late cancellation, on a visit unfit at the door and on a no-show. '
  'The no-show is Claude''s default of 2026-09-06 for the founder to overrule '
  '(docs/CHANGE-REQUESTS/billing-05.md). No cancellation takes a session from a package.';

-- rollback:
--   -- 202's comment, word for word.
--   comment on column public.scheduling_setting.unfit_fee_fils is
--     'What a visit costs the household when the practitioner arrives and it cannot go ahead, in '
--     'integer fils. Recorded here; nothing charges it yet (docs/CHANGE-REQUESTS/scheduling-04.md).';
