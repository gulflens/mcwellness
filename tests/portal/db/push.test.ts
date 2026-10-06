import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, freshDatabase, rolledBack, seedTenant, setAuditContext } from '../../db/helpers';
import { PORTAL, seedConsent, seedPortalHousehold, seedWording } from './support';

/**
 * The phone notifications' floor (migration 707, db/policies/portal/push.sql;
 * the push memo's decisions 2 and 3).
 *
 * A person's devices are theirs alone; the practice learns how many and never
 * an address; every message sent is a record nobody edits; and another
 * practice sees none of it. Read as `app_role` with each person's own stamp.
 * Every row, address and key here is invented and opens nothing.
 */

const RLS_VIOLATION = '42501';
const CHECK_VIOLATION = '23514';

/** Base64url shapes of the right lengths: 65 bytes and 16 bytes. */
const P256DH = `B${'A'.repeat(86)}`;
const AUTH = 'A'.repeat(22);
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/synthetic-device-${n}`;

const WORDING = '00000001-0000-4000-8000-0000000000a1';
const M = {
  first: '00000001-0000-4000-8000-0000000000b1',
  second: '00000001-0000-4000-8000-0000000000b2',
  third: '00000001-0000-4000-8000-0000000000b3',
  announcement: '00000001-0000-4000-8000-0000000000b4',
  otherPractice: '00000001-0000-4000-8000-0000000000b5',
} as const;

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Another Studio');
  await seedWording(owner, {
    id: WORDING,
    purpose: 'marketing',
    locale: 'en',
    version: '1.0',
    status: 'approved',
  });
});

afterAll(async () => {
  await owner?.end();
});

/** As one person, stamped as themselves; writes stand until the test's rollback. */
async function as<T>(
  userId: string,
  roles: string,
  fn: () => Promise<T>,
  tenantId: string = IDS.tenantA,
): Promise<T> {
  await setAuditContext(owner, userId, 'Synthetic test');
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

const household = <T>(userId: string, fn: () => Promise<T>) => as(userId, 'client_contact', fn);
const admin = <T>(fn: () => Promise<T>) => as(PORTAL.admin, 'admin', fn);

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

async function subscribe(n: number): Promise<string> {
  const rows = await owner.query<{ id: string }>(
    'select app.portal_subscribe_push($1, $2, $3) as id',
    [endpoint(n), P256DH, AUTH],
  );
  return rows.rows[0]?.id as string;
}

async function visibleSubscriptions(): Promise<string[]> {
  const rows = await owner.query<{ push_endpoint: string }>(
    'select push_endpoint from push_subscription order by push_endpoint',
  );
  return rows.rows.map((row) => row.push_endpoint);
}

async function sendAsAdmin(id: string, kind: 'announcement' | 'offer', createdAt = 'now()') {
  await owner.query(
    'insert into push_message (id, tenant_id, kind, title_en, title_ar, body_en, body_ar, ' +
      'recipient_count, device_count, created_by, created_at) values ($1, $2, $3::push_kind, ' +
      "'News', 'خبر', 'Practice news.', 'خبر من المركز.', 1, 1, $4, " +
      `${createdAt})`,
    [id, IDS.tenantA, kind, PORTAL.admin],
  );
}

describe('a person’s own devices', () => {
  it('lets an adult add a device for themselves and read only their own', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      await household(PORTAL.adultUser, () => subscribe(2));
      expect(await household(PORTAL.motherUser, visibleSubscriptions)).toEqual([endpoint(1)]);
      expect(await household(PORTAL.adultUser, visibleSubscriptions)).toEqual([endpoint(2)]);
    });
  });

  it('never shows a household another household’s device, nor lets it remove one', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      const removed = await household(PORTAL.adultUser, () =>
        owner.query('delete from push_subscription where push_endpoint = $1', [endpoint(1)]),
      );
      expect(removed.rowCount).toBe(0);
      expect(await visibleSubscriptions()).toEqual([endpoint(1)]);
    });
  });

  it('lets a person remove their own device', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      const removed = await household(PORTAL.motherUser, () =>
        owner.query('delete from push_subscription where push_endpoint = $1', [endpoint(1)]),
      );
      expect(removed.rowCount).toBe(1);
    });
  });

  it("refuses a young person's own login, and a member of the practice", async () => {
    await rolledBack(owner, async () => {
      const call = 'select app.portal_subscribe_push($1, $2, $3)';
      expect(
        await household(PORTAL.minorUser, () => codeOf(call, [endpoint(3), P256DH, AUTH])),
      ).toBe(RLS_VIOLATION);
      expect(await admin(() => codeOf(call, [endpoint(3), P256DH, AUTH]))).toBe(RLS_VIOLATION);
      expect(await visibleSubscriptions()).toEqual([]);
    });
  });

  it('refuses a direct write naming somebody else, or a young person’s own login', async () => {
    await rolledBack(owner, async () => {
      const insert =
        'insert into push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, ' +
        'push_auth, created_by) values ($1, $2, $3, $4, $5, $6)';
      expect(
        await household(PORTAL.motherUser, () =>
          codeOf(insert, [
            IDS.tenantA,
            PORTAL.adultUser,
            endpoint(4),
            P256DH,
            AUTH,
            PORTAL.motherUser,
          ]),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await household(PORTAL.minorUser, () =>
          codeOf(insert, [
            IDS.tenantA,
            PORTAL.minorUser,
            endpoint(4),
            P256DH,
            AUTH,
            PORTAL.minorUser,
          ]),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('moves a shared device to the last person who turned notifications on with it', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(5));
      await household(PORTAL.adultUser, () => subscribe(5));
      const rows = await owner.query<{ user_id: string }>(
        'select user_id from push_subscription where push_endpoint = $1',
        [endpoint(5)],
      );
      expect(rows.rows).toEqual([{ user_id: PORTAL.adultUser }]);
    });
  });

  it('refuses a key that is not the shape a browser hands over', async () => {
    await rolledBack(owner, async () => {
      const code = await household(PORTAL.motherUser, () =>
        codeOf('select app.portal_subscribe_push($1, $2, $3)', [endpoint(6), 'short', AUTH]),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });
  });
});

describe('the practice learns counts, never an address', () => {
  it('reads no device at all as the owner or an admin', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      expect(await admin(visibleSubscriptions)).toEqual([]);
      expect(await as(IDS.ownerA, 'owner', visibleSubscriptions)).toEqual([]);
    });
  });

  it('answers the audience as people, devices and standing, from each person’s own consent', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      await household(PORTAL.motherUser, () => subscribe(2));
      await household(PORTAL.adultUser, () => subscribe(3));
      await household(PORTAL.adultUser, () =>
        owner.query('select app.portal_give_marketing_consent($1)', [WORDING]),
      );
      const rows = await admin(() =>
        owner.query<{
          user_id: string;
          devices: number;
          locale: string;
          has_consent: boolean;
          contacts: unknown[];
        }>(
          'select user_id, devices, locale::text as locale, ' +
            'marketing_consent_id is not null as has_consent, contacts from app.push_audience()',
        ),
      );
      const byUser = Object.fromEntries(rows.rows.map((row) => [row.user_id, row]));
      expect(byUser[PORTAL.motherUser]).toMatchObject({
        devices: 2,
        locale: 'en',
        has_consent: false,
      });
      expect(byUser[PORTAL.motherUser]?.contacts).toHaveLength(2);
      expect(byUser[PORTAL.adultUser]).toMatchObject({
        devices: 1,
        locale: 'ar',
        has_consent: true,
      });
      expect(Object.keys(rows.rows[0] ?? {})).not.toContain('push_endpoint');
    });
  });

  it('refuses the audience to a household and to a practitioner', async () => {
    await rolledBack(owner, async () => {
      expect(
        await household(PORTAL.motherUser, () => codeOf('select * from app.push_audience()')),
      ).toBe(RLS_VIOLATION);
      expect(
        await as(PORTAL.practitioner, 'practitioner', () =>
          codeOf('select * from app.push_audience()'),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });
});

describe('the record of a send', () => {
  it('is written and read by the owner and an admin, with each recipient’s standing', async () => {
    await rolledBack(owner, async () => {
      await admin(async () => {
        await sendAsAdmin(M.first, 'announcement');
        await owner.query(
          'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
            "marketing_standing, created_by) values ($1, $2, $3, 2, 'off', $4)",
          [IDS.tenantA, M.first, PORTAL.motherUser, PORTAL.admin],
        );
      });
      const read = await as(IDS.ownerA, 'owner', () =>
        owner.query<{ marketing_standing: string; devices: number }>(
          'select marketing_standing::text, devices from push_recipient where message_id = $1',
          [M.first],
        ),
      );
      expect(read.rows).toEqual([{ marketing_standing: 'off', devices: 2 }]);
    });
  });

  it('cannot say a consent stood without naming it, nor name one that did not', async () => {
    await rolledBack(owner, async () => {
      await admin(() => sendAsAdmin(M.first, 'announcement'));
      const code = await admin(() =>
        codeOf(
          'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
            "marketing_standing, created_by) values ($1, $2, $3, 1, 'on', $4)",
          [IDS.tenantA, M.first, PORTAL.motherUser, PORTAL.admin],
        ),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });
  });

  it('is never read by a household, a practitioner or finance', async () => {
    await rolledBack(owner, async () => {
      await admin(() => sendAsAdmin(M.first, 'announcement'));
      const count = () =>
        owner
          .query<{ n: string }>('select count(*)::text as n from push_message')
          .then((r) => r.rows[0]?.n);
      expect(await household(PORTAL.motherUser, count)).toBe('0');
      expect(await as(PORTAL.practitioner, 'practitioner', count)).toBe('0');
      expect(await as(PORTAL.finance, 'finance', count)).toBe('0');
      expect(await admin(count)).toBe('1');
    });
  });

  it('is never sent by anybody but the owner or an admin, as themselves', async () => {
    await rolledBack(owner, async () => {
      expect(
        await as(PORTAL.leadPractitioner, 'lead_practitioner', () =>
          codeOf(
            'insert into push_message (tenant_id, kind, title_en, title_ar, body_en, body_ar, ' +
              "recipient_count, device_count, created_by) values ($1, 'announcement', 'a', " +
              "'ب', 'a', 'ب', 1, 1, $2)",
            [IDS.tenantA, PORTAL.leadPractitioner],
          ),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await admin(() =>
          codeOf(
            'insert into push_message (tenant_id, kind, title_en, title_ar, body_en, body_ar, ' +
              "recipient_count, device_count, created_by) values ($1, 'announcement', 'a', " +
              "'ب', 'a', 'ب', 1, 1, $2)",
            [IDS.tenantA, IDS.ownerA],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('is never edited and never deleted; the delivery writes its outcome once', async () => {
    await rolledBack(owner, async () => {
      await admin(() => sendAsAdmin(M.first, 'announcement'));
      expect(
        await admin(() =>
          codeOf("update push_message set body_en = 'Something else' where id = $1", [M.first]),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(await admin(() => codeOf('delete from push_message where id = $1', [M.first]))).toBe(
        RLS_VIOLATION,
      );
      await admin(() =>
        owner.query(
          'update push_message set delivered_count = 1, gone_count = 0, failed_count = 0, ' +
            'delivered_at = now() where id = $1',
          [M.first],
        ),
      );
      expect(
        await admin(() =>
          codeOf('update push_message set delivered_count = 0 where id = $1', [M.first]),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('refuses a third offer in one calendar month, and allows it the next month', async () => {
    await rolledBack(owner, async () => {
      await admin(async () => {
        await sendAsAdmin(M.first, 'offer');
        await sendAsAdmin(M.second, 'offer');
        // Announcements have no ceiling.
        await sendAsAdmin(M.announcement, 'announcement');
      });
      expect(
        await admin(() =>
          codeOf(
            'insert into push_message (id, tenant_id, kind, title_en, title_ar, body_en, ' +
              "body_ar, recipient_count, device_count, created_by) values ($1, $2, 'offer', " +
              "'a', 'ب', 'a', 'ب', 1, 1, $3)",
            [M.third, IDS.tenantA, PORTAL.admin],
          ),
        ),
      ).toBe(CHECK_VIOLATION);
      await admin(() => sendAsAdmin(M.third, 'offer', "now() + interval '40 days'"));
    });
  });
});

describe('delivery', () => {
  it('reaches every device of an announcement’s recipients', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      await household(PORTAL.motherUser, () => subscribe(2));
      await admin(async () => {
        await sendAsAdmin(M.first, 'announcement');
        await owner.query(
          'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
            "marketing_standing, created_by) values ($1, $2, $3, 2, 'off', $4)",
          [IDS.tenantA, M.first, PORTAL.motherUser, PORTAL.admin],
        );
      });
      const targets = await admin(() =>
        owner.query('select * from app.push_delivery_targets($1)', [M.first]),
      );
      expect(targets.rows).toHaveLength(2);
      expect(
        await household(PORTAL.motherUser, () =>
          codeOf('select * from app.push_delivery_targets($1)', [M.first]),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('drops an offer’s device the moment its person withdraws, even after the send', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.adultUser, () => subscribe(3));
      await household(PORTAL.adultUser, () =>
        owner.query('select app.portal_give_marketing_consent($1)', [WORDING]),
      );
      const consent = await owner.query<{ id: string }>(
        "select id from consent where purpose = 'marketing'",
      );
      await admin(async () => {
        await sendAsAdmin(M.first, 'offer');
        await owner.query(
          'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
            "marketing_standing, marketing_consent_id, created_by) values ($1, $2, $3, 1, 'on', " +
            '$4, $5)',
          [IDS.tenantA, M.first, PORTAL.adultUser, consent.rows[0]?.id, PORTAL.admin],
        );
      });
      const before = await admin(() =>
        owner.query('select * from app.push_delivery_targets($1)', [M.first]),
      );
      expect(before.rows).toHaveLength(1);
      await household(PORTAL.adultUser, () =>
        owner.query('select app.portal_withdraw_marketing_consent()'),
      );
      const after = await admin(() =>
        owner.query('select * from app.push_delivery_targets($1)', [M.first]),
      );
      expect(after.rows).toHaveLength(0);
    });
  });

  it('deletes a device its service reported gone', async () => {
    await rolledBack(owner, async () => {
      const id = await household(PORTAL.motherUser, () => subscribe(1));
      const gone = await admin(() =>
        owner.query<{ n: number }>('select app.push_subscriptions_gone($1) as n', [[id]]),
      );
      expect(gone.rows[0]?.n).toBe(1);
      expect(await visibleSubscriptions()).toEqual([]);
    });
  });
});

describe('another practice', () => {
  it('sees none of it: no device, no message, no recipient, no audience', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(1));
      await admin(() => sendAsAdmin(M.first, 'announcement'));
      const seen = await as(
        IDS.ownerB,
        'owner',
        async () => {
          const subs = await owner.query('select id from push_subscription');
          const msgs = await owner.query('select id from push_message');
          const recips = await owner.query('select id from push_recipient');
          const audience = await owner.query('select * from app.push_audience()');
          const targets = await owner.query('select * from app.push_delivery_targets($1)', [
            M.first,
          ]);
          return [subs, msgs, recips, audience, targets].map((r) => r.rowCount);
        },
        IDS.tenantB,
      );
      expect(seen).toEqual([0, 0, 0, 0, 0]);
    });
  });

  it('cannot clear another practice’s device', async () => {
    await rolledBack(owner, async () => {
      const id = await household(PORTAL.motherUser, () => subscribe(1));
      const gone = await as(
        IDS.ownerB,
        'owner',
        () => owner.query<{ n: number }>('select app.push_subscriptions_gone($1) as n', [[id]]),
        IDS.tenantB,
      );
      expect(gone.rows[0]?.n).toBe(0);
      expect(await visibleSubscriptions()).toEqual([endpoint(1)]);
    });
  });
});

/**
 * Migration 975 (docs/CHANGE-REQUESTS/client-portal-07.md, "Asked of the
 * trunk", items 1 and 2): a device's address and keys never reach the trail,
 * and an erasure that closes a household account takes that account's devices
 * with it — and spares a colleague's, as 968 spares the colleague.
 */
describe('migration 975: the trail and the erasure', () => {
  const ERASURE = '00000001-0000-4000-8000-0000000000b9';
  const COLLEAGUE_CONTACT = '00000001-0000-4000-8000-0000000000ba';

  async function device(userId: string, n: number): Promise<void> {
    await owner.query(
      'insert into push_subscription (tenant_id, user_id, push_endpoint, push_p256dh, push_auth, ' +
        'created_by) values ($1, $2, $3, $4, $5, $2)',
      [IDS.tenantA, userId, endpoint(n), P256DH, AUTH],
    );
  }

  async function devicesOf(userId: string): Promise<number> {
    const rows = await owner.query<{ n: number }>(
      'select count(*)::int as n from push_subscription where user_id = $1',
      [userId],
    );
    return rows.rows[0]?.n ?? 0;
  }

  it('keeps a device’s address and keys out of the trail, on the way in and the way out', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.motherUser, () => subscribe(11));
      await household(PORTAL.motherUser, () =>
        owner.query('delete from push_subscription where push_endpoint = $1', [endpoint(11)]),
      );
      const trail = await owner.query<{ action: string; values: Record<string, unknown> }>(
        'select action, coalesce(new_values, old_values) as values from audit_log ' +
          "where entity_type = 'push_subscription' order by id",
      );
      expect(trail.rows.map((row) => row.action)).toEqual(['insert', 'delete']);
      for (const row of trail.rows) {
        for (const key of ['push_endpoint', 'push_p256dh', 'push_auth']) {
          expect(Object.keys(row.values), `${row.action} ${key}`).not.toContain(key);
        }
        expect(JSON.stringify(row.values)).not.toContain('synthetic-device');
        // What it still says: whose device, and that it was one.
        expect(row.values.user_id).toBe(PORTAL.motherUser);
      }
    });
  });

  it('takes the devices of the household account an erasure closes, and only those', async () => {
    await rolledBack(owner, async () => {
      await device(PORTAL.adultUser, 21);
      await device(PORTAL.adultUser, 22);
      await device(PORTAL.motherUser, 23);
      // A colleague who is also a contact on the record being erased (968).
      await owner.query(
        'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
          "family_name, is_legal_guardian, can_consent) values ($1, $2, $3, $4, 'spouse', " +
          "'Iris', 'Harbour', false, false)",
        [COLLEAGUE_CONTACT, IDS.tenantA, PORTAL.adultClient, PORTAL.admin],
      );
      await device(PORTAL.admin, 24);
      await owner.query(
        'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
        [ERASURE, IDS.tenantA, PORTAL.adultClient, 'Household asked to be forgotten'],
      );
      await setAuditContext(owner, IDS.ownerA);
      await owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA],
      );
      const result = await owner.query<{ summary: Record<string, unknown> }>(
        'select app.erase_client($1, $2) as summary',
        [PORTAL.adultClient, ERASURE],
      );
      expect(result.rows[0]?.summary).toMatchObject({ portalAccountsArchived: 1 });
      expect(await devicesOf(PORTAL.adultUser)).toBe(0);
      // Another household's devices, and the spared colleague's own, stand.
      expect(await devicesOf(PORTAL.motherUser)).toBe(1);
      expect(await devicesOf(PORTAL.admin)).toBe(1);
      const status = await owner.query<{ status: string }>(
        'select status::text as status from app_user where id = $1',
        [PORTAL.admin],
      );
      expect(status.rows[0]?.status).toBe('active');
    });
  });
});

/**
 * Only the switch counts (PR 247's review, finding 1): a marketing row the
 * adult did not give with their own portal's switch — one the console filed
 * before it was refused, or one on paper — never makes them a recipient of an
 * offer, never stops them turning the switch on, and an offer never reaches a
 * device through a consent on an erased record.
 */
describe('only the portal switch makes an offer’s recipient', () => {
  const PAPER = '00000001-0000-4000-8000-0000000000bb';

  async function offerTo(userId: string): Promise<void> {
    await admin(async () => {
      await sendAsAdmin(M.first, 'offer');
      await owner.query(
        'insert into push_recipient (tenant_id, message_id, user_id, devices, ' +
          "marketing_standing, created_by) values ($1, $2, $3, 1, 'off', $4)",
        [IDS.tenantA, M.first, userId, PORTAL.admin],
      );
    });
  }

  it('reads a marketing row not given with the switch as no consent at all', async () => {
    await rolledBack(owner, async () => {
      await seedConsent(owner, {
        id: PAPER,
        clientId: PORTAL.adultClient,
        contactId: PORTAL.adultContact,
        purpose: 'marketing',
        wordingId: WORDING,
      });
      await household(PORTAL.adultUser, () => subscribe(31));
      const audience = await admin(() =>
        owner.query<{ marketing_consent_id: string | null }>(
          'select marketing_consent_id from app.push_audience() where user_id = $1',
          [PORTAL.adultUser],
        ),
      );
      expect(audience.rows).toEqual([{ marketing_consent_id: null }]);
      await offerTo(PORTAL.adultUser);
      const targets = await admin(() =>
        owner.query('select * from app.push_delivery_targets($1)', [M.first]),
      );
      expect(targets.rowCount).toBe(0);
    });
  });

  it('lets the adult turn the switch on beside such a row', async () => {
    await rolledBack(owner, async () => {
      await seedConsent(owner, {
        id: PAPER,
        clientId: PORTAL.adultClient,
        contactId: PORTAL.adultContact,
        purpose: 'marketing',
        wordingId: WORDING,
      });
      const given = await household(PORTAL.adultUser, () =>
        owner.query('select app.portal_give_marketing_consent($1)', [WORDING]),
      );
      expect(given.rowCount).toBe(1);
    });
  });

  it('never delivers an offer through a consent on an erased record', async () => {
    await rolledBack(owner, async () => {
      await household(PORTAL.adultUser, () => subscribe(32));
      await household(PORTAL.adultUser, () =>
        owner.query('select app.portal_give_marketing_consent($1)', [WORDING]),
      );
      await offerTo(PORTAL.adultUser);
      await owner.query("update client set status = 'erased' where id = $1", [PORTAL.adultClient]);
      const targets = await admin(() =>
        owner.query('select * from app.push_delivery_targets($1)', [M.first]),
      );
      expect(targets.rowCount).toBe(0);
    });
  });
});
