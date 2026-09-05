import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * The drive cache (db/migrations/204_drive_estimate.sql,
 * db/policies/scheduling/drive_estimate.sql,
 * docs/SPEC/practitioner-phone.md section 5.2).
 *
 * What is proved here: the key is the pair and the hour, so the same two
 * addresses at eight in the morning and at midday are two rows; a row cannot
 * join two practices' places; every role that may write is proved to write and
 * every role that may not is proved to be refused; and nobody at all may
 * delete, because a stale row is overwritten in place.
 *
 * The table is `tests/session/db`'s to test even though the migration is in
 * scheduling's range: piece eight owns migration 204 and the policy file for
 * this piece (docs/SPEC/OWNERSHIP.md), and rule 4 keeps a stream's database
 * tests under its own path.
 */

const RLS_VIOLATION = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const PRACTITIONER_USER = '00000000-0000-4000-8000-000000401001';
const PRACTITIONER = '00000000-0000-4000-8000-000000401002';
const ADMIN_USER = '00000000-0000-4000-8000-000000401003';
const LEAD_USER = '00000000-0000-4000-8000-000000401004';
const FINANCE_USER = '00000000-0000-4000-8000-000000401005';
const CONTACT_USER = '00000000-0000-4000-8000-000000401006';

const CLIENT_A = '00000000-0000-4000-8000-000000402001';
const CLIENT_B = '00000000-0000-4000-8000-000000402002';
const HOME = '00000000-0000-4000-8000-000000403001';
const AWAY = '00000000-0000-4000-8000-000000403002';
const FOREIGN_PLACE = '00000000-0000-4000-8000-000000403003';

const INSERT =
  'insert into drive_estimate (tenant_id, from_location_id, to_location_id, hour_bucket, ' +
  'seconds, metres, source) values ($1, $2, $3, $4, $5, $6, $7)';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedUser(client, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_USER,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
  for (const [userId, role] of [
    [ADMIN_USER, 'admin'],
    [LEAD_USER, 'lead_practitioner'],
    [FINANCE_USER, 'finance'],
    [CONTACT_USER, 'client_contact'],
  ] as const) {
    await seedUser(client, {
      id: userId,
      tenantId: IDS.tenantA,
      authId: userId,
      displayName: 'Synthetic Colleague',
      roles: [role],
    });
  }
  await seedClient(client, IDS.tenantA, CLIENT_A, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantB, CLIENT_B, IDS.ownerB, 'Orchard');
  await seedLocation(client, IDS.tenantA, HOME, CLIENT_A, IDS.ownerA);
  await seedLocation(client, IDS.tenantA, AWAY, CLIENT_A, IDS.ownerA);
  await seedLocation(client, IDS.tenantB, FOREIGN_PLACE, CLIENT_B, IDS.ownerB);
});

afterAll(async () => {
  await client.end();
});

describe('the cache key', () => {
  it('keeps one figure per pair per hour and refuses a second', async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'traffic']);
      await rejectsWith(client, UNIQUE_VIOLATION, INSERT, [
        IDS.tenantA,
        HOME,
        AWAY,
        8,
        1600,
        18000,
        'straight-line',
      ]);
    });
  });

  it('keeps the same pair at another hour as its own row', async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'traffic']);
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 13, 1000, 18000, 'traffic']);
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from drive_estimate',
      );
      expect(rows[0]?.n).toBe('2');
    });
  });

  it('keeps the drive back as its own row, because it is a different drive', async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'traffic']);
      await client.query(INSERT, [IDS.tenantA, AWAY, HOME, 8, 1700, 18000, 'traffic']);
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from drive_estimate',
      );
      expect(rows[0]?.n).toBe('2');
    });
  });

  it("refuses a row joining another practice's place", async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, FOREIGN_KEY_VIOLATION, INSERT, [
        IDS.tenantA,
        HOME,
        FOREIGN_PLACE,
        8,
        1500,
        18000,
        'traffic',
      ]);
    });
  });

  it('refuses an hour outside the day and a figure outside all reason', async () => {
    await rolledBack(client, async () => {
      for (const [hour, seconds, metres] of [
        [24, 1500, 18000],
        [-1, 1500, 18000],
        [8, 90000, 18000],
        [8, 1500, 3000000],
        [8, -1, 18000],
      ] as const) {
        await rejectsWith(client, CHECK_VIOLATION, INSERT, [
          IDS.tenantA,
          HOME,
          AWAY,
          hour,
          seconds,
          metres,
          'traffic',
        ]);
      }
    });
  });

  it('carries the audit trigger and says it names no client', async () => {
    const { rows } = await client.query<{ comment: string | null; enabled: string }>(
      "select obj_description('public.drive_estimate'::regclass, 'pg_class') as comment, " +
        '(select tgenabled::text from pg_trigger ' +
        "where tgrelid = 'public.drive_estimate'::regclass and tgname = 'audit_row') as enabled",
    );
    expect(rows[0]?.comment).toMatch(/^audited: no client/);
    expect(rows[0]?.enabled).toBe('A');
  });
});

