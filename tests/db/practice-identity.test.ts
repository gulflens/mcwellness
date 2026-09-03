import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asApiRole,
  IDS,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedTenant,
} from './helpers';

/**
 * Migration 905: who the practice is, whether it charges VAT, who may say so,
 * and what an invoice keeps of all that.
 *
 * The four things worth proving are the four a later reader will doubt: the
 * two tax numbers stay apart, the VAT registration cannot be half-recorded,
 * only an owner or an admin may edit any of it, and the snapshot on an
 * invoice is taken by the trigger rather than by whoever happened to write
 * the row. Every case runs inside a transaction that is rolled back, so the
 * practice these tests rename and register is never the practice the next
 * test reads.
 */

let owner: pg.Client;

const TENANT = IDS.tenantA;
const OWNER = IDS.ownerA;
const CLIENT = IDS.clientA;
// Fifteen digits in the reserved synthetic shape; never a real registration.
const VAT_TRN = '100000000000003';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, TENANT, OWNER, 'Synthetic Studio A');
  await seedClient(owner, TENANT, CLIENT, OWNER, 'Harbour');
});

afterAll(async () => {
  await owner.end();
});

async function tenantRow(): Promise<Record<string, unknown>> {
  const { rows } = await owner.query('select * from tenant where id = $1', [TENANT]);
  return rows[0] as Record<string, unknown>;
}

describe('the practice’s identity', () => {
  it('starts unregistered for VAT, with nothing said about the licence', async () => {
    const row = await tenantRow();
    expect(row.vat_registered).toBe(false);
    expect(row.vat_trn).toBeNull();
    expect(row.legal_name_ar).toBeNull();
    expect(row.licence_number).toBeNull();
    expect(row.licensing_authority).toBeNull();
    expect(row.licence_expires_on).toBeNull();
  });

  it('keeps the corporate tax number and the VAT number in different columns', async () => {
    // The whole point of the pair: recording one says nothing about the other.
    await rolledBack(owner, async () => {
      await owner.query('update tenant set trn = $1 where id = $2', [VAT_TRN, TENANT]);
      const row = await tenantRow();
      expect(row.trn).toBe(VAT_TRN);
      expect(row.vat_registered).toBe(false);
      expect(row.vat_trn).toBeNull();
    });
  });

  it('refuses a VAT number that is not fifteen digits', async () => {
    await rolledBack(owner, async () => {
      for (const bad of ['1234', '10000000000000A', '1000000000000031', '']) {
        await rejectsWith(owner, '23514', 'update tenant set vat_trn = $1 where id = $2', [
          bad,
          TENANT,
        ]);
      }
    });
  });

  it('refuses a VAT registration with no number to print', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '23514', 'update tenant set vat_registered = true where id = $1', [
        TENANT,
      ]);
    });
  });

  it('takes the registration and its number together', async () => {
    await rolledBack(owner, async () => {
      await owner.query('update tenant set vat_registered = true, vat_trn = $1 where id = $2', [
        VAT_TRN,
        TENANT,
      ]);
      const row = await tenantRow();
      expect(row.vat_registered).toBe(true);
      expect(row.vat_trn).toBe(VAT_TRN);
    });
  });
});

describe('who may change it', () => {
  it('lets an owner and an admin edit the practice', async () => {
    for (const roles of ['owner', 'admin,finance']) {
      await rolledBack(owner, async () => {
        await asApiRole(
          owner,
          TENANT,
          async () => {
            await owner.query('update tenant set licensing_authority = $1 where id = $2', [
              'Synthetic Department of Economy and Tourism',
              TENANT,
            ]);
          },
          roles,
        );
      });
    }
  });

  it('refuses a practitioner, a lead practitioner and finance alone', async () => {
    for (const roles of ['practitioner', 'lead_practitioner', 'finance']) {
      await rolledBack(owner, async () => {
        await asApiRole(
          owner,
          TENANT,
          async () => {
            await rejectsWith(owner, '42501', 'update tenant set legal_name = $1 where id = $2', [
              'Renamed By Somebody Else',
              TENANT,
            ]);
          },
          roles,
        );
      });
    }
    expect((await tenantRow()).legal_name).toBe('Synthetic Studio A');
  });

  it('stands aside for the runner and the seed, which stamp no role at all', async () => {
    await rolledBack(owner, async () => {
      await owner.query('update tenant set legal_name_ar = $1 where id = $2', ['استوديو', TENANT]);
      expect((await tenantRow()).legal_name_ar).toBe('استوديو');
    });
  });
});

describe('what an invoice keeps of it', () => {
  const ISSUE =
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, gross_fils) ' +
    "values ($1, $2, $3, 'statement', current_date, 0, 0, 0)";

  it('stamps the practice as it stands, and never moves it again', async () => {
    await rolledBack(owner, async () => {
      await owner.query(
        'update tenant set legal_name = $1, legal_name_ar = $2, licence_number = $3, ' +
          'licensing_authority = $4, vat_registered = true, vat_trn = $5 where id = $6',
        [
          'Synthetic Studio A',
          'استوديو أ',
          'SYN-000001',
          'Synthetic Department of Economy and Tourism',
          VAT_TRN,
          TENANT,
        ],
      );
      await owner.query(ISSUE, [TENANT, CLIENT, 1]);

      const { rows } = await owner.query<Record<string, unknown>>(
        'select supplier_legal_name, supplier_legal_name_ar, supplier_licence_number, ' +
          'supplier_licensing_authority, supplier_vat_registered, supplier_vat_trn ' +
          'from invoice where tenant_id = $1 and number = 1',
        [TENANT],
      );
      expect(rows[0]).toEqual({
        supplier_legal_name: 'Synthetic Studio A',
        supplier_legal_name_ar: 'استوديو أ',
        supplier_licence_number: 'SYN-000001',
        supplier_licensing_authority: 'Synthetic Department of Economy and Tourism',
        supplier_vat_registered: true,
        supplier_vat_trn: VAT_TRN,
      });

      // The practice renames and deregisters. The issued invoice says what it said.
      await owner.query(
        'update tenant set legal_name = $1, vat_registered = false, vat_trn = null where id = $2',
        ['Synthetic Studio A, Renamed', TENANT],
      );
      const { rows: after } = await owner.query<{ name: string; registered: boolean }>(
        'select supplier_legal_name as name, supplier_vat_registered as registered ' +
          'from invoice where tenant_id = $1 and number = 1',
        [TENANT],
      );
      expect(after[0]).toEqual({ name: 'Synthetic Studio A', registered: true });
    });
  });

  it('leaves an unregistered practice saying so on the invoice, with no number', async () => {
    await rolledBack(owner, async () => {
      await owner.query(ISSUE, [TENANT, CLIENT, 2]);
      const { rows } = await owner.query<{ registered: boolean; trn: string | null }>(
        'select supplier_vat_registered as registered, supplier_vat_trn as trn ' +
          'from invoice where tenant_id = $1 and number = 2',
        [TENANT],
      );
      expect(rows[0]).toEqual({ registered: false, trn: null });
    });
  });
});
