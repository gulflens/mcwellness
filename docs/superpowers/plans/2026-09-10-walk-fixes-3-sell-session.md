# The walk's fixes, part three: sell a session — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the office sell one session up front: an invoice, one credit at the single-session price, and the payment when money changed hands, so a trial session can be invoiced before the visit.

**Architecture:** A new invoice kind `single_session` (migration 410) sits beside `session` and `package`: like a package it is a credit sold ahead of delivery, so the books post it to contract liability and move it to income when the credit is consumed, which the existing posting rules already do for every kind but the fee and the statement. One route, `POST /api/billing/session-purchases`, mirrors the package sale's shape and idempotency. One drawer, `SellSessionDrawer`, mirrors the package drawer. Check-in consumes the credit through `app.oldest_available_entitlement`, which already ignores where a credit came from.

**Tech Stack:** PostgreSQL enum and check constraint, Hono, zod, React 19, Vitest against the local database with the billing harness in `tests/billing/db/support.ts`.

**Spec:** `docs/superpowers/specs/2026-09-10-walk-fixes-design.md`, section "Pull request 3", as amended by this plan: the invoice kind is `single_session`, not `session`, because `invoice_source_matches_kind` (migrations 402, 408) requires a `session_id` on a `session` invoice and a pre-sold credit has none.

## Global Constraints

- Branch `trunk-round-43`, after parts one and two. Billing's own paths (`domain/billing/**`, `app/admin/billing/**`, `app/api/billing/**`, migrations 400–449, `tests/billing/**`) plus the shared `domain/accounting/posting.ts` and `app/api/accounting/poster.ts` (one union member and one list entry each); note them in the trunk note.
- Money is integer fils. VAT is resolved by `resolveSaleVat` from the price row's stamp and the registration, never typed (CLAUDE.md rule 6).
- The price is never typed into a sale: it is the price row in force on `purchasedOn`; an extra discount needs `mayDiscount` and a reason of at least `MINIMUM_REASON` characters.
- Issued invoices are never edited (rule 7); the sale is one transaction.
- Every task ends with its tests green; the PR ends with `pnpm verify`, `pnpm test:db`, the compliance and security reviewers, and the schema reviewer for migration 410.
- Commit after every task, conventional message, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: The invoice kind `single_session`

**Files:**
- Create: `db/migrations/410_billing_single_session.sql`
- Modify: `domain/accounting/posting.ts:17` (union), `app/api/accounting/poster.ts:77` (list)
- Test: `tests/billing/db/single_session_kind.test.ts` (new), `domain/accounting/posting.test.ts` (add a case)

**Interfaces:**
- Produces: `invoice.kind = 'single_session'` allowed with `session_id`, `package_purchase_id` and `appointment_id` all null; `MoneyEvent['invoiceKind']` includes `'single_session'`; the poster maps it.

- [ ] **Step 1: Write the failing domain test**

In `domain/accounting/posting.test.ts`, beside the case that posts a package invoice:

```ts
  it('posts a session sold ahead of its visit to contract liability, as a package is', () => {
    const draft = postingsFor(
      {
        event: 'invoice.issued',
        sourceId: 'inv-1',
        occurredOn: '2026-09-10',
        invoiceKind: 'single_session',
        netFils: fils(70_000),
        vatFils: fils(0),
        grossFils: fils(70_000),
      },
      chart,
    );
    expect(draft?.lines).toEqual([
      dr(accountByRole(chart, 'receivable').id, fils(70_000)),
      cr(accountByRole(chart, 'contract_liability').id, fils(70_000)),
    ]);
  });
```

Use the `chart` fixture and helpers the file already defines.

- [ ] **Step 2: Write the failing database test**

