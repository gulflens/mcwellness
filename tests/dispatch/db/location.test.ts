import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { runJob } from '@app/api/scheduler';
import type { ServerStorageProvider } from '@app/api/_middleware/storage';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedClient,
  seedContact,
  seedPractitioner,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';
import { STAFF_LOCATION_NOTICE_VERSION } from '@domain/scheduling';

/**
 * Live location in the database (migration 211, db/policies/dispatch/
 * location.sql, docs/SPEC/dispatch.md section 15): nobody turns on anybody
 * else's sharing, the owner included; positions are refused without consent;
 * the board reads only the last one; a household reads none of it; the job
 * deletes what is older than two days and nothing else; and a position never
 * reaches the audit log. Ids in this file's own 75xx block of the reserved
 * range.
 */

const SHARER_USER = MORE_IDS.practitionerUserA;
const SHARER = MORE_IDS.practitionerA;
const OTHER_USER = '00000000-0000-4000-8000-000000007501';
const OTHER = '00000000-0000-4000-8000-000000007502';
const LEAD_USER = '00000000-0000-4000-8000-000000007503';
const FINANCE_USER = '00000000-0000-4000-8000-000000007504';
const CONTACT = '00000000-0000-4000-8000-000000007505';
const ADMIN_USER = MORE_IDS.adminUserA;
const CONTACT_USER = MORE_IDS.contactUserA;

let owner: pg.Client;

/** Runs `fn` as `userId` holding `roles`, under the API role, in practice A, rolled back. */
async function as<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  return rolledBack(owner, async () => {
    await setAuditContext(owner, userId);
    return asApiRole(owner, IDS.tenantA, fn, roles);
  });
}

/** The SQLSTATE a statement fails with, or 'ok'. Inside a savepoint, so the caller's transaction lives on. */
async function outcome(sql: string, params: unknown[] = []): Promise<string> {
  await owner.query('savepoint attempt');
  try {
    await owner.query(sql, params);
    await owner.query('release savepoint attempt');
    return 'ok';
  } catch (error) {
    await owner.query('rollback to savepoint attempt');
    return (error as { code?: string }).code ?? 'unknown';
  }
}

const GIVE =
  'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
  "values ($1, $2, 'location_sharing', '1.2', $2)";
const SWITCH_ON =
  'insert into location_sharing (tenant_id, user_id, sharing_on, created_by) values ($1, $2, true, $2)';
const POSITION =
  'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, ' +
  'accuracy_metres, recorded_at, created_by) values ($1, $2, $3, $4, 15, $5, $6)';

/** As the table's owner, outside row security: the fixture, not the act under test. */
async function seedSharing(userId: string): Promise<void> {
  await owner.query(GIVE, [IDS.tenantA, userId]);
  await owner.query(SWITCH_ON, [IDS.tenantA, userId]);
}

