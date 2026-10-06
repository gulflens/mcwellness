import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedTenant,
  setAuditContext,
} from '../../db/helpers';
import { PORTAL, asContact, seedPortalHousehold } from './support';

/**
 * The announcements table and its floor (migration 705,
 * db/policies/portal/announcement.sql; docs/SPEC/client-portal.md sections
 * 6.5 and 6.7).
 *
 * Read as `app_role` with each person's own stamp, which is what a request
 * is: a household reads only the current announcements of its own practice,
 * a young person's own login reads none, and nobody edits one once it is
 * published. Every row here is invented and names nobody.
 */

const RLS_VIOLATION = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const A = {
  current: '00000001-0000-4000-8000-0000000000d1',
  endingSoon: '00000001-0000-4000-8000-0000000000d2',
  withdrawn: '00000001-0000-4000-8000-0000000000d3',
  future: '00000001-0000-4000-8000-0000000000d4',
  ended: '00000001-0000-4000-8000-0000000000d5',
  otherPractice: '00000001-0000-4000-8000-0000000000d6',
  /** Written inside a test and rolled back with it. */
  fresh: '00000001-0000-4000-8000-0000000000d7',
  correction: '00000001-0000-4000-8000-0000000000d8',
  secondCorrection: '00000001-0000-4000-8000-0000000000d9',
} as const;

const CURRENT_TENANT_A = [A.current, A.endingSoon].sort();
const EVERY_TENANT_A = [A.current, A.endingSoon, A.withdrawn, A.future, A.ended].sort();

/** The practice's own today, as SQL, offset by whole days. */
const DAY = (offset: number) =>
  `((select (now() at time zone t.timezone)::date from tenant t where t.id = $2) + ${offset})`;

async function insertAnnouncement(
  owner: pg.Client,
  row: {
    id: string;
    tenantId?: string;
    createdBy?: string;
    createdDaysAgo?: number;
    from?: number | null;
    until?: number | null;
    withdrawn?: boolean;
  },
): Promise<void> {
  const tenantId = row.tenantId ?? IDS.tenantA;
  const by = row.createdBy ?? IDS.ownerA;
  await owner.query(
    'insert into announcement (id, tenant_id, title_en, title_ar, body_en, body_ar, ' +
      'visible_from, visible_until, withdrawn_at, withdrawn_by, created_at, created_by) ' +
      "values ($1, $2, 'Closed for the holiday', 'مغلق في العطلة', " +
      "'The studio is closed on Thursday.', 'الاستوديو مغلق يوم الخميس.', " +
      `${row.from === undefined || row.from === null ? 'null' : DAY(row.from)}, ` +
      `${row.until === undefined || row.until === null ? 'null' : DAY(row.until)}, ` +
      `${row.withdrawn ? 'now()' : 'null'}, ${row.withdrawn ? '$3::uuid' : 'null'}, ` +
      `now() - interval '${row.createdDaysAgo ?? 2} days', $3)`,
    [row.id, tenantId, by],
  );
}

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Another Studio');

  await insertAnnouncement(owner, { id: A.current });
  await insertAnnouncement(owner, { id: A.endingSoon, until: 3 });
  await insertAnnouncement(owner, { id: A.withdrawn, withdrawn: true });
  await insertAnnouncement(owner, { id: A.future, from: 5 });
  await insertAnnouncement(owner, { id: A.ended, createdDaysAgo: 10, until: -1 });
  await insertAnnouncement(owner, {
    id: A.otherPractice,
    tenantId: IDS.tenantB,
    createdBy: IDS.ownerB,
  });
});

afterAll(async () => {
  await owner?.end();
});

async function ids(): Promise<string[]> {
  const rows = await owner.query<{ id: string }>('select id from announcement order by id');
  return rows.rows.map((row) => row.id);
}

async function expectCode(sql: string, params: unknown[], code: string): Promise<void> {
  await owner.query('savepoint expect_code');
  let seen: string | undefined;
  try {
    await owner.query(sql, params);
  } catch (error) {
    seen = (error as { code?: string }).code;
  } finally {
    await owner.query('rollback to savepoint expect_code');
  }
  expect(seen, sql).toBe(code);
}

/** As one of the practice's people, stamped as themselves. */
async function asStaff<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  await setAuditContext(owner, userId);
  return asApiRole(owner, IDS.tenantA, fn, roles);
}

