import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedTenant,
  seedUser,
} from './helpers';

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
const PRACTITIONER_USER = '00000000-0000-4000-8000-00000000a005';
const PRACTITIONER = '00000000-0000-4000-8000-00000000a006';
const PRACTITIONER_BASE_1 = '00000000-0000-4000-8000-00000000a007';
const PRACTITIONER_BASE_2 = '00000000-0000-4000-8000-00000000a008';

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

describe('963_backfill_primary_location — the pre-flight for other owner types', () => {
  // The three repair statements only ever touch owner_type = 'client'. A
  // practitioner's home base (db/migrations/913_practitioner_base.sql) has
  // one legitimate writer, app.set_practitioner_base, which always reuses the
  // practitioner's own row rather than insert a second flagged one — so this
  // scenario reproduces the shape a bug elsewhere would have to produce
  // before the pre-flight check has anything to find. Run inside its own
  // transaction, rolled back at the end, so it never disturbs the successful
  // run the rest of this file asserts against.
  it('checks a practitioner base rather than repairing it, and names the owner when it already holds two flagged primaries', async () => {
    await owner.query('begin');
    try {
      // The index would itself refuse seeding a second flagged row below;
      // dropping it first reproduces the state a real duplicate would need to
      // have gotten into before this migration ever ran.
      await owner.query('drop index if exists location_one_primary_per_owner');

      await seedUser(owner, {
        id: PRACTITIONER_USER,
        tenantId: IDS.tenantA,
        authId: null,
        displayName: 'Synthetic Practitioner',
        roles: ['practitioner'],
      });
      await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
      for (const locationId of [PRACTITIONER_BASE_1, PRACTITIONER_BASE_2]) {
        await owner.query(
          'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
            'entrance_point, is_primary, created_by) ' +
            "values ($1, $2, 'practitioner', $3, 'base', 'DXB', " +
            "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), true, $4)",
          [locationId, IDS.tenantA, PRACTITIONER, IDS.ownerA],
        );
      }

      await owner.query('savepoint before_backfill');
      let failure: Error | undefined;
      try {
        await owner.query(await backfillSql());
      } catch (error) {
        failure = error as Error;
      } finally {
        await owner.query('rollback to savepoint before_backfill');
      }

      // Named: which migration, which owner, and that it is a practitioner
      // rather than the studio or a household — a bare constraint violation
      // from the index below would have said none of that.
      expect(failure?.message).toContain('963');
      expect(failure?.message).toContain('practitioner');
      expect(failure?.message).toContain(PRACTITIONER);

      // And the index was never reached: the check runs first and the whole
      // file's own transaction stops there, which is why the index this
      // suite's other describe block found in place is, for the moment this
      // rolls back to, still missing.
      const { rowCount } = await owner.query(
        "select indexname from pg_indexes where indexname = 'location_one_primary_per_owner'",
      );
      expect(rowCount).toBe(0);
    } finally {
      await owner.query('rollback');
    }
  });
});