```ts
// tests/billing/db/single_session_kind.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TODAY } from '../../../db/seed/generate';
import { rejectsWith } from '../../db/helpers';
import { startHarness, type Harness } from './support';

/**
 * Migration 410: an invoice may be of kind single_session, and then names no
 * session, no package purchase and no appointment — a credit sold ahead of the
 * visit that will consume it. The source rule is the one place that says what
 * each kind must name (408's precedent), restated here with the new kind in it.
 */
let h: Harness;
const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const CHECK_VIOLATION = '23514';

beforeAll(async () => {
  h = await startHarness(NOW);
});
afterAll(async () => {
  await h.close();
});

async function asPractice<T>(fn: () => Promise<T>): Promise<T> {
  await h.owner.query("select set_config('app.tenant_id', $1, true)", [h.data.tenantId]);
  await h.owner.query("select set_config('app.actor_id', $1, true)", [h.data.users[0]?.id]);
  return fn();
}

describe('invoice kind single_session', () => {
  it('is accepted with no session, no package purchase and no appointment', async () => {
    await asPractice(async () => {
      const { rows } = await h.owner.query<{ id: string }>(
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, gross_fils) ' +
          "values ($1, $2, app.next_invoice_number(), 'single_session', $3, 70000, 0, 70000) returning id",
        [h.data.tenantId, h.clientId(0), SEED_TODAY],
      );
      expect(rows[0]?.id).toBeTruthy();
    });
  });

  it('refuses one that names a package purchase, which would be a package invoice in disguise', async () => {
    await asPractice(async () => {
      const { rows } = await h.owner.query<{ id: string }>(
        'select id from package_purchase limit 1',
      );
      const purchase = rows[0]?.id;
      if (!purchase) return; // The seed on this database sold nothing; the rule is still pinned by the first case.
      await rejectsWith(
        h.owner,
        CHECK_VIOLATION,
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, package_purchase_id, net_fils, vat_fils, gross_fils) ' +
          "values ($1, $2, app.next_invoice_number(), 'single_session', $3, $4, 70000, 0, 70000)",
        [h.data.tenantId, h.clientId(0), SEED_TODAY, purchase],
      );
    });
  });
});
```

Read `tests/billing/db/support.ts` for the exact name of the tenant id on `h.data` (it may be
`h.data.tenant.id`) and for how other tests set the audit context before writing as the owner
connection; copy that rather than the two `set_config` lines above if they differ.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run domain/accounting/posting.test.ts && pnpm vitest run --config vitest.db.config.ts tests/billing/db/single_session_kind.test.ts`
Expected: FAIL (a type error on the union; an invalid enum value).

- [ ] **Step 4: Write the migration**

```sql
-- 410_billing_single_session.sql
-- Needs: 402 (invoice, invoice_kind), 403 (entitlement.source_type 'single'), 408 (the source rule as last restated)
--
-- A session sold before its visit. Until trunk round 43 (2026-09-10) a visit
-- outside a package was charged when it closed (app.charge_single_visit: an
-- invoice of kind 'session' naming the session, and a credit born consumed),
-- and nothing could invoice a trial session up front. The operator's decision
-- of 10 September adds the sale: an invoice of a fourth kind, naming no
-- session, no package purchase and no appointment, and one credit of source
-- 'single' pointing at it — which the entitlement table's own rule
-- (entitlement_source_is_named) has always allowed.
--
-- The books already know what to do with it. app.unposted_money_events reads
-- the kind as text, and domain/accounting/posting.ts posts every kind but the
-- fee and the statement to contract liability, moving it to income when the
-- credit is consumed: exactly a package's life, for a package of one.
--
-- The enum value is added first and used only as a text literal below, for
-- the reason 408 gives: a value added to a type cannot be used as that type in
-- the transaction that added it.
alter type invoice_kind add value 'single_session';

alter table invoice drop constraint invoice_source_matches_kind;
alter table invoice add constraint invoice_source_matches_kind check (
  case kind::text
    when 'session' then
      session_id is not null and package_purchase_id is null and appointment_id is null
    when 'package' then
      package_purchase_id is not null and session_id is null and appointment_id is null
    when 'statement' then
      session_id is null and package_purchase_id is null and appointment_id is null
    when 'call_out_fee' then
      appointment_id is not null and session_id is null and package_purchase_id is null
    when 'single_session' then
      session_id is null and package_purchase_id is null and appointment_id is null
    else false
  end
);

comment on constraint invoice_source_matches_kind on invoice is
  'What each kind of invoice must name (402, restated in 408 and 410). A single_session '
  'invoice names nothing: the credit it created points at it, not the other way round.';
