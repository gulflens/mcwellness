import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedTenant,
  setAuditContext,
} from '../../db/helpers';

/**
 * What a household is worried about, and the six things the signed agreement
 * asks them to tell the practice (108_concerns_and_health.sql).
 *
 * The rules proved here are the operator's own, taken on 2026-09-14: whoever
 * may open the record may read both — the office and the practitioner
 * attending this client, and not finance; a change to the health answers is a
 * new row and never an edit; and the erasure reaches both, the concern reduced
 * the way a goal is and the answers deleted outright.
 */

const RLS_VIOLATION = '42501';
const ERASURE_REQUEST = '00000000-0000-4000-8000-0000000001c1';

let owner: pg.Client;
/**
 * A category from the practice's own list rather than one invented here: every
 * tenant is seeded with six by 100_client_record.sql, and inserting a seventh
 * named `sleep` collides with the unique key on (tenant, code).
 */
let category: string;

/** One concern and one screening, written as the office writes them. */
async function seedBoth(): Promise<void> {
  await owner.query(
    "insert into concern (tenant_id, client_id, category_id, description, created_by) values ($1, $2, $3, 'Wakes at three and cannot settle', $4)",
    [IDS.tenantA, IDS.clientA, category, IDS.ownerA],
  );
  await owner.query(
    'insert into health_screening (tenant_id, client_id, seizures, implanted_device, head_injury, ' +
      'pregnancy, medication, scalp, head_injury_note, created_by) ' +
      "values ($1, $2, false, false, true, false, false, false, 'A fall in 2019, no lasting effect', $3)",
    [IDS.tenantA, IDS.clientA, IDS.ownerA],
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Practice');
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
  const categories = await owner.query(
    'select id from goal_category where tenant_id = $1 order by code limit 1',
    [IDS.tenantA],
  );
  category = categories.rows[0]?.id as string;
  expect(category).toBeTruthy();
});

afterAll(async () => {
  await owner.end();
});

describe('who may read a concern and the health answers', () => {
  it('shows both to the office and to the lead practitioner', async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      for (const role of ['owner', 'admin', 'lead_practitioner']) {
        await asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            const concerns = await owner.query('select id from concern');
            const health = await owner.query('select id from health_screening');
            expect({ role, concerns: concerns.rowCount, health: health.rowCount }).toEqual({
              role,
              concerns: 1,
              health: 1,
            });
          },
          role,
        );
      }
    });
  });

  it('shows neither to finance, who books and takes money', async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect((await owner.query('select id from concern')).rowCount).toBe(0);
          expect((await owner.query('select id from health_screening')).rowCount).toBe(0);
        },
        'finance',
      );
    });
  });

  it('shows neither to a practitioner with no visit to this client', async () => {
    // `client_visible_to_practitioner` is ninety days back and thirty forward,
    // confirmed visits only. Nothing is booked here, so the door is shut — the
    // same gate every other part of the record uses.
    await rolledBack(owner, async () => {
      await seedBoth();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect((await owner.query('select id from concern')).rowCount).toBe(0);
          expect((await owner.query('select id from health_screening')).rowCount).toBe(0);
        },
        'practitioner',
      );
    });
  });

  it('shows neither to a household signed in to their own portal', async () => {
    // A concern is the practice's note of what it was told, and the six answers
    // are health data the portal has no screen for. The portal shows a family
    // their sessions and their money.
    await rolledBack(owner, async () => {
      await seedBoth();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          expect((await owner.query('select id from concern')).rowCount).toBe(0);
          expect((await owner.query('select id from health_screening')).rowCount).toBe(0);
        },
        'client_contact',
      );
    });
  });
});

describe('writing them', () => {
  it('lets the office record both', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA, 'the household told us at enrolment');
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await owner.query(
            "insert into concern (tenant_id, client_id, category_id, description, created_by) values ($1, $2, $3, 'Struggles to wind down', $4)",
            [IDS.tenantA, IDS.clientA, category, IDS.ownerA],
          );
          await owner.query(
            'insert into health_screening (tenant_id, client_id, seizures, implanted_device, ' +
              'head_injury, pregnancy, medication, scalp, created_by) ' +
              'values ($1, $2, false, false, false, false, true, false, $3)',
            [IDS.tenantA, IDS.clientA, IDS.ownerA],
          );
          expect((await owner.query('select id from health_screening')).rowCount).toBe(1);
        },
        'admin',
      );
    });
  });

  it('refuses a practitioner writing health answers, who tells the office instead', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await rejectsWith(
            owner,
            RLS_VIOLATION,
            'insert into health_screening (tenant_id, client_id, seizures, implanted_device, ' +
              'head_injury, pregnancy, medication, scalp, created_by) ' +
              'values ($1, $2, true, false, false, false, false, false, $3)',
            [IDS.tenantA, IDS.clientA, IDS.ownerA],
          );
        },
        'practitioner',
      );
    });
  });

  it('grants no update on the answers at all: a change is a new row', async () => {
    // Not a policy — the grant itself. What somebody said in March is not
    // edited into what they say in September; the newest row is the current one.
    await rolledBack(owner, async () => {
      await seedBoth();
      await setAuditContext(owner, IDS.ownerA);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await rejectsWith(owner, RLS_VIOLATION, 'update health_screening set seizures = true');
        },
        'owner',
      );
    });
  });
});

describe('the erasure reaches both', () => {
  it("clears the concern's words, deletes the answers, and counts each", async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      await owner.query(
        "insert into erasure_request (id, tenant_id, client_id, reason, created_by) values ($1, $2, $3, 'Household asked to be forgotten', $4)",
        [ERASURE_REQUEST, IDS.tenantA, IDS.clientA, IDS.ownerA],
      );
      await setAuditContext(owner, IDS.ownerA, 'erasure');
      await owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA],
      );
      const result = await owner.query('select app.erase_client($1, $2) as summary', [
        IDS.clientA,
        ERASURE_REQUEST,
      ]);
      expect(result.rows[0]?.summary).toMatchObject({
        concernsCleared: 1,
        healthScreeningsDeleted: 1,
      });

      // The concern keeps its category, which is a figure about the practice;
      // its words are the household's and are gone.
      const concern = await owner.query('select description, category_id from concern');
      expect(concern.rows[0]).toMatchObject({ description: '', category_id: category });

      // The answers keep nothing: the six of them ARE the personal part.
      expect((await owner.query('select id from health_screening')).rowCount).toBe(0);
    });
  });
});
