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

/** One concern and one declaration of the six, written as the office writes them. */
async function seedBoth(): Promise<void> {
  await owner.query(
    "insert into concern (tenant_id, client_id, category_id, description, created_by) values ($1, $2, $3, 'Wakes at three and cannot settle', $4)",
    [IDS.tenantA, IDS.clientA, category, IDS.ownerA],
  );
  await owner.query(
    'insert into health_declaration (tenant_id, client_id, seizures, implanted_device, head_injury, ' +
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
            const health = await owner.query('select id from health_declaration');
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
          expect((await owner.query('select id from health_declaration')).rowCount).toBe(0);
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
          expect((await owner.query('select id from health_declaration')).rowCount).toBe(0);
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
          expect((await owner.query('select id from health_declaration')).rowCount).toBe(0);
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
            'insert into health_declaration (tenant_id, client_id, seizures, implanted_device, ' +
              'head_injury, pregnancy, medication, scalp, created_by) ' +
              'values ($1, $2, false, false, false, false, true, false, $3)',
            [IDS.tenantA, IDS.clientA, IDS.ownerA],
          );
          expect((await owner.query('select id from health_declaration')).rowCount).toBe(1);
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
            'insert into health_declaration (tenant_id, client_id, seizures, implanted_device, ' +
              'head_injury, pregnancy, medication, scalp, created_by) ' +
              'values ($1, $2, true, false, false, false, false, false, $3)',
            [IDS.tenantA, IDS.clientA, IDS.ownerA],
          );
        },
        'practitioner',
      );
    });
  });

  it('refuses a concern from anyone who is not the office', async () => {
    // Finance books and takes money; a practitioner tells the office; a
    // household's own login is the portal, which has no screen for this.
    for (const role of ['finance', 'practitioner', 'client_contact']) {
      await rolledBack(owner, async () => {
        await setAuditContext(owner, IDS.ownerA);
        await asApiRole(
          owner,
          IDS.tenantA,
          async () => {
            await rejectsWith(
              owner,
              RLS_VIOLATION,
              "insert into concern (tenant_id, client_id, category_id, description, created_by) values ($1, $2, $3, 'Cannot settle', $4)",
              [IDS.tenantA, IDS.clientA, category, IDS.ownerA],
            );
          },
          role,
        );
      });
    }
  });

  it("lets the lead practitioner change a concern, and a practitioner's change reaches no row", async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      await setAuditContext(owner, IDS.ownerA);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const changed = await owner.query("update concern set status = 'resolved'");
          expect(changed.rowCount).toBe(1);
        },
        'lead_practitioner',
      );
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const changed = await owner.query("update concern set status = 'open'");
          expect(changed.rowCount).toBe(0);
        },
        'practitioner',
      );
    });
  });

  it('grants no delete on either, to anyone', async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      await setAuditContext(owner, IDS.ownerA);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await rejectsWith(owner, RLS_VIOLATION, 'delete from concern');
          await rejectsWith(owner, RLS_VIOLATION, 'delete from health_declaration');
        },
        'owner',
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
          await rejectsWith(owner, RLS_VIOLATION, 'update health_declaration set seizures = true');
        },
        'owner',
      );
    });
  });
});

describe('another practice', () => {
  it('sees neither, even as its owner', async () => {
    await rolledBack(owner, async () => {
      await seedBoth();
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Other Synthetic Practice');
      await asApiRole(
        owner,
        IDS.tenantB,
        async () => {
          expect((await owner.query('select id from concern')).rowCount).toBe(0);
          expect((await owner.query('select id from health_declaration')).rowCount).toBe(0);
        },
        'owner',
      );
    });
  });
});

describe('the audit trail', () => {
  it('records that the six were declared, and never what was said (965)', async () => {
    await rolledBack(owner, async () => {
      // Written as the database owner: the trigger is `enable always` and the
      // redaction is its own, whoever writes — and asApiRole rolls its
      // savepoint back on the way out, which would take the trail row with it.
      await setAuditContext(owner, IDS.ownerA, 'the household told us at enrolment');
      const inserted = await owner.query<{ id: string }>(
        'insert into health_declaration (tenant_id, client_id, seizures, implanted_device, ' +
          'head_injury, pregnancy, medication, scalp, seizures_note, created_by) ' +
          "values ($1, $2, true, false, false, false, false, false, 'Two, as a child', $3) returning id",
        [IDS.tenantA, IDS.clientA, IDS.ownerA],
      );
      const trail = await owner.query<{ new_values: Record<string, unknown> }>(
        "select new_values from audit_log where entity_type = 'health_declaration' and entity_id = $1",
        [inserted.rows[0]?.id],
      );
      expect(trail.rowCount).toBe(1);
      const keys = Object.keys(trail.rows[0]?.new_values ?? {});
      expect(keys).toEqual(expect.arrayContaining(['id', 'client_id', 'asked_at', 'created_by']));
      for (const dropped of [
        'seizures',
        'seizures_note',
        'implanted_device',
        'implanted_device_note',
        'head_injury',
        'head_injury_note',
        'pregnancy',
        'pregnancy_note',
        'medication',
        'medication_note',
        'scalp',
        'scalp_note',
      ]) {
        expect(keys).not.toContain(dropped);
      }
    });
  });
});

describe('the erasure reaches both', () => {
  it('is defined by a migration numbered above every earlier definer', async () => {
    // 108 redefined app.erase_client first and 954 overwrote it silently a
    // moment later, which is why the step lives in 964. This reads the live
    // body: a later redefinition numbered below 964 would drop both steps
    // without an error, and this is what would notice.
    const body = await owner.query<{ prosrc: string }>(
      "select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'erase_client'",
    );
    expect(body.rowCount).toBe(1);
    expect(body.rows[0]?.prosrc).toContain('public.concern');
    expect(body.rows[0]?.prosrc).toContain('public.health_declaration');
  });

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
        healthDeclarationsDeleted: 1,
      });

      // The concern keeps its category, which is a figure about the practice;
      // its words are the household's and are gone.
      const concern = await owner.query('select description, category_id from concern');
      expect(concern.rows[0]).toMatchObject({ description: '', category_id: category });

      // The answers keep nothing: the six of them ARE the personal part.
      expect((await owner.query('select id from health_declaration')).rowCount).toBe(0);
    });
  });
});
