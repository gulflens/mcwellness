-- 950_invoice_vat_constraint.sql
-- Needs: 402 (invoice), 406 (app.guard_invoice_vat, the trigger this stands
--        beside), 905 (invoice.supplier_vat_registered)
--
-- The check constraint round 20 asked for and could not have, asked for again
-- by the billing stream in docs/CHANGE-REQUESTS/billing-04.md request 1:
--
--   an invoice carries VAT only if the practice was registered for it on the
--   day the invoice was numbered.
--
-- **The first trunk migration in the 950s** (docs/SPEC/OWNERSHIP.md). The
-- trunk's 900-949 are migrations a stream may build on; 950-999 are the other
-- direction, trunk migrations that build on a stream's own table and must
-- therefore sort last. `invoice` is billing's, `supplier_vat_registered` is
-- the trunk's own 905 on top of it, and this constraint needs both.
--
-- **Why it is here rather than in billing's 406, where round 20 put it.** It
-- cannot be there. Migrations apply in numeric order within a database, and
-- `invoice.supplier_vat_registered` arrives in the trunk's 905; billing's
-- range is 400-499, so 406 runs before that column exists on a fresh database
-- and the `alter table` fails outright. `checkNeeds` refuses a `-- Needs:`
-- naming a higher number for exactly this reason, and refused that file's
-- first draft. The general point is the one the ownership document now
-- carries: no stream can ever put a table-level constraint on anything the
-- trunk adds from 900 onwards, so the work belongs on this side of the line.
--
-- **Why it is worth adding when a trigger already enforces it.** Migration
-- 406's `app.guard_invoice_vat` raises on exactly this case, and it fires
-- after `app.stamp_invoice_supplier` so it reads the stamped snapshot rather
-- than the null a caller passed. That holds today. A trigger can be disabled
-- and a check constraint cannot, and the failure this guards against is a
-- false statement to the Federal Tax Authority on the one page an auditor
-- reads. Belt, and now braces.
--
-- **What each of the three arms means.**
--   `supplier_vat_registered is null` — an invoice numbered before migration
--     905 says nothing about the registration, and null there is "unknown",
--     never "false" (905's own column comment). Refusing those rows now would
--     refuse history rather than protect it.
--   `supplier_vat_registered` — a registered practice charges VAT, and how
--     much is `domain/billing`'s arithmetic, not this constraint's.
--   `vat_fils = 0` — an unregistered practice charges none.
--
-- The line's own rate is guarded separately and stays a trigger
-- (`app.guard_invoice_line_vat`, 406): it has to read the header row to know
-- the answer, and a check constraint may not read another row.
--
-- **What was checked before this landed.** Every existing invoice on this
-- database, seeded and test-written alike, satisfies it: `pnpm test:db` is
-- green with the constraint in place, including the fourteen tests in
-- `tests/billing` that refused it in round 20 and now pass because billing's
-- own pull request 54 made the charge follow `tenant.vat_registered`
-- (migration 406). `invoice` grants neither update nor delete, so an insert
-- is the only way a row arrives and this is the only moment it can be judged.
--
-- **What this migration deliberately does not do.** `invoice.document_id`
-- (402) is dead — nothing has ever written it, and nothing can, since the
-- table grants no update, which is why a rendered document hangs off
-- `billing_document` instead (407). billing-04 request 5 asks for it to be
-- dropped here. It is not dropped, because something does read it:
-- `tests/billing/db/packages.test.ts` selects `document_id from invoice` and
-- asserts it is null, which is a test that the column stays empty. That file
-- is the billing stream's, so the column stays and the ask goes back in
-- docs/CHANGE-REQUESTS/trunk-notes.md round 24 with what has to change first.

alter table invoice add constraint invoice_no_vat_unless_supplier_registered
  check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0);

comment on constraint invoice_no_vat_unless_supplier_registered on invoice is
  'An invoice carries VAT only if the practice was registered for it when the invoice was '
  'numbered. Null means the invoice predates migration 905 and says nothing, never that the '
  'practice was unregistered. app.guard_invoice_vat (406) says the same and can be disabled; '
  'this cannot (migration 950).';

-- rollback:
--   alter table invoice drop constraint if exists invoice_no_vat_unless_supplier_registered;