```

Read `db/migrations/408_billing_call_out_fee.sql` lines 85–125 in full before writing this, and
keep the constraint's other four branches character-for-character as 408 left them. If 408
had to split the enum addition into its own file or statement for the runner (its comment at
line 89 explains what it did), do the same here.

- [ ] **Step 5: Teach the books the kind**

`domain/accounting/posting.ts:17`: `invoiceKind: 'session' | 'package' | 'call_out_fee' | 'statement' | 'single_session';`.
`app/api/accounting/poster.ts:77`: `const INVOICE_KINDS = ['session', 'package', 'call_out_fee', 'statement', 'single_session'] as const;`.
No branch changes: `postingsFor` already sends every kind but `statement` and `call_out_fee` to contract liability.

- [ ] **Step 6: Run the tests and the migration audit**

Run: `pnpm vitest run domain/accounting && pnpm vitest run --config vitest.db.config.ts tests/billing/db/single_session_kind.test.ts tests/db/checksums.test.ts && pnpm audit:migrations`
Expected: PASS (add 410 to the checksum list if the test keeps one).

- [ ] **Step 7: Commit**

```bash
git add db/migrations/410_billing_single_session.sql domain/accounting/posting.ts domain/accounting/posting.test.ts app/api/accounting/poster.ts tests/billing/db/single_session_kind.test.ts
git commit -m "feat(billing): an invoice kind for a session sold ahead of its visit"
```

---

### Task 2: The route `POST /api/billing/session-purchases`

**Files:**
- Modify: `domain/billing/expiry.ts` (the constant), `domain/billing/index.ts` (export it)
- Modify: `app/api/billing/ledger-schema.ts` (`SellSessionInput`, `SellSessionResponse`)
- Create: `app/api/billing/session-sales.ts`
- Modify: `app/api/billing/routes.ts` (mount it)
- Test: `domain/billing/expiry.test.ts` (one case), `tests/billing/db/session_sales.test.ts` (new)

**Interfaces:**
- Produces: `SINGLE_SESSION_MONTHS = 12`; `SellSessionInput = { clientId, serviceTypeId, purchasedOn, payment?, extraDiscount? }` (the package input with `serviceTypeId` in place of `packageId`); `SellSessionResponse = { invoiceId, invoiceReference, entitlementId, serviceTypeName, netFils, vatFils, grossFils, expiresOn }`; the route answers 201 with it, replays on an `idempotency-key`, and refuses as the package sale does.

- [ ] **Step 1: Write the failing domain test**

In `domain/billing/expiry.test.ts`:

```ts
  it('gives a session sold on its own twelve months, the term a package of one gets', () => {
    expect(SINGLE_SESSION_MONTHS).toBe(12);
    expect(expiryOn('2026-09-10', SINGLE_SESSION_MONTHS)).toBe('2027-09-10');
  });
```

- [ ] **Step 2: Write the failing route test**

```ts
// tests/billing/db/session_sales.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SellSessionResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

let h: Harness;
const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
});
afterAll(async () => {
  await h.close();
});

function sale(overrides: Record<string, unknown> = {}) {
  return {
    clientId: h.clientId(0),
    serviceTypeId: h.serviceTypeId('nf-session'),
    purchasedOn: SEED_TODAY,
    ...overrides,
  };
}