describe('reading: the office reads every one, a household the current ones', () => {
  it('shows the owner and an admin every announcement of their own practice', async () => {
    await rolledBack(owner, async () => {
      expect(await asStaff(IDS.ownerA, 'owner', ids)).toEqual(EVERY_TENANT_A);
      expect(await asStaff(PORTAL.admin, 'admin', ids)).toEqual(EVERY_TENANT_A);
    });
  });

  it('shows a household only the current ones: never withdrawn, not yet begun or ended', async () => {
    await rolledBack(owner, async () => {
      expect(await asContact(owner, PORTAL.motherUser, ids)).toEqual(CURRENT_TENANT_A);
      expect(await asContact(owner, PORTAL.adultUser, ids)).toEqual(CURRENT_TENANT_A);
    });
  });

  it("shows a young person's own login none at all", async () => {
    await rolledBack(owner, async () => {
      expect(await asContact(owner, PORTAL.minorUser, ids)).toEqual([]);
    });
  });

  it('shows the rest of the practice none, as staff', async () => {
    await rolledBack(owner, async () => {
      for (const [user, role] of [
        [PORTAL.leadPractitioner, 'lead_practitioner'],
        [PORTAL.practitioner, 'practitioner'],
        [PORTAL.finance, 'finance'],
      ] as const) {
        expect(await asStaff(user, role, ids), role).toEqual([]);
      }
    });
  });

  it("never shows one practice another practice's announcements", async () => {
    await rolledBack(owner, async () => {
      expect(await asContact(owner, PORTAL.motherUser, ids)).not.toContain(A.otherPractice);
      expect(await asStaff(IDS.ownerA, 'owner', ids)).not.toContain(A.otherPractice);
      await setAuditContext(owner, IDS.ownerB);
      const theirs = await asApiRole(owner, IDS.tenantB, ids, 'owner');
      expect(theirs).toEqual([A.otherPractice]);
    });
  });

  it('shows none to a stamp with no practice at all', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      expect(await asApiRole(owner, null, ids, 'client_contact')).toEqual([]);
    });
  });
});

const INSERT =
  'insert into announcement (id, tenant_id, title_en, title_ar, body_en, body_ar, created_by, ' +
  'withdrawn_at, withdrawn_by, supersedes_id) values ($1, $2, $3, $4, ' +
  "'The studio is closed on Thursday.', 'الاستوديو مغلق يوم الخميس.', $5, $6, $7, $8)";

function insertParams(
  overrides: Partial<{
    id: string;
    titleEn: string;
    titleAr: string;
    createdBy: string;
    withdrawnAt: Date | null;
    withdrawnBy: string | null;
    supersedes: string | null;
  }> = {},
): unknown[] {
  return [
    overrides.id ?? A.fresh,
    IDS.tenantA,
    overrides.titleEn ?? 'A new practitioner',
    overrides.titleAr ?? 'ممارسة جديدة',
    overrides.createdBy ?? PORTAL.admin,
    overrides.withdrawnAt ?? null,
    overrides.withdrawnBy ?? null,
    overrides.supersedes ?? null,
  ];
}

describe('publishing: the owner and an admin, as themselves', () => {
  it('lets an admin publish one in their own name', async () => {
    await rolledBack(owner, async () => {
      const result = await asStaff(PORTAL.admin, 'admin', () =>
        owner.query(INSERT, insertParams()),
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses one published in somebody else’s name', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', () =>
        expectCode(INSERT, insertParams({ createdBy: IDS.ownerA }), RLS_VIOLATION),
      );
    });
  });

  it('refuses one born already withdrawn', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', () =>
        expectCode(
          INSERT,
          insertParams({ withdrawnAt: new Date(), withdrawnBy: PORTAL.admin }),
          RLS_VIOLATION,
        ),
      );
    });
  });

  it('refuses a household and the rest of the practice', async () => {
    await rolledBack(owner, async () => {
      await asContact(owner, PORTAL.motherUser, () =>
        expectCode(INSERT, insertParams({ createdBy: PORTAL.motherUser }), RLS_VIOLATION),
      );
      for (const [user, role] of [
        [PORTAL.leadPractitioner, 'lead_practitioner'],
        [PORTAL.practitioner, 'practitioner'],
        [PORTAL.finance, 'finance'],
      ] as const) {
        await asStaff(user, role, () =>
          expectCode(INSERT, insertParams({ createdBy: user }), RLS_VIOLATION),
        );
      }
    });
  });

  it('refuses a title longer than eighty characters, or an empty Arabic', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', async () => {
        await expectCode(INSERT, insertParams({ titleEn: 'a'.repeat(81) }), CHECK_VIOLATION);
        await expectCode(INSERT, insertParams({ titleAr: '   ' }), CHECK_VIOLATION);
      });
    });
  });

  it('refuses a last day before the first', async () => {
    await rolledBack(owner, async () => {
      await expectCode(
        'insert into announcement (tenant_id, title_en, title_ar, body_en, body_ar, ' +
          "visible_from, visible_until) values ($1, 'A title', 'عنوان', 'A body.', 'نص.', " +
          "'2026-10-10', '2026-10-09')",
        [IDS.tenantA],
        CHECK_VIOLATION,
      );
    });
  });

  it('admits one correction of an announcement, and not a second', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', async () => {
        await owner.query(INSERT, insertParams({ id: A.correction, supersedes: A.current }));
        await expectCode(
          INSERT,
          insertParams({ id: A.secondCorrection, supersedes: A.current }),
          UNIQUE_VIOLATION,
        );
      });
    });
  });
});

