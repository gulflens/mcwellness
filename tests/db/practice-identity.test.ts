import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asApiRole,
  IDS,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedLocation,
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
const STUDIO = IDS.locationA;
const CLIENT_HOME = IDS.locationB;
// Fifteen digits in the reserved synthetic shape; never a real registration.
const VAT_TRN = '100000000000003';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, TENANT, OWNER, 'Synthetic Studio A');
  await seedClient(owner, TENANT, CLIENT, OWNER, 'Harbour');
  await seedLocation(owner, TENANT, CLIENT_HOME, CLIENT, OWNER);
  // The practice's own address, the one app.stamp_invoice_supplier copies.
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
      "entrance_point, display_address, created_by) values ($1, $2, 'tenant', $2, 'studio', " +
      "'DXB', extensions.st_geogfromtext('SRID=4326;POINT(55.26 25.19)'), $3, $4)",
    [STUDIO, TENANT, 'Unit 1, Synthetic Tower, Dubai', OWNER],
  );
  await owner.query('update tenant set location_id = $1 where id = $2', [STUDIO, TENANT]);
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

describe('the practice’s own address', () => {
  // db/policies/client/writers.sql admits a lead practitioner to every
  // location's insert and update, which is right for a household's address and
  // wrong for the one every invoice is issued from.
  it('refuses a lead practitioner the address an invoice is stamped from', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        TENANT,
        async () => {
          await rejectsWith(
            owner,
            '42501',
            'update location set display_address = $1 where id = $2',
            ['Somewhere Else, Dubai', STUDIO],
          );
          await rejectsWith(
            owner,
            '42501',
            'insert into location (tenant_id, owner_type, owner_id, label, emirate, ' +
              "entrance_point, display_address) values ($1, 'tenant', $1, 'studio', 'DXB', " +
              "extensions.st_geogfromtext('SRID=4326;POINT(55.3 25.3)'), 'A second studio')",
            [TENANT],
          );
        },
        'lead_practitioner',
      );
    });
    const { rows } = await owner.query<{ display_address: string }>(
      'select display_address from location where id = $1',
      [STUDIO],
    );
    expect(rows[0]?.display_address).toBe('Unit 1, Synthetic Tower, Dubai');
  });

  it('lets an owner and an admin change it', async () => {
    for (const roles of ['owner', 'admin']) {
      await rolledBack(owner, async () => {
        await asApiRole(
          owner,
          TENANT,
          async () => {
            await owner.query('update location set display_address = $1 where id = $2', [
              'Unit 2, Synthetic Tower, Dubai',
              STUDIO,
            ]);
          },
          roles,
        );
      });
    }
  });

  it('leaves a household’s own address exactly where it was', async () => {
    // The guard is narrow on purpose: guard_location_notes (100) still decides
    // everything about a client's location, and a lead practitioner may edit one.
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        TENANT,
        async () => {
          await owner.query('update location set display_address = $1 where id = $2', [
            'Villa 3, Synthetic Gardens, Dubai',
            CLIENT_HOME,
          ]);
        },
        'lead_practitioner',
      );
    });
  });
});

describe('what an invoice keeps of it', () => {
  const ISSUE =
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, gross_fils) ' +
    "values ($1, $2, $3, 'statement', current_date, 0, 0, 0)";
  /** A caller passing its own supplier snapshot, which skips the stamping. */
  const ISSUE_SUPPLIED =
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
    'gross_fils, supplier_legal_name, supplier_vat_registered, supplier_vat_trn) ' +
    "values ($1, $2, $3, 'statement', current_date, 0, 0, 0, $4, $5, $6)";

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

  it('refuses a supplier VAT number that is not fifteen digits, however it arrives', async () => {
    await rolledBack(owner, async () => {
      // Stamped: the tenant's own bad value can never exist (905's constraint
      // on tenant.vat_trn), so the case that matters is a caller supplying one.
      await rejectsWith(owner, '23514', ISSUE_SUPPLIED, [
        TENANT,
        CLIENT,
        3,
        'Synthetic Studio A',
        true,
        '1234',
      ]);
    });
  });

  it('refuses a VAT number on an invoice whose supplier was not registered', async () => {
    // The path that skips the stamp — supplier_legal_name already supplied —
    // is held to the same rule as the stamped one.
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '23514', ISSUE_SUPPLIED, [
        TENANT,
        CLIENT,
        4,
        'Synthetic Studio A',
        false,
        VAT_TRN,
      ]);
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

describe('no VAT unless the supplier was registered (migration 950)', () => {
  /**
   * A caller supplying its own supplier snapshot, so the stamp returns early
   * and the row says exactly what the test means it to say. Ten fils of VAT
   * on a hundred net, which invoice_totals_agree accepts.
   */
  const ISSUE_WITH_VAT =
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
    'gross_fils, supplier_legal_name, supplier_vat_registered) ' +
    "values ($1, $2, $3, 'statement', current_date, 100, 10, 110, $4, $5)";

  it('refuses VAT from a practice that was not registered, by the trigger 406 already had', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '23514', ISSUE_WITH_VAT, [
        TENANT,
        CLIENT,
        11,
        'Synthetic Studio A',
        false,
      ]);
    });
  });

  it('refuses it again with that trigger switched off, which is the whole point', async () => {
    // A trigger can be disabled and a check constraint cannot. This is the
    // case the constraint exists for: the failure it guards against is a
    // false statement to the Federal Tax Authority, so the rule holds even
    // for somebody who has the privilege to turn the guard off.
    await rolledBack(owner, async () => {
      await owner.query('alter table invoice disable trigger zz_guard_invoice_vat');
      const refusal = await owner
        .query(ISSUE_WITH_VAT, [TENANT, CLIENT, 12, 'Synthetic Studio A', false])
        .then(() => 'the statement was accepted')
        .catch((error: Error) => error.message);
      expect(refusal).toContain('invoice_no_vat_unless_supplier_registered');
    });
  });

  it('says nothing about an invoice issued before the registration column existed', async () => {
    // supplier_vat_registered null means "unknown", never "false" (905's own
    // column comment). Refusing those rows would refuse history rather than
    // protect it, so the constraint's first arm lets them through.
    await rolledBack(owner, async () => {
      await owner.query('alter table invoice disable trigger zz_guard_invoice_vat');
      await owner.query(ISSUE_WITH_VAT, [TENANT, CLIENT, 13, 'Synthetic Studio A', null]);
      const { rows } = await owner.query<{ vat: number }>(
        'select vat_fils as vat from invoice where tenant_id = $1 and number = 13',
        [TENANT],
      );
      expect(rows[0]?.vat).toBe(10);
    });
  });

  it('lets a registered practice charge it', async () => {
    await rolledBack(owner, async () => {
      await owner.query('update tenant set vat_registered = true, vat_trn = $1 where id = $2', [
        VAT_TRN,
        TENANT,
      ]);
      await owner.query(ISSUE_WITH_VAT, [TENANT, CLIENT, 14, 'Synthetic Studio A', true]);
      const { rows } = await owner.query<{ vat: number }>(
        'select vat_fils as vat from invoice where tenant_id = $1 and number = 14',
        [TENANT],
      );
      expect(rows[0]?.vat).toBe(10);
    });
  });
});