describe('POST /api/billing/session-purchases', () => {
  it('sells one session at the price in force, unpaid: an invoice and one credit', async () => {
    const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale());
    expect(res.status).toBe(201);
    const body = (await res.json()) as SellSessionResponse;
    expect(body.netFils).toBe(70_000);
    expect(body.grossFils).toBe(70_000);
    expect(body.invoiceReference).toMatch(/^INV-\d{6}$/);
    expect(body.expiresOn).toBe('2027-09-10');
    const credit = await h.owner.query<{
      source_type: string;
      invoice_id: string;
      status: string;
      expires_on: string;
      allocated_net_fils: number;
    }>('select source_type, invoice_id, status, expires_on, allocated_net_fils from entitlement where id = $1', [
      body.entitlementId,
    ]);
    expect(credit.rows[0]).toMatchObject({
      source_type: 'single',
      invoice_id: body.invoiceId,
      status: 'available',
      allocated_net_fils: 70_000,
    });
    const invoice = await h.owner.query<{ kind: string; session_id: string | null }>(
      'select kind, session_id from invoice where id = $1',
      [body.invoiceId],
    );
    expect(invoice.rows[0]).toEqual({ kind: 'single_session', session_id: null });
    const paid = await h.owner.query('select 1 from payment where invoice_id = $1', [body.invoiceId]);
    expect(paid.rows).toHaveLength(0);
  });

  it('records the payment and its receipt when money changed hands', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/session-purchases',
      SEEDED.owner,
      sale({ payment: { method: 'cash', amountFils: 70_000, reference: 'DOOR-1' } }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as SellSessionResponse;
    const paid = await h.owner.query<{ amount_fils: number; receipt_reference: string | null }>(
      'select amount_fils, receipt_reference from payment where invoice_id = $1',
      [body.invoiceId],
    );
    expect(paid.rows[0]?.amount_fils).toBe(70_000);
    expect(paid.rows[0]?.receipt_reference).toMatch(/^RCP-\d{6}$/);
  });

  it('replays the same answer for the same idempotency key', async () => {
    const key = 'session-sale-under-test-0001';
    const first = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale(), {
      'idempotency-key': key,
    });
    const second = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale(), {
      'idempotency-key': key,
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
  });

  it('refuses a practitioner, a future date, an unpriced service and an unknown client', async () => {
    expect((await h.call('POST', '/api/billing/session-purchases', SEEDED.practitioner, sale())).status).toBe(403);
    expect(
      (await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale({ purchasedOn: '2099-01-01' }))).status,
    ).toBe(400);
    expect(
      (
        await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale({ purchasedOn: '2020-01-01' }))
      ).status,
    ).toBe(422);
    expect(
      (
        await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale({ clientId: '00000000-0000-4000-8000-0000000000ff' }))
      ).status,
    ).toBe(404);
  });

  it('refuses an extra discount from an admin, who may sell but not discount', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/session-purchases',
      SEEDED.admin,
      sale({ extraDiscount: { discount: { basisPoints: 1000 }, reason: 'Trial session, agreed on the phone' } }),
    );
    expect(res.status).toBe(403);
  });

  it('is consumed by the next check-in of that service', async () => {
    const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale());
    const body = (await res.json()) as SellSessionResponse;
    const picked = await h.owner.query<{ id: string }>(
      'select id from app.oldest_available_entitlement($1, $2, $3::date)',
      [h.clientId(0), h.serviceTypeId('nf-session'), SEED_TODAY],
    );
    // The oldest available credit for this service is one of the three this
    // suite sold; the function does not care that it came from no package.
    expect(picked.rows[0]?.id).toBeTruthy();
    expect(body.entitlementId).toBeTruthy();
  });
});
```

Check `tests/billing/db/consumption.test.ts` for how it calls
`app.oldest_available_entitlement` (its exact parameters and the audit context it sets first)
and copy that call. The `discount` body shape (`basisPoints` or `fils`) is `DiscountInput` in
`app/api/billing/ledger-schema.ts`; use its field names.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run domain/billing/expiry.test.ts && pnpm vitest run --config vitest.db.config.ts tests/billing/db/session_sales.test.ts`
Expected: FAIL (constant missing; 404 on the route).

- [ ] **Step 4: The constant and the schemas**

`domain/billing/expiry.ts`:

```ts
/**
 * How long a session sold on its own can be used: twelve months from the day
 * it was bought, the term the practice's own packages carry. A single credit
 * has no package behind it to take a term from, so it takes this one
 * (docs/superpowers/specs/2026-09-10-walk-fixes-design.md).
 */
export const SINGLE_SESSION_MONTHS = 12;
```

Export it from `domain/billing/index.ts` beside `expiryOn`.

`app/api/billing/ledger-schema.ts`, after `SellPackageResponse`:

```ts
// ---------------------------------------------------------------------------
// Selling one session
// ---------------------------------------------------------------------------

export const SellSessionInput = SellPackageInput.omit({ packageId: true }).extend({
  serviceTypeId: z.uuid(),
});
export type SellSessionInput = z.infer<typeof SellSessionInput>;

export const SellSessionResponse = z.object({
  invoiceId: z.uuid(),
  invoiceReference: z.string(),
  entitlementId: z.uuid(),
  serviceTypeName: z.string(),
  netFils: z.number().int().nonnegative(),
  vatFils: z.number().int().nonnegative(),
  grossFils: z.number().int().nonnegative(),
  expiresOn: z.string(),
});
export type SellSessionResponse = z.infer<typeof SellSessionResponse>;
```

- [ ] **Step 5: The route**

