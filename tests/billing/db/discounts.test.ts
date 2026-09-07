import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  InvoicesResponse,
  PackageResponse,
  PackageRow,
  PackagesResponse,
  SellPackageResponse,
} from '../../../app/api/billing/ledger-schema';
import type { CreatePriceResponse, PricesResponse } from '../../../app/api/billing/schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { rolledBack } from '../../db/helpers';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * A discount, from the columns up (migration 409, docs/SPEC/billing.md
 * section 2.4). This file starts at the table — what the backfill left behind,
 * and which constraint refuses what — because a discount the database does not
 * itself hold to `list − discount` is a figure two readers can disagree about.
 */

// SEED_TODAY (2026-09-02) at 08:00 UTC is still 2026-09-02 in Asia/Dubai. The
// clock moves, because a price takes effect on its own day and this suite has
// to stand on the far side of one.
const SEED_TODAY_AT_EIGHT = '2026-09-02T08:00:00.000Z';
let clock = new Date(SEED_TODAY_AT_EIGHT);
const NOW = () => clock;

/** Runs `fn` with the practice's own clock on `day`, then puts it back. */
async function on<T>(day: string, fn: () => Promise<T>): Promise<T> {
  const before = clock;
  clock = new Date(`${day}T08:00:00.000Z`);
  try {
    return await fn();
  } finally {
    clock = before;
  }
}

const TOMORROW = '2026-09-03';
const THE_DAY_AFTER = '2026-09-04';

const STATEMENT_INVOICE_NUMBER = 90_001;

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

/**
 * The constraint that refused a statement, inside a savepoint so the
 * surrounding transaction survives. `rejectsWith` (tests/db/helpers.ts) proves
 * the SQLSTATE; a discount has several constraints answering the same
 * SQLSTATE, so these tests name the one they mean.
 */
async function refusedBy(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint expect_refusal');
  try {
    await client.query(sql, params);
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    expect(code).toBe('23514');
    return constraint ?? '';
  } finally {
    await client.query('rollback to savepoint expect_refusal');
  }
  throw new Error(`Expected a check violation: ${sql}`);
}

/** An invoice to hang a refused line off, inside a transaction nobody keeps. */
async function withStatementInvoice(fn: (invoiceId: string) => Promise<void>): Promise<void> {
  await rolledBack(h.owner, async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
        "net_fils, vat_fils, gross_fils) values ($1, $2, $3, 'statement', '2026-09-02', " +
        '0, 0, 0) returning id',
      [h.data.tenant.id, h.clientId(0), STATEMENT_INVOICE_NUMBER],
    );
    const invoiceId = rows[0]?.id;
    if (!invoiceId) throw new Error('The statement invoice was not written.');
    await fn(invoiceId);
  });
}

const LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
  'quantity, unit_net_fils, discount_fils, net_fils, vat_rate_basis_points, ' +
  'vat_setting_version, vat_fils, gross_fils) ' +
  "values ($1, $2, $3, 1, 'Neurofeedback session', 1, 70000, $4, $5, 0, 1, 0, $5)";

const PRICE_SQL =
  'insert into price (tenant_id, service_type_id, list_price_fils, discount_fils, ' +
  'discount_basis_points, unit_price_fils, vat_rate_basis_points, vat_setting_version, ' +
  "valid_from, amendment_reason) values ($1, $2, 70000, $3, $4, $5, 500, 1, '2027-01-01', " +
  "'A price this suite writes and never keeps.')";

const PACKAGE_PRICE_SQL =
  'insert into package_price (tenant_id, package_id, list_price_fils, discount_fils, ' +
  'amount_fils, vat_rate_basis_points, vat_setting_version, valid_from, amendment_reason) ' +
  "values ($1, $2, 1215000, 182500, $3, 500, 1, '2027-01-01', " +
  "'A price this suite writes and never keeps.')";

async function silverPackageId(): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    "select id from package where code = 'silver' and tenant_id = $1",
    [h.data.tenant.id],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The seeded Silver programme is missing.');
  return id;
}

