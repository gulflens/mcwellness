import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse, SellPackageResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { requireDatabaseUrl } from '../../../db/runner/apply';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The invoice number, under load and under failure.
 *
 * A tax invoice needs a sequential number, and the Federal Tax Authority
 * means sequential without gaps. A Postgres sequence cannot give that — a
 * rolled-back transaction burns its number permanently — so
 * 402_billing_document.sql takes the number from a per-practice counter row
 * with one locking `update ... returning`. This file proves both halves of
 * that claim: two sales at the same moment never take the same number, and a
 * sale that fails gives its number back.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');

let h: Harness;
let silverId: string;

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

describe('two sales at the same moment', () => {
  it('take five different numbers, with no gaps between them', async () => {
    // Five families buying at once, each on its own pooled connection.
    const sales = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
          packageId: silverId,
          clientId: h.clientId(index),
          purchasedOn: SEED_TODAY,
        }),
      ),
    );
    expect(sales.map((res) => res.status)).toEqual([201, 201, 201, 201, 201]);

    const references = await Promise.all(
      sales.map(async (res) => ((await res.json()) as SellPackageResponse).invoiceReference),
    );
    expect(new Set(references).size).toBe(5);
    expect([...references].sort()).toEqual([
      'INV-000001',
      'INV-000002',
      'INV-000003',
      'INV-000004',
      'INV-000005',
    ]);
  });
});

describe('a number taken by a sale that never happens', () => {
  it('comes back, so the sequence stays gapless', async () => {
    const url = requireDatabaseUrl();
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await first.connect();
    await second.connect();
    try {
      const context =
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', 'owner', true), set_config('app.reason', '', true)";
      const ownerUser = h.data.users[SEEDED.owner];

      await first.query('begin');
      await first.query(context, [h.data.tenant.id, ownerUser?.id ?? null]);
      const taken = await first.query<{ n: number }>('select app.next_invoice_number() as n');
      expect(taken.rows[0]?.n).toBe(6);
      // The sale falls through — a card declined, a coordinator's second
      // thoughts, an error anywhere in the request.
      await first.query('rollback');

      await second.query('begin');
      await second.query(context, [h.data.tenant.id, ownerUser?.id ?? null]);
      const next = await second.query<{ n: number }>('select app.next_invoice_number() as n');
      // The same number, not the one after it: nothing was burned.
      expect(next.rows[0]?.n).toBe(6);
      await second.query('rollback');
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('is never handed to two practices at once', async () => {
    // A second practice starts its own book at one, whatever the first has
    // reached: the counter is per practice, not per database.
    const other = '00000000-0000-4000-8000-0000000000b0';
    await h.owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio B')", [
      other,
    ]);
    const { rows } = await h.owner.query<{ next_number: number }>(
      'select next_number from invoice_number_series where tenant_id = $1',
      [other],
    );
    expect(rows[0]?.next_number).toBe(1);
  });
});

describe("the supplier's own identity, on every invoice", () => {
  it('is snapshotted at the moment the invoice is written, not looked up later', async () => {
    // A UAE tax invoice must name its supplier, and this row can never be
    // updated: an invoice issued before the practice recorded its TRN would be
    // missing it for ever, with no way to backfill. So the database stamps it
    // (402_billing_document.sql), rather than each of the two callers
    // remembering to.
    const { rows } = await h.owner.query<{
      supplier_legal_name: string | null;
      supplier_trn: string | null;
      n: string;
    }>(
      'select supplier_legal_name, supplier_trn, count(*)::text as n from invoice ' +
        'group by 1, 2',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.supplier_legal_name).toBe(h.data.tenant.legalName);
    expect(rows[0]?.supplier_trn).toBe(h.data.tenant.trn);
  });

  it('keeps saying what it said when the practice is renamed', async () => {
    await h.owner.query("update tenant set legal_name = 'Renamed Studio' where id = $1", [
      h.data.tenant.id,
    ]);
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from invoice where supplier_legal_name = 'Renamed Studio'",
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
