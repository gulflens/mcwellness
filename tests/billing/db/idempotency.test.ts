import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  PackagesResponse,
  RecordPaymentResponse,
  SellPackageResponse,
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
 * The same press twice.
 *
 * A sale writes a purchase, an invoice with its number, a line, fifteen-odd
 * credits and often a payment, into tables that grant neither update nor
 * delete. A payment writes into one of them. So a retried request — a double
 * tap, a lost response, a phone that changed network — used to leave a second
 * sale on a family's record with no way to take it back but a credit note
 * that does not exist yet.
 *
 * The drawer makes an `Idempotency-Key` when the person presses the button
 * and sends it with every attempt of that press. These are the retries.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const KEY_ONE = '00000000-0000-4000-8000-0000000d0001';
const KEY_TWO = '00000000-0000-4000-8000-0000000d0002';
const KEY_THREE = '00000000-0000-4000-8000-0000000d0003';
const KEY_FOUR = '00000000-0000-4000-8000-0000000d0004';
const KEY_FIVE = '00000000-0000-4000-8000-0000000d0005';

let h: Harness;
let silverId: string;

async function rowCount(table: string, clientIndex: number): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    `select count(*)::text as n from ${table} where client_id = $1`,
    [h.clientId(clientIndex)],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
  );
  if (created.status !== 201) throw new Error('Silver could not be created.');
  const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const silver = ((await list.json()) as PackagesResponse).packages.find(
    (p) => p.code === SILVER_CODE,
  );
  if (!silver) throw new Error('Silver is missing.');
  silverId = silver.id;
});

afterAll(async () => {
  await h.close();
});

describe('selling the same package twice under one key', () => {
  it('sells it once and answers the same thing both times', async () => {
    const body = {
      packageId: silverId,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
      payment: { method: 'transfer' as const, amountFils: 1_084_125, reference: 'FT26090201' },
    };
    const first = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, body, {
      'idempotency-key': KEY_ONE,
    });
    expect(first.status).toBe(201);
    const one = (await first.json()) as SellPackageResponse;

    const second = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, body, {
      'idempotency-key': KEY_ONE,
    });
    expect(second.status).toBe(201);
    const two = (await second.json()) as SellPackageResponse;

    // The same purchase, the same invoice number, the same credits: a caller
    // cannot tell the retry from the original, which is the point of it.
    expect(two.purchase.id).toBe(one.purchase.id);
    expect(two.invoiceReference).toBe(one.invoiceReference);
    expect(two.entitlements).toBe(one.entitlements);

    expect(await rowCount('package_purchase', 0)).toBe(1);
    expect(await rowCount('invoice', 0)).toBe(1);
    expect(await rowCount('payment', 0)).toBe(1);
    // Fifteen sessions, two brain maps and a consultation. Once.
    expect(await rowCount('entitlement', 0)).toBe(18);
  });

  it('sells it again under a different key, because that is a different sale', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/package-purchases',
      SEEDED.owner,
      { packageId: silverId, clientId: h.clientId(0), purchasedOn: SEED_TODAY },
      { 'idempotency-key': KEY_TWO },
    );
    expect(res.status).toBe(201);
    expect(await rowCount('package_purchase', 0)).toBe(2);
  });

  it('refuses a key that is not a key rather than ignoring it', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/package-purchases',
      SEEDED.owner,
      { packageId: silverId, clientId: h.clientId(1), purchasedOn: SEED_TODAY },
      { 'idempotency-key': 'the-same-one-as-before' },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_idempotency_key');
  });
});

