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