async function seedPosition(
  practitionerId: string,
  userId: string,
  recordedAt: Date,
  latitude = 25.2,
): Promise<void> {
  await owner.query(POSITION, [IDS.tenantA, practitionerId, latitude, 55.27, recordedAt, userId]);
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedUser(owner, {
    id: SHARER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, SHARER, SHARER_USER);
  await seedUser(owner, {
    id: OTHER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner B',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, OTHER, OTHER_USER);
  await seedUser(owner, {
    id: LEAD_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Lead',
    roles: ['lead_practitioner'],
  });
  await seedUser(owner, {
    id: ADMIN_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });
  await seedUser(owner, {
    id: CONTACT_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
  });
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedContact(owner, IDS.tenantA, CONTACT, IDS.clientA, 'x-location');
  await owner.query('update contact set user_id = $1 where id = $2', [CONTACT_USER, CONTACT]);
});

afterAll(async () => {
  await owner.end();
});

describe('nobody turns on anybody else', () => {
  it("refuses the owner giving consent on a practitioner's behalf", async () => {
    await as(IDS.ownerA, 'owner', async () => {
      expect(await outcome(GIVE, [IDS.tenantA, SHARER_USER])).toBe('42501');
    });
  });

  it("refuses the owner switching a practitioner's sharing on", async () => {
    await as(IDS.ownerA, 'owner', async () => {
      expect(await outcome(SWITCH_ON, [IDS.tenantA, SHARER_USER])).toBe('42501');
    });
  });

  it("leaves a practitioner's switch untouched when the owner tries to turn it", async () => {
    await rolledBack(owner, async () => {
      await owner.query(
        'insert into location_sharing (tenant_id, user_id, sharing_on) values ($1, $2, false)',
        [IDS.tenantA, SHARER_USER],
      );
      await setAuditContext(owner, IDS.ownerA);
      const changed = await asApiRole(owner, IDS.tenantA, async () => {
        const { rowCount } = await owner.query(
          'update location_sharing set sharing_on = true where user_id = $1',
          [SHARER_USER],
        );
        return rowCount;
      });
      expect(changed).toBe(0);
      const { rows } = await owner.query<{ sharing_on: boolean }>(
        'select sharing_on from location_sharing where user_id = $1',
        [SHARER_USER],
      );
      expect(rows[0]?.sharing_on).toBe(false);
    });
  });

  it('refuses one practitioner giving consent for another', async () => {
    await as(OTHER_USER, 'practitioner', async () => {
      expect(await outcome(GIVE, [IDS.tenantA, SHARER_USER])).toBe('42501');
    });
  });

  it('admits the person giving their own consent and turning their own switch on', async () => {
    await as(SHARER_USER, 'practitioner', async () => {
      expect(await outcome(GIVE, [IDS.tenantA, SHARER_USER])).toBe('ok');
      expect(await outcome(SWITCH_ON, [IDS.tenantA, SHARER_USER])).toBe('ok');
    });
  });

  it('keeps a consent as evidence: it is withdrawn once, and never edited', async () => {
    await rolledBack(owner, async () => {
      await owner.query(GIVE, [IDS.tenantA, SHARER_USER]);
      expect(await outcome("update staff_consent set notice_version = '2.0'")).toBe('23514');
      expect(await outcome('update staff_consent set withdrawn_at = now()')).toBe('ok');
      expect(await outcome('update staff_consent set withdrawn_at = now()')).toBe('23514');
    });
  });

  it('holds one standing consent per person', async () => {
    await rolledBack(owner, async () => {
      await owner.query(GIVE, [IDS.tenantA, SHARER_USER]);
      expect(await outcome(GIVE, [IDS.tenantA, SHARER_USER])).toBe('23505');
    });
  });
});

describe('who reads the consent and the switch', () => {
  it("shows the owner and an admin who has consented, and nobody else anybody's", async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      const count = async (userId: string, roles: string): Promise<number> => {
        await setAuditContext(owner, userId);
        return asApiRole(
          owner,
          IDS.tenantA,
          async () =>
            (
              await owner.query<{ n: number }>(
                'select (select count(*)::int from staff_consent) + ' +
                  '(select count(*)::int from location_sharing) as n',
              )
            ).rows[0]?.n ?? 0,
          roles,
        );
      };
      expect(await count(IDS.ownerA, 'owner')).toBe(2);
      expect(await count(ADMIN_USER, 'admin')).toBe(2);
      expect(await count(SHARER_USER, 'practitioner')).toBe(2);
      expect(await count(LEAD_USER, 'lead_practitioner')).toBe(0);
      expect(await count(OTHER_USER, 'practitioner')).toBe(0);
      expect(await count(FINANCE_USER, 'finance')).toBe(0);
      expect(await count(CONTACT_USER, 'client_contact')).toBe(0);
    });
  });
});