describe('three presses at once, under one key', () => {
  it('answers all three the same way, and sells once', async () => {
    // Not a retry after an answer: three requests in flight together. Two of
    // them find nothing under the key, insert, and collide on the unique
    // index. Without the recovery both were told the sale had failed — a 500
    // apiece — while the sale had in fact gone through.
    const body = {
      packageId: silverId,
      clientId: h.clientId(4),
      purchasedOn: SEED_TODAY,
    };
    const answers = await Promise.all(
      [0, 1, 2].map(() =>
        h.call('POST', '/api/billing/package-purchases', SEEDED.owner, body, {
          'idempotency-key': KEY_FOUR,
        }),
      ),
    );
    expect(answers.map((res) => res.status)).toEqual([201, 201, 201]);

    const bodies = (await Promise.all(answers.map((res) => res.json()))) as SellPackageResponse[];
    expect(new Set(bodies.map((b) => b.purchase.id)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.invoiceReference)).size).toBe(1);
    expect(await rowCount('package_purchase', 4)).toBe(1);
    expect(await rowCount('invoice', 4)).toBe(1);
    expect(await rowCount('entitlement', 4)).toBe(18);
  });

  it('records one payment for three presses, and says so three times', async () => {
    const body = {
      clientId: h.clientId(5),
      method: 'cash' as const,
      amountFils: 50_000,
    };
    const answers = await Promise.all(
      [0, 1, 2].map(() =>
        h.call('POST', '/api/billing/payments', SEEDED.owner, body, {
          'idempotency-key': KEY_FIVE,
        }),
      ),
    );
    expect(answers.map((res) => res.status)).toEqual([201, 201, 201]);

    const bodies = (await Promise.all(answers.map((res) => res.json()))) as RecordPaymentResponse[];
    expect(new Set(bodies.map((b) => b.payment.id)).size).toBe(1);
    expect(bodies.every((b) => b.payment.amountFils === 50_000)).toBe(true);
    expect(await rowCount('payment', 5)).toBe(1);
  });
});

describe('recording the same payment twice under one key', () => {
  it('records it once and answers the same thing both times', async () => {
    const body = {
      clientId: h.clientId(2),
      method: 'cash' as const,
      amountFils: 73_500,
      reference: 'AT THE DOOR 12',
    };
    const first = await h.call('POST', '/api/billing/payments', SEEDED.owner, body, {
      'idempotency-key': KEY_THREE,
    });
    expect(first.status).toBe(201);
    const one = (await first.json()) as RecordPaymentResponse;

    const second = await h.call('POST', '/api/billing/payments', SEEDED.owner, body, {
      'idempotency-key': KEY_THREE,
    });
    expect(second.status).toBe(201);
    const two = (await second.json()) as RecordPaymentResponse;

    expect(two.payment.id).toBe(one.payment.id);
    expect(await rowCount('payment', 2)).toBe(1);
  });

  it('gives the payment a receipt number a coordinator can quote', async () => {
    // "Recorded" is not something a family can be told. When they ring
    // tomorrow to ask what was received, this is what the coordinator reads
    // out — and it is its own sequence, not the invoice book's, because a
    // payment settles a tax invoice and is not one (405_billing_receipt.sql).
    const res = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(6),
      method: 'transfer' as const,
      amountFils: 25_000,
      reference: 'FT26090299',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RecordPaymentResponse;
    expect(body.payment.receiptReference).toMatch(/^RCP-\d{6}$/);

    const { rows } = await h.owner.query<{ n: string }>(
      'select count(distinct receipt_reference)::text as n from payment where receipt_number is not null',
    );
    const total = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from payment where receipt_number is not null',
    );
    // One number each, and no two the same.
    expect(rows[0]?.n).toBe(total.rows[0]?.n);
  });

  it('refuses a reason that says nothing, wherever a reason is asked for', async () => {
    const res = await h.call('POST', `/api/billing/packages/${silverId}/price`, SEEDED.owner, {
      amountFils: 900_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'x',
    });
    expect(res.status).toBe(400);

    const repeated = await h.call('POST', `/api/billing/packages/${silverId}/price`, SEEDED.owner, {
      amountFils: 900_000,
      validFrom: SEED_TODAY,
      amendmentReason: 'xxxxxxxxxx',
    });
    // Eight characters of one letter is a required field being filled in, not
    // answered.
    expect(repeated.status).toBe(400);
  });

  it('refuses a reference that is a sentence rather than a bank reference', async () => {
    const res = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(2),
      method: 'cash' as const,
      amountFils: 1_000,
      // A place a coordinator could write anything about a family, in a table
      // with no delete, copied verbatim into the audit trail.
      reference: "Mum paid in cash, said she'd lost her job and would be late again",
    });
    expect(res.status).toBe(400);
  });

  it('refuses money that arrived before the practice existed', async () => {
    const res = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(2),
      method: 'cash' as const,
      amountFils: 1_000,
      receivedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('received_too_old');
  });

  it('refuses a sale dated before the practice existed', async () => {
    const res = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silverId,
      clientId: h.clientId(3),
      purchasedOn: '1999-01-01',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('purchase_too_old');
  });
});