```ts
// app/api/billing/session-sales.ts
import type { Hono } from 'hono';
import {
  SINGLE_SESSION_MONTHS,
  combineDiscounts,
  expiryOn,
  resolveSaleVat,
  type AppliedDiscount,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { maySell, mayDiscount } from './access';
import { toDiscount } from './schema';
import { IdempotencyKey, SellSessionInput, SellSessionResponse } from './ledger-schema';

/**
 * `POST /api/billing/session-purchases` — a family buys one session ahead of
 * the visit (the operator's decision of 10 September 2026).
 *
 * The package sale's shape, for a package of one: the price row in force on
 * the day, the practice's discount and an optional extra one combined once
 * against the list figure, VAT resolved from the row's stamp and the
 * registration, and in one transaction an invoice of kind `single_session`
 * (migration 410) with one line, one credit of source `single` pointing at
 * the invoice, and the payment when money changed hands. A retry with the same
 * `Idempotency-Key` replays the first answer from what it wrote; the key is
 * kept on the invoice, since a single sale has no purchase row of its own.
 *
 * Nothing changes for a visit with no credit: `app.charge_single_visit` still
 * invoices it when it closes.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const JURISDICTION = 'AE';
const RECIPIENT_TYPE = 'individual';
const EARLIEST_SALE_ON = '2024-01-01';

const CLIENT_SQL =
  "select id from client where tenant_id = app.current_tenant_id() and id = $1 and status <> 'erased'";

// The price in force on the day, with the service's name for the line and the
// answer: the same row app.charge_single_visit reads, chosen the same way.
const PRICE_SQL =
  'select p.id, p.list_price_fils, p.discount_fils, p.discount_basis_points, p.unit_price_fils, ' +
  'p.vat_rate_basis_points, p.vat_setting_version, st.name as service_type_name, ' +
  'st.name_ar as service_type_name_ar, st.code as service_type_code, ' +
  'app.tenant_charges_vat(app.current_tenant_id()) as vat_registered ' +
  'from price p join service_type st on st.id = p.service_type_id ' +
  'where p.tenant_id = app.current_tenant_id() and st.tenant_id = app.current_tenant_id() ' +
  "and p.service_type_id = $1 and p.jurisdiction = $2 and p.recipient_type = $3 and st.status = 'active' " +
  'and p.valid_from <= $4 order by p.valid_from desc limit 1';

const INSERT_INVOICE_SQL =
  'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, gross_fils, ' +
  'idempotency_key, created_by) values (app.current_tenant_id(), $1, app.next_invoice_number(), ' +
  "'single_session', $2, $3, $4, $5, $6, app.current_actor_id()) returning id, reference";

const INSERT_LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, description_ar, ' +
  'service_type_id, quantity, unit_net_fils, discount_fils, discount_basis_points, net_fils, ' +
  'vat_rate_basis_points, vat_setting_version, vat_fils, gross_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, 1, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, ' +
  'app.current_actor_id())';

const INSERT_ENTITLEMENT_SQL =
  'insert into entitlement (tenant_id, client_id, service_type_id, source_type, invoice_id, ' +
  'allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on, created_by) ' +
  "values (app.current_tenant_id(), $1, $2, 'single', $3, $4, $5, $6, $7, app.current_actor_id()) " +
  'returning id';

const INSERT_PAYMENT_SQL =
  'insert into payment (tenant_id, client_id, method, amount_fils, received_at, reference, ' +
  'invoice_id, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id())';

const REPLAY_SQL =
  'select i.id, i.reference, i.net_fils, i.vat_fils, i.gross_fils, e.id as entitlement_id, ' +
  'e.expires_on, st.name as service_type_name from invoice i ' +
  'join entitlement e on e.invoice_id = i.id join service_type st on st.id = e.service_type_id ' +
  "where i.tenant_id = app.current_tenant_id() and i.kind = 'single_session' and i.idempotency_key = $1";

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

type Db = ApiEnv['Variables']['db'];

async function replay(db: Db, key: string): Promise<SellSessionResponse | null> {
  const found = await db.query<{
    id: string;
    reference: string;
    net_fils: number;
    vat_fils: number;
    gross_fils: number;
    entitlement_id: string;
    expires_on: string;
    service_type_name: string;
  }>(REPLAY_SQL, [key]);
  const row = found.rows[0];
  if (!row) return null;
  return SellSessionResponse.parse({
    invoiceId: row.id,
    invoiceReference: row.reference,
    entitlementId: row.entitlement_id,
    serviceTypeName: row.service_type_name,
    netFils: row.net_fils,
    vatFils: row.vat_fils,
    grossFils: row.gross_fils,
    expiresOn: row.expires_on,
  });
}

export function mountSessionSales(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/session-purchases', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!maySell(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = SellSessionInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    if (input.purchasedOn > today) {
      return c.json({ error: 'bad_request', code: 'purchase_in_future', requestId }, 400);
    }
    if (input.purchasedOn < EARLIEST_SALE_ON) {
      return c.json({ error: 'bad_request', code: 'purchase_too_old', requestId }, 400);
    }
    const header = c.req.header('idempotency-key');
    let idempotencyKey: string | null = null;
    if (header !== undefined) {
      const parsed = IdempotencyKey.safeParse(header);
      if (!parsed.success) {
        return c.json({ error: 'bad_request', code: 'invalid_idempotency_key', requestId }, 400);
      }
      idempotencyKey = parsed.data;
    }
    const db = c.get('db');
    if (idempotencyKey !== null) {
      const seen = await replay(db, idempotencyKey);
      if (seen) return c.json(seen, 201);
    }

    const client = await db.query<{ id: string }>(CLIENT_SQL, [input.clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const priced = await db.query<{
      id: string;
      list_price_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      unit_price_fils: number;
      vat_rate_basis_points: number;
      vat_setting_version: number;
      service_type_name: string;
      service_type_name_ar: string | null;
      service_type_code: string;
      vat_registered: boolean;
    }>(PRICE_SQL, [input.serviceTypeId, JURISDICTION, RECIPIENT_TYPE, input.purchasedOn]);
    const price = priced.rows[0];
    if (!price) {
      // No price in force on that day: nothing is sold rather than something
      // guessed, as the package sale refuses an unpriced bundle.
      return c.json({ error: 'unprocessable', code: 'not_priced', requestId }, 422);
    }
    if (input.extraDiscount && !mayDiscount(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    let applied: AppliedDiscount;
    try {
      applied = combineDiscounts(
        fils(price.list_price_fils),
        { discountFils: fils(price.discount_fils), basisPoints: price.discount_basis_points },
        toDiscount(input.extraDiscount?.discount),
      );
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }
    const vat = resolveSaleVat(
      applied.netFils,
      { rateBasisPoints: price.vat_rate_basis_points, version: price.vat_setting_version },
      { vatRegistered: price.vat_registered },
    );
    const expiresOn = expiryOn(input.purchasedOn, SINGLE_SESSION_MONTHS);

    if (idempotencyKey !== null) {
      await db.query('savepoint session_sale_attempt');
    }
    let invoice;
    try {
      invoice = await db.query<{ id: string; reference: string }>(INSERT_INVOICE_SQL, [
        input.clientId,
        input.purchasedOn,
        applied.netFils,
        vat.vatFils,
        vat.grossFils,
        idempotencyKey,
      ]);
    } catch (error) {
      if (idempotencyKey === null || !isDuplicateKey(error)) throw error;
      await db.query('rollback to savepoint session_sale_attempt');
      const seen = await replay(db, idempotencyKey);
      if (!seen) throw error;
      return c.json(seen, 201);
    }
    const invoiceId = invoice.rows[0]?.id;
    const reference = invoice.rows[0]?.reference;
    if (!invoiceId || !reference) {
      throw new Error('Insert of an invoice did not return an id and a reference.');
    }
    await db.query(INSERT_LINE_SQL, [
      invoiceId,
      input.clientId,
      price.service_type_name,
      price.service_type_name_ar,
      input.serviceTypeId,
      applied.listFils,
      applied.discountFils,
      applied.basisPoints,
      applied.netFils,
      vat.rateBasisPoints,
      price.vat_setting_version,
      vat.vatFils,
      vat.grossFils,
    ]);
    const credit = await db.query<{ id: string }>(INSERT_ENTITLEMENT_SQL, [
      input.clientId,
      input.serviceTypeId,
      invoiceId,
      applied.netFils,
      price.vat_rate_basis_points,
      price.vat_setting_version,
      expiresOn,
    ]);
    const entitlementId = credit.rows[0]?.id;
    if (!entitlementId) {
      throw new Error('Insert of an entitlement did not return an id.');
    }
    if (input.payment) {
      await db.query(INSERT_PAYMENT_SQL, [
        input.clientId,
        input.payment.method,
        input.payment.amountFils,
        now().toISOString(),
        input.payment.reference ?? null,
        invoiceId,
      ]);
    }
    return c.json(
      SellSessionResponse.parse({
        invoiceId,
        invoiceReference: reference,
        entitlementId,
        serviceTypeName: price.service_type_name,
        netFils: applied.netFils,
        vatFils: vat.vatFils,
        grossFils: vat.grossFils,
        expiresOn,
      }),
      201,
    );
  });
}
```

