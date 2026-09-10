import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SellSessionResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * `POST /api/billing/session-purchases` — a family buys one session ahead of
 * the visit (the operator's decision of 10 September 2026,
 * .superpowers/sdd/2026-09-10-walk-fixes-3-sell-session/task-2-brief.md).
 * The package sale's own shape, for a package of one: no typed price, the
 * price list's own discount and an optional extra combined once, VAT from the
 * price row's stamp and the registration, one credit, and a retried press
 * that replays rather than doubles.
 */

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

async function rowCount(table: string, clientIndex: number): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    `select count(*)::text as n from ${table} where client_id = $1`,
    [h.clientId(clientIndex)],
  );
  return Number(rows[0]?.n);
}

describe('POST /api/billing/session-purchases', () => {
  it('sells one session at the price in force, unpaid: an invoice and one credit', async () => {
    const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale());
    expect(res.status).toBe(201);
    const body = (await res.json()) as SellSessionResponse;
    expect(body.netFils).toBe(70_000);
    expect(body.grossFils).toBe(70_000);
    expect(body.invoiceReference).toMatch(/^INV-\d{6}$/);
    // Twelve months from SEED_TODAY (db/seed/generate.ts: '2026-09-02'), not
    // from 10 September — the brief's own draft assumed SEED_TODAY was the
    // day this round started rather than the fixed seed date.
    expect(body.expiresOn).toBe('2027-09-02');
    const credit = await h.owner.query<{
      source_type: string;
      invoice_id: string;
      status: string;
      expires_on: string;
      allocated_net_fils: number;
    }>(
      'select source_type, invoice_id, status, expires_on, allocated_net_fils from entitlement where id = $1',
      [body.entitlementId],
    );
    expect(credit.rows[0]).toMatchObject({
      source_type: 'single',
      invoice_id: body.invoiceId,
      status: 'available',
      allocated_net_fils: 70_000,
    });
    const invoice = await h.owner.query<{
      kind: string;
      session_id: string | null;
      discount_reason: string | null;
    }>('select kind, session_id, discount_reason from invoice where id = $1', [body.invoiceId]);
    // No extra discount on this sale, so nothing explains one (migration 411
    // section 3): the column stays null rather than an empty string.
    expect(invoice.rows[0]).toEqual({
      kind: 'single_session',
      session_id: null,
      discount_reason: null,
    });
    const paid = await h.owner.query('select 1 from payment where invoice_id = $1', [
      body.invoiceId,
    ]);
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
    // A valid Idempotency-Key is a uuid (ledger-schema.ts's IdempotencyKey);
    // the brief's own draft used a plain slug here, which the schema would
    // have refused with 400 before ever reaching the sale.
    const key = '00000000-0000-4000-8000-0000000e5501';
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
    expect(
      (await h.call('POST', '/api/billing/session-purchases', SEEDED.practitioner, sale())).status,
    ).toBe(403);
    expect(
      (
        await h.call(
          'POST',
          '/api/billing/session-purchases',
          SEEDED.owner,
          sale({ purchasedOn: '2099-01-01' }),
        )
      ).status,
    ).toBe(400);
    // Before the price list's own validFrom (SEED_TODAY) but after the
    // practice opened (2024-01-01): no price row is in force yet, so this is
    // "not priced", not "too old" — the brief's own draft used 2020-01-01,
    // which the route's EARLIEST_SALE_ON guard catches first as a 400 and
    // never reaches the price lookup at all.
    expect(
      (
        await h.call(
          'POST',
          '/api/billing/session-purchases',
          SEEDED.owner,
          sale({ purchasedOn: '2024-06-01' }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await h.call(
          'POST',
          '/api/billing/session-purchases',
          SEEDED.owner,
          sale({
            clientId: '00000000-0000-4000-8000-0000000000ff',
          }),
        )
      ).status,
    ).toBe(404);
  });

  it('refuses an extra discount from a role that may not give one, at both doors', async () => {
    // The brief's own draft tried this against SEEDED.admin, on the premise
    // that an admin "may sell but not discount". Neither access.ts's
    // mayDiscount nor docs/SPEC/billing.md section 2.4 agrees: "Only the
    // owner, an admin or finance may give one" — the identical audience
    // maySell already grants, so an admin is refused nothing here (201, not
    // 403). tests/billing/db/discounts.test.ts's own package-sale suite hits
    // the same wall and tests the practitioner instead, noting the refusal
    // is the same 403 whichever of maySell or mayDiscount is asked first;
    // this test follows that precedent. DiscountInput is also a
    // discriminated union on `kind` (schema.ts), which the brief's draft
    // omitted — fixed here too.
    const res = await h.call(
      'POST',
      '/api/billing/session-purchases',
      SEEDED.practitioner,
      sale({
        extraDiscount: {
          discount: { kind: 'percent', basisPoints: 1000 },
          reason: 'Trial session, agreed on the phone',
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('combines a standing discount and an extra one once, and keeps the reason', async () => {
    // Nothing else in this file prices a service that already carries the
    // price list's own discount, so a discounted sale's wiring
    // (combineDiscounts / toDiscount, session-sales.ts:203-212) has never
    // actually run here — the unit tests cover the arithmetic,
    // tests/billing/db/session_sales.test.ts had only the 403 above. Priced
    // fresh: discovery-call carries no price from setPracticePrices, so a
    // standing ten per cent off is this test's own, and the extra discount is
    // a further five. Both are percentages, so domain/billing/discount.ts
    // combines them into one flat fifteen per cent off the list — 15,000 of
    // 100,000 — never fifteen and then five per cent of an already
    // discounted figure. Sold by an admin rather than the owner, to prove the
    // route's own use of the domain functions for the audience
    // access.ts:mayDiscount actually admits, not only for the role every
    // other case in this file happens to use.
    const priced = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('discovery-call'),
      listPriceFils: 100_000,
      discount: { kind: 'percent', basisPoints: 1000 },
      validFrom: SEED_TODAY,
      amendmentReason: 'A launch discount of ten per cent on the discovery call.',
    });
    expect(priced.status).toBe(201);

    const res = await h.call(
      'POST',
      '/api/billing/session-purchases',
      SEEDED.admin,
      sale({
        clientId: h.clientId(5),
        serviceTypeId: h.serviceTypeId('discovery-call'),
        extraDiscount: {
          discount: { kind: 'percent', basisPoints: 500 },
          reason: 'A further five per cent agreed on the call.',
        },
        payment: { method: 'cash', amountFils: 85_000, reference: 'DOOR-2' },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as SellSessionResponse;
    expect(body.netFils).toBe(85_000);
    expect(body.vatFils).toBe(0);
    expect(body.grossFils).toBe(85_000);

    const invoice = await h.owner.query<{
      net_fils: number;
      vat_fils: number;
      gross_fils: number;
      discount_reason: string | null;
    }>('select net_fils, vat_fils, gross_fils, discount_reason from invoice where id = $1', [
      body.invoiceId,
    ]);
    expect(invoice.rows[0]).toEqual({
      net_fils: 85_000,
      vat_fils: 0,
      gross_fils: 85_000,
      discount_reason: 'A further five per cent agreed on the call.',
    });

    const line = await h.owner.query<{
      unit_net_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      net_fils: number;
    }>(
      'select unit_net_fils, discount_fils, discount_basis_points, net_fils from invoice_line where invoice_id = $1',
      [body.invoiceId],
    );
    expect(line.rows[0]).toEqual({
      unit_net_fils: 100_000,
      discount_fils: 15_000,
      discount_basis_points: 1500,
      net_fils: 85_000,
    });

    const entitlement = await h.owner.query<{ allocated_net_fils: number }>(
      'select allocated_net_fils from entitlement where id = $1',
      [body.entitlementId],
    );
    expect(entitlement.rows[0]?.allocated_net_fils).toBe(85_000);

    const payment = await h.owner.query<{ amount_fils: number }>(
      'select amount_fils from payment where invoice_id = $1',
      [body.invoiceId],
    );
    expect(payment.rows[0]?.amount_fils).toBe(85_000);
  });

  it('answers three presses at once the same way, and sells once', async () => {
    // Not a retry after an answer: three requests in flight together, as
    // tests/billing/db/idempotency.test.ts's own "three presses at once"
    // exercises for the package sale. Two of the three find nothing under the
    // key, insert, and collide on invoice_one_per_idempotency_key (migration
    // 411); the savepoint and the rollback-to-savepoint recovery in
    // session-sales.ts is what turns that collision into a replayed answer
    // rather than a 500 for a sale that in fact went through — the brief's
    // own test list only pressed the button once, so nothing else here
    // proves that path actually works under a genuine race rather than only
    // reading it off the code.
    const key = '00000000-0000-4000-8000-0000000e5503';
    const body = sale({ clientId: h.clientId(2) });
    const answers = await Promise.all(
      [0, 1, 2].map(() =>
        h.call('POST', '/api/billing/session-purchases', SEEDED.owner, body, {
          'idempotency-key': key,
        }),
      ),
    );
    expect(answers.map((res) => res.status)).toEqual([201, 201, 201]);
    const bodies = (await Promise.all(answers.map((res) => res.json()))) as SellSessionResponse[];
    expect(new Set(bodies.map((b) => b.invoiceId)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.entitlementId)).size).toBe(1);
    expect(await rowCount('invoice', 2)).toBe(1);
    expect(await rowCount('entitlement', 2)).toBe(1);
  });

  it('is consumed by the next check-in of that service', async () => {
    const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, sale());
    const body = (await res.json()) as SellSessionResponse;
    // app.oldest_available_entitlement returns a scalar uuid, not a row set
    // (403_billing_entitlement.sql: `returns uuid`), so it is called in the
    // select list — `select app.oldest_available_entitlement(...) as id`, the
    // form tests/billing/db/consumption_race.test.ts uses — rather than
    // `select id from ...(...)`, and it is security definer reading
    // app.current_tenant_id() from the session's own context, so that has to
    // be set first, as consumption_race.test.ts's beforeAll does.
    const owner = h.data.users[SEEDED.owner];
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
        "set_config('app.actor_roles', 'owner', false), " +
        "set_config('app.request_id', '00000000-0000-4000-8000-0000000e5502', false), " +
        "set_config('app.reason', '', false)",
      [h.data.tenant.id, owner?.id ?? null],
    );
    const picked = await h.owner.query<{ id: string | null }>(
      'select app.oldest_available_entitlement($1, $2, $3::date) as id',
      [h.clientId(0), h.serviceTypeId('nf-session'), SEED_TODAY],
    );
    // The oldest available credit for this service is one of the several this
    // suite sold; the function does not care that it came from no package.
    expect(picked.rows[0]?.id).toBeTruthy();
    expect(body.entitlementId).toBeTruthy();
    // Hands the connection back as it found it (support.ts's own discipline
    // for a fixture that changes session-scoped state on h.owner).
    await h.owner.query(
      "select set_config('app.tenant_id', '', false), set_config('app.actor_id', '', false), " +
        "set_config('app.actor_roles', '', false), set_config('app.request_id', '', false), " +
        "set_config('app.reason', '', false)",
    );
  });
});
