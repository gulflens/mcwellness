import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, freshDatabase, rolledBack, seedTenant, setAuditContext } from '../../db/helpers';
import { PORTAL, seedPortalHousehold } from './support';

/**
 * The event notifications' floor (migration 708,
 * db/policies/portal/push_events.sql): a member of staff's browsers are
 * theirs alone and only the people who see Enquiries may add one; the
 * delivery reaches a record's household devices and the staff browsers only
 * as the owner or an admin; every event notified is a record of a kind, an id
 * and counts that nobody edits and nobody deletes. Every address and key here
 * is invented and opens nothing.
 */

const RLS_VIOLATION = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const P256DH = `B${'A'.repeat(86)}`;
const AUTH = 'A'.repeat(22);
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/synthetic-staff-${n}`;
const householdEndpoint = (n: number) =>
  `https://fcm.googleapis.com/fcm/send/synthetic-household-${n}`;

const SUBJECT = '00000001-0000-4000-8000-0000000000c1';
const EVENT = '00000001-0000-4000-8000-0000000000c2';

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Another Studio');
});

afterAll(async () => {
  await owner?.end();
});

async function as<T>(
  userId: string | null,
  roles: string,
  fn: () => Promise<T>,
  tenantId: string = IDS.tenantA,
): Promise<T> {
  if (userId === null) {
    await owner.query("select set_config('app.actor_id', '', true)");
  } else {
    await setAuditContext(owner, userId, 'Synthetic test');
  }
  await owner.query('set local role app_role');
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [tenantId, roles],
  );
  try {
    return await fn();
  } finally {
    await owner.query('reset role');
  }
}

/** The delivery's own stamp: `admin`, and nobody pressed anything. */
const delivery = <T>(fn: () => Promise<T>) => as(null, 'admin', fn);

async function codeOf(sql: string, params: unknown[] = []): Promise<string | undefined> {
  await owner.query('savepoint expect_code');
  try {
    await owner.query(sql, params);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await owner.query('rollback to savepoint expect_code');
  }
}

const subscribeSql = 'select app.staff_subscribe_push($1, $2, $3) as id';

async function staffSubscribe(n: number): Promise<void> {
  await owner.query(subscribeSql, [endpoint(n), P256DH, AUTH]);
}

async function visibleStaffDevices(): Promise<string[]> {
  const rows = await owner.query<{ push_endpoint: string }>(
    'select push_endpoint from staff_push_subscription order by push_endpoint',
  );
  return rows.rows.map((row) => row.push_endpoint);
}

describe('a member of staff’s own browsers', () => {
  it('lets the people who see Enquiries add a browser, and read only their own', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.admin, 'admin', () => staffSubscribe(1));
      await as(PORTAL.leadPractitioner, 'lead_practitioner', () => staffSubscribe(2));
      await as(IDS.ownerA, 'owner', () => staffSubscribe(3));
      expect(await as(PORTAL.admin, 'admin', visibleStaffDevices)).toEqual([endpoint(1)]);
      expect(await as(PORTAL.leadPractitioner, 'lead_practitioner', visibleStaffDevices)).toEqual([
        endpoint(2),
      ]);
    });
  });

  it('refuses a practitioner, finance, a helper and a household', async () => {
    await rolledBack(owner, async () => {
      for (const [user, role] of [
        [PORTAL.practitioner, 'practitioner'],
        [PORTAL.finance, 'finance'],
        [PORTAL.practitioner, 'helper'],
        [PORTAL.motherUser, 'client_contact'],
      ] as const) {
        expect(await as(user, role, () => codeOf(subscribeSql, [endpoint(9), P256DH, AUTH]))).toBe(
          RLS_VIOLATION,
        );
      }
    });
  });

  it('refuses a direct insert for somebody else', async () => {
    await rolledBack(owner, async () => {
      expect(
        await as(PORTAL.admin, 'admin', () =>
          codeOf(
            'insert into staff_push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, ' +
              'push_auth, created_by) values ($1, $2, $3, $4, $5, $6)',
            [IDS.tenantA, PORTAL.leadPractitioner, endpoint(4), P256DH, AUTH, PORTAL.admin],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('moves a shared browser to the person signed in now', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.admin, 'admin', () => staffSubscribe(5));
      await as(PORTAL.leadPractitioner, 'lead_practitioner', () => staffSubscribe(5));
      expect(await as(PORTAL.admin, 'admin', visibleStaffDevices)).toEqual([]);
      expect(await as(PORTAL.leadPractitioner, 'lead_practitioner', visibleStaffDevices)).toEqual([
        endpoint(5),
      ]);
    });
  });

  it('never lets one colleague remove another’s browser', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.admin, 'admin', () => staffSubscribe(6));
      const removed = await as(PORTAL.leadPractitioner, 'lead_practitioner', () =>
        owner.query('delete from staff_push_subscription where push_endpoint = $1', [endpoint(6)]),
      );
      expect(removed.rowCount).toBe(0);
      const own = await as(PORTAL.admin, 'admin', () =>
        owner.query('delete from staff_push_subscription where push_endpoint = $1', [endpoint(6)]),
      );
      expect(own.rowCount).toBe(1);
    });
  });
});

