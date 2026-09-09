import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asApiRole,
  freshDatabase,
  IDS,
  rejectsWith,
  rolledBack,
  seedTenant,
  setAuditContext,
} from './helpers';

/**
 * The quarantine and its one door (db/migrations/916_enquiry.sql), against a
 * real database: what app.lodge_enquiry admits and refuses, who may read a row,
 * that nothing inserts directly, and that an actioned row keeps nothing.
 */

const LODGE = 'select app.lodge_enquiry($1::jsonb) as id';
const COUNT = 'select count(*)::text as n from enquiry';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

function lodging(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'website',
    name: 'Hazel Harbour',
    whatsapp_e164: '+971500000099',
    email: 'hazel@example.com',
    area: 'Jumeirah',
    message: 'I want to know more',
    consent: 'true',
    ip_hash: HASH_A,
    ...overrides,
  });
}

const SCRUB =
  'name = null, whatsapp_e164 = null, email = null, area = null, message = null, ' +
  'concern = null, preferred_time = null, contact_method = null, consent = null, ip_hash = null';

let owner: pg.Client;

async function countAs(tenantId: string | null, roles: string): Promise<string> {
  return asApiRole(
    owner,
    tenantId,
    async () => {
      const { rows } = await owner.query<{ n: string }>(COUNT);
      return rows[0]?.n ?? '';
    },
    roles,
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Practice A');
});

afterAll(async () => {
  await owner.end();
});

describe('lodging through the door', () => {
  it('lets the API role lodge with no tenant and no actor stamped — and see nothing back', async () => {
    // The door's own situation: a stranger pressed Send, the fence has not
    // run, and only a request id is stamped. The definer resolves the practice
    // itself; the caller, with no tenant in context, is shown no row at all.
    await rolledBack(owner, async () => {
      const seen = await asApiRole(
        owner,
        null,
        async () => {
          const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
          expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
          const { rows: n } = await owner.query<{ n: string }>(COUNT);
          return n[0]?.n;
        },
        '',
      );
      expect(seen).toBe('0');
    });
  });

  it('files what the form gave, for the practice', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [lodging()]);
      const { rows: read } = await owner.query(
        'select tenant_id, status, name, whatsapp_e164, consent, source, actioned_by from enquiry where id = $1',
        [rows[0]?.id],
      );
      expect(read[0]).toEqual({
        tenant_id: IDS.tenantA,
        status: 'new',
        name: 'Hazel Harbour',
        whatsapp_e164: '+971500000099',
        consent: true,
        source: 'website',
        actioned_by: null,
      });
    });
  });

  it('keeps consent three-valued: absent is never asked, not refused', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [lodging({ consent: undefined })]);
      const { rows: read } = await owner.query('select consent from enquiry where id = $1', [
        rows[0]?.id,
      ]);
      expect(read[0]?.consent).toBeNull();
    });
  });

  it('refuses the sixth lodging from one address in ten minutes, and says so to nobody', async () => {
    await rolledBack(owner, async () => {
      for (let i = 0; i < 5; i += 1) {
        const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
        expect(rows[0]?.id, `lodging ${i + 1}`).not.toBeNull();
      }
      const { rows: sixth } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
      expect(sixth[0]?.id).toBeNull();
      // Another address is not throttled by the first one's budget.
      const { rows: other } = await owner.query<{ id: string | null }>(LODGE, [
        lodging({ ip_hash: HASH_B }),
      ]);
      expect(other[0]?.id).not.toBeNull();
      const { rows: n } = await owner.query<{ n: string }>(COUNT);
      expect(n[0]?.n).toBe('6');
    });
  });

  it('lodges nothing on a database that is not exactly one practice', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA, 'a second practice');
      await owner.query("insert into tenant (id, legal_name) values ($1, 'Practice B')", [
        IDS.tenantB,
      ]);
      const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
      expect(rows[0]?.id).toBeNull();
    });
  });

  it('gives the API role no way to insert directly', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          rejectsWith(
            owner,
            INSUFFICIENT_PRIVILEGE,
            "insert into enquiry (tenant_id, source, name, whatsapp_e164, ip_hash) values ($1, 'website', 'x', '+971500000098', $2)",
            [IDS.tenantA, HASH_A],
          ),
        'owner',
      );
    });
  });
});

describe('who may read and action', () => {
  async function lodgeOne(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(LODGE, [lodging()]);
    return rows[0]!.id;
  }

  it('shows the row to the owner, an admin and the lead practitioner, and to nobody else', async () => {
    await rolledBack(owner, async () => {
      await lodgeOne();
      for (const roles of ['owner', 'admin', 'lead_practitioner']) {
        expect(await countAs(IDS.tenantA, roles), roles).toBe('1');
      }
      for (const roles of ['practitioner', 'finance']) {
        expect(await countAs(IDS.tenantA, roles), roles).toBe('0');
      }
    });
  });

  it('shows another practice nothing', async () => {
    await rolledBack(owner, async () => {
      await lodgeOne();
      expect(await countAs(IDS.tenantB, 'owner')).toBe('0');
    });
  });

  it('lets an admin dismiss a new enquiry, and only by scrubbing every personal field', async () => {
    await rolledBack(owner, async () => {
      const id = await lodgeOne();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          // Half a scrub is refused by the table itself, not by a route remembering.
          await rejectsWith(
            owner,
            CHECK_VIOLATION,
            "update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, whatsapp_e164 = null, ip_hash = null where id = $1",
            [id, IDS.ownerA],
          );
          const { rowCount } = await owner.query(
            `update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
            [id, IDS.ownerA],
          );
          expect(rowCount).toBe(1);
        },
        'admin',
      );
    });
  });

  it('touches nothing for a practitioner, and nothing already actioned', async () => {
    await rolledBack(owner, async () => {
      const id = await lodgeOne();
      const asPractitioner = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rowCount } = await owner.query(
            `update enquiry set status = 'dismissed', dismiss_reason = 'x', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
            [id, IDS.ownerA],
          );
          return rowCount;
        },
        'practitioner',
      );
      expect(asPractitioner).toBe(0);

      await owner.query(
        `update enquiry set status = 'dismissed', dismiss_reason = 'done', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
        [id, IDS.ownerA],
      );
      const again = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rowCount } = await owner.query(
            "update enquiry set dismiss_reason = 'changed my mind' where id = $1",
            [id],
          );
          return rowCount;
        },
        'admin',
      );
      // An actioned row admits no second action: the policy's `using` is status = new.
      expect(again).toBe(0);
    });
  });
});