describe('the backfill', () => {
  it('carries every existing price forward as its own list figure with no discount', async () => {
    const { rows } = await h.owner.query<{ total: string; plain: string }>(
      'select count(*)::text as total, ' +
        'count(*) filter (where list_price_fils = unit_price_fils and discount_fils = 0 ' +
        'and discount_basis_points is null)::text as plain from price',
    );
    expect(Number(rows[0]?.total)).toBeGreaterThan(0);
    expect(rows[0]?.plain).toBe(rows[0]?.total);
  });

  it('carries the launch package prices forward as list minus the difference', async () => {
    const { rows } = await h.owner.query<{
      list_price_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      amount_fils: number;
    }>(
      'select pp.list_price_fils, pp.discount_fils, pp.discount_basis_points, pp.amount_fils ' +
        'from package_price pp join package p on p.id = pp.package_id ' +
        "where p.code = 'silver' and p.tenant_id = $1",
      [h.data.tenant.id],
    );
    expect(rows[0]).toEqual({
      list_price_fils: 1_215_000,
      discount_fils: 182_500,
      discount_basis_points: null,
      amount_fils: 1_032_500,
    });
  });
});

describe('an invoice line', () => {
  it('refuses an invoice line whose net is not quantity times unit less discount', async () => {
    await withStatementInvoice(async (invoiceId) => {
      // A fils out is still out: the line's arithmetic is the database's too.
      expect(
        await refusedBy(h.owner, LINE_SQL, [
          h.data.tenant.id,
          invoiceId,
          h.clientId(0),
          10_500,
          59_501,
        ]),
      ).toBe('invoice_line_net_is_quantity_times_unit_less_discount');
      await h.owner.query(LINE_SQL, [h.data.tenant.id, invoiceId, h.clientId(0), 10_500, 59_500]);
    });
  });

  it('refuses a discount larger than the line', async () => {
    await withStatementInvoice(async (invoiceId) => {
      expect(
        await refusedBy(h.owner, LINE_SQL, [
          h.data.tenant.id,
          invoiceId,
          h.clientId(0),
          70_001,
          -1,
        ]),
      ).toBe('invoice_line_discount_within_line');
    });
  });
});

describe('the price list', () => {
  it('refuses a price whose unit is not list less discount', async () => {
    await rolledBack(h.owner, async () => {
      const serviceTypeId = h.serviceTypeId('nf-session');
      expect(
        await refusedBy(h.owner, PRICE_SQL, [
          h.data.tenant.id,
          serviceTypeId,
          10_500,
          1500,
          59_499,
        ]),
      ).toBe('price_unit_is_list_less_discount');
      await h.owner.query(PRICE_SQL, [h.data.tenant.id, serviceTypeId, 10_500, 1500, 59_500]);
    });
  });

  it('refuses a package price whose amount is not list less discount', async () => {
    await rolledBack(h.owner, async () => {
      const packageId = await silverPackageId();
      expect(
        await refusedBy(h.owner, PACKAGE_PRICE_SQL, [h.data.tenant.id, packageId, 1_032_499]),
      ).toBe('package_price_amount_is_list_less_discount');
      await h.owner.query(PACKAGE_PRICE_SQL, [h.data.tenant.id, packageId, 1_032_500]);
    });
  });

  it('refuses a discount percentage outside nought to a hundred', async () => {
    await rolledBack(h.owner, async () => {
      const serviceTypeId = h.serviceTypeId('nf-session');
      expect(
        await refusedBy(h.owner, PRICE_SQL, [
          h.data.tenant.id,
          serviceTypeId,
          10_500,
          10_001,
          59_500,
        ]),
      ).toBe('price_discount_percent_range');
    });
  });
});