describe('what the delivery reaches', () => {
  it('lists a record’s household devices with the facts the rules decide from', async () => {
    await rolledBack(owner, async () => {
      for (const [user, n] of [
        [PORTAL.motherUser, 1],
        [PORTAL.adultUser, 3],
      ] as const) {
        await as(user, 'client_contact', () =>
          owner.query('select app.portal_subscribe_push($1, $2, $3)', [
            householdEndpoint(n),
            P256DH,
            AUTH,
          ]),
        );
      }
      // The minor's own login is refused a device by 707; give it one as the
      // table owner, so this proves the delivery still hands the domain the
      // facts that keep it off.
      await owner.query(
        'insert into push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, ' +
          'push_auth) values ($1, $2, $3, $4, $5)',
        [IDS.tenantA, PORTAL.minorUser, householdEndpoint(2), P256DH, AUTH],
      );
      const rows = await delivery(() =>
        owner.query<{
          user_id: string;
          locale: string;
          push_endpoint: string;
          contacts: { relationship: string }[];
          on_record: { relationship: string; isLegalGuardian: boolean; dateOfBirth: string };
        }>(
          'select user_id, locale::text as locale, push_endpoint, contacts, on_record ' +
            'from app.push_event_household_targets($1) order by push_endpoint',
          [PORTAL.childA],
        ),
      );
      expect(rows.rows.map((row) => [row.user_id, row.push_endpoint])).toEqual([
        [PORTAL.motherUser, householdEndpoint(1)],
        [PORTAL.minorUser, householdEndpoint(2)],
      ]);
      const mother = rows.rows[0]!;
      expect(mother.on_record).toEqual({
        relationship: 'mother',
        // The fixture's mother is not recorded as the first child's legal
        // guardian (she is on the second's), so a report about this child is
        // not hers to be told of.
        isLegalGuardian: false,
        dateOfBirth: '2014-09-05',
      });
      expect(mother.contacts).toHaveLength(2);
      const minor = rows.rows[1]!;
      expect(minor.on_record.relationship).toBe('self');
    });
  });

  it('reaches nobody on an erased record', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.adultUser, 'client_contact', () =>
        owner.query('select app.portal_subscribe_push($1, $2, $3)', [
          householdEndpoint(7),
          P256DH,
          AUTH,
        ]),
      );
      await owner.query("update client set status = 'erased' where id = $1", [PORTAL.adultClient]);
      const rows = await delivery(() =>
        owner.query('select 1 from app.push_event_household_targets($1)', [PORTAL.adultClient]),
      );
      expect(rows.rowCount).toBe(0);
    });
  });

  it('lists every staff browser with the roles its person holds now', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.admin, 'admin', () => staffSubscribe(8));
      await as(PORTAL.leadPractitioner, 'lead_practitioner', () => staffSubscribe(9));
      const rows = await delivery(() =>
        owner.query<{ user_id: string; roles: string[] }>(
          'select user_id, roles from app.push_event_staff_targets() order by push_endpoint',
        ),
      );
      expect(rows.rows).toEqual([
        { user_id: PORTAL.admin, roles: ['admin'] },
        { user_id: PORTAL.leadPractitioner, roles: ['lead_practitioner'] },
      ]);
    });
  });

  it('refuses every target list to anybody but the owner or an admin', async () => {
    await rolledBack(owner, async () => {
      for (const sql of [
        `select * from app.push_event_household_targets('${PORTAL.childA}')`,
        'select * from app.push_event_staff_targets()',
        'select app.staff_push_subscriptions_gone(array[]::uuid[])',
      ]) {
        expect(await as(PORTAL.leadPractitioner, 'lead_practitioner', () => codeOf(sql))).toBe(
          RLS_VIOLATION,
        );
        expect(await as(PORTAL.motherUser, 'client_contact', () => codeOf(sql))).toBe(
          RLS_VIOLATION,
        );
      }
    });
  });

  it('lets the delivery clear a staff browser a push service called gone', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.admin, 'admin', () => staffSubscribe(10));
      const id = (
        await owner.query<{ id: string }>(
          'select id from staff_push_subscription where push_endpoint = $1',
          [endpoint(10)],
        )
      ).rows[0]!.id;
      const gone = await delivery(() =>
        owner.query<{ n: number }>('select app.staff_push_subscriptions_gone($1::uuid[]) as n', [
          [id],
        ]),
      );
      expect(gone.rows[0]?.n).toBe(1);
    });
  });
});

