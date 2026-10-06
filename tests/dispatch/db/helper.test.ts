import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedPractitioner,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';

/**
 * The helper in the database (migrations 213 and 974,
 * db/policies/dispatch/location.sql, docs/SPEC/dispatch.md section 15.12):
 * whom a helper accompanies is named by the owner or an admin and by nobody
 * else, ended rather than edited; a helper writes only their own positions,
 * and only while they accompany somebody, have agreed and have switched on;
 * the board's roles read a helper's last position alone; another practice
 * reads nothing; the purge and a withdrawal take a helper's positions as they
 * take a practitioner's. Ids in this file's own 78xx block.
 */

const PRACTITIONER_USER = MORE_IDS.practitionerUserA;
const PRACTITIONER = MORE_IDS.practitionerA;
const SECOND_USER = '00000000-0000-4000-8000-000000007801';
const SECOND = '00000000-0000-4000-8000-000000007802';
const HELPER = '00000000-0000-4000-8000-000000007803';
const OTHER_HELPER = '00000000-0000-4000-8000-000000007804';
const LEAD_USER = '00000000-0000-4000-8000-000000007805';
const FINANCE_USER = '00000000-0000-4000-8000-000000007806';
const NEWCOMER = '00000000-0000-4000-8000-000000007807';
const ADMIN_USER = MORE_IDS.adminUserA;

let owner: pg.Client;

/** Runs `fn` as `userId` holding `roles`, under the API role, in practice A, rolled back. */
async function as<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  return rolledBack(owner, async () => {
    await setAuditContext(owner, userId);
    return asApiRole(owner, IDS.tenantA, fn, roles);
  });
}

/** The SQLSTATE a statement fails with, or 'ok'. Inside a savepoint. */
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

const HELPER_POSITION =
  'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres, ' +
  'created_by) values ($1, $2, 25.21, 55.27, 12, $2)';

async function seedSharing(userId: string): Promise<void> {
  await owner.query(
    'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
      "values ($1, $2, 'location_sharing', '1.1', $2)",
    [IDS.tenantA, userId],
  );
  await owner.query(
    'insert into location_sharing (tenant_id, user_id, sharing_on, created_by) values ($1, $2, true, $2)',
    [IDS.tenantA, userId],
  );
}

/** Names, as the owner through the API role, whom `helper` accompanies. */
async function nameAsOwner(helper: string, practitioner: string): Promise<void> {
  await owner.query('begin');
  try {
    await setAuditContext(owner, IDS.ownerA, 'named whom a helper accompanies');
    await asApiRoleCommitted('owner', () =>
      owner.query('select app.name_helper($1, $2)', [helper, practitioner]),
    );
    await owner.query('commit');
  } catch (error) {
    await owner.query('rollback');
    throw error;
  }
}

/** As asApiRole, but keeps the work: sets the role for the rest of the transaction only. */
async function asApiRoleCommitted<T>(roles: string, fn: () => Promise<T>): Promise<T> {
  await owner.query('set local role app_role');
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [IDS.tenantA, roles],
  );
  try {
    return await fn();
  } finally {
    await owner.query('reset role');
  }
}

async function standing(helper: string): Promise<{ practitioner_id: string }[]> {
  const { rows } = await owner.query<{ practitioner_id: string }>(
    'select practitioner_id from helper_accompaniment where helper_user_id = $1 and ended_at is null',
    [helper],
  );
  return rows;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  for (const [id, name, roles] of [
    [PRACTITIONER_USER, 'Synthetic Practitioner A', ['practitioner']],
    [SECOND_USER, 'Synthetic Practitioner B', ['practitioner']],
    [LEAD_USER, 'Synthetic Lead', ['lead_practitioner']],
    [ADMIN_USER, 'Synthetic Admin', ['admin']],
    [FINANCE_USER, 'Synthetic Finance', ['finance']],
    [HELPER, 'Synthetic Helper', []],
    [OTHER_HELPER, 'Synthetic Helper Two', []],
    [NEWCOMER, 'Synthetic Newcomer', ['finance']],
  ] as const) {
    await seedUser(owner, { id, tenantId: IDS.tenantA, authId: null, displayName: name, roles });
  }
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
  await seedPractitioner(owner, IDS.tenantA, SECOND, SECOND_USER);
});

afterAll(async () => {
  await owner.end();
});

