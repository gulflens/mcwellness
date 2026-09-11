import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MonthlyMoneyResponse } from '../../../app/api/billing/document-schema';
import type {
  BalanceResponse,
  SellPackageResponse,
  SellSessionResponse,
} from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The three figures against the ledger they are derived from
 * (docs/SPEC/billing.md section 4.1).
 *
 * The reconciliation is the test that matters. Anyone can add up payments; what
 * has to hold is that cash collected ties to the ledger view the balance screen
 * reads, and that every credit the practice was paid for is accounted for as
 * either earned or still owed, with nothing falling between the two.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const MONTH = SEED_TODAY.slice(0, 7);
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fb';

let h: Harness;
let silverId: string;

async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

let sessionSeq = 0;

async function deliverVisit(clientId: string): Promise<void> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000b${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId('nf-session')],
  );
}

async function summary(month = MONTH): Promise<MonthlyMoneyResponse> {
  const res = await h.call('GET', `/api/billing/summary?month=${month}`, SEEDED.owner);
  if (res.status !== 200) throw new Error(`The summary answered ${res.status}.`);
  return (await res.json()) as MonthlyMoneyResponse;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);

  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
    { 'x-reason': "The practice's own launch pricing." },
  );
  if (created.status !== 201) throw new Error('Silver was not created.');
  const listed = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const packages = (await listed.json()) as { packages: { id: string; code: string }[] };
  const silver = packages.packages.find((p) => p.code === SILVER_CODE);
  if (!silver) throw new Error('Silver was not in the catalogue.');
  silverId = silver.id;
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('a programme sold and one visit delivered', () => {
  it('shows the cash in full and recognises only what was delivered', async () => {
    const clientId = h.clientId(0);
    const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silverId,
      clientId,
      purchasedOn: SEED_TODAY,
      payment: { method: 'transfer', amountFils: 1_032_500, reference: 'SYN 0002' },
    });
    expect(sold.status).toBe(201);
    const purchase = (await sold.json()) as SellPackageResponse;

    const before = await summary();
    expect(before.cashCollectedFils).toBe(1_032_500);
    // Nothing delivered yet, so nothing earned. This is the whole point of the
    // three figures: a great cash month is not yet a great trading month.
    expect(before.revenueRecognisedFils).toBe(0);
    expect(before.deferredNetFils).toBe(1_032_500);

    await deliverVisit(clientId);
    const after = await summary();
    expect(after.cashCollectedFils).toBe(1_032_500);
    expect(after.revenueRecognisedFils).toBeGreaterThan(0);
    // What was earned and what is still owed come to what was allocated.
    expect(after.revenueRecognisedFils + after.deferredNetFils).toBe(1_032_500);
    expect(purchase.entitlements).toBe(18);
  });
});

describe('the figures reconcile to the ledger', () => {
  it('ties cash collected to the payments the ledger view holds', async () => {
    const figures = await summary();
    const { rows } = await h.owner.query<{ paid: string }>(
      'select coalesce(sum(-amount_fils), 0)::text as paid from app.billing_ledger ' +
        "where tenant_id = $1 and entry_kind = 'payment' " +
        "and to_char(occurred_on, 'YYYY-MM') = $2",
      [h.data.tenant.id, MONTH],
    );
    expect(figures.cashCollectedFils).toBe(Number(rows[0]?.paid));
  });

  it('accounts for every credit as either earned or still owed', async () => {
    const figures = await summary();
    const { rows } = await h.owner.query<{ allocated: string }>(
      'select coalesce(sum(allocated_net_fils), 0)::text as allocated from entitlement ' +
        "where tenant_id = $1 and status not in ('refunded', 'waived')",
      [h.data.tenant.id],
    );
    // Every credit the practice holds money against is in exactly one of the
    // two columns. A credit that fell between them would be revenue nobody
    // recognised and an obligation nobody counted.
    expect(figures.revenueRecognisedFils + figures.deferredNetFils).toBe(
      Number(rows[0]?.allocated),
    );
  });

  it("agrees with the client's own balance about what is deferred", async () => {
    // The money screen and the client's panel are two readings of one ledger,
    // and they must not be able to disagree.
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    const balance = (await res.json()) as BalanceResponse;
    const figures = await summary();
    expect(figures.deferredNetFils).toBe(balance.deferredNetFils);
    expect(figures.revenueRecognisedFils).toBe(balance.recognisedNetFils);
  });
});

describe('a session sold ahead of its visit', () => {
  /**
   * Task 4 of the walk-fixes round, step 2: the design's claim is that a
   * sold-ahead session's credit counts on the client's balance exactly as any
   * other credit does. `clientId(1)` is fresh in this file — the earlier
   * describe blocks' programme and visit are on `clientId(0)`, and the
   * previous block's own identities depend on that being the tenant's only
   * deferred credit, so this one runs after it rather than before.
   */
  it('shows one credit left, with no expiry, and charged by the gross', async () => {
    const clientId = h.clientId(1);
    const before = (await (
      await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner)
    ).json()) as BalanceResponse;
    expect(before.services.find((s) => s.serviceTypeCode === 'nf-session')).toBeUndefined();

    const sold = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
      clientId,
      serviceTypeId: h.serviceTypeId('nf-session'),
      purchasedOn: SEED_TODAY,
    });
    expect(sold.status).toBe(201);
    const sale = (await sold.json()) as SellSessionResponse;

    const after = (await (
      await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner)
    ).json()) as BalanceResponse;
    const service = after.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(service?.purchased).toBe(1);
    expect(service?.remaining).toBe(1);
    expect(service?.delivered).toBe(0);

    // No date at all. The twelve months this assertion used to expect came
    // from a constant in the code; the term is the price row's own now, and
    // the seeded price carries none, so the credit never expires (the
    // operator's ruling of 12 September 2026). A dated price is walked in
    // tests/billing/db/session_sales.test.ts.
    expect(sale.expiresOn).toBeNull();
    expect(service?.nextExpiryOn).toBeNull();

    // The same figure the sale itself answered, and "Charged" rose by exactly
    // it — a credit sold ahead of its visit counts on the money screen like
    // any other.
    expect(after.chargedFils - before.chargedFils).toBe(sale.grossFils);
  });
});

describe('the summary route', () => {
  it('answers zero for a month nothing happened in', async () => {
    const figures = await summary('2026-01');
    expect(figures.cashCollectedFils).toBe(0);
    expect(figures.revenueRecognisedFils).toBe(0);
    // The deferred balance is a position, not a period: it is what is owed now,
    // whichever month was asked about.
    expect(figures.deferredNetFils).toBeGreaterThan(0);
  });

  it('refuses a month that is not one', async () => {
    const res = await h.call('GET', '/api/billing/summary?month=2026-13', SEEDED.owner);
    expect(res.status).toBe(400);
  });

  it('is refused to a practitioner, who has no business with the practice’s takings', async () => {
    const res = await h.call('GET', '/api/billing/summary', SEEDED.practitioner);
    expect(res.status).toBe(403);
  });
});
