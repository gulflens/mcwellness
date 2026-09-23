# Bank details and the discount percentage on the invoice (round 61) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The practice records its bank account in Settings › Practice, every invoice rendered from then on carries "Pay by bank transfer" with those details, and a discounted invoice states the percentage beside the amount.

**Architecture:** Four nullable columns on `tenant` (migration 924, trunk first half) edited through the existing practice route and drawer. The document reads them **live at render time, as it reads the logo** — not snapshotted per invoice — because the practice's payment instructions are a fact of today, the filed PDF is the immutable record, and the one real invoice already exists so a snapshot stamped at insert would never reach it. The percentage is already on every invoice line (`discount_basis_points`) and in the document model; the renderer starts printing it, on the line and in the totals when every discounted line shares one.

**Tech Stack:** SQL migration, Hono + zod (`app/api/practice/`), React (`app/admin/settings/`), the pure PDF writer (`domain/billing/document/`), Vitest + real database tests.

**Spec:** the owner's ask of 23 September 2026 (bank details: account holder `MCWELLNESS L.L.C-FZ`, an IBAN, a BIC, the bank's address; "the % value for the discount in addition to the discounted amount"), `docs/SPEC/billing.md` §2.4 ("with the percentage when there was one") and §5.6 (the document's design), and this round's design (bank details read live; block left of the totals box; receipt carries none).

## Global Constraints

- **Never write the practice's real bank details, IBAN or BIC into any file, test, fixture, seed or commit.** Tests use invented values in the reserved shapes: IBAN `AE07 0000 0000 0000 0000 001` style (country `AE`, digits only, 23 characters), BIC `TESTAEXX`, holder from `db/seed/names.ts` or "Example Practice L.L.C-FZ". The owner enters the real ones in Settings once the round is live.
- Bank details are the practice's own business facts, not personal data: they are audited like every other `tenant` column and **not** added to `app.audit_redact`. Say so in the change request for the compliance reviewer.
- Validation (zod and a database check, both): IBAN stored uppercase with spaces removed, `^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`; BIC uppercase `^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$`; holder 1–120 characters; bank address 1–200 characters. Holder and IBAN are both set or both null (`(bank_iban is null) = (bank_account_holder is null)`); BIC and address are optional but only with an IBAN.
- The block prints only when holder and IBAN are present. A document rendered before the practice recorded them is byte-identical to today's output (the document tests' determinism case must still pass on a supplier with no bank details).
- Document wording is inline `{ en, ar }` pairs in `domain/billing/document/strings.ts`; figures in Western digits; the design's own phrasing keeps its middle dot.
- The receipt carries no bank block.
- `pnpm -s format` before `pnpm verify`; `pnpm test:db` needs this worktree's database (port 5436).

## Review Focus

1. A long bank address or account holder must wrap inside the left column and never cross into the totals box: Task 3's geometry test renders a 200-character address and asserts no overlap and no margin crossing.
2. An invoice with two discounted lines at different percentages must print each line's own percentage and NO percentage in the totals: Task 3 tests it.
3. A discount typed as a sum (basis points null) prints the amount alone, exactly as today: Task 3 tests it against the existing fixture.
4. Clearing a bank field in the drawer must clear it in the database, which the contact fields cannot do today (`coalesce($n, col)` keeps the old value): Task 1 tests "clear the IBAN" end to end and fixes the same defect for the three contact fields, since the same route line causes it.
5. The invoice-level percentage is only meaningful when every discounted line agrees; a line with no discount does not break the agreement: Task 3 tests one discounted line at 25% beside one undiscounted line → totals say 25%.

---

### Task 1: The columns and the route

**Files:**
- Create: `db/migrations/924_practice_bank_account.sql`
- Modify: `app/api/practice/schema.ts` (`Practice` :162-209, `UpdatePracticeInput` :231-279)
- Modify: `app/api/practice/routes.ts` (`SELECT_PRACTICE` :35-45, `PracticeRow` :47-69, `view()` :98-128, the PATCH update :192-231)
- Modify: `docs/SPEC/00-data-model.md` (tenant, ~230-233: the four columns)
- Test: `tests/db/practice.test.ts`, `tests/db/practice-identity.test.ts`

