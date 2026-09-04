-- 950_invoice_vat_constraint.sql
-- Needs: 402 (invoice), 406 (app.guard_invoice_vat and app.tenant_charges_vat,
--        the trigger this replaces and the question it asks), 905
--        (invoice.supplier_vat_registered)
--
-- The check constraint round 20 asked for and could not have, asked for again
-- by the billing stream in docs/CHANGE-REQUESTS/billing-04.md request 1:
--
--   an invoice carries VAT only if the practice was registered for it on the
--   day the invoice was numbered.
--
-- And the hole the security review of that pull request found underneath it,
-- which the constraint alone does not close. See section 1.
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
-- **What was checked before this landed.** The seed writes no invoices at all,
-- so a seeded database proves nothing here; what proves it is the database
-- suite. `pnpm test:db` is green with the constraint live — every invoice the
-- tests write, through the charge paths and by hand, satisfies it — including
-- the fourteen in `tests/billing` that refused this constraint in round 20 and
-- now pass because billing's own pull request 54 made the charge follow
-- `tenant.vat_registered` (migration 406). `invoice` grants neither update nor
-- delete, so an insert is the only way a row arrives and this is the only
-- moment it can be judged.
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

------------------------------------------------------------------------------
-- 1. The claim itself, checked against the practice's own row.
--
--    **The hole.** Both rules above read `supplier_vat_registered` — 406's
--    guard falls back to the tenant only when it is null, and the constraint
--    below takes it as given. Neither ever asks whether the practice really
--    holds the registration the row claims. And 905's stamp returns early the
--    moment a caller supplies `supplier_legal_name`, precisely so a correction
--    may pass its own snapshot in, so a caller who names a supplier and sets
--    `supplier_vat_registered = true` writes VAT for an unregistered practice
--    past every existing check. 905 ties the VAT *number* to the flag
--    (`invoice_supplier_vat_trn_needs_registration`) and never the flag to
--    `tenant.vat_registered`.
--
--    **The rule.** A row may not claim a registration the practice does not
--    hold. `app.tenant_charges_vat` (406) is the same question every charge
--    path already asks, and it answers false for a practice that is not
--    there, which is the safe way round.
--
--    **Why this is in a trunk migration and not in 406.** 406 is merged and a
--    merged migration is never edited (.claude/rules/data-model.md), and the
--    rule needs `invoice.supplier_vat_registered`, which arrives in the
--    trunk's 905 — so a stream's 4xx cannot name it in a `-- Needs:` line and
--    cannot be sure of it on a fresh database. This range exists for exactly
--    that: trunk work that builds on a stream's own table and must sort last
--    (docs/SPEC/OWNERSHIP.md).
--
--    **What this narrows, said plainly.** A practice that deregisters can no
--    longer file a correction claiming the registration it held when the
--    original was issued: the only registration the database can check is the
--    one on `tenant` today. That is a real restriction and it is the right
--    way round — the alternative is taking a caller's word for a tax
--    registration, and the failure it guards against is a false statement to
--    the Federal Tax Authority. A practice that needs to correct an invoice
--    from a registered period raises it rather than asserting it.
--
--    Replaced whole rather than patched: `create or replace` has no undo, so
--    the rollback below carries 406's body verbatim.
------------------------------------------------------------------------------
create or replace function app.guard_invoice_vat() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- A null here is not "says nothing" at insert time. The stamp returns early
  -- when a caller supplies its own supplier_legal_name, so null is exactly what
  -- an insert that named its own supplier and skipped the registration leaves
  -- behind — and reading that as permission is how VAT gets onto an invoice
  -- from a practice that holds no registration. The practice's own answer is
  -- the fallback, which is what the stamp would have written.
  if not coalesce(new.supplier_vat_registered, app.tenant_charges_vat(new.tenant_id))
     and new.vat_fils <> 0 then
    raise exception 'an invoice cannot carry VAT for a practice that is not registered for it'
      using errcode = 'check_violation',
            hint    = 'Prices are net and VAT is added only while tenant.vat_registered is true '
                      '(migration 406). Leave vat_fils at zero.';
  end if;

  -- And the other way about (migration 950): a row may not claim a
  -- registration the practice does not hold. Without this a caller who
  -- supplies its own supplier snapshot writes true and walks past both the
  -- rule above and the constraint below.
  if new.supplier_vat_registered is true
     and not app.tenant_charges_vat(new.tenant_id) then
    raise exception 'an invoice cannot claim a VAT registration the practice does not hold'
      using errcode = 'check_violation',
            hint    = 'supplier_vat_registered is stamped from tenant.vat_registered '
                      '(migration 905). Record the registration on the practice first.';
  end if;

  return new;
end
$$;
revoke execute on function app.guard_invoice_vat() from public;

------------------------------------------------------------------------------
-- 2. The constraint, which holds even with that trigger switched off.
------------------------------------------------------------------------------
alter table invoice add constraint invoice_no_vat_unless_supplier_registered
  check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0);

comment on constraint invoice_no_vat_unless_supplier_registered on invoice is
  'An invoice carries VAT only if the practice was registered for it when the invoice was '
  'numbered. Null means the invoice predates migration 905 and says nothing, never that the '
  'practice was unregistered. app.guard_invoice_vat (406, 950) says the same and can be '
  'disabled; this cannot (migration 950).';

-- rollback:
--   alter table invoice drop constraint if exists invoice_no_vat_unless_supplier_registered;
--   -- The guard goes back to 406's body, verbatim, without the claim check.
--   create or replace function app.guard_invoice_vat() returns trigger
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   begin
--     if not coalesce(new.supplier_vat_registered, app.tenant_charges_vat(new.tenant_id))
--        and new.vat_fils <> 0 then
--       raise exception 'an invoice cannot carry VAT for a practice that is not registered for it'
--         using errcode = 'check_violation',
--               hint    = 'Prices are net and VAT is added only while tenant.vat_registered is true '
--                         '(migration 406). Leave vat_fils at zero.';
--     end if;
--     return new;
--   end
--   $fn$;
--   revoke execute on function app.guard_invoice_vat() from public;