describe('never edited in place: withdrawn, once, and nothing else', () => {
  it('refuses a change to the words of a published announcement, even to the table owner', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', () =>
        expectCode(
          "update announcement set title_en = 'Something else' where id = $1",
          [A.current],
          CHECK_VIOLATION,
        ),
      );
      await expectCode(
        "update announcement set body_ar = 'شيء آخر' where id = $1",
        [A.current],
        CHECK_VIOLATION,
      );
      await expectCode(
        'update announcement set visible_until = current_date + 30 where id = $1',
        [A.current],
        CHECK_VIOLATION,
      );
    });
  });

  it('lets an admin withdraw one in their own name', async () => {
    await rolledBack(owner, async () => {
      const result = await asStaff(PORTAL.admin, 'admin', () =>
        owner.query(
          'update announcement set withdrawn_at = now(), withdrawn_by = $2 where id = $1',
          [A.current, PORTAL.admin],
        ),
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a withdrawal in somebody else’s name, or by a household', async () => {
    await rolledBack(owner, async () => {
      await asStaff(PORTAL.admin, 'admin', () =>
        expectCode(
          'update announcement set withdrawn_at = now(), withdrawn_by = $2 where id = $1',
          [A.current, IDS.ownerA],
          RLS_VIOLATION,
        ),
      );
      const touched = await asContact(owner, PORTAL.motherUser, () =>
        owner.query(
          'update announcement set withdrawn_at = now(), withdrawn_by = $2 where id = $1',
          [A.current, PORTAL.motherUser],
        ),
      );
      expect(touched.rowCount).toBe(0);
    });
  });

  it('refuses to withdraw one twice, or to bring one back', async () => {
    await rolledBack(owner, async () => {
      await expectCode(
        'update announcement set withdrawn_at = now(), withdrawn_by = $2 where id = $1',
        [A.withdrawn, IDS.ownerA],
        CHECK_VIOLATION,
      );
      await expectCode(
        'update announcement set withdrawn_at = null, withdrawn_by = null where id = $1',
        [A.withdrawn],
        CHECK_VIOLATION,
      );
    });
  });

  it('refuses a withdrawal that names when and not who', async () => {
    await rolledBack(owner, async () => {
      await expectCode(
        'update announcement set withdrawn_at = now() where id = $1',
        [A.current],
        CHECK_VIOLATION,
      );
    });
  });

  it('deletes for nobody', async () => {
    await rolledBack(owner, async () => {
      await asStaff(IDS.ownerA, 'owner', () =>
        expectCode('delete from announcement where id = $1', [A.current], RLS_VIOLATION),
      );
    });
  });
});

describe('the trail', () => {
  it('records a publication and a withdrawal with the reason given, and no client', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.admin, 'The studio closes for the holiday');
      await owner.query("select set_config('app.tenant_id', $1, true)", [IDS.tenantA]);
      await owner.query(INSERT, insertParams());
      await setAuditContext(owner, PORTAL.admin, 'The dates were wrong');
      await owner.query(
        'update announcement set withdrawn_at = now(), withdrawn_by = $2 where id = $1',
        [A.fresh, PORTAL.admin],
      );
      const trail = await owner.query<{
        action: string;
        reason: string | null;
        client_id: string | null;
        actor_id: string | null;
      }>(
        'select action, reason, client_id, actor_id from audit_log ' +
          "where entity_type = 'announcement' and entity_id = $1 order by id",
        [A.fresh],
      );
      expect(trail.rows).toEqual([
        {
          action: 'insert',
          reason: 'The studio closes for the holiday',
          client_id: null,
          actor_id: PORTAL.admin,
        },
        {
          action: 'update',
          reason: 'The dates were wrong',
          client_id: null,
          actor_id: PORTAL.admin,
        },
      ]);
    });
  });
});