**Interfaces:**
- Produces: `GET /api/practice` answers `bank: { accountHolder, iban, bic, bankAddress } | null` (null when no IBAN); `PATCH /api/practice` accepts the same four under `bank` (each `string | null`; `null` clears; an absent `bank` key leaves them alone). Same for the contact fields: `contactPhone`, `contactEmail`, `website` accept `null` to clear.

- [ ] **Step 1: The migration**

```sql
-- 924_practice_bank_account.sql
-- Needs: 912
-- The practice's bank account, for "Pay by bank transfer" on its invoices
-- (round 61, the owner's ask of 23 September 2026). Business facts of the
-- practice, not personal data: audited with the row, never redacted. Read by
-- the invoice at render time, as the logo is (docs/SPEC/billing.md §5.6).
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
```

`app.guard_tenant_identity()` (905) already restricts every `tenant` update to owner/admin, and `app_role` has a table-level update grant (090), so no grant or policy change.

- [ ] **Step 2: Failing route tests**

In `tests/db/practice.test.ts` (the `form()` helper builds the PATCH body):

```ts
it('records the bank account and answers it back, IBAN stored without spaces', …); // PATCH bank {accountHolder:'Example Practice L.L.C-FZ', iban:'ae07 0000 0000 0000 0000 001', bic:'testaexx', bankAddress:'1 Example Street, Abu Dhabi'} → GET bank.iban === 'AE070000000000000000001', bic 'TESTAEXX'
it('refuses an IBAN of the wrong shape', …);            // 400 with the field named
it('refuses a BIC without an IBAN', …);
it('clears the bank account when every field is null', …); // PATCH bank {accountHolder:null, iban:null, bic:null, bankAddress:null} → GET bank === null
it('clears a contact field when it is sent as null', …);   // the same defect for contactPhone → GET contactPhone null
it('writes the reason onto the audit row', …);           // existing pattern at ~184-189
```

- [ ] **Step 3: Run red, then implement**

Schema: a `Bank` object with the four fields, each `z.string().trim()…nullable()` with `.transform` for IBAN (uppercase, strip spaces) and BIC (uppercase), then `.refine` for the shapes; `bank: Bank.optional()` on the input. Change the seven fields' update from `coalesce($n, col)` to explicit "present → set (possibly null), absent → keep": build the SET list from the keys present in the body (the route already builds a parameter list; extend it). The GET's `view()` maps the four columns to `bank` or `null`.

- [ ] **Step 4: Run green** — `pnpm test:db -- tests/db/practice.test.ts tests/db/practice-identity.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/924_practice_bank_account.sql app/api/practice docs/SPEC/00-data-model.md tests/db/practice.test.ts
git commit -m "feat(practice): the practice's bank account, recorded once (round 61)"
```

### Task 2: Settings › Practice shows and edits it

