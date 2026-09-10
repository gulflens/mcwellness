import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BalanceResponse,
  PackageResponse,
  PackagesResponse,
  SellPackageResponse,
} from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  GOLD_CODE,
  SEEDED,
  setPracticePrices,
  setPracticeVatRegistration,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The bundle catalogue and a sale, end to end: the practice's own Silver
 * package, sold to a synthetic family, and every figure it leaves behind.
 */

// SEED_TODAY (2026-09-02) at 08:00 UTC is still 2026-09-02 in Asia/Dubai.
const NOW = () => new Date('2026-09-02T08:00:00.000Z');

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
});

afterAll(async () => {
  await h.close();
});

/** What each bundle price is stamped with, read from the table, not the route. */
async function stampedPackagePrices(): Promise<Record<string, string>> {
  const { rows } = await h.owner.query<{
    id: string;
    vat_rate_basis_points: number;
    vat_setting_version: number;
  }>('select id, vat_rate_basis_points, vat_setting_version from package_price');
  return Object.fromEntries(
    rows.map((row) => [row.id, `${row.vat_rate_basis_points}/${row.vat_setting_version}`]),
  );
}

describe('the bundle catalogue', () => {
  it('holds whatever the practice sells, and nothing this suite has not added yet', async () => {
    // The seed carries the practice's own three programmes on one database
    // and nothing at all on another, so what is asserted is the invariant
    // that holds either way: the catalogue reads, every bundle in it is
    // priced coherently, and the one this suite is about to create is not
    // there yet.
    const res = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    expect(res.status).toBe(200);
    const { packages } = (await res.json()) as PackagesResponse;
    expect(packages.some((p) => p.code === SILVER_CODE)).toBe(false);
    for (const bundle of packages) {
      expect(bundle.listPriceFils).toBeGreaterThanOrEqual(0);
      if (bundle.currentPrice) {
        expect(bundle.currentPrice.grossFils).toBe(
          bundle.currentPrice.amountFils + bundle.currentPrice.vatFils,
        );
      }
    }
  });

  it('refuses a practitioner, who neither sees nor sets what the practice sells', async () => {
    expect((await h.call('GET', '/api/billing/packages', SEEDED.practitioner)).status).toBe(403);
    expect(
      (
        await h.call(
          'POST',
          '/api/billing/packages',
          SEEDED.practitioner,
          silverInput(h, SEED_TODAY),
        )
      ).status,
    ).toBe(403);
  });

  it('takes the list price and the launch price as two separate figures', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      silverInput(h, SEED_TODAY),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as PackageResponse;

    // AED 12,150 published, AED 10,325 charged. Neither is derived from the
    // other. The founder's decision of 2026-09-03 — that no discount
    // percentage is stored anywhere — was amended by the operator on
    // 2026-09-07 (docs/SPEC/billing.md section 2.4): the price row names the
    // gap between the two as a discount, and this one is a sum, so there is
    // still no percentage to store.
    expect(body.package.listPriceFils).toBe(1_215_000);
    expect(body.package.currentPrice).toMatchObject({
      listPriceFils: 1_215_000,
      discountFils: 182_500,
      discountBasisPoints: null,
      amountFils: 1_032_500,
    });
    // The same sum done against the practice's own price list agrees with the
    // figure the founder published.
    expect(body.package.componentsTotalFils).toBe(1_215_000);
    expect(body.package.sellable).toBe(true);
    expect(body.package.expiryMonths).toBe(12);
  });

  it('charges no VAT while the practice is not registered, so the total is the price', async () => {
    await setPracticeVatRegistration(h, false);
    const res = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const body = (await res.json()) as PackagesResponse;
    const silver = body.packages.find((p) => p.code === SILVER_CODE);

    expect(body.vatRegistered).toBe(false);
    // The rate the price row was written under is still on it — what the
    // standard rate was on the day — and nothing is charged at it.
    expect(silver?.currentPrice?.vatRateBasisPoints).toBe(500);
    expect(silver?.currentPrice?.vatFils).toBe(0);
    expect(silver?.currentPrice?.grossFils).toBe(1_032_500);
  });

  it('adds VAT on top of the same net price once the practice registers, restamping nothing', async () => {
    await setPracticeVatRegistration(h, false);
    const before = (await (
      await h.call('GET', '/api/billing/packages', SEEDED.owner)
    ).json()) as PackagesResponse;
    const stampedBefore = await stampedPackagePrices();

    try {
      await setPracticeVatRegistration(h, true);
      const after = (await (
        await h.call('GET', '/api/billing/packages', SEEDED.owner)
      ).json()) as PackagesResponse;
      const silver = after.packages.find((p) => p.code === SILVER_CODE);

      expect(after.vatRegistered).toBe(true);
      expect(silver?.currentPrice?.amountFils).toBe(1_032_500);
      expect(silver?.currentPrice?.vatRateBasisPoints).toBe(500);
      expect(silver?.currentPrice?.vatFils).toBe(51_625); // 5% of 1,032,500
      expect(silver?.currentPrice?.grossFils).toBe(1_084_125);
      // Registering changes what is charged and nothing that was stamped: the
      // rate and the setting version on every price row are the ones they were
      // written with, on both reads.
      expect(await stampedPackagePrices()).toEqual(stampedBefore);
      expect(after.packages.map((p) => [p.id, p.currentPrice?.vatRateBasisPoints])).toEqual(
        before.packages.map((p) => [p.id, p.currentPrice?.vatRateBasisPoints]),
      );
    } finally {
      // Whatever happened above, the practice this suite sells under is the
      // real one: unregistered. A failed assertion must not leave a
      // registration behind for the sale below to charge under.
      await setPracticeVatRegistration(h, false);
    }
  });

  it('lists the contents with what each costs on its own', async () => {
    const res = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await res.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    expect(
      silver?.components.map((c) => [c.serviceTypeCode, c.quantity, c.standaloneNetFils]),
    ).toEqual([
      ['consultation', 1, 0],
      ['brain-map', 2, 82_500],
      ['nf-session', 15, 70_000],
    ]);
  });

  it('refuses a second bundle under a code the practice already uses', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      silverInput(h, SEED_TODAY),
    );
    expect(res.status).toBe(409);
  });

  it('refuses a bundle naming the same service twice', async () => {
    const input = silverInput(h, SEED_TODAY);
    const res = await h.call('POST', '/api/billing/packages', SEEDED.owner, {
      ...input,
      code: 'silver-twice',
      components: [
        { serviceTypeId: h.serviceTypeId('nf-session'), quantity: 5 },
        { serviceTypeId: h.serviceTypeId('nf-session'), quantity: 5 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('lets an admin, not only the owner, add a bundle', async () => {
    const input = silverInput(h, SEED_TODAY);
    const res = await h.call('POST', '/api/billing/packages', SEEDED.admin, {
      ...input,
      code: GOLD_CODE,
      name: 'Gold',
      nameAr: 'الذهبية',
      listPriceFils: 1_997_500,
      components: [
        { serviceTypeId: h.serviceTypeId('consultation'), quantity: 2 },
        { serviceTypeId: h.serviceTypeId('brain-map'), quantity: 3 },
        { serviceTypeId: h.serviceTypeId('nf-session'), quantity: 25 },
      ],
      price: { ...input.price, discount: { kind: 'amount' as const, fils: 300_000 } },
    });
    expect(res.status).toBe(201);
  });

  it('leaves nothing behind when the price is refused', async () => {
    // The whole request runs in one transaction, but the request-context
    // middleware commits anything below a 500 — so a 400 returned after the
    // package and its components were written committed them anyway. The
    // founder was told her date was wrong and left with a nameless bundle
    // holding the code she wanted, so trying again answered "that code is
    // taken". The price is settled before the first insert now.
    const input = silverInput(h, SEED_TODAY);
    const refused = await h.call('POST', '/api/billing/packages', SEEDED.owner, {
      ...input,
      code: 'half-made',
      name: 'Half made',
      price: { ...input.price, validFrom: '2020-01-01' },
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe('date_not_future');

    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from package where code = 'half-made'",
    );
    expect(Number(rows[0]?.n)).toBe(0);

    // And the code is free, which is the thing the founder actually needs.
    const second = await h.call('POST', '/api/billing/packages', SEEDED.owner, {
      ...input,
      code: 'half-made',
      name: 'Half made',
    });
    expect(second.status).toBe(201);
  });

  it('will not sell a bundle whose service has no price of its own', async () => {
    const res = await h.call('POST', '/api/billing/packages', SEEDED.owner, {
      ...silverInput(h, SEED_TODAY),
      code: 'unpriced-bundle',
      name: 'Compassionate Inquiry course',
      nameAr: null,
      listPriceFils: 300_000,
      components: [{ serviceTypeId: h.serviceTypeId('compassionate-inquiry'), quantity: 6 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PackageResponse;
    // Compassionate Inquiry carries no price row, so a share of the package
    // price cannot honestly be worked out for it.
    expect(body.package.sellable).toBe(false);
    expect(body.package.componentsTotalFils).toBeNull();
  });

  it('appends a new price rather than editing the one a family was shown', async () => {
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    const res = await h.call('POST', `/api/billing/packages/${silver?.id}/price`, SEEDED.owner, {
      amountFils: 1_100_000,
      validFrom: '2026-12-01',
      amendmentReason: 'Launch pricing ends.',
    });
    expect(res.status).toBe(201);
    // Dated in the future, so today's list still shows the launch price.
    const after = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const stillSilver = ((await after.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    expect(stillSilver?.currentPrice?.amountFils).toBe(1_032_500);

    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from package_price where package_id = $1',
      [silver?.id],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('refuses to backdate a price a family may already have been quoted', async () => {
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    const res = await h.call('POST', `/api/billing/packages/${silver?.id}/price`, SEEDED.owner, {
      amountFils: 900_000,
      validFrom: '2026-01-01',
      amendmentReason: 'Trying to backdate.',
    });
    expect(res.status).toBe(400);
  });
});

describe('selling a Silver package', () => {
  let silverId: string;
  let purchaseId: string;

  beforeAll(async () => {
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    if (!silver) throw new Error('Silver was not created.');
    silverId = silver.id;
  });

  it('refuses a practitioner: reading a balance is one thing, selling is another', async () => {
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.practitioner, {
      packageId: silverId,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
    });
    expect(res.status).toBe(403);
  });

  it('writes the purchase, the invoice and eighteen credits in one go', async () => {
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silverId,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
      payment: { method: 'transfer', amountFils: 1_032_500, reference: 'Bank transfer' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SellPackageResponse;
    purchaseId = body.purchase.id;

    expect(body.purchase.netFils).toBe(1_032_500);
    // No VAT: the practice is not registered for it, so the family pays the
    // net price the list showed them (migration 406).
    expect(body.purchase.vatFils).toBe(0);
    expect(body.purchase.grossFils).toBe(1_032_500);
    expect(body.purchase.listPriceFils).toBe(1_215_000);
    // Twelve months from the day of purchase (the founder's decision).
    expect(body.purchase.expiresOn).toBe('2027-09-02');
    expect(body.invoiceReference).toBe('INV-000001');
    expect(body.entitlements).toBe(18);
  });

  it('gives every credit its share of what was paid, to the fils', async () => {
    const { rows } = await h.owner.query<{ total: string; n: string }>(
      'select coalesce(sum(allocated_net_fils), 0)::text as total, count(*)::text as n ' +
        'from entitlement where package_purchase_id = $1',
      [purchaseId],
    );
    expect(Number(rows[0]?.n)).toBe(18);
    expect(Number(rows[0]?.total)).toBe(1_032_500);
  });

  it('allocates by what each service costs on its own, not by dividing the price', async () => {
    const { rows } = await h.owner.query<{ code: string; allocated_net_fils: number; n: string }>(
      'select st.code, e.allocated_net_fils, count(*)::text as n from entitlement e ' +
        'join service_type st on st.id = e.service_type_id where e.package_purchase_id = $1 ' +
        'group by st.code, e.allocated_net_fils order by st.code, e.allocated_net_fils desc',
      [purchaseId],
    );
    expect(rows).toEqual([
      { code: 'brain-map', allocated_net_fils: 70_108, n: '2' },
      { code: 'consultation', allocated_net_fils: 0, n: '1' },
      // Nine fils of rounding remainder go to the nine credits that lost the
      // most to it; the price divided by fifteen would have been 68,833.
      { code: 'nf-session', allocated_net_fils: 59_486, n: '9' },
      { code: 'nf-session', allocated_net_fils: 59_485, n: '6' },
    ]);
  });

  it('writes one invoice with one line, and the payment against it', async () => {
    const { rows: invoices } = await h.owner.query<{
      reference: string;
      kind: string;
      net_fils: number;
      vat_fils: number;
      gross_fils: number;
      documents: number;
    }>(
      'select i.reference, i.kind, i.net_fils, i.vat_fils, i.gross_fils, ' +
        // The rendered PDF hangs off `billing_document` and never off the
        // invoice row: an invoice grants no update, so a column on it could
        // only be filled at insert time and the PDF does not exist then
        // (migration 407). `invoice.document_id` was the column that tried,
        // and the trunk dropped it in migration 954; this is what replaced
        // the assertion that it stayed null.
        '  (select count(*)::int from billing_document b where b.invoice_id = i.id) as documents ' +
        'from invoice i where i.package_purchase_id = $1',
      [purchaseId],
    );
    expect(invoices).toEqual([
      {
        reference: 'INV-000001',
        kind: 'package',
        net_fils: 1_032_500,
        vat_fils: 0,
        gross_fils: 1_032_500,
        documents: 0,
      },
    ]);

    const { rows: lines } = await h.owner.query<{
      description: string;
      description_ar: string | null;
      quantity: number;
    }>(
      'select l.description, l.description_ar, l.quantity from invoice_line l ' +
        'join invoice i on i.id = l.invoice_id where i.package_purchase_id = $1',
      [purchaseId],
    );
    // The term said on the invoice line, in both languages
    // (docs/PLAN/package-terms.md): this suite's own Silver is built by
    // silverInput() at twelve months, not the seed's new six, so the words
    // are the fixture's own term and not the operator's headline figure.
    expect(lines).toEqual([
      { description: 'Silver, 12 months', description_ar: 'الفضية، 12 شهرًا', quantity: 1 },
    ]);

    const { rows: payments } = await h.owner.query<{ method: string; amount_fils: number }>(
      'select p.method, p.amount_fils from payment p join invoice i on i.id = p.invoice_id ' +
        'where i.package_purchase_id = $1',
      [purchaseId],
    );
    expect(payments).toEqual([{ method: 'transfer', amount_fils: 1_032_500 }]);
  });

  it('shows the family fifteen sessions to come and nothing owed', async () => {
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BalanceResponse;

    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.purchased).toBe(15);
    expect(sessions?.delivered).toBe(0);
    expect(sessions?.remaining).toBe(15);
    expect(body.nextExpiryOn).toBe('2027-09-02');
    expect(body.expiryWarning).toBe('none');
    // Charged and paid in the same breath, so the family owes nothing.
    expect(body.chargedFils).toBe(1_032_500);
    expect(body.paidFils).toBe(1_032_500);
    expect(body.outstandingFils).toBe(0);
    expect(body.purchases).toHaveLength(1);
  });

  it('refuses to change what a bundle contains once a family has bought it', async () => {
    // 403_billing_entitlement.sql's guard: the composition a client was sold
    // is history. SQLSTATE 23001, restrict_violation.
    await expect(
      h.owner.query('delete from package_component where package_id = $1', [silverId]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('will not sell a bundle that no longer has a price it can be sold at', async () => {
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const unpriced = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === 'unpriced-bundle',
    );
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: unpriced?.id,
      clientId: h.clientId(1),
      purchasedOn: SEED_TODAY,
    });
    expect(res.status).toBe(422);
  });

  it('will not record a sale that has not happened yet', async () => {
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silverId,
      clientId: h.clientId(1),
      purchasedOn: '2027-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('will not sell to a client of another practice, or to nobody', async () => {
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silverId,
      clientId: '00000000-0000-4000-8000-0000000000ff',
      purchasedOn: SEED_TODAY,
    });
    expect(res.status).toBe(404);
  });
});

describe('the exact-sum guard in the database', () => {
  it('refuses credits that do not total what was paid, whatever wrote them', async () => {
    const { rows } = await h.owner.query<{ id: string; net_fils: number; client_id: string }>(
      'select id, net_fils, client_id from package_purchase limit 1',
    );
    const purchase = rows[0];
    if (!purchase) throw new Error('No purchase to test against.');

    await h.owner.query('begin');
    try {
      await h.owner.query(
        'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
          'package_purchase_id, allocated_net_fils, vat_rate_basis_points, vat_setting_version) ' +
          "select tenant_id, client_id, service_type_id, 'package', $1, 1, 500, 1 " +
          'from entitlement where package_purchase_id = $1 limit 1',
        [purchase.id],
      );
      // Deferred to commit, so this is where it fails: a nineteenth credit
      // pushes the total one fils past what the family paid.
      await expect(h.owner.query('commit')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await h.owner.query('rollback');
    }
  });
});

/**
 * The sale the Sell drawer makes: it sends `price.grossFils` from this very
 * route as `payment.amountFils`, "what the family actually hands over". While
 * the catalogue answered with the stamped rate applied, that was the net price
 * plus five per cent against an invoice charging none, and every package sold
 * with payment taken left a five per cent overpayment on the family's balance.
 */
describe('taking payment for exactly what the catalogue showed', () => {
  it('records a payment equal to the invoice, and the family owes nothing', async () => {
    await setPracticeVatRegistration(h, false);
    const listed = (await (
      await h.call('GET', '/api/billing/packages', SEEDED.owner)
    ).json()) as PackagesResponse;
    expect(listed.vatRegistered).toBe(false);
    const gold = listed.packages.find((p) => p.code === GOLD_CODE);
    const grossFils = gold?.currentPrice?.grossFils;
    if (!gold || grossFils === undefined) {
      throw new Error('Gold was not in the catalogue with a price.');
    }

    const clientId = h.clientId(3);
    const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: gold.id,
      clientId,
      purchasedOn: SEED_TODAY,
      payment: { method: 'transfer', amountFils: grossFils, reference: null },
    });
    expect(sold.status).toBe(201);
    const body = (await sold.json()) as SellPackageResponse;

    const { rows } = await h.owner.query<{ amount_fils: number; gross_fils: number }>(
      'select p.amount_fils, i.gross_fils from payment p join invoice i on i.id = p.invoice_id ' +
        'where i.package_purchase_id = $1',
      [body.purchase.id],
    );
    expect(rows).toEqual([{ amount_fils: 1_697_500, gross_fils: 1_697_500 }]);

    const balance = (await (
      await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner)
    ).json()) as BalanceResponse;
    expect(balance.chargedFils).toBe(1_697_500);
    expect(balance.paidFils).toBe(1_697_500);
    expect(balance.outstandingFils).toBe(0);
  });
});
