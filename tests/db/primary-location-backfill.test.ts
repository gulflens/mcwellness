import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, MORE_IDS, freshDatabase, seedClient, seedLocation, seedTenant } from './helpers';

/**
 * Migration 963 fills client.primary_location_id from the flag on the location
 * (or the client's only location) for every client enrolled before the link
 * was written by the routes, and — from the first task-5 review round —
 * resolves a client left holding two flagged locations to one, with a
 * partial unique index then making that the schema's own invariant.
 * freshDatabase() runs every migration, so this test seeds the four cases
 * against a database that already has 963 applied (dropping the index it
 * created first, so a client can be seeded with two flagged locations at
 * all) and re-runs the migration's own file, which is what the file would do
 * on a database that already had these rows.
 */
let owner: pg.Client;

const FLAGGED = '00000000-0000-4000-8000-00000000a001';
const LONE = '00000000-0000-4000-8000-00000000a002';
const AMBIGUOUS = '00000000-0000-4000-8000-00000000a003';
const TWO_FLAGGED = '00000000-0000-4000-8000-00000000a004';

async function backfillSql(): Promise<string> {
  const fs = await import('node:fs/promises');
  return fs.readFile('db/migrations/963_backfill_primary_location.sql', 'utf8');
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  // The index 963 itself creates would refuse seeding a client with two
  // flagged locations below; dropping it first reproduces the legacy state
  // the migration is meant to run against, and the migration's own text
  // (re-run at the end of this block) recreates it once the data agrees.
  await owner.query('drop index if exists location_one_primary_per_owner');

  await seedClient(owner, IDS.tenantA, FLAGGED, IDS.ownerA, 'Flagged');
  await seedClient(owner, IDS.tenantA, LONE, IDS.ownerA, 'Lone');
  await seedClient(owner, IDS.tenantA, AMBIGUOUS, IDS.ownerA, 'Ambiguous');
  await seedClient(owner, IDS.tenantA, TWO_FLAGGED, IDS.ownerA, 'Doubled');
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationB, FLAGGED, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationC, FLAGGED, IDS.ownerA);
  await owner.query('update location set is_primary = true where id = $1', [MORE_IDS.locationC]);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationD, LONE, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationE, AMBIGUOUS, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationF, AMBIGUOUS, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationG, TWO_FLAGGED, IDS.ownerA);
  await seedLocation(owner, IDS.tenantA, MORE_IDS.locationH, TWO_FLAGGED, IDS.ownerA);
  await owner.query('update location set is_primary = true where id = any($1)', [
    [MORE_IDS.locationG, MORE_IDS.locationH],
  ]);
  await owner.query('update client set primary_location_id = null where id = any($1)', [
    [FLAGGED, LONE, AMBIGUOUS, TWO_FLAGGED],
  ]);
  await owner.query(await backfillSql());
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
  it('resolves a client with two flagged locations to exactly one, linked, and demotes the loser', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "select id from location where owner_type = 'client' and owner_id = $1 and is_primary",
      [TWO_FLAGGED],
    );
    expect(rows).toHaveLength(1);
    expect([MORE_IDS.locationG, MORE_IDS.locationH]).toContain(rows[0]?.id);
    expect(await primaryOf(TWO_FLAGGED)).toBe(rows[0]?.id);
  });
  it('re-creates the one-primary-per-owner index the backfill relies on', async () => {
    const { rowCount } = await owner.query(
      "select indexname from pg_indexes where indexname = 'location_one_primary_per_owner'",
    );
    expect(rowCount).toBe(1);
  });
});
