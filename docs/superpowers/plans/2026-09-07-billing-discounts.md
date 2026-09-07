# Billing discounts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Tests before implementation for everything in `domain/` (CLAUDE.md).

**Goal:** A discount field on service prices, package prices and package sales, printed on the invoice, exactly as `docs/SPEC/billing.md` section 2.4 specifies (read it first, whole). The operator's plan is `docs/PLAN/billing-discounts.md`.

**Architecture:** One migration, `409_billing_discount.sql`, adds the discount columns to `price`, `package_price`, `invoice_line` and `package_purchase`, backfills every existing row so nothing a family was shown changes, and replaces `app.charge_single_visit` whole so a single visit carries the price row's own discount. One pure rule file, `domain/billing/discount.ts`, does all the arithmetic; routes call it and never restate it. The books are untouched: `net_fils`, `vat_fils` and `gross_fils` keep their meaning everywhere (net is *after* discount), so `domain/accounting`, migration 454 and the poster do not change and their identity tests must stay green.

**Tech stack:** TypeScript, React + Vite (admin console), Hono routes, PostgreSQL 17 with plpgsql triggers and RLS, zod, vitest (unit, jsdom screen tests, and `pnpm test:db` against this worktree's own Postgres on port 5436), pnpm.

**Read before starting:** `docs/SPEC/billing.md` sections 2 and 5, `docs/SPEC/OWNERSHIP.md` (billing's row and the "apply order is not fixed" rule), `.claude/rules/data-model.md`, `.claude/rules/testing.md`, `.claude/rules/ui.md`, `docs/DESIGN-BRIEF.md` section 6, `CLAUDE.md`. Then the files each task names.

## Global constraints

- **Worktree:** `/Volumes/Storage/McWellness/mcwellness-billing`, branch `billing-discounts` (already created from `origin/main`). Every command runs there. Its database is `mcwellness-billing-db-1` on port 5436; run `pnpm db:migrate` first (it applies the merged migrations this database has not seen, then 409 once it exists) and `pnpm seed` when a fresh seed is wanted.
- **Money is integer fils** (`Fils`, `fils()`, `addFils` from `domain/shared`); never a float for money; `formatFils` is the only formatter.
- **Rules are pure functions in `domain/billing/`** with a test file beside each; no clock, no I/O.
- **Migration 409 only**, in billing's range; `-- Needs:` names only lower numbers; a `-- rollback:` block that writes 406's `app.charge_single_visit` out in full (copy it verbatim from `db/migrations/406_billing_vat_registration.sql` lines 220 to 300). Never edit a merged migration.
- **Edit only billing's paths** (`domain/billing/**`, `app/admin/billing/**`, `app/api/billing/**`, `tests/billing/**`, `db/migrations/409_*`) plus exactly these shared-zone files, which Task 10 lists in `docs/CHANGE-REQUESTS/billing-08.md`: `db/seed/generate.ts`, `db/seed/apply.ts`, `docs/SPEC/00-data-model.md` section 6, `docs/SPEC/billing.md` (already amended). Nothing in `domain/accounting`, `app/api/accounting`, `domain/shared`, `app/shell`, `app/client`, `app/api/portal` changes.
- **The staff screens are English only** (`tests/lint/console-is-english.test.ts`): no `lang="ar"` or `dir="rtl"` under `app/admin`. Arabic goes on the rendered document only (`domain/billing/document/strings.ts`).
- **Copy:** British English; no ALL-CAPS labels; "AED" named once per table (in a column header); tabular figures via the `numeric` column flag; fixed sentences on screen keyed by a server `code`, never the server's own reason text.
- **Synthetic data only** in tests: ids `0000000K-0000-4000-8000-…`, names from `db/seed/names.ts`.
- **Refusals** answer `{ error, code, requestId }` in the shapes the routes already use; the drawers map a `code` to a fixed sentence.
- **Commands, always with an explicit timeout** (a silent ten-minute command stalled a builder before; this Mac has no `timeout` binary, so use the Bash tool's own timeout parameter, 600000 ms or more): `pnpm test <file>` for one file while iterating; `pnpm test:db` for the database suite; `pnpm verify` and `pnpm build` before declaring done, each under `set -o pipefail` with the exit code checked (a piped `tail` hides a red exit).
- **Commits:** small, conventional, each ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Push the branch when done (`git push -u origin billing-discounts`); do not open the pull request.

---

## Task 1: The rule — `domain/billing/discount.ts`

**Files:**
- Create: `domain/billing/discount.test.ts` (first)
- Create: `domain/billing/discount.ts`
- Modify: `domain/billing/index.ts` (export the three names and the two types)

**Interface:**

```ts
import { fils, type Fils } from '../shared';

/** How a person expressed a discount: a share of the list figure, or a sum of money. */
export type Discount =
  | { kind: 'percent'; basisPoints: number } // 1500 is fifteen per cent
  | { kind: 'amount'; fils: Fils };

export type AppliedDiscount = {
  listFils: Fils;
  discountFils: Fils;
  netFils: Fils;
  /** The percentage, kept only when the discount was one; null for a sum. */
  basisPoints: number | null;
};

/** Money off `listFils`, rounded half up to the fils. `null` is no discount. */
export function applyDiscount(listFils: Fils, discount: Discount | null): AppliedDiscount;

/**
 * A sale's discount: the price list's own standing discount plus an extra one
 * taken from the same list figure. When both are percentages the combined
 * percentage is applied once to the list figure (so 15% + 5% is exactly 20%,
 * never two roundings); otherwise the two sums are added and no percentage is kept.
 */
export function combineDiscounts(
  listFils: Fils,
  standing: { discountFils: Fils; basisPoints: number | null },
  extra: Discount | null,
): AppliedDiscount;
```

**Rules (each a test):**
1. `applyDiscount(70_000, { percent 1500 })` → discount 10,500, net 59,500, basisPoints 1500.
2. `applyDiscount(1_215_000, { percent 1500 })` → discount 182,250, net 1,032,750.
3. Rounding is half up: `applyDiscount(fils(1), { percent 5000 })` → discount 1 (0.5 fils rounds up); `applyDiscount(fils(3), { percent 3333 })` → discount 1 (0.9999 → 1); use integer arithmetic: `const product = listFils * basisPoints; const remainder = product % 10_000; const whole = (product - remainder) / 10_000; discount = remainder * 2 >= 10_000 ? whole + 1 : whole`.
4. `applyDiscount(70_000, { amount 5_000 })` → discount 5,000, net 65,000, basisPoints null.
5. `applyDiscount(x, null)` → discount 0, net x, basisPoints null.
6. Throws `RangeError` on: a negative list; `basisPoints` outside 0..10000 or not a safe integer; an amount that is negative, not a safe integer, or larger than the list.
7. `combineDiscounts(1_215_000, { 182_250, 1500 }, { percent 500 })` → basisPoints 2000, discount 243,000 (20% applied once), net 972,000.
8. `combineDiscounts(1_215_000, { 182_500, null }, { percent 500 })` → basisPoints null, discount 182,500 + 60,750 = 243,250.
9. `combineDiscounts(1_215_000, { 182_250, 1500 }, { amount 50_000 })` → basisPoints null, discount 232,250.
10. `combineDiscounts(list, standing, null)` → standing unchanged, its basisPoints kept.
11. `combineDiscounts` throws `RangeError` when the combined discount exceeds the list figure, and when `standing.discountFils` is negative or above the list.

- [ ] Write `discount.test.ts` with the eleven rules as `it(...)` names that read as requirements; run `pnpm test domain/billing/discount.test.ts` and see it fail.
- [ ] Write `discount.ts`; make the tests pass; export from `index.ts`: `applyDiscount`, `combineDiscounts`, and the types `Discount`, `AppliedDiscount`.
- [ ] Commit: `feat(billing): the discount arithmetic, one rule file`.

---

## Task 2: Migration `409_billing_discount.sql`

**Files:**
- Create: `db/migrations/409_billing_discount.sql`
- Create: `tests/billing/db/discounts.test.ts` (the schema half; the route half grows in later tasks)

**Header comment** (in the house style of 408): what changes and why; the operator's decision of 7 September 2026 at 21:49 amending the founder's decision of 2026-09-03 recorded in 401's header; that the books are untouched because every reader of `net_fils` reads the net after discount; that nothing a family was shown changes because the backfill sets every existing price to "list equals the figure, no discount" and every existing package price to "list minus the difference". `-- Needs: 400 (price, vat_setting), 401 (package, package_price), 402 (invoice_line), 403 (package_purchase), 406 (app.charge_single_visit, the version this replaces, and app.tenant_charges_vat)`.

**Body:**

```sql
------------------------------------------------------------------------------
-- 1. price: the list figure, and the discount taken from it.
------------------------------------------------------------------------------
alter table price add column list_price_fils integer;
alter table price add column discount_fils integer not null default 0;
alter table price add column discount_basis_points integer;
-- Backfill: every price on the list today is its own list figure with no discount.
update price set list_price_fils = unit_price_fils;
alter table price alter column list_price_fils set not null;
alter table price add constraint price_list_nonnegative check (list_price_fils >= 0);
alter table price add constraint price_discount_within_list
  check (discount_fils between 0 and list_price_fils);
alter table price add constraint price_discount_percent_range
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
alter table price add constraint price_unit_is_list_less_discount
  check (unit_price_fils = list_price_fils - discount_fils);
comment on column public.price.list_price_fils is '...';
comment on column public.price.discount_fils is '...';
comment on column public.price.discount_basis_points is '...';

------------------------------------------------------------------------------
-- 2. package_price: the same three, with the list figure snapshotted from the
--    package at the moment the row was written.
------------------------------------------------------------------------------
alter table package_price add column list_price_fils integer;
alter table package_price add column discount_fils integer not null default 0;
alter table package_price add column discount_basis_points integer;
update package_price pp
   set list_price_fils = greatest(p.list_price_fils, pp.amount_fils),
       discount_fils   = greatest(p.list_price_fils, pp.amount_fils) - pp.amount_fils
  from package p
 where p.id = pp.package_id and p.tenant_id = pp.tenant_id;
alter table package_price alter column list_price_fils set not null;
-- the same four constraints, named package_price_*, with amount_fils in place of unit_price_fils

------------------------------------------------------------------------------
-- 3. invoice_line: the discount on the line.
------------------------------------------------------------------------------
alter table invoice_line add column discount_fils integer not null default 0;
alter table invoice_line add column discount_basis_points integer;
alter table invoice_line drop constraint invoice_line_net_is_quantity_times_unit;
alter table invoice_line add constraint invoice_line_net_is_quantity_times_unit_less_discount
  check (net_fils = quantity * unit_net_fils - discount_fils);
alter table invoice_line add constraint invoice_line_discount_within_line
  check (discount_fils between 0 and quantity * unit_net_fils);
alter table invoice_line add constraint invoice_line_discount_percent_range
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);

------------------------------------------------------------------------------
-- 4. package_purchase: how the sale's discount was expressed, and why the
--    extra was given. The discount itself is list_price_fils - net_fils, both
--    already on the row; nothing new is stored twice.
------------------------------------------------------------------------------
alter table package_purchase add column discount_basis_points integer
  check (discount_basis_points is null or discount_basis_points between 0 and 10000);
alter table package_purchase add column discount_reason text
  check (length(btrim(discount_reason)) between 1 and 200);

------------------------------------------------------------------------------
-- 5. The single-visit charge, replaced whole (406's text in the rollback).
--    The one change: the line carries unit = the list figure, the row's own
--    discount, and net = unit_price_fils. The invoice's net, the VAT and the
--    credit's allocated value are unchanged.
------------------------------------------------------------------------------
create or replace function app.charge_single_visit(...)  -- 406's body, with the invoice_line insert naming
  -- quantity, unit_net_fils, discount_fils, discount_basis_points, net_fils and the values
  -- 1, v_price.list_price_fils, v_price.discount_fils, v_price.discount_basis_points, v_price.unit_price_fils
```

No grant changes: the columns sit on tables app_role already reads and writes. Column comments on every new column. `-- rollback:` drops the constraints and columns in reverse and writes 406's function out verbatim.

**Tests, `tests/billing/db/discounts.test.ts`** (use `tests/billing/db/support.ts`'s harness like `packages.test.ts`; seed a fresh database):
1. `it('carries every existing price forward as its own list figure with no discount')`: every `price` row has `list_price_fils = unit_price_fils` and `discount_fils = 0`.
2. `it('carries the launch package prices forward as list minus the difference')`: Silver's `package_price` has `list_price_fils = 1_215_000`, `discount_fils = 182_500`, `discount_basis_points null`, `amount_fils = 1_032_500`.
3. `it('refuses an invoice line whose net is not quantity times unit less discount')`: an insert as the owner client with `net_fils` off by one → SQLSTATE `23514`.
4. `it('refuses a discount larger than the line')`: `discount_fils` above `quantity * unit_net_fils` → `23514`.
5. `it('refuses a price whose unit is not list less discount')` and the same for `package_price` → `23514`.

- [ ] Write the five tests; run `pnpm db:migrate` then `pnpm test:db tests/billing/db/discounts.test.ts` (check how `pnpm test:db` takes a single file in `package.json` / `vitest.db.config.ts`; if it cannot, run the suite) and see them fail on the missing columns.
- [ ] Write the migration; `pnpm db:migrate`; make the tests pass. Run `pnpm test:db tests/billing/db/consumption.test.ts tests/billing/db/call_out_fee.test.ts tests/db/seed.test.ts tests/db/audit.test.ts tests/db/schema.test.ts` (whatever schema-shape tests exist under `tests/db/`) and fix what the new columns disturb.
- [ ] Commit: `feat(billing): migration 409, the discount columns and the backfill`.

---

## Task 3: The seed knows the list figure

**Files:**
- Modify: `db/seed/generate.ts` (the `PRICES` and `PACKAGES` constants and the price shapes in `SeedData`; the comment at "no discount percentage is stored anywhere" is rewritten to say the decision was amended on 2026-09-07 and the seed's launch discounts are sums, not percentages, so the seeded figures stay what every test pins)
- Modify: `db/seed/apply.ts` (the `price` insert gains `list_price_fils`, `discount_fils`, `discount_basis_points`; the `package_price` insert gains the same three)

Seeded values: every service price `listPriceFils = unitPriceFils`, `discountFils = 0`, `discountBasisPoints = null`; every package price `listPriceFils = listFils`, `discountFils = listFils - nowFils`, `discountBasisPoints = null`.

- [ ] Make the change; `pnpm db:reset && pnpm seed` (or whatever the scripts are named; check `package.json`) and run `pnpm test:db tests/db/seed.test.ts tests/billing/db/discounts.test.ts`.
- [ ] Run `pnpm test db/seed` (the generator's own unit tests, if any).
- [ ] Commit: `feat(seed): the catalogue names its list figures and launch discounts`.

---

## Task 4: The API shapes

**Files:**
- Modify: `app/api/billing/schema.ts`
- Modify: `app/api/billing/ledger-schema.ts`

**`schema.ts`:**
```ts
export const DiscountInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), basisPoints: z.number().int().min(0).max(10_000) }),
  z.object({ kind: z.literal('amount'), fils: z.number().int().nonnegative().max(INT4_MAX) }),
]);
export type DiscountInput = z.infer<typeof DiscountInput>;
```
`PriceRow` gains `listPriceFils: Fils`, `discountFils: Fils`, `discountBasisPoints: z.number().int().min(0).max(10_000).nullable()`; `unitPriceFils` stays and keeps its meaning (the net after discount). `CreatePriceInput`: `unitPriceFils` is **replaced** by `listPriceFils` (same validation) and `discount: DiscountInput.nullable().optional()`.

**`ledger-schema.ts`:** `PackagePriceRow` gains the same three fields. `CreatePackageInput.price` becomes `{ discount: DiscountInput.nullable().optional(), validFrom, amendmentReason }` (no `amountFils`: the amount is `list − discount`, computed on the server from the package's list price); `AddPackagePriceInput` the same. `SellPackageInput` gains `extraDiscount: z.object({ discount: DiscountInput, reason: Reason }).optional()`. `PurchaseRow` gains `discountFils` (nonnegative), `discountBasisPoints` (nullable), `discountReason` (string, nullable). `InvoiceRow` gains `discountFils` (nonnegative).

- [ ] Make the changes; `pnpm -s typecheck` will now list every caller to update — that is the map for Tasks 5 to 9. Do not commit until the typecheck is green at the end of Task 7; or commit per task with the typecheck red in between only if each commit's tests pass. Prefer one commit after Task 7: `feat(billing): the discount on the wire`.

---

## Task 5: The price list route

**Files:**
- Modify: `app/api/billing/prices.ts`
- Modify: `tests/billing/db/prices.test.ts` (existing POST bodies send `listPriceFils` instead of `unitPriceFils`)
- Modify: `tests/billing/db/discounts.test.ts` (add the route tests)

`LIST_SQL`, `LATEST_FOR_SERVICE_SQL` and `INSERT_PRICE_SQL` gain the three columns; `toPriceRow` maps them. The POST computes `const applied = applyDiscount(fils(body.data.listPriceFils), body.data.discount ?? null)` inside a `try`; a `RangeError` answers `400 { code: 'discount_too_large' }`; the insert writes `list_price_fils = applied.listFils`, `discount_fils = applied.discountFils`, `discount_basis_points = applied.basisPoints`, `unit_price_fils = applied.netFils`; VAT is resolved on `applied.netFils` exactly as today.

Tests:
6. `it('records a percentage discount on a service price and charges the net')`: POST `{ serviceTypeId: nf-session, listPriceFils: 70_000, discount: { kind: 'percent', basisPoints: 1500 }, validFrom: tomorrow, amendmentReason }` → 201; the row has `unitPriceFils 59_500`, `discountFils 10_500`, `discountBasisPoints 1500`, `listPriceFils 70_000`; the GET on the following day shows the same (use the route's `now` injection the existing tests use).
7. `it('records a sum discount with no percentage')`.
8. `it('refuses a discount larger than the list price')` → 400 `discount_too_large`.

- [ ] Tests first, then the route.

---

## Task 6: The package routes

**Files:**
- Modify: `app/api/billing/packages.ts`
- Modify: `tests/billing/db/packages.test.ts` (the `silverInput` helper sends `price: { discount: { kind: 'amount', fils: 182_500 }, validFrom, amendmentReason }`; the test at "no discount percentage is stored anywhere" now asserts `currentPrice.listPriceFils 1_215_000`, `discountFils 182_500`, `discountBasisPoints null`, `amountFils 1_032_500`, and its comment says the decision was amended on 2026-09-07)
- Modify: `tests/billing/db/discounts.test.ts`

`readPackages`: `CURRENT_PRICES_SQL` selects the three columns; `currentPrice` carries `listPriceFils`, `discountFils`, `discountBasisPoints`. `insertPackagePrice(db, packageId, listPriceFils, input, approval)` computes `applyDiscount(fils(listPriceFils), input.discount ?? null)` and writes `list_price_fils`, `discount_fils`, `discount_basis_points`, `amount_fils = netFils`. The create route passes `input.listPriceFils`; the add-price route reads `package.list_price_fils` for the package (`select id, list_price_fils from package …`). A `RangeError` from `applyDiscount` → `400 { code: 'discount_too_large' }`, checked **before** any insert (the same discipline `checkPackagePrice` has: a refused price leaves no package behind). The header comment's sentence about "stores no discount percentage" is rewritten.

Tests:
9. `it('prices a package by a percentage off its list price')`: POST a package with `price.discount { percent 1500 }` and `listPriceFils 1_215_000` → `amountFils 1_032_750`, `discountBasisPoints 1500`.
10. `it('adds a package price by a sum off the list price and snapshots the list')`: POST `/packages/:id/price` with `{ discount: { amount 200_000 } }` → `listPriceFils` equals the package's, `amountFils = list − 200_000`.
11. `it('refuses a package discount larger than the list price, leaving nothing behind')` → 400 `discount_too_large`, and no `package` row with that code exists afterwards.

- [ ] Tests first, then the routes.

---

## Task 7: The sale

**Files:**
- Modify: `app/api/billing/sales.ts`
- Modify: `app/api/billing/access.ts` (add `mayDiscount(actor, now)`: `hasRole(actor, 'owner', 'admin', 'finance')`, with a comment naming 408's trio; add its row to `tests/billing/access.test.ts`)
- Modify: `app/api/billing/balance.ts`, `app/api/billing/extensions.ts` (`PURCHASES_SQL`/the replay select gain `discount_basis_points, discount_reason`; the mapping adds `discountFils: Math.max(0, row.list_price_fils - row.net_fils)`, `discountBasisPoints`, `discountReason`)
- Modify: `app/api/billing/invoices.ts` (the select gains `coalesce((select sum(l.discount_fils) from invoice_line l where l.tenant_id = i.tenant_id and l.invoice_id = i.id), 0)::int as discount_fils`; the row maps `discountFils`)
- Modify: `tests/billing/db/discounts.test.ts`, and `tests/billing/db/idempotency.test.ts` if its expected replay shape is pinned

In `sales.ts`, after the bundle and price are found:
```ts
if (input.extraDiscount && !mayDiscount(actor, now())) {
  return c.json({ error: 'forbidden', requestId }, 403);
}
let applied: AppliedDiscount;
try {
  applied = combineDiscounts(
    fils(price.listPriceFils),
    { discountFils: fils(price.discountFils), basisPoints: price.discountBasisPoints },
    input.extraDiscount?.discount ?? null,
  );
} catch {
  return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
}
```
Then everywhere the code used `price.amountFils` as the net it uses `applied.netFils`: the allocation, `resolveSaleVat`, the purchase's `net_fils`, the invoice's `net_fils`. The purchase's `list_price_fils` becomes `applied.listFils` (the price row's snapshot), and it gains `discount_basis_points = applied.basisPoints`, `discount_reason = input.extraDiscount?.reason ?? null`. `INSERT_LINE_SQL` writes `quantity 1, unit_net_fils = applied.listFils, discount_fils = applied.discountFils, discount_basis_points = applied.basisPoints, net_fils = applied.netFils`. The response's purchase carries the three new fields; `replaySale` reads them back. Rewrite the header comment's paragraph "The price is not typed here" to say what the sale now takes and what it still refuses.

Tests:
12. `it('sells at the list price less the price list's own discount when no extra is given')`: with Silver as seeded, the purchase has `netFils 1_032_500`, `listPriceFils 1_215_000`, `discountFils 182_500`, `discountBasisPoints null`, `discountReason null`; the invoice line has `unit_net_fils 1_215_000`, `discount_fils 182_500`, `net_fils 1_032_500`; the credits sum to `1_032_500` (the deferred trigger accepted the sale).
13. `it('gives an extra discount at the sale, combined into one line, with a reason')`: `extraDiscount { discount: { amount 50_000 }, reason: 'Sibling of an existing client.' }` → purchase `netFils 982_500`, `discountFils 232_500`, `discountReason` kept; the line's `discount_fils 232_500`; the invoice's `net_fils 982_500`; `/api/billing/invoices` shows `discountFils 232_500` on that invoice.
14. `it('combines two percentages into one applied once')`: seed a package price at 15% by the route (Task 6's POST), then sell with `extraDiscount { percent 500 }` → `discountBasisPoints 2000`, `discountFils = round(list × 0.2)`.
15. `it('refuses an extra discount without a reason')` → 400 `invalid_request`.
16. `it('refuses an extra discount that takes the price below nothing')` → 400 `discount_too_large`.
17. `it('replays the same sale, discount included, for the same idempotency key')`.
18. `it('refuses an extra discount from a role that may not give one')`: use `callAs` with a fixture user holding only `practitioner`… note `maySell` already refuses that role with 403, so assert 403 and say in the test name that both doors refuse.
19. `it('charges a single visit at the list figure less the price row's own discount')`: set a 15% discounted `nf-session` price via the route dated today (check how `consumption.test.ts` closes a session with no credit and copy that path) → the session invoice's line has `unit_net_fils 70_000`, `discount_fils 10_500`, `net_fils 59_500`; the invoice `net_fils 59_500`; the credit `allocated_net_fils 59_500`.

- [ ] Tests first; then the route; then `pnpm -s typecheck` green; commit `feat(billing): the discount on the wire, the price list, the packages and the sale`.
- [ ] Run `pnpm test:db` whole (timeout 900000) — including `tests/accounting/db/**`, whose identities must still hold — and fix anything red.

---

## Task 8: The document

**Files:**
- Modify: `domain/billing/document/model.ts` (`InvoiceLine` gains `discountFils: number; discountBasisPoints: number | null`; `InvoiceDocument` gains `discountFils: number`, the sum of its lines')
- Modify: `domain/billing/document/strings.ts` (`WORDS.beforeDiscount { en: 'Before discount (AED)', ar: 'قبل الخصم' }`, `WORDS.discount { en: 'Discount (AED)', ar: 'الخصم' }`; `export function discountNote(line: { discountFils: number; discountBasisPoints: number | null }): Phrase` → en `Discount 15%: 105.00` or `Discount: 105.00`, ar `الخصم 15%: 105.00` / `الخصم: 105.00`, figures through `formatFils`)
- Modify: `domain/billing/document/render.ts` (in the lines loop, when `line.discountFils > 0`, two further small grey rows beneath the description block — the English note then the Arabic note, rtl, aligned start — counted into `height` before drawing; in the totals, when `document_.discountFils > 0`, `totalRow(WORDS.beforeDiscount, netFils + discountFils)` then `totalRow(WORDS.discount, discountFils)` before the rows already there, in both the registered and the plain branch)
- Modify: `app/api/billing/document-source.ts` (`LINES_SQL` selects `discount_fils, discount_basis_points`; the line and the document's `discountFils` are mapped)
- Modify: `tests/billing/document.test.ts`, `tests/billing/geometry.test.ts` (fixtures gain `discountFils: 0, discountBasisPoints: null`), `tests/billing/db/documents.test.ts` if it builds lines

Tests (in `document.test.ts`):
20. `it('prints the discount beneath a discounted line and in the totals, in both languages')`: a plain invoice with one line `unit 70_000, discount 10_500 at 1500, net 59_500` → the extracted text contains `Discount 15%: 105.00`, `Before discount (AED)`, `700.00`, `595.00`, and the Arabic `الخصم` as copied.
21. `it('says nothing about a discount when none was given')`: the words `Discount` and `Before discount` are absent.
22. The same for a registered invoice: VAT is on the net after discount (`vatFils` on the line is whatever the row says; the renderer recomputes nothing).

- [ ] Tests first, then the model, strings, renderer and source; run `pnpm test tests/billing/document.test.ts tests/billing/geometry.test.ts`; commit `feat(billing): the discount on the rendered invoice`.

---

## Task 9: The screens

**Files:**
- Modify: `app/admin/billing/PriceDrawer.tsx`, `tests/billing/PriceDrawer.test.tsx`
- Modify: `app/admin/billing/PackageDrawer.tsx`, `tests/billing/PackageDrawer.test.tsx`
- Modify: `app/admin/billing/SellPackageDrawer.tsx`, `tests/billing/SellPackageDrawer.test.tsx`
- Modify: `app/admin/billing/BillingPage.tsx` (the price list table), `tests/billing/BillingPage.test.tsx`
- Modify: `app/admin/billing/PackagesSection.tsx`, `tests/billing/PackagesSection.test.tsx`
- Modify: `app/admin/billing/InvoicesSection.tsx`, `tests/billing/InvoicesSection.test.tsx`
- Modify: `app/admin/billing/BalancesSection.tsx` only if it lists purchases with a list price (grep `listPriceFils`); then add the discount and its reason beside it
- Modify: `app/admin/billing/money.ts` (a `previewDiscount(listFils, kind, typed)` helper that parses the typed value — a percentage with up to two decimals to basis points, or `parseAedToFils` — and calls `applyDiscount`; the browser and the server run one arithmetic)
- Modify: `app/admin/billing/billing.css` only if a new row style is needed

**A discount control, shared by the three drawers:** create `app/admin/billing/DiscountFields.tsx`: a `Select` (`id` given) with options `No discount`, `Percentage`, `Amount (AED)`, and beside it a `Field` for the value (`inputMode="decimal"`), returning `{ kind, value }` through `onChange`; the parent computes the preview. The English-only guard applies.

- **PriceDrawer:** "Price (AED, excluding VAT)" is renamed "List price (AED, excluding VAT)"; `DiscountFields` beneath it; the preview rows become List price, Discount (only when > 0), Price, VAT, Total; the request sends `listPriceFils` and `discount` (null when none). Fixed sentences for `discount_too_large` ("The discount is larger than the list price.") and a field error when the typed discount is not a number.
- **PackageDrawer:** `DiscountFields` labelled "Discount off the list price" between "List price" and "Price now"; typing a discount sets "Price now" to `list − discount`; typing "Price now" directly sets the discount to `Amount = list − price now` (and the select to Amount); a price now above the list is refused on the screen with "The price now is above the list price. Raise the list price or lower the price now." The request sends `price: { discount, validFrom, amendmentReason }`. The header comment's sentence about no percentage being kept is rewritten.
- **SellPackageDrawer:** the preview shows List price, then "Discount on the list" (when > 0: "15%" beside the figure when the row carries a percentage), then `DiscountFields` labelled "Extra discount for this sale" with a "Why" `Field` (required when a discount is chosen; at least eight characters, `isRealText`), then Price after discount, VAT, Total; the payment sent is the new gross (the drawer holds the net and calls `previewVat` with the row's `vatRateBasisPoints` only while the row's `vatFils > 0`, otherwise the gross is the net — read how the row's `vatFils` and `grossFils` are answered today and keep the drawer's rule: what the family hands over equals the invoice's gross). The request sends `extraDiscount` only when a discount is chosen. Fixed sentences for `discount_too_large` and for a 403 ("You don't have permission to give an extra discount."). The idempotency key already follows the payload.
- **BillingPage price table:** columns become Service, List (AED), Discount, Price (AED), VAT, Total, Effective from; the Discount cell shows "15%" when the row carries a percentage, the amount when a sum, "—" when none.
- **PackagesSection:** a Discount column after List (AED), read from `currentPrice`, the same rendering.
- **InvoicesSection:** a Discount column before Net (AED): the amount, or "—" when zero.

Screen tests, one per screen at least: the drawer sends the right body; the preview shows the computed figures; the refusal sentence appears on `discount_too_large`; the tables render the new column. Keep every existing test green.

- [ ] Run `pnpm test tests/billing` (timeout 600000) and `pnpm test tests/lint/console-is-english.test.ts`; commit `feat(billing): the discount on the screens`.

---

## Task 10: The records

**Files:**
- Create: `docs/CHANGE-REQUESTS/billing-08.md`: "what the discount round edits outside billing's paths": `db/seed/generate.ts` and `db/seed/apply.ts` (with the diff summary), `docs/SPEC/00-data-model.md` section 6 (the `price` line gains `list_price_fils`, `discount_fils`, `discount_basis_points`; `package_price` the same; `invoice_line` names its discount), and the note that `docs/SPEC/billing.md` section 2.4 was written by the integrator. In the shape of `billing-06.md`.
- Modify: `docs/SPEC/00-data-model.md` section 6 accordingly (three sentences).
- Modify: the comments that still say "no discount percentage is stored anywhere" — `db/migrations/401_billing_package.sql` is merged and **must not be edited**; instead 409's header says 401's sentence is amended. `app/api/billing/packages.ts`, `app/admin/billing/PackageDrawer.tsx`, `db/seed/generate.ts` and `tests/billing/db/packages.test.ts` are edited in their own tasks.

- [ ] `set -o pipefail; pnpm verify 2>&1 | tail -40; echo EXIT=${PIPESTATUS[0]}` (timeout 900000) — green, including the secrets scan, lint, format check (`pnpm format:check` or whatever `verify` runs; run `pnpm format` if it complains) and the migration audit.
- [ ] `set -o pipefail; pnpm test:db 2>&1 | tail -20; echo EXIT=${PIPESTATUS[0]}` (timeout 900000) — green.
- [ ] `set -o pipefail; pnpm build 2>&1 | tail -5; echo EXIT=${PIPESTATUS[0]}` (timeout 600000) — green.
- [ ] Commit `docs(billing): the discount round's records`; `git push -u origin billing-discounts`.
- [ ] Write the report the brief asks for.

## Done when

1. Every test in this plan exists with its number's requirement as its name, and `pnpm verify`, `pnpm test:db` and `pnpm build` are green on the branch.
2. On a freshly seeded database every existing price reads "list equals unit, no discount" and every launch package price reads "list minus the difference"; `tests/accounting/db/**` is green unchanged.
3. A package sold with an extra discount produces one invoice line whose `net = unit − discount`, credits summing to that net, an invoice the book lists with its discount, and a rendered PDF that says the discount in both languages.
4. Nothing under `domain/accounting`, `app/api/accounting`, `domain/shared`, `app/shell`, `app/client`, `app/api/portal` changed; `git diff --stat origin/main -- domain/accounting app/api/accounting domain/shared app/shell app/client app/api/portal` is empty.
