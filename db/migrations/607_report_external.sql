-- 607_report_external.sql
-- An uploaded report: a PDF the practice produced in another tool, filed
-- against a client and put in front of the household as it stands
-- (docs/SPEC/reports-v1.md section 12; the practice's request of
-- 2026-10-06: "import/upload client reports in PDF format ... and send/share
-- it directly with the client").
--
-- **Why two files**, 602's reason exactly. A value added to an enum cannot
-- be used in the transaction that added it, and the runner applies each file
-- in one. So this file adds the value and names it nowhere else — not in a
-- check, not in a policy, not in a function. Every rule that has to say
-- `external` is 608's.
--
-- Needs: 600 (report_kind).

alter type public.report_kind add value if not exists 'external';

-- rollback:
--   -- 608 first. Postgres cannot drop a value from an enum; `external` stays
--   -- on the type, unused, which is harmless (602's own note). Every row of
--   -- the kind must be gone first: a filed report is never deleted outside an
--   -- erasure, so in practice this is not rolled back.
