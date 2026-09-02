import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, IDS, seedTenant } from '../../db/helpers';

/**
 * migration 400_billing_catalogue.sql's app.default_vat_setting() trigger:
 * a tenant inserted after the migration has already run — the ordinary case,
 * every seed and every real signup — gets its first VAT rate the moment it
 * exists, with no separate step. Complements
 * tests/billing/db/vat-setting-backfill.test.ts, which proves the other
 * half: a tenant that already existed before the migration ran.
 */

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
});

afterAll(async () => {
  await client.end();
});

describe('inserting a tenant', () => {
  it('yields exactly one vat_setting: the UAE standard rate from 2018', async () => {
    await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');

    const { rows } = await client.query<{
      version: number;
      rate_basis_points: number;
      effective_from: string;
      supersedes_id: string | null;
      amendment_reason: string;
    }>(
      'select version, rate_basis_points, effective_from::text, supersedes_id, amendment_reason ' +
        'from vat_setting where tenant_id = $1',
      [IDS.tenantA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      rate_basis_points: 500,
      effective_from: '2018-01-01',
      supersedes_id: null,
      amendment_reason: 'standard rate at go-live',
    });
  });

  it('gives a second tenant its own rate, not a shared one', async () => {
    await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Second Synthetic Studio');

    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from vat_setting where tenant_id = $1',
      [IDS.tenantB],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