describe('POST /api/billing/prices', () => {
  it('records a percentage discount on a service price and charges the net', async () => {
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('nf-session'),
      listPriceFils: 70_000,
      discount: { kind: 'percent', basisPoints: 1500 },
      validFrom: TOMORROW,
      amendmentReason: 'Launch discount of fifteen per cent off the session price.',
    });
    expect(res.status).toBe(201);
    const { price } = (await res.json()) as CreatePriceResponse;
    expect(price.listPriceFils).toBe(70_000);
    expect(price.discountFils).toBe(10_500);
    expect(price.discountBasisPoints).toBe(1500);
    expect(price.unitPriceFils).toBe(59_500);

    // And the list says the same on the day the price starts.
    const listed = await on(TOMORROW, () => h.call('GET', '/api/billing/prices', SEEDED.owner));
    const row = ((await listed.json()) as PricesResponse).prices.find(
      (p) => p.serviceTypeCode === 'nf-session',
    );
    expect(row).toMatchObject({
      listPriceFils: 70_000,
      discountFils: 10_500,
      discountBasisPoints: 1500,
      unitPriceFils: 59_500,
    });
  });

  it('records a sum discount with no percentage', async () => {
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('brain-map'),
      listPriceFils: 82_500,
      discount: { kind: 'amount', fils: 7_500 },
      validFrom: TOMORROW,
      amendmentReason: 'A flat AED 75 off the brain map for the launch.',
    });
    expect(res.status).toBe(201);
    const { price } = (await res.json()) as CreatePriceResponse;
    expect(price.discountFils).toBe(7_500);
    expect(price.discountBasisPoints).toBeNull();
    expect(price.unitPriceFils).toBe(75_000);
  });

  it('refuses a discount larger than the list price', async () => {
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('consultation'),
      listPriceFils: 70_000,
      discount: { kind: 'amount', fils: 70_001 },
      validFrom: THE_DAY_AFTER,
      amendmentReason: 'A discount larger than the price it comes off.',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'discount_too_large' });
  });

  it('still accepts the older body, reading unitPriceFils as a list with nothing off it', async () => {
    // The accounting stream writes the practice's prices through this route
    // from fixtures billing does not own (docs/SPEC/OWNERSHIP.md).
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('results-call'),
      unitPriceFils: 12_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'The older body, still a price with nothing off it.',
    });
    expect(res.status).toBe(201);
    const { price } = (await res.json()) as CreatePriceResponse;
    expect(price).toMatchObject({
      listPriceFils: 12_000,
      discountFils: 0,
      discountBasisPoints: null,
      unitPriceFils: 12_000,
    });
  });

  it('refuses a discount sent beside the older unitPriceFils, which would name two figures', async () => {
    const res = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('discovery-call'),
      unitPriceFils: 12_000,
      discount: { kind: 'percent', basisPoints: 1000 },
      validFrom: SEED_TODAY,
      amendmentReason: 'Two names for one figure, which is one too many.',
    });
    expect(res.status).toBe(400);
  });
});

