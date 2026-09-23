-- 924_practice_bank_account.sql
-- The practice's bank account, for "Pay by bank transfer" on its invoices
-- (round 61, the owner's ask of 23 September 2026). Business facts of the
-- practice, not personal data: audited with the row, never redacted. Read by
-- the invoice at render time, as the logo is (docs/SPEC/billing.md §5.6).
--
-- The IBAN is held uppercase with its spaces taken out, and printed grouped
-- in fours; the BIC uppercase, eight or eleven characters. The holder's name
-- and the IBAN travel together, and a BIC or a bank address means nothing
-- without an IBAN, so neither may be recorded alone. `app/api/practice/
-- schema.ts` holds the same rules and refuses a typo with a sentence first.
--
-- Who may write them is already settled: `app.guard_tenant_identity` (905)
-- restricts every `tenant` update to an owner or an admin, and `app_role`
-- has a table-level update grant (090), so no grant or policy changes here.
--
-- Trunk range, first half (900-949): it alters `tenant`, a core table.
--
-- Needs: 912 (the practice's contact columns, beside which these sit).

alter table tenant
  add column bank_account_holder text,
  add column bank_iban text,
  add column bank_bic text,
  add column bank_address text;

alter table tenant
  add constraint tenant_bank_iban_shape check (bank_iban is null or bank_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  add constraint tenant_bank_bic_shape check (bank_bic is null or bank_bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  add constraint tenant_bank_holder_length check (bank_account_holder is null or length(bank_account_holder) between 1 and 120),
  add constraint tenant_bank_address_length check (bank_address is null or length(bank_address) between 1 and 200),
  add constraint tenant_bank_holder_with_iban check ((bank_iban is null) = (bank_account_holder is null)),
  add constraint tenant_bank_details_need_iban check (bank_iban is not null or (bank_bic is null and bank_address is null));

comment on column tenant.bank_iban is 'Uppercase, no spaces; printed grouped in fours.';

-- rollback:
--   alter table tenant drop column bank_account_holder, drop column bank_iban, drop column bank_bic, drop column bank_address;