describe('positions are written only with consent and the switch on', () => {
  const now = new Date();

  it('refuses a position from somebody who has not consented', async () => {
    await rolledBack(owner, async () => {
      await owner.query(SWITCH_ON, [IDS.tenantA, SHARER_USER]);
      await setAuditContext(owner, SHARER_USER);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect(
            await outcome(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, now, SHARER_USER]),
          ).toBe('42501');
        },
        'practitioner',
      );
    });
  });

  it('refuses a position once the consent is withdrawn', async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await owner.query('update staff_consent set withdrawn_at = now() where user_id = $1', [
        SHARER_USER,
      ]);
      await setAuditContext(owner, SHARER_USER);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect(
            await outcome(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, now, SHARER_USER]),
          ).toBe('42501');
        },
        'practitioner',
      );
    });
  });

  it('refuses a position with consent but the switch off', async () => {
    await rolledBack(owner, async () => {
      await owner.query(GIVE, [IDS.tenantA, SHARER_USER]);
      await setAuditContext(owner, SHARER_USER);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect(
            await outcome(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, now, SHARER_USER]),
          ).toBe('42501');
        },
        'practitioner',
      );
    });
  });

  it("admits a position with consent and the switch on, for the person's own row only", async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedSharing(OTHER_USER);
      await setAuditContext(owner, SHARER_USER);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect(
            await outcome(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, now, SHARER_USER]),
          ).toBe('ok');
          // A colleague's row, though the colleague is sharing too.
          expect(await outcome(POSITION, [IDS.tenantA, OTHER, 25.2, 55.27, now, SHARER_USER])).toBe(
            '42501',
          );
        },
        'practitioner',
      );
    });
  });
});

describe('the board reads only the last position', () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  async function visible(userId: string, roles: string): Promise<{ latitude: number }[]> {
    await setAuditContext(owner, userId);
    return asApiRole(
      owner,
      IDS.tenantA,
      async () =>
        (
          await owner.query<{ latitude: number }>(
            'select latitude from practitioner_position order by latitude',
          )
        ).rows,
      roles,
    );
  }

  it('gives the owner, an admin and the lead one row per sharer: the latest', async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(20), 25.1);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(2), 25.3);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(10), 25.2);
      for (const [userId, roles] of [
        [IDS.ownerA, 'owner'],
        [ADMIN_USER, 'admin'],
        [LEAD_USER, 'lead_practitioner'],
      ] as const) {
        expect(await visible(userId, roles), roles).toEqual([{ latitude: 25.3 }]);
      }
    });
  });

  it('shows nothing of somebody who has turned their switch off', async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(2));
      await owner.query('update location_sharing set sharing_on = false where user_id = $1', [
        SHARER_USER,
      ]);
      expect(await visible(ADMIN_USER, 'admin')).toEqual([]);
    });
  });

  it('shows a household, finance, and the practitioners themselves nothing at all', async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(2));
      expect(await visible(CONTACT_USER, 'client_contact')).toEqual([]);
      expect(await visible(FINANCE_USER, 'finance')).toEqual([]);
      expect(await visible(SHARER_USER, 'practitioner')).toEqual([]);
      expect(await visible(OTHER_USER, 'practitioner')).toEqual([]);
    });
  });

  it('shows another practice nothing', async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedPosition(SHARER, SHARER_USER, minutesAgo(2));
      await setAuditContext(owner, IDS.ownerB);
      const rows = await asApiRole(owner, IDS.tenantB, async () => {
        return (await owner.query('select id from practitioner_position')).rows;
      });
      expect(rows).toEqual([]);
    });
  });
});

describe('a withdrawal forgets', () => {
  it("deletes the person's own positions at once and nobody else's", async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await seedSharing(OTHER_USER);
      await seedPosition(SHARER, SHARER_USER, new Date());
      await seedPosition(OTHER, OTHER_USER, new Date());
      await setAuditContext(owner, SHARER_USER);
      // Read back before asApiRole's savepoint is rolled back, as the owner.
      const { deleted, left } = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const n = (await owner.query<{ n: number }>('select app.forget_own_positions() as n'))
            .rows[0]?.n;
          await owner.query('reset role');
          const { rows } = await owner.query<{ practitioner_id: string }>(
            'select practitioner_id from practitioner_position',
          );
          return { deleted: n, left: rows.map((row) => row.practitioner_id) };
        },
        'practitioner',
      );
      expect(deleted).toBe(1);
      expect(left).toEqual([OTHER]);
    });
  });
});