describe('whom a helper accompanies', () => {
  it('is named by the owner, which makes the person a helper', async () => {
    await nameAsOwner(HELPER, PRACTITIONER);
    expect(await standing(HELPER)).toEqual([{ practitioner_id: PRACTITIONER }]);
    const { rows } = await owner.query<{ role: string }>(
      'select role::text as role from user_role where user_id = $1',
      [HELPER],
    );
    expect(rows).toEqual([{ role: 'helper' }]);
  });

  it('is named by an admin too, and by nobody else', async () => {
    expect(
      await as(ADMIN_USER, 'admin', () =>
        outcome('select app.name_helper($1, $2)', [OTHER_HELPER, PRACTITIONER]),
      ),
    ).toBe('ok');
    for (const [user, roles] of [
      [LEAD_USER, 'lead_practitioner'],
      [PRACTITIONER_USER, 'practitioner'],
      [FINANCE_USER, 'finance'],
      [HELPER, 'helper'],
    ] as const) {
      expect(
        await as(user, roles, () =>
          outcome('select app.name_helper($1, $2)', [OTHER_HELPER, SECOND]),
        ),
        roles,
      ).toBe('42501');
    }
  });

  it('asks who is calling of user_role, never of the roles the session claims', async () => {
    // A lead whose session claims "owner" is still a lead.
    expect(
      await as(LEAD_USER, 'owner', () =>
        outcome('select app.name_helper($1, $2)', [OTHER_HELPER, SECOND]),
      ),
    ).toBe('42501');
  });

  it('refuses a person who already holds another role, and a practitioner not working', async () => {
    expect(
      await as(IDS.ownerA, 'owner', () =>
        outcome('select app.name_helper($1, $2)', [NEWCOMER, PRACTITIONER]),
      ),
    ).toBe('42501');
    await owner.query("update practitioner set status = 'inactive' where id = $1", [SECOND]);
    expect(
      await as(IDS.ownerA, 'owner', () =>
        outcome('select app.name_helper($1, $2)', [HELPER, SECOND]),
      ),
    ).toBe('42501');
    await owner.query("update practitioner set status = 'active' where id = $1", [SECOND]);
  });

  it('cannot be changed by the helper, who reads their own and nobody else’s', async () => {
    await as(HELPER, 'helper', async () => {
      const { rows } = await owner.query<{ helper_user_id: string }>(
        'select helper_user_id from helper_accompaniment',
      );
      expect(rows).toEqual([{ helper_user_id: HELPER }]);
      expect(
        await outcome(
          'insert into helper_accompaniment (tenant_id, helper_user_id, practitioner_id) values ($1, $2, $3)',
          [IDS.tenantA, HELPER, SECOND],
        ),
      ).toBe('42501');
      expect(
        await outcome(
          'update helper_accompaniment set ended_at = now() where helper_user_id = $1',
          [HELPER],
        ),
      ).toBe('42501');
      expect(await outcome('select app.name_helper($1, $2)', [HELPER, SECOND])).toBe('42501');
    });
  });

  it('is ended and replaced, never edited, when the practitioner changes', async () => {
    await nameAsOwner(HELPER, SECOND);
    const { rows } = await owner.query<{ practitioner_id: string; ended: boolean }>(
      'select practitioner_id, ended_at is not null as ended from helper_accompaniment ' +
        'where helper_user_id = $1 order by started_at, ended_at nulls last',
      [HELPER],
    );
    expect(rows).toEqual([
      { practitioner_id: PRACTITIONER, ended: true },
      { practitioner_id: SECOND, ended: false },
    ]);
    expect(
      await rolledBack(owner, () =>
        outcome(
          'update helper_accompaniment set practitioner_id = $2 where helper_user_id = $1 and ended_at is null',
          [HELPER, PRACTITIONER],
        ),
      ),
    ).toBe('23514');
    expect(
      await rolledBack(owner, () =>
        outcome(
          'update helper_accompaniment set ended_at = now() where helper_user_id = $1 and ended_at is not null',
          [HELPER],
        ),
      ),
    ).toBe('23514');
    // Back to the first practitioner for the rest of this file.
    await nameAsOwner(HELPER, PRACTITIONER);
  });

  it('is audited under whoever named it', async () => {
    const { rows } = await owner.query<{ actor_id: string; action: string }>(
      "select actor_id, action from audit_log where entity_type = 'helper_accompaniment' " +
        'order by id',
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((row) => row.actor_id === IDS.ownerA || row.actor_id === ADMIN_USER)).toBe(
      true,
    );
  });
});