describe('the bundle catalogue', () => {
  const PERCENT_CODE = 'gold-at-fifteen-off';
  const SUM_CODE = 'platinum-at-a-sum-off';
  const REFUSED_CODE = 'a-bundle-priced-below-nothing';

  function bundle(code: string, name: string, listPriceFils: number, price: unknown) {
    return {
      code,
      name,
      listPriceFils,
      expiryMonths: 12,
      components: [
        { serviceTypeId: h.serviceTypeId('consultation'), quantity: 1 },
        { serviceTypeId: h.serviceTypeId('brain-map'), quantity: 2 },
        { serviceTypeId: h.serviceTypeId('nf-session'), quantity: 15 },
      ],
      price,
    };
  }

  it('prices a package by a percentage off its list price', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      bundle(PERCENT_CODE, 'Gold at fifteen off', 1_215_000, {
        discount: { kind: 'percent', basisPoints: 1500 },
        validFrom: SEED_TODAY,
        amendmentReason: 'Fifteen per cent off the list for the launch.',
      }),
    );
    expect(res.status).toBe(201);
    const { package: created } = (await res.json()) as PackageResponse;
    expect(created.currentPrice).toMatchObject({
      listPriceFils: 1_215_000,
      discountFils: 182_250,
      discountBasisPoints: 1500,
      amountFils: 1_032_750,
    });
  });

  it('adds a package price by a sum off the list price and snapshots the list', async () => {
    const created = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      bundle(SUM_CODE, 'Platinum at a sum off', 1_215_000, {
        discount: { kind: 'amount', fils: 100_000 },
        validFrom: SEED_TODAY,
        amendmentReason: 'A flat AED 1,000 off to open with.',
      }),
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as PackageResponse).package.id;

    const res = await h.call('POST', `/api/billing/packages/${id}/price`, SEEDED.owner, {
      discount: { kind: 'amount', fils: 200_000 },
      validFrom: TOMORROW,
      amendmentReason: 'Deepening the launch discount for the second week.',
    });
    expect(res.status).toBe(201);
    const { rows } = await h.owner.query<{
      list_price_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      amount_fils: number;
    }>(
      'select list_price_fils, discount_fils, discount_basis_points, amount_fils ' +
        'from package_price where package_id = $1 and valid_from = $2',
      [id, TOMORROW],
    );
    expect(rows[0]).toEqual({
      list_price_fils: 1_215_000,
      discount_fils: 200_000,
      discount_basis_points: null,
      amount_fils: 1_015_000,
    });
  });

  it('refuses a package discount larger than the list price, leaving nothing behind', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      bundle(REFUSED_CODE, 'A bundle priced below nothing', 1_215_000, {
        discount: { kind: 'amount', fils: 1_215_001 },
        validFrom: SEED_TODAY,
        amendmentReason: 'A discount larger than the list it comes off.',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'discount_too_large' });
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from package where code = $1',
      [REFUSED_CODE],
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('a sale', () => {
  /** The seeded Silver programme: list AED 12,150, launch AED 10,325. */
  async function seededSilver(): Promise<PackageRow> {
    const res = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const found = ((await res.json()) as PackagesResponse).packages.find(
      (p) => p.code === 'silver',
    );
    if (!found) throw new Error('The seeded Silver programme is missing.');
    return found;
  }

  async function lineFor(purchaseId: string) {
    const { rows } = await h.owner.query<{
      unit_net_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      net_fils: number;
      invoice_net_fils: number;
    }>(
      'select l.unit_net_fils, l.discount_fils, l.discount_basis_points, l.net_fils, ' +
        'i.net_fils as invoice_net_fils from invoice_line l join invoice i on i.id = l.invoice_id ' +
        'where i.package_purchase_id = $1',
      [purchaseId],
    );
    return rows[0];
  }

  async function creditTotal(purchaseId: string): Promise<number> {
    const { rows } = await h.owner.query<{ total: string }>(
      'select coalesce(sum(allocated_net_fils), 0)::text as total from entitlement ' +
        'where package_purchase_id = $1',
      [purchaseId],
    );
    return Number(rows[0]?.total);
  }

  it("sells at the list price less the price list's own discount when no extra is given", async () => {
    const silver = await seededSilver();
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
    });
    expect(res.status).toBe(201);
    const { purchase } = (await res.json()) as SellPackageResponse;
    expect(purchase).toMatchObject({
      netFils: 1_032_500,
      listPriceFils: 1_215_000,
      discountFils: 182_500,
      discountBasisPoints: null,
      discountReason: null,
    });
    expect(await lineFor(purchase.id)).toEqual({
      unit_net_fils: 1_215_000,
      discount_fils: 182_500,
      discount_basis_points: null,
      net_fils: 1_032_500,
      invoice_net_fils: 1_032_500,
    });
    // The credits total the net exactly, which is what the deferred check in
    // 403_billing_entitlement.sql refuses a sale for failing.
    expect(await creditTotal(purchase.id)).toBe(1_032_500);
  });

  it('gives an extra discount at the sale, combined into one line, with a reason', async () => {
    const silver = await seededSilver();
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(1),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'amount', fils: 50_000 },
        reason: 'Sibling of an existing client.',
      },
    });
    expect(res.status).toBe(201);
    const { purchase } = (await res.json()) as SellPackageResponse;
    expect(purchase).toMatchObject({
      netFils: 982_500,
      listPriceFils: 1_215_000,
      discountFils: 232_500,
      discountBasisPoints: null,
      discountReason: 'Sibling of an existing client.',
    });
    expect(await lineFor(purchase.id)).toEqual({
      unit_net_fils: 1_215_000,
      discount_fils: 232_500,
      discount_basis_points: null,
      net_fils: 982_500,
      invoice_net_fils: 982_500,
    });
    expect(await creditTotal(purchase.id)).toBe(982_500);

    const book = await h.call('GET', '/api/billing/invoices', SEEDED.owner);
    const invoices = ((await book.json()) as InvoicesResponse).invoices;
    expect(invoices.find((i) => i.id === purchase.invoiceId)?.discountFils).toBe(232_500);
  });

  it('combines two percentages into one applied once', async () => {
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const bundle = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === 'gold-at-fifteen-off',
    );
    if (!bundle) throw new Error('The fifteen-per-cent bundle is missing.');
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: bundle.id,
      clientId: h.clientId(2),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'percent', basisPoints: 500 },
        reason: 'Agreed with the family at the consultation.',
      },
    });
    expect(res.status).toBe(201);
    const { purchase } = (await res.json()) as SellPackageResponse;
    // Twenty per cent of the list, once: never fifteen and then five per cent
    // of an already discounted figure, and never two roundings.
    expect(purchase).toMatchObject({
      netFils: 972_000,
      discountFils: 243_000,
      discountBasisPoints: 2000,
    });
  });

  it('refuses an extra discount without a reason', async () => {
    const silver = await seededSilver();
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(4),
      purchasedOn: SEED_TODAY,
      extraDiscount: { discount: { kind: 'amount', fils: 50_000 }, reason: '' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('refuses an extra discount that takes the price below nothing', async () => {
    const silver = await seededSilver();
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(4),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'amount', fils: 1_100_000 },
        reason: 'A discount larger than what is left of the list.',
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'discount_too_large' });
  });

  it('replays the same sale, discount included, for the same idempotency key', async () => {
    const silver = await seededSilver();
    const body = {
      packageId: silver.id,
      clientId: h.clientId(5),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'percent', basisPoints: 200 },
        reason: 'Paid the whole programme up front.',
      },
    };
    const key = { 'idempotency-key': '0000000d-0000-4000-8000-000000000001' };
    const first = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, body, key);
    const second = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const one = (await first.json()) as SellPackageResponse;
    const two = (await second.json()) as SellPackageResponse;
    expect(two.purchase.id).toBe(one.purchase.id);
    expect(two.purchase).toMatchObject({
      discountFils: one.purchase.discountFils,
      discountBasisPoints: one.purchase.discountBasisPoints,
      discountReason: one.purchase.discountReason,
    });
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from package_purchase where client_id = $1',
      [h.clientId(5)],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('refuses an extra discount from a role that may not give one, at both doors', async () => {
    // A practitioner may not sell at all (maySell) and may not discount
    // (mayDiscount); either refusal is the same 403, and the sale is refused
    // whichever of the two is asked first.
    const silver = await seededSilver();
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.practitioner, {
      packageId: silver.id,
      clientId: h.clientId(6),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'amount', fils: 50_000 },
        reason: 'A discount from somebody who may not give one.',
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('a visit charged by itself', () => {
  it("charges a single visit at the list figure less the price row's own discount", async () => {
    // The trigger reads the practice's own clock, not this suite's, so the
    // price it charges at must be in force on the real day — as
    // tests/billing/db/consumption.test.ts already relies on. Dated the seed's
    // own today for that reason.
    const priced = await h.call('POST', '/api/billing/prices', SEEDED.owner, {
      serviceTypeId: h.serviceTypeId('consultation'),
      listPriceFils: 70_000,
      discount: { kind: 'percent', basisPoints: 1500 },
      validFrom: SEED_TODAY,
      amendmentReason: 'A consultation sold on its own, at fifteen per cent off.',
    });
    expect(priced.status).toBe(201);

    // The same transaction settings the request-context middleware stamps, as
    // the seeded practitioner closing their own visit: the charge reads the
    // tenant off them (app.current_tenant_id), so an unstamped connection
    // would find no price and queue an exception instead.
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
        "set_config('app.actor_roles', 'practitioner', false), " +
        "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
      [
        h.data.tenant.id,
        h.data.users[SEEDED.practitioner]?.id ?? null,
        '00000000-0000-4000-8000-0000000000ee',
      ],
    );

    const clientId = h.clientId(9);
    const sessionId = '0000000e-0000-4000-8000-000000000001';
    await h.owner.query(
      'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
        "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', " +
        "'in_progress', now())",
      [
        sessionId,
        h.data.tenant.id,
        clientId,
        h.data.practitioners[0]?.id,
        h.serviceTypeId('consultation'),
      ],
    );
    await h.owner.query("update session set status = 'completed' where id = $1", [sessionId]);
    // And the connection is handed back as it was found.
    await h.owner.query(
      "select set_config('app.tenant_id', '', false), set_config('app.actor_id', '', false), " +
        "set_config('app.actor_roles', '', false), set_config('app.request_id', '', false), " +
        "set_config('app.reason', '', false)",
    );

    const { rows } = await h.owner.query<{
      unit_net_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      net_fils: number;
      invoice_net_fils: number;
      allocated_net_fils: number;
    }>(
      'select l.unit_net_fils, l.discount_fils, l.discount_basis_points, l.net_fils, ' +
        'i.net_fils as invoice_net_fils, e.allocated_net_fils ' +
        'from invoice i join invoice_line l on l.invoice_id = i.id ' +
        'join entitlement e on e.invoice_id = i.id where i.session_id = $1',
      [sessionId],
    );
    expect(rows[0]).toEqual({
      unit_net_fils: 70_000,
      discount_fils: 10_500,
      discount_basis_points: 1500,
      net_fils: 59_500,
      invoice_net_fils: 59_500,
      allocated_net_fils: 59_500,
    });
  });
});