describe('the record of events', () => {
  const insert =
    'insert into push_event (id, tenant_id, kind, subject_id, recipient_count, device_count) ' +
    "values ($1, $2, 'visit_booked', $3, 2, 3)";

  it('is written by the delivery once per kind and subject, and its outcome once', async () => {
    await rolledBack(owner, async () => {
      await delivery(() => owner.query(insert, [EVENT, IDS.tenantA, SUBJECT]));
      expect(
        await delivery(() =>
          codeOf(insert, ['00000001-0000-4000-8000-0000000000c3', IDS.tenantA, SUBJECT]),
        ),
      ).toBe(UNIQUE_VIOLATION);
      await delivery(() =>
        owner.query(
          'update push_event set delivered_count = 2, gone_count = 1, failed_count = 0, ' +
            'delivered_at = now() where id = $1',
          [EVENT],
        ),
      );
      expect(
        await delivery(() =>
          codeOf('update push_event set failed_count = 1 where id = $1', [EVENT]),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('is never edited before its delivery either', async () => {
    await rolledBack(owner, async () => {
      await delivery(() => owner.query(insert, [EVENT, IDS.tenantA, SUBJECT]));
      expect(
        await delivery(() =>
          codeOf("update push_event set kind = 'visit_moved' where id = $1", [EVENT]),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('is deleted by nobody', async () => {
    await rolledBack(owner, async () => {
      await delivery(() => owner.query(insert, [EVENT, IDS.tenantA, SUBJECT]));
      expect(
        await as(IDS.ownerA, 'owner', () =>
          codeOf('delete from push_event where id = $1', [EVENT]),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('is written and read by no one else, and never across practices', async () => {
    await rolledBack(owner, async () => {
      expect(
        await as(PORTAL.leadPractitioner, 'lead_practitioner', () =>
          codeOf(insert, [EVENT, IDS.tenantA, SUBJECT]),
        ),
      ).toBe(RLS_VIOLATION);
      await delivery(() => owner.query(insert, [EVENT, IDS.tenantA, SUBJECT]));
      const lead = await as(PORTAL.leadPractitioner, 'lead_practitioner', () =>
        owner.query('select 1 from push_event'),
      );
      expect(lead.rowCount).toBe(0);
      const elsewhere = await as(
        IDS.ownerB,
        'owner',
        () => owner.query('select 1 from push_event'),
        IDS.tenantB,
      );
      expect(elsewhere.rowCount).toBe(0);
      const admin = await as(PORTAL.admin, 'admin', () => owner.query('select 1 from push_event'));
      expect(admin.rowCount).toBe(1);
    });
  });
});