describe("a helper's positions", () => {
  it('are refused before the helper has agreed and switched on', async () => {
    expect(await as(HELPER, 'helper', () => outcome(HELPER_POSITION, [IDS.tenantA, HELPER]))).toBe(
      '42501',
    );
  });

  it('are written by the helper for themselves once they have', async () => {
    await seedSharing(HELPER);
    expect(await as(HELPER, 'helper', () => outcome(HELPER_POSITION, [IDS.tenantA, HELPER]))).toBe(
      'ok',
    );
  });

  it('are never written for anybody else: another helper, or a practitioner', async () => {
    await seedSharing(OTHER_HELPER);
    await as(HELPER, 'helper', async () => {
      expect(await outcome(HELPER_POSITION, [IDS.tenantA, OTHER_HELPER])).toBe('42501');
      expect(
        await outcome(
          'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, ' +
            'accuracy_metres) values ($1, $2, 25.2, 55.27, 10)',
          [IDS.tenantA, PRACTITIONER],
        ),
      ).toBe('42501');
    });
    // Nor by the owner for a helper.
    expect(
      await as(IDS.ownerA, 'owner', () => outcome(HELPER_POSITION, [IDS.tenantA, HELPER])),
    ).toBe('42501');
  });

  it('name exactly one person: a practitioner or a helper, never both, never neither', async () => {
    for (const [practitioner, user] of [
      [PRACTITIONER, HELPER],
      [null, null],
    ] as const) {
      expect(
        await rolledBack(owner, () =>
          outcome(
            'insert into practitioner_position (tenant_id, practitioner_id, user_id, latitude, ' +
              'longitude, accuracy_metres) values ($1, $2, $3, 25.2, 55.27, 10)',
            [IDS.tenantA, practitioner, user],
          ),
        ),
      ).toBe('23514');
    }
  });

  it('take the database clock, whatever the helper sends', async () => {
    const recorded = await rolledBack(owner, async () => {
      await setAuditContext(owner, HELPER);
      return asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await owner.query(
            'insert into practitioner_position (tenant_id, user_id, latitude, longitude, ' +
              "accuracy_metres, recorded_at) values ($1, $2, 25.2, 55.27, 10, now() - interval '3 days')",
            [IDS.tenantA, HELPER],
          );
          await owner.query('reset role');
          const { rows } = await owner.query<{ fresh: boolean }>(
            "select bool_and(recorded_at > now() - interval '1 minute') as fresh " +
              'from practitioner_position where user_id = $1',
            [HELPER],
          );
          return rows[0]?.fresh;
        },
        'helper',
      );
    });
    expect(recorded).toBe(true);
  });

  it('are read by the board’s three roles, the last one only', async () => {
    // Two positions as the table's owner, a second apart: only the later one shows.
    await owner.query(
      'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres, ' +
        'recorded_at) values ($1, $2, 25.21, 55.27, 12, now()), ' +
        "($1, $2, 25.3, 55.3, 9, now() + interval '1 second')",
      [IDS.tenantA, HELPER],
    );
    for (const [user, roles] of [
      [IDS.ownerA, 'owner'],
      [ADMIN_USER, 'admin'],
      [LEAD_USER, 'lead_practitioner'],
    ] as const) {
      const rows = await as(user, roles, async () => {
        const { rows } = await owner.query<{ user_id: string; latitude: number }>(
          'select user_id, latitude from practitioner_position',
        );
        return rows;
      });
      expect(rows, roles).toEqual([{ user_id: HELPER, latitude: 25.3 }]);
    }
  });

  it('are read by nobody else: a practitioner, finance, or the helpers themselves', async () => {
    for (const [user, roles] of [
      [PRACTITIONER_USER, 'practitioner'],
      [FINANCE_USER, 'finance'],
      [HELPER, 'helper'],
      [OTHER_HELPER, 'helper'],
    ] as const) {
      const n = await as(user, roles, async () => {
        const { rows } = await owner.query<{ n: number }>(
          'select count(*)::int as n from practitioner_position',
        );
        return rows[0]?.n;
      });
      expect(n, `${roles} ${user}`).toBe(0);
    }
  });

  it('are read by nobody in another practice', async () => {
    const rows = await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerB);
      return asApiRole(owner, IDS.tenantB, async () => {
        const { rows } = await owner.query('select id from practitioner_position');
        const accompaniments = await owner.query('select id from helper_accompaniment');
        return [...rows, ...accompaniments.rows];
      });
    });
    expect(rows).toEqual([]);
  });

  it('leave the board, and stop being written, once the switch is off', async () => {
    await owner.query('update location_sharing set sharing_on = false where user_id = $1', [
      HELPER,
    ]);
    expect(
      await as(IDS.ownerA, 'owner', async () => {
        const { rows } = await owner.query('select id from practitioner_position');
        return rows.length;
      }),
    ).toBe(0);
    expect(await as(HELPER, 'helper', () => outcome(HELPER_POSITION, [IDS.tenantA, HELPER]))).toBe(
      '42501',
    );
    await owner.query('update location_sharing set sharing_on = true where user_id = $1', [HELPER]);
  });

  it('are deleted by the hourly purge as a practitioner’s are', async () => {
    await owner.query(
      'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres, ' +
        "recorded_at) values ($1, $2, 25.1, 55.1, 9, now() - interval '3 days')",
      [IDS.tenantA, HELPER],
    );
    const purged = await rolledBack(owner, async () => {
      await setAuditContext(owner, ADMIN_USER);
      return asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rows } = await owner.query<{ n: number }>(
            "select app.purge_practitioner_positions(now() - interval '48 hours') as n",
          );
          return rows[0]?.n;
        },
        'admin',
      );
    });
    expect(purged).toBe(1);
  });

  it('are all deleted at once when the helper withdraws', async () => {
    const [before, left] = await rolledBack(owner, async () => {
      await setAuditContext(owner, HELPER);
      return asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await owner.query('reset role');
          const counted = () =>
            owner.query<{ n: number }>(
              'select count(*)::int as n from practitioner_position where user_id = $1',
              [HELPER],
            );
          const first = (await counted()).rows[0]?.n;
          await owner.query('set local role app_role');
          await owner.query('select app.forget_own_positions()');
          await owner.query('reset role');
          return [first, (await counted()).rows[0]?.n];
        },
        'helper',
      );
    });
    expect(before).toBeGreaterThan(0);
    expect(left).toBe(0);
  });
});