describe('who may read and who may fill the cache', () => {
  async function asRole<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
    return asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [userId]);
        return fn();
      },
      roles,
    );
  }

  it('lets the practice and a practitioner read it, and refuses a household', async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'traffic']);
      for (const [userId, roles] of [
        [IDS.ownerA, 'owner'],
        [ADMIN_USER, 'admin'],
        [LEAD_USER, 'lead_practitioner'],
        [FINANCE_USER, 'finance'],
        [PRACTITIONER_USER, 'practitioner'],
      ] as const) {
        const seen = await asRole(userId, roles, async () => {
          const { rows } = await client.query<{ n: string }>(
            'select count(*)::text as n from drive_estimate',
          );
          return rows[0]?.n;
        });
        expect(seen, roles).toBe('1');
      }
      const contact = await asRole(CONTACT_USER, 'client_contact', async () => {
        const { rows } = await client.query<{ n: string }>(
          'select count(*)::text as n from drive_estimate',
        );
        return rows[0]?.n;
      });
      expect(contact).toBe('0');
    });
  });

  it("refuses another practice's cache to everybody", async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'traffic']);
      const seen = await asApiRole(
        client,
        IDS.tenantB,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [IDS.ownerB]);
          const { rows } = await client.query<{ n: string }>(
            'select count(*)::text as n from drive_estimate',
          );
          return rows[0]?.n;
        },
        'owner',
      );
      expect(seen).toBe('0');
    });
  });

  it('lets a practitioner fill it, which is what the day sheet does', async () => {
    await rolledBack(client, async () => {
      await asRole(PRACTITIONER_USER, 'practitioner', async () => {
        await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'straight-line']);
      });
    });
  });

  it('refuses finance and a household filling it', async () => {
    for (const [userId, roles] of [
      [FINANCE_USER, 'finance'],
      [CONTACT_USER, 'client_contact'],
    ] as const) {
      await rolledBack(client, async () => {
        await asRole(userId, roles, async () => {
          await rejectsWith(client, RLS_VIOLATION, INSERT, [
            IDS.tenantA,
            HOME,
            AWAY,
            8,
            1500,
            18000,
            'traffic',
          ]);
        });
      });
    }
  });

  it('lets a practitioner refresh a stale row in place', async () => {
    await rolledBack(client, async () => {
      await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'straight-line']);
      await asRole(PRACTITIONER_USER, 'practitioner', async () => {
        const updated = await client.query(
          "update drive_estimate set seconds = 1400, source = 'traffic', fetched_at = now() " +
            'where from_location_id = $1 and to_location_id = $2 and hour_bucket = 8',
          [HOME, AWAY],
        );
        expect(updated.rowCount).toBe(1);
      });
    });
  });

  it('refuses finance and a household refreshing one, though finance may read it', async () => {
    // The update grant is the one the routing route uses, and it is narrower
    // than the read: finance may look at a drive because a drive is a cost of
    // delivering a visit, and may not touch the figure; a household reaches
    // neither. A restrictive policy that refuses an update filters the row out
    // rather than raising, so the proof is that nothing was written — the
    // statement matched no row, and the figure still says what it said.
    for (const [userId, roles] of [
      [FINANCE_USER, 'finance'],
      [CONTACT_USER, 'client_contact'],
    ] as const) {
      await rolledBack(client, async () => {
        await client.query(INSERT, [IDS.tenantA, HOME, AWAY, 8, 1500, 18000, 'straight-line']);
        await asRole(userId, roles, async () => {
          const updated = await client.query(
            "update drive_estimate set seconds = 60, source = 'traffic' " +
              'where from_location_id = $1 and to_location_id = $2 and hour_bucket = 8',
            [HOME, AWAY],
          );
          expect(updated.rowCount, roles).toBe(0);
        });
        const { rows } = await client.query<{ seconds: number; source: string }>(
          'select seconds, source::text as source from drive_estimate ' +
            'where from_location_id = $1 and to_location_id = $2 and hour_bucket = 8',
          [HOME, AWAY],
        );
        expect(rows[0]?.seconds, roles).toBe(1500);
        expect(rows[0]?.source, roles).toBe('straight-line');
      });
    }
  });

  it('grants nobody a delete: a stale row is overwritten, never removed', async () => {
    const { rows } = await client.query<{ privilege_type: string }>(
      'select privilege_type from information_schema.role_table_grants ' +
        "where table_name = 'drive_estimate' and grantee = 'app_role'",
    );
    expect([...new Set(rows.map((row) => row.privilege_type))].sort()).toEqual([
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
  });
});

describe("the fallback's own figures", () => {
  it('gives every practice a road factor and a peak multiplier it can edit', async () => {
    const { rows } = await client.query<{
      drive_road_factor: string;
      drive_peak_multiplier: string;
    }>(
      'select drive_road_factor::text, drive_peak_multiplier::text from scheduling_setting ' +
        'where tenant_id = $1',
      [IDS.tenantA],
    );
    expect(rows[0]?.drive_road_factor).toBe('1.35');
    expect(rows[0]?.drive_peak_multiplier).toBe('1.50');
  });

  it('refuses a road factor outside anything a road could be', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        'update scheduling_setting set drive_road_factor = 0.5 where tenant_id = $1',
        [IDS.tenantA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        'update scheduling_setting set drive_peak_multiplier = 9 where tenant_id = $1',
        [IDS.tenantA],
      );
    });
  });
});