describe('the two-day limit', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

  it('deletes positions older than two days, keeps the rest, and runs again to no effect', async () => {
    await seedSharing(SHARER_USER);
    await seedPosition(SHARER, SHARER_USER, hoursAgo(72), 25.1);
    await seedPosition(SHARER, SHARER_USER, hoursAgo(49), 25.2);
    await seedPosition(SHARER, SHARER_USER, hoursAgo(47), 25.3);
    await seedPosition(SHARER, SHARER_USER, hoursAgo(1), 25.4);
    // Another practice's old position is that practice's run's to delete.
    await seedUser(owner, {
      id: '00000000-0000-4000-8000-000000007506',
      tenantId: IDS.tenantB,
      authId: null,
      displayName: 'Synthetic Practitioner Elsewhere',
      roles: ['practitioner'],
    });
    await seedPractitioner(
      owner,
      IDS.tenantB,
      '00000000-0000-4000-8000-000000007507',
      '00000000-0000-4000-8000-000000007506',
    );
    await owner.query(POSITION, [
      IDS.tenantB,
      '00000000-0000-4000-8000-000000007507',
      25.9,
      55.27,
      hoursAgo(72),
      '00000000-0000-4000-8000-000000007506',
    ]);

    const pool = createPool(process.env.API_DATABASE_URL ?? '');
    const lines: string[] = [];
    const storage = {} as ServerStorageProvider;
    try {
      await runJob('location-positions', { pool, storage, log: (line) => lines.push(line) });
      const { rows } = await owner.query<{ latitude: number }>(
        'select latitude from practitioner_position order by latitude',
      );
      expect(rows.map((row) => row.latitude)).toEqual([25.3, 25.4]);
      expect(lines.join('\n')).toContain('practice 1, 2 old positions deleted');

      lines.length = 0;
      await runJob('location-positions', { pool, storage, log: (line) => lines.push(line) });
      expect((await owner.query('select latitude from practitioner_position')).rows).toHaveLength(
        2,
      );
      expect(lines.join('\n')).not.toContain('did not run');
      // No line names a position, a coordinate or a person: a count and nothing else.
      expect(lines.join('\n')).not.toMatch(/25\.|55\.|0000/);
    } finally {
      await pool.end();
      await owner.query('delete from practitioner_position');
      await owner.query('delete from location_sharing');
      await owner.query('delete from staff_consent');
    }
  });

  it('refuses the delete to anybody but the office', async () => {
    await as(SHARER_USER, 'practitioner', async () => {
      expect(
        await outcome("select app.purge_practitioner_positions(now() - interval '2 days')"),
      ).toBe('42501');
    });
  });

  it('refuses a cutoff in the future, which would delete what is still owed two days', async () => {
    await as(ADMIN_USER, 'admin', async () => {
      expect(
        await outcome("select app.purge_practitioner_positions(now() + interval '1 hour')"),
      ).toBe('23514');
    });
  });
});

describe('positions never reach the audit log', () => {
  it('writes no audit row for a position written, read or deleted; the consent is audited', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, SHARER_USER);
      const rows = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await owner.query(GIVE, [IDS.tenantA, SHARER_USER]);
          await owner.query(SWITCH_ON, [IDS.tenantA, SHARER_USER]);
          await owner.query(POSITION, [
            IDS.tenantA,
            SHARER,
            25.123456,
            55.654321,
            new Date(),
            SHARER_USER,
          ]);
          await owner.query('select app.forget_own_positions()');
          // Read back before asApiRole's savepoint is rolled back, as the owner.
          await owner.query('reset role');
          return (
            await owner.query<{ entity_type: string; body: string }>(
              'select entity_type, ' +
                "coalesce(old_values::text, '') || coalesce(new_values::text, '') as body " +
                'from audit_log',
            )
          ).rows;
        },
        'practitioner',
      );
      const types = rows.map((row) => row.entity_type);
      expect(types).toContain('staff_consent');
      expect(types).toContain('location_sharing');
      expect(types).not.toContain('practitioner_position');
      const everything = rows.map((row) => row.body).join(' ');
      expect(everything).not.toContain('25.123456');
      expect(everything).not.toContain('55.654321');
    });
  });
});