describe('revoking a helper', () => {
  it('is refused to a lead, and to the helper', async () => {
    for (const [user, roles] of [
      [LEAD_USER, 'lead_practitioner'],
      [HELPER, 'helper'],
    ] as const) {
      expect(
        await as(user, roles, () => outcome('select app.revoke_helper($1)', [OTHER_HELPER])),
        roles,
      ).toBe('42501');
    }
  });

  it('refuses somebody who is not a helper', async () => {
    expect(
      await as(IDS.ownerA, 'owner', () =>
        outcome('select app.revoke_helper($1)', [PRACTITIONER_USER]),
      ),
    ).toBe('42501');
  });

  it('ends the accompaniment, deletes their positions and suspends their sign-in', async () => {
    await owner.query(
      'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres) ' +
        'values ($1, $2, 25.2, 55.2, 9)',
      [IDS.tenantA, HELPER],
    );
    await owner.query('begin');
    await setAuditContext(owner, ADMIN_USER, 'revoked a helper');
    await asApiRoleCommitted('admin', () => owner.query('select app.revoke_helper($1)', [HELPER]));
    await owner.query('commit');

    expect(await standing(HELPER)).toEqual([]);
    const positions = await owner.query<{ n: number }>(
      'select count(*)::int as n from practitioner_position where user_id = $1',
      [HELPER],
    );
    expect(positions.rows[0]?.n).toBe(0);
    const user = await owner.query<{ status: string }>(
      'select status::text as status from app_user where id = $1',
      [HELPER],
    );
    expect(user.rows).toEqual([{ status: 'suspended' }]);
    // The role row stays, so the person is still found in Settings › Team.
    const roles = await owner.query<{ role: string }>(
      'select role::text as role from user_role where user_id = $1',
      [HELPER],
    );
    expect(roles.rows).toEqual([{ role: 'helper' }]);
  });

  it('leaves a helper with no accompaniment unable to write, and invisible', async () => {
    await owner.query("update app_user set status = 'active' where id = $1", [HELPER]);
    expect(await as(HELPER, 'helper', () => outcome(HELPER_POSITION, [IDS.tenantA, HELPER]))).toBe(
      '42501',
    );
    const { rows } = await owner.query<{ visible: boolean }>(
      "select set_config('app.tenant_id', $1, false) is not null and " +
        'app.helper_position_visible($2) as visible',
      [IDS.tenantA, HELPER],
    );
    expect(rows).toEqual([{ visible: false }]);
    await owner.query("select set_config('app.tenant_id', '', false)");
  });
});