Before running: check three column names against the schema and the package sale, and fix
the SQL above to match: (1) whether `invoice` has an `idempotency_key` column (the package
sale keeps the key on `package_purchase`; if `invoice` has none, migration 410 adds
`idempotency_key text` with a partial unique index `(tenant_id, idempotency_key) where
idempotency_key is not null`, and the test in Task 1 gains a case for it); (2) whether
`invoice_line` has `service_type_id` (it does if `app.charge_single_visit` writes one; read
migration 406 lines 270–285); (3) how `sales.ts` passes `received_at` for the payment (copy
it). Mount it in `routes.ts`: `mountSessionSales(api, now);` after `mountSales`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run domain/billing && pnpm vitest run --config vitest.db.config.ts tests/billing/db/session_sales.test.ts tests/billing/db/idempotency.test.ts tests/billing/db/audit_coverage.test.ts`
Expected: PASS. `audit_coverage.test.ts` may list every billing route; add the new one.

- [ ] **Step 7: Commit**

```bash
git add domain/billing/expiry.ts domain/billing/expiry.test.ts domain/billing/index.ts app/api/billing/ledger-schema.ts app/api/billing/session-sales.ts app/api/billing/routes.ts tests/billing/db/session_sales.test.ts db/migrations/410_billing_single_session.sql tests/billing/db/single_session_kind.test.ts
git commit -m "feat(billing): sell one session ahead of its visit"
```

---

### Task 3: The drawer and the button

**Files:**
- Create: `app/admin/billing/SellSessionDrawer.tsx`
- Modify: `app/admin/billing/PackagesSection.tsx:46-52, 180-196, 250-262`
- Test: `app/admin/billing/SellSessionDrawer.test.tsx` (new)

**Interfaces:**
- Consumes: `GET /api/billing/prices` (the current price list; read `PricesSection.tsx` for the response schema and the row type), `ClientPicker`, `DiscountFields`, `useAttemptKey`, `useDrawer`, `previewSaleDiscount`, `previewVat`, `discountBody`, `formatFils`, `SellSessionResponse`.
- Produces: `SellSessionDrawer({ onClose, onSold })`, `onSold(summary: string)`.

- [ ] **Step 1: Write the failing test**

Model it on `SellPackageDrawer.test.tsx` if that exists (read it; copy its `mount` and fetch stub). Otherwise, in the style of `ContactForm.test.tsx`:

```tsx
  it('sells the chosen service at the price in force and says so', async () => {
    // fetch stub: GET /api/billing/prices -> one row for "Neurofeedback session" at 70,000 fils net;
    // GET /api/clients?... -> one client "Alpha Synthetic"; POST /api/billing/session-purchases -> 201
    // { invoiceId, invoiceReference: 'INV-000004', entitlementId, serviceTypeName: 'Neurofeedback session',
    //   netFils: 70000, vatFils: 0, grossFils: 70000, expiresOn: '2027-09-10' }
    const { calls, onSold } = mount();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: SERVICE_ID } });
    // pick the client through ClientPicker the way the package drawer test does
    fireEvent.click(screen.getByRole('checkbox', { name: 'Money has changed hands' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    await waitFor(() => expect(onSold).toHaveBeenCalled());
    const post = calls.find((c) => c.url === '/api/billing/session-purchases');
    const body = JSON.parse(String(post?.init?.body));
    expect(body).toMatchObject({ serviceTypeId: SERVICE_ID, payment: { method: 'transfer', amountFils: 70000 } });
    expect(new Headers(post?.init?.headers).get('idempotency-key')).toBeTruthy();
    expect(onSold).toHaveBeenCalledWith(
      'Neurofeedback session sold to Alpha Synthetic for AED 700.00, invoice INV-000004.',
    );
  });

  it('shows the figures before the sale: list, discount, price, VAT, total', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: SERVICE_ID } });
    expect(screen.getByText('Total (AED)').nextSibling?.textContent).toBe('700.00');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/admin/billing/SellSessionDrawer.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the drawer**

