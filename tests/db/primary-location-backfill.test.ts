import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, MORE_IDS, freshDatabase, seedClient, seedLocation, seedTenant } from './helpers';

/**
 * Migration 963 fills client.primary_location_id from the flag on the location
 * (or the client's only location) for every client enrolled before the link
 * was written by the routes. freshDatabase() runs every migration, so this
 * test seeds the three cases and re-runs the migration's statements against
 * them, which is what the file would do on a database that already had them.
 */
let owner: pg.Client;

const FLAGGED = '00000000-0000-4000-8000-00000000a001';
const LONE = '00000000-0000-4000-8000-00000000a002';
const AMBIGUOUS = '00000000-0000-4000-8000-00000000a003';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedClient(owner, IDS.tenantA, FLAGGED, IDS.ownerA, 'Flagged');
  await seedClient(owner, IDS.tenantA, LONE, IDS.ownerA, 'Lone');
  await seedClient(owner, IDS.tenantA, AMBIGUOUS, IDS.ownerA, 'Ambiguous');
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationB, FLAGGED, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationC, FLAGGED, IDS.ownerA);
  await owner.query('update location set is_primary = true where id = $1', [MORE_IDS.locationC]);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationD, LONE, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationE, AMBIGUOUS, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationF, AMBIGUOUS, IDS.ownerA);
  await owner.query('update client set primary_location_id = null where id = any($1)', [
    [FLAGGED, LONE, AMBIGUOUS],
  ]);
  const sql = await import('node:fs/promises').then((fs) =>
    fs.readFile('db/migrations/963_backfill_primary_location.sql', 'utf8'),
  );
  await owner.query(sql);
});

afterAll(async () => {
  await owner.end();
});

async function primaryOf(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ primary_location_id: string | null }>(
    'select primary_location_id from client where id = $1',
    [id],
  );
  return rows[0]?.primary_location_id ?? null;
}

describe('963_backfill_primary_location', () => {
  it('takes the flagged location when there is one', async () => {
    expect(await primaryOf(FLAGGED)).toBe(MORE_IDS.locationC);
  });
  it('takes the only location when none is flagged', async () => {
    expect(await primaryOf(LONE)).toBe(MORE_IDS.locationD);
  });
  it('leaves a client with several unflagged locations alone', async () => {
    expect(await primaryOf(AMBIGUOUS)).toBeNull();
  });
});