**Files:**
- Modify: `app/admin/settings/PracticePage.tsx` (groups at 202-273: add "Bank account" after "Registered address": Account holder, IBAN grouped in fours, BIC, Bank address; "Not recorded" when null, in the page's own muted style)
- Modify: `app/admin/settings/PracticeDrawer.tsx` (`FieldErrors`/`FIELD_IDS` :45-73, state :112-159, validation :205-222, PATCH body :273-290; four new fields after the contact fields at ~399-442; client-side checks mirror the schema; an empty field sends `null`)
- Test: `app/admin/settings/PracticePage.test.tsx` (the contact-save test at 283-313 is the template)

- [ ] **Step 1: Failing tests** — renders the four values; shows "Not recorded" when `bank` is null; saving sends `bank` with the IBAN as typed (the server normalises) and `null` for an emptied field; a malformed IBAN shows the field error before any request.
- [ ] **Step 2: Run red, build, run green.**
- [ ] **Step 3: Commit** — `feat(settings): Settings › Practice records the bank account`.

### Task 3: The document — the block and the percentage

**Files:**
- Modify: `domain/billing/document/model.ts` (`SupplierSnapshot` :21-51 gains `bank: { accountHolder: string; iban: string; bic: string | null; bankAddress: string | null } | null`; `InvoiceDocument` :76-103 gains `discountBasisPoints: number | null`)
- Modify: `app/api/billing/document-source.ts` (read the four `tenant` columns in `supplierOf()` / beside `practiceLogo`, live; compute `discountBasisPoints` = the one value every line with `discountFils > 0` shares, else null)
- Modify: `domain/billing/document/strings.ts` (`WORDS`: `payByTransfer` "Pay by bank transfer" / "الدفع بالتحويل المصرفي", `accountHolder` "Account holder" / "اسم صاحب الحساب", `iban` "IBAN" / "رقم الآيبان", `bic` "BIC" / "رمز السويفت", `bankAddress` "Bank address" / "عنوان البنك"; `discountLine(listFils, discountFils, basisPoints)` → `List AED 7,950.00 · less AED 1,987.50 (25%)` when basis points are set, unchanged otherwise, Arabic likewise with the percentage in Western digits; `discountTotalLabel(basisPoints)` → `Discount 25%` / `الخصم 25%`; replace the "Both figures, and no percentage" comment with why the percentage is printed now)
- Modify: `domain/billing/document/render.ts` (after `totalsBox()` at :833: when `supplier.bank` is set, draw the block at the same top as the totals box, from the left margin, width = page inner width − `TOTALS_WIDTH` − `GUTTER`; a small violet-free heading `payByTransfer` in both languages, then four small rows label / Arabic label / value, IBAN grouped in fours, address wrapped; `sheet.room()` for its height before drawing, so a page break falls before the totals rather than through them; the totals row at :822 uses `discountTotalLabel` when `document_.discountBasisPoints` is set)
- Modify: `docs/SPEC/billing.md` §2.4 "On the document" (percentage now printed on the line and in the totals when the lines agree) and §5.6 (the bank block, read live, receipt has none)
- Test: `tests/billing/document.test.ts` (the discount case at :532-579; new cases below), `tests/billing/geometry.test.ts` (the block's box), `tests/billing/db/supplier_contact.test.ts` (the source reads live bank details; an issued invoice re-rendered after the bank changes prints the new details — that is the intended drift, say so in the test name)

- [ ] **Step 1: Failing document tests**

```ts
it('prints the percentage beside a discounted line and in the totals when every line shares it', …); // 'List AED 700.00 · less AED 105.00 (15%)' and 'Discount 15%'
it('prints no percentage for a discount typed as a sum', …);                                       // existing fixture, basisPoints null → today's strings, no '%'
it('prints each line\'s own percentage and none in the totals when they differ', …);
it('prints 25% in the totals when one discounted line sits beside an undiscounted one', …);
it('prints "Pay by bank transfer" with the account, the IBAN grouped in fours, the BIC and the bank address', …); // 'AE07 0000 0000 0000 0000 001'
it('prints no bank block when the practice has recorded none, and the bytes are unchanged', …);    // compare against the determinism fixture at :269
it('prints no bank block on a receipt', …);
```

Geometry: a 200-character bank address and a 120-character holder → nothing crosses the margins, nothing overlaps the totals box, the block's right edge < the totals box's left edge − GUTTER.

- [ ] **Step 2: Run red, build, run green** — `pnpm vitest run tests/billing/document.test.ts tests/billing/geometry.test.ts`, then `pnpm test:db -- tests/billing/db/supplier_contact.test.ts tests/billing/db/documents.test.ts` (whichever file exercises `POST /api/billing/documents`; find it with `grep -rl "api/billing/documents" tests/billing/db`).

- [ ] **Step 3: Commit**

```bash
git add domain/billing/document app/api/billing/document-source.ts docs/SPEC/billing.md tests/billing
git commit -m "feat(billing): the invoice says how to pay, and says the discount's percentage (round 61)"
```

### Task 4: Record and gate

**Files:**
- Create: `docs/CHANGE-REQUESTS/trunk-round-61.md` in the shape of `trunk-round-59.md`: the ask, the two decisions (read live like the logo, and why; the percentage on the line and in the totals), the compliance note (bank details are business facts, audited, not redacted), the `coalesce` clearing defect fixed for seven fields, and "Going live": migration 924 by hand on staging then production with the ledger row in the same call; no policy file; fingerprint `tenant`'s columns + constraints; then the build; proof = `payByTransfer` string in the served API bundle is server-side — so proof is the Settings chunk carrying "Bank account" and a rendered invoice after the owner records the details. Note for the operator: the existing invoice INV-000001 gains the block only if its PDF has not yet been filed.

- [ ] **Step 1: `pnpm -s format && pnpm verify && pnpm test:db`** — all green.
- [ ] **Step 2: Commit.**

```bash
git add docs/CHANGE-REQUESTS/trunk-round-61.md
git commit -m "docs: round 61 — bank details and the discount percentage on the invoice"
```