Copy `SellPackageDrawer.tsx` to `SellSessionDrawer.tsx` and make these changes, keeping
everything else (the attempt key, `useDrawer`, the discount fields, the payment fields, the
refusal messages, the figures table):

- Props: `{ onClose, onSold }` with no `bundle`.
- State: `const [prices, setPrices] = useState<PriceRow[] | null>(null)` loaded once from
  `GET /api/billing/prices` (use the same schema `PricesSection.tsx` parses), and
  `const [serviceTypeId, setServiceTypeId] = useState('')`. `const price = prices?.find((p) => p.serviceTypeId === serviceTypeId) ?? null`.
- A `Select` labelled "Service" listing every priced service (`price.serviceTypeName`) above the
  client picker.
- Credits line: "1 × {price.serviceTypeName}" instead of the bundle's contents.
- The figures use `price.listPriceFils`, `price.discountFils`, `price.discountBasisPoints`,
  `price.vatFils`, `price.vatRateBasisPoints`, `price.grossFils` — the names `PricesSection.tsx`
  reads off the same response.
- Payload: `{ serviceTypeId, clientId, purchasedOn, extraDiscount?, payment? }` to
  `/api/billing/session-purchases`; parse `SellSessionResponse`; the summary is
  `` `${body.serviceTypeName} sold to ${client.givenName} ${client.familyName} for AED ${formatFils(body.grossFils)}, invoice ${body.invoiceReference}.` ``.
