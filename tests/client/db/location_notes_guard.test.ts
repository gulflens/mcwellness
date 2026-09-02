import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedLocation,
  seedTenant,
} from '../../db/helpers';

/**
 * app.guard_location_notes() (db/migrations/100_client_record.sql): a
 * practitioner's one write on a location is access_notes, and nothing else —
 * "add access notes to a location" (docs/SPEC/client-record.md section 2).
 * Tested directly against the trigger, as the owner connection (which
 * bypasses row security) with app.actor_roles set by hand to 'practitioner':
 * row visibility is db/policies/client/writers.sql and
 * app.client_visible_to_practitioner's job, closed for now
 * (tests/client/db/policies.test.ts); this is the column boundary underneath
 * it, which the trigger enforces regardless of who reaches the row.
 */

const INSUFFICIENT_PRIVILEGE = '42501';

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
});

afterAll(async () => {
  await owner.end();
});

async function asPractitioner(fn: () => Promise<void>): Promise<void> {
  await owner.query("select set_config('app.actor_roles', 'practitioner', true)");
  await fn();
}

describe('app.guard_location_notes', () => {
  it('lets a practitioner change access_notes alone', async () => {
    await rolledBack(owner, async () => {
      await asPractitioner(async () => {
        await owner.query('update location set access_notes = $1 where id = $2', [
          'Gate code changed',
          IDS.locationA,
        ]);
      });
      const { rows } = await owner.query<{ access_notes: string }>(
        'select access_notes from location where id = $1',
        [IDS.locationA],
      );
      expect(rows[0]?.access_notes).toBe('Gate code changed');
    });
  });

  it('refuses a practitioner changing any other column, even alongside access_notes', async () => {
    await rolledBack(owner, async () => {
      await asPractitioner(async () => {
        await rejectsWith(
          owner,
          INSUFFICIENT_PRIVILEGE,
          'update location set display_address = $1 where id = $2',
          ['A different street entirely', IDS.locationA],
        );
        // is_primary starts false (the seed's default): setting it true is a real
        // change, not the no-op a second "false" would be.
        await rejectsWith(
          owner,
          INSUFFICIENT_PRIVILEGE,
          'update location set access_notes = $1, is_primary = true where id = $2',
          ['Ring the bell twice', IDS.locationA],
        );
      });
    });
  });

  it('lets the owner change anything, unrestricted by the guard', async () => {
    await rolledBack(owner, async () => {
      await owner.query("select set_config('app.actor_roles', 'owner', true)");
      await owner.query('update location set display_address = $1 where id = $2', [
        'Villa 12, Street 4',
        IDS.locationA,
      ]);
      const { rows } = await owner.query<{ display_address: string }>(
        'select display_address from location where id = $1',
        [IDS.locationA],
      );
      expect(rows[0]?.display_address).toBe('Villa 12, Street 4');
    });
  });

  it('refuses a practitioner changing a column the old enumerated check never named', async () => {
    // created_by was never in the guard's original column-by-column list — the exact gap
    // a structural to_jsonb(new) minus to_jsonb(old) comparison closes, so a column added
    // to location tomorrow is covered without anyone remembering to add it here (issue 9).
    await rolledBack(owner, async () => {
      await asPractitioner(async () => {
        // seedLocation already set created_by to IDS.ownerA (tests/db/helpers.ts), so the
        // change under test has to be to something else — null is a genuine change and a
        // valid one, since the column is nullable.
        await rejectsWith(
          owner,
          INSUFFICIENT_PRIVILEGE,
          'update location set created_by = null where id = $1',
          [IDS.locationA],
        );
      });
    });
  });

  it("does nothing when app.actor_roles is unset — the owner's own maintenance, never a request", async () => {
    // set_config(..., true) is transaction-local (tests/db/helpers.ts's rolledBack begins a
    // fresh transaction per test), so app.actor_roles starts unset here: no asPractitioner,
    // no owner role, nothing at all. A seed script or a console session in this shape must
    // still be able to write a location; only a request through the API ever stamps a role
    // (096_api_role.sql), so this is never a practitioner's write slipping past the guard.
    await rolledBack(owner, async () => {
      await owner.query(
        'update location set display_address = $1, is_primary = true where id = $2',
        ['No role assumed at all', IDS.locationA],
      );
      const { rows } = await owner.query<{ display_address: string; is_primary: boolean }>(
        'select display_address, is_primary from location where id = $1',
        [IDS.locationA],
      );
      expect(rows[0]?.display_address).toBe('No role assumed at all');
      expect(rows[0]?.is_primary).toBe(true);
    });
  });
});