describe('fix round 1: the database floor', () => {
  it("stamps recorded_at with the server's clock, whatever the writer sends", async () => {
    await rolledBack(owner, async () => {
      await seedSharing(SHARER_USER);
      await setAuditContext(owner, SHARER_USER);
      const stamps = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const future = new Date(Date.now() + 24 * 3_600_000);
          const stale = new Date(Date.now() - 72 * 3_600_000);
          await owner.query(POSITION, [IDS.tenantA, SHARER, 25.1, 55.27, future, SHARER_USER]);
          await owner.query(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, stale, SHARER_USER]);
          await owner.query('reset role');
          return (
            await owner.query<{ drift: number }>(
              'select abs(extract(epoch from recorded_at - now()))::int as drift ' +
                'from practitioner_position',
            )
          ).rows;
        },
        'practitioner',
      );
      expect(stamps).toHaveLength(2);
      for (const stamp of stamps) expect(stamp.drift).toBeLessThan(5);
    });
  });

  it("stamps the server's clock for any writer but the table's owner, not only the API role", async () => {
    await rolledBack(owner, async () => {
      // A role granted insert some day after this one — not app_role, and not
      // the owner. It bypasses row security so only the stamp is under test.
      await owner.query('create role zz_position_writer bypassrls');
      await owner.query('grant insert on practitioner_position to zz_position_writer');
      await owner.query('grant zz_position_writer to current_user with set true');
      await owner.query('set local role zz_position_writer');
      await owner.query(POSITION, [
        IDS.tenantA,
        SHARER,
        25.3,
        55.27,
        new Date(Date.now() + 24 * 3_600_000),
        SHARER_USER,
      ]);
      await owner.query('reset role');
      const { rows } = await owner.query<{ drift: number }>(
        'select abs(extract(epoch from recorded_at - now()))::int as drift ' +
          'from practitioner_position where latitude = 25.3',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.drift).toBeLessThan(5);
    });
  });

  it('refuses a position and hides the last one when the consent names an older notice', async () => {
    await rolledBack(owner, async () => {
      await owner.query(
        'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
          "values ($1, $2, 'location_sharing', '1.0', $2)",
        [IDS.tenantA, SHARER_USER],
      );
      await owner.query(SWITCH_ON, [IDS.tenantA, SHARER_USER]);
      await seedPosition(SHARER, SHARER_USER, new Date());
      await setAuditContext(owner, SHARER_USER);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect(
            await outcome(POSITION, [IDS.tenantA, SHARER, 25.2, 55.27, new Date(), SHARER_USER]),
          ).toBe('42501');
        },
        'practitioner',
      );
      await setAuditContext(owner, ADMIN_USER);
      const seen = await asApiRole(
        owner,
        IDS.tenantA,
        async () => (await owner.query('select id from practitioner_position')).rows,
        'admin',
      );
      expect(seen).toEqual([]);
    });
  });

  it('knows the notice version the domain asks consent to', async () => {
    const { rows } = await owner.query<{ v: string }>(
      'select app.staff_location_notice_version() as v',
    );
    expect(rows[0]?.v).toBe(STAFF_LOCATION_NOTICE_VERSION);
  });

  it('deletes a position stamped in the future, however it got there', async () => {
    await owner.query('delete from practitioner_position');
    await owner.query('delete from location_sharing');
    await owner.query('delete from staff_consent');
    await seedSharing(SHARER_USER);
    // Only the table's owner — a restore, a data step — can write such a row;
    // the API's own role is stamped with the server's clock.
    await seedPosition(SHARER, SHARER_USER, new Date(Date.now() + 24 * 3_600_000), 25.8);
    await seedPosition(SHARER, SHARER_USER, new Date(), 25.4);
    const pool = createPool(process.env.API_DATABASE_URL ?? '');
    try {
      await runJob('location-positions', {
        pool,
        storage: {} as ServerStorageProvider,
        log: () => undefined,
      });
      const { rows } = await owner.query<{ latitude: number }>(
        'select latitude from practitioner_position',
      );
      expect(rows.map((row) => row.latitude)).toEqual([25.4]);
    } finally {
      await pool.end();
      await owner.query('delete from practitioner_position');
    }
  });
});