- Title: "Sell a session". Submit button: "Record the sale". Refusal for 422 `not_priced`:
  "This service has no price on that day. Set a price first."
- Header comment: what a single sale is, that the credit runs twelve months, and that a visit
  with no credit is still charged when it closes.

- [ ] **Step 4: The button**

`PackagesSection.tsx`: add `const [sellingSession, setSellingSession] = useState(false);`.
Beside "Add package" in the actions row (line ~185), when `canWrite`:

```tsx
<Button
  variant="secondary"
  onClick={() => {
    setNote(null);
    setSellingSession(true);
  }}
>
  Sell a session
</Button>
```

and beside the `SellPackageDrawer` render:

```tsx
{sellingSession ? (
  <SellSessionDrawer
    onClose={() => setSellingSession(false)}
    onSold={(summary) => {
      setSellingSession(false);
      setNote(summary);
    }}
  />
) : null}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run app/admin/billing && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/admin/billing/SellSessionDrawer.tsx app/admin/billing/SellSessionDrawer.test.tsx app/admin/billing/PackagesSection.tsx
git commit -m "feat(billing): Sell a session beside the packages"
```

---

### Task 4: The document, the balance, the books: nothing new to say, proven

**Files:**
- Test: `tests/billing/db/documents.test.ts` (one case), `tests/billing/db/summary.test.ts` or `stop_balance.test.ts` (one case), `tests/accounting/db/*.test.ts` (one case where the poster is exercised)

- [ ] **Step 1: Prove the invoice renders**

In `tests/billing/db/documents.test.ts`, sell a session through the route and fetch its PDF the
way the file fetches a package invoice's; assert 200 and `application/pdf`. If the renderer
branches on kind anywhere and refuses `single_session`, extend that branch to treat it as a
package invoice's line (a service, quantity one).

- [ ] **Step 2: Prove the balance counts it**

In the balance test file, sell a session and assert the client's balance for that service shows
one credit left with `expiresOn` twelve months on, and that "Charged" rose by the gross.

- [ ] **Step 3: Prove the books post it**

In the accounting poster test, sell a session, run the poster (`pnpm job:post-books`'s function
as the test already calls it), and assert an entry "Invoice issued" debiting receivable and
crediting contract liability for the net.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run --config vitest.db.config.ts tests/billing tests/accounting`
Expected: PASS.

```bash
git add tests
git commit -m "test(billing): a sold session renders, counts, and posts like a package of one"
```

---

### Task 5: Docs, the gate, the pull request

**Files:**
- Modify: `docs/SPEC/billing.md` (section 2: the four sources; a new paragraph on the up-front sale, kind `single_session`, twelve months), `docs/SPEC/accounting.md` (the kinds the poster knows), `docs/CHANGE-REQUESTS/trunk-notes.md` (Round 43, part three)

- [ ] **Step 1: The specs and the note**

`billing.md`: under "Buy a single session → 1 entitlement", change "consumed immediately" to
"consumed immediately when charged at the door; available for twelve months when sold ahead
(`single_session` invoice, migration 410, trunk round 43)". `accounting.md`: add
`single_session` to the list of invoice kinds and say it posts as a package does. Trunk note:
what was added, the two shared-zone lines in `domain/accounting/posting.ts` and
`app/api/accounting/poster.ts`, and that the credit cannot be extended in this round.

- [ ] **Step 2: The gate and the pull request**

Run: `pnpm verify && pnpm test:db`. Then:

```bash
git add docs
git commit -m "docs(trunk): round 43, part three — a session sold ahead of its visit"
git push
gh pr create --title "trunk round 43, part three: sell a session" --body-file <(cat <<'EOF'
A session can be sold before the visit: "Sell a session" beside the packages, one invoice of a
new kind `single_session` (migration 410), one credit at the single-session price running for
twelve months, and the payment when money changed hands. Check-in consumes it like any credit;
the books post it as a package of one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 3: Reviews**

Dispatch `compliance-reviewer`, `security-reviewer` and `schema-reviewer` (migration 410). Fix,
re-run the gate, merge only when every check reads SUCCESS.
