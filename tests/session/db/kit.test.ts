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
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import { seedAppointment } from './helpers';

/**
 * The equipment register (db/migrations/306_kit_and_setup_photo.sql,
 * db/policies/session/kit.sql, docs/SPEC/practitioner-phone.md section 6).
 *
 * Three halves, if that is allowed. The table's own rules — one row per serial
 * per practice, no assignment across practices, a due date that cannot precede
 * the calibration it follows. Then who may do what to it, with a deny test per
 * grant: every role that is not on the list is proved to be refused, not
 * merely absent from the list. Then the rule the register exists for:
 * `app.checkin_context` answering whether the caller's own instruments are in
 * calibration, and which amplifier the visit should be recorded against.
 *
 * Every id, name and phone is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md). A serial is in the same shape: it names a box
 * this practice does not own, and no real model appears anywhere.
 */

const RLS_VIOLATION = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f3';

// Tenant A: the caller, one other practitioner whose kit is not theirs to
// read, and one carrying nothing at all — which is what the register looks
// like on the day it ships. Tenant B: somebody else's practice entirely.
const CALLER_USER = '00000000-0000-4000-8000-000000301001';
const CALLER = '00000000-0000-4000-8000-000000301002';
const OTHER_USER = '00000000-0000-4000-8000-000000301003';
const OTHER = '00000000-0000-4000-8000-000000301004';
const FOREIGN_USER = '00000000-0000-4000-8000-000000301005';
const FOREIGN = '00000000-0000-4000-8000-000000301006';
const BARE_USER = '00000000-0000-4000-8000-000000301010';
const BARE = '00000000-0000-4000-8000-000000301011';

// One user per role, so a deny test can act as each of them in turn.
const ADMIN_USER = '00000000-0000-4000-8000-000000301007';
const LEAD_USER = '00000000-0000-4000-8000-000000301008';
const FINANCE_USER = '00000000-0000-4000-8000-000000301009';

const CLIENT_A = '00000000-0000-4000-8000-000000302001';
const LOCATION_A = '00000000-0000-4000-8000-000000303001';

const KIT_CALLER_AMPLIFIER = '00000000-0000-4000-8000-000000304001';
const KIT_OTHER_AMPLIFIER = '00000000-0000-4000-8000-000000304002';
const KIT_SPARE = '00000000-0000-4000-8000-000000304003';
const KIT_LAPTOP = '00000000-0000-4000-8000-000000304004';
// Written only inside a rolled-back transaction, against the practitioner who
// otherwise carries nothing.
const KIT_BARE_AMPLIFIER = '00000000-0000-4000-8000-000000304005';
const KIT_BARE_SECOND = '00000000-0000-4000-8000-000000304006';
const KIT_BARE_LAPTOP = '00000000-0000-4000-8000-000000304007';

/** Serials in the reserved shape: a fictional prefix and a synthetic number. */
const SERIAL = {
  callerAmplifier: 'SYN-AMP-000001',
  otherAmplifier: 'SYN-AMP-000002',
  spare: 'SYN-AMP-000003',
  laptop: 'SYN-LAP-000001',
  bareAmplifier: 'SYN-AMP-000004',
  bareSecond: 'SYN-AMP-000005',
  bareLaptop: 'SYN-LAP-000002',
} as const;

/** When a calibration runs out, relative to now. Null is never calibrated at all. */
type Due = 'past' | 'future' | null;

const DUE_SQL: Record<'past' | 'future', string> = {
  past: "now() - interval '1 day'",
  future: "now() + interval '1 year'",
};

let client: pg.Client;

async function seedKit(kit: {
  id: string;
  tenantId: string;
  serial: string;
  kind: 'amplifier' | 'laptop' | 'electrode_set';
  assignedTo?: string | null;
  status?: 'active' | 'inactive';
  due?: Due;
}): Promise<void> {
  const due = kit.due ?? null;
  await client.query(
    'insert into kit (id, tenant_id, serial, model, kind, status, assigned_practitioner_id, ' +
      'last_calibrated_at, calibration_due_at, created_by) ' +
      "values ($1, $2, $3, 'Synthetic Bench Unit', $4, $5, $6, null, " +
      `${due === null ? 'null' : DUE_SQL[due]}, $7)`,
    [
      kit.id,
      kit.tenantId,
      kit.serial,
      kit.kind,
      kit.status ?? 'active',
      kit.assignedTo ?? null,
      IDS.ownerA,
    ],
  );
}

/** app.checkin_context as the given practitioner, resolving the client by id. */
async function contextAs(
  userId: string,
): Promise<{ kit_calibration_overdue: boolean; kit_id: string | null; found: boolean }> {
  return asApiRole(
    client,
    IDS.tenantA,
    async () => {
      await client.query("select set_config('app.actor_id', $1, true)", [userId]);
      const { rows } = await client.query<{
        found: boolean;
        kit_calibration_overdue: boolean;
        kit_id: string | null;
      }>('select found, kit_calibration_overdue, kit_id from app.checkin_context($1, null)', [
        CLIENT_A,
      ]);
      return rows[0]!;
    },
    'practitioner',
  );
}

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(client, IDS.tenantA, SERVICE_TYPE, 'nf-session');

  for (const [userId, practitionerId, tenantId] of [
    [CALLER_USER, CALLER, IDS.tenantA],
    [OTHER_USER, OTHER, IDS.tenantA],
    [BARE_USER, BARE, IDS.tenantA],
    [FOREIGN_USER, FOREIGN, IDS.tenantB],
  ] as const) {
    await seedUser(client, {
      id: userId,
      tenantId,
      authId: userId,
      displayName: 'Synthetic Practitioner',
      roles: ['practitioner'],
    });
    await seedPractitioner(client, tenantId, practitionerId, userId);
  }
  for (const [userId, role] of [
    [ADMIN_USER, 'admin'],
    [LEAD_USER, 'lead_practitioner'],
    [FINANCE_USER, 'finance'],
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
  await client.query("update client set date_of_birth = '1990-01-01' where id = $1", [CLIENT_A]);
  await seedLocation(client, IDS.tenantA, LOCATION_A, CLIENT_A, IDS.ownerA);

  // One booked visit apiece today, so `found` is true for each of the three
  // and the kit columns are what the assertions are actually reading.
  const today = (
    await client.query<{ today: string }>(
      "select (now() at time zone 'Asia/Dubai')::date::text as today",
    )
  ).rows[0]!.today;
  for (const [appointmentId, practitionerId, hour] of [
    ['00000000-0000-4000-8000-000000305001', CALLER, '08'],
    ['00000000-0000-4000-8000-000000305002', OTHER, '10'],
    ['00000000-0000-4000-8000-000000305003', BARE, '12'],
  ] as const) {
    await seedAppointment(client, {
      id: appointmentId,
      tenantId: IDS.tenantA,
      clientId: CLIENT_A,
      practitionerId,
      serviceTypeId: SERVICE_TYPE,
      locationId: LOCATION_A,
      windowStart: `${today}T${hour}:00:00+04:00`,
      status: 'confirmed',
    });
  }

  // The register as the practice keeps it: an amplifier apiece for two
  // practitioners, a spare on the shelf, and a laptop that is never
  // calibrated. BARE carries nothing, deliberately.
  await seedKit({
    id: KIT_CALLER_AMPLIFIER,
    tenantId: IDS.tenantA,
    serial: SERIAL.callerAmplifier,
    kind: 'amplifier',
    assignedTo: CALLER,
    due: 'future',
  });
  await seedKit({
    id: KIT_OTHER_AMPLIFIER,
    tenantId: IDS.tenantA,
    serial: SERIAL.otherAmplifier,
    kind: 'amplifier',
    assignedTo: OTHER,
    due: 'future',
  });
  await seedKit({
    id: KIT_SPARE,
    tenantId: IDS.tenantA,
    serial: SERIAL.spare,
    kind: 'amplifier',
    assignedTo: null,
    due: 'past',
  });
  await seedKit({
    id: KIT_LAPTOP,
    tenantId: IDS.tenantA,
    serial: SERIAL.laptop,
    kind: 'laptop',
    assignedTo: CALLER,
  });
});

afterAll(async () => {
  await client.end();
});

describe('the register itself', () => {
  it('refuses a serial the practice already has, and accepts it in another practice', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        UNIQUE_VIOLATION,
        'insert into kit (tenant_id, serial, model, kind) ' +
          "values ($1, $2, 'Synthetic Bench Unit', 'amplifier')",
        [IDS.tenantA, SERIAL.callerAmplifier],
      );
      // The same serial in another practice is another practice's business.
      await client.query(
        'insert into kit (tenant_id, serial, model, kind) ' +
          "values ($1, $2, 'Synthetic Bench Unit', 'amplifier')",
        [IDS.tenantB, SERIAL.callerAmplifier],
      );
    });
  });

  it("refuses an item assigned to another practice's practitioner", async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        FOREIGN_KEY_VIOLATION,
        'insert into kit (tenant_id, serial, model, kind, assigned_practitioner_id) ' +
          "values ($1, $2, 'Synthetic Bench Unit', 'amplifier', $3)",
        [IDS.tenantA, SERIAL.bareAmplifier, FOREIGN],
      );
    });
  });

  it('refuses a calibration that runs out before it was done', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        'insert into kit (tenant_id, serial, model, kind, last_calibrated_at, calibration_due_at) ' +
          "values ($1, $2, 'Synthetic Bench Unit', 'amplifier', now(), now() - interval '1 day')",
        [IDS.tenantA, SERIAL.bareAmplifier],
      );
    });
  });

  it('refuses a blank serial and a blank model', async () => {
    await rolledBack(client, async () => {
      for (const [serial, model] of [
        ['   ', 'Synthetic Bench Unit'],
        [SERIAL.bareAmplifier, '  '],
      ] as const) {
        await rejectsWith(
          client,
          CHECK_VIOLATION,
          'insert into kit (tenant_id, serial, model, kind) values ($1, $2, $3, $4)',
          [IDS.tenantA, serial, model, 'amplifier'],
        );
      }
    });
  });

  it('carries the audit trigger and says it names no client', async () => {
    const { rows } = await client.query<{ comment: string | null; enabled: string }>(
      "select obj_description('public.kit'::regclass, 'pg_class') as comment, " +
        "(select tgenabled::text from pg_trigger where tgrelid = 'public.kit'::regclass " +
        "and tgname = 'audit_row') as enabled",
    );
    expect(rows[0]?.comment).toMatch(/^audited: no client/);
    // 'A' is `enable always`, which session_replication_role cannot switch off.
    expect(rows[0]?.enabled).toBe('A');
  });
});

describe('who may read the register', () => {
  async function visibleTo(userId: string, roles: string): Promise<string[]> {
    return asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [userId]);
        const { rows } = await client.query<{ id: string }>('select id from kit order by serial');
        return rows.map((row) => row.id);
      },
      roles,
    );
  }

  it('shows the whole register to the owner, an admin and the lead practitioner', async () => {
    for (const [userId, roles] of [
      [IDS.ownerA, 'owner'],
      [ADMIN_USER, 'admin'],
      [LEAD_USER, 'lead_practitioner'],
    ] as const) {
      await rolledBack(client, async () => {
        expect(await visibleTo(userId, roles), roles).toHaveLength(4);
      });
    }
  });

  it('shows a practitioner their own items and nobody else’s', async () => {
    await rolledBack(client, async () => {
      const seen = await visibleTo(CALLER_USER, 'practitioner');
      expect([...seen].sort()).toEqual([KIT_CALLER_AMPLIFIER, KIT_LAPTOP].sort());
    });
  });

  it('shows a practitioner carrying nothing an empty register', async () => {
    await rolledBack(client, async () => {
      expect(await visibleTo(BARE_USER, 'practitioner')).toEqual([]);
    });
  });

  it('shows finance nothing at all', async () => {
    await rolledBack(client, async () => {
      expect(await visibleTo(FINANCE_USER, 'finance')).toEqual([]);
    });
  });

  it('shows a client contact nothing at all', async () => {
    await rolledBack(client, async () => {
      expect(await visibleTo(IDS.ownerA, 'client_contact')).toEqual([]);
    });
  });

  it("shows another practice's register to nobody", async () => {
    await rolledBack(client, async () => {
      const seen = await asApiRole(
        client,
        IDS.tenantB,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [IDS.ownerB]);
          const { rows } = await client.query<{ id: string }>('select id from kit');
          return rows.map((row) => row.id);
        },
        'owner',
      );
      expect(seen).toEqual([]);
    });
  });
});

describe('who may change the register', () => {
  const insert =
    'insert into kit (tenant_id, serial, model, kind) ' +
    "values ($1, $2, 'Synthetic Bench Unit', 'amplifier')";

  it('lets the owner, an admin and the lead practitioner add an item', async () => {
    for (const [index, [userId, roles]] of [
      [IDS.ownerA, 'owner'],
      [ADMIN_USER, 'admin'],
      [LEAD_USER, 'lead_practitioner'],
    ].entries()) {
      await rolledBack(client, async () => {
        await asApiRole(
          client,
          IDS.tenantA,
          async () => {
            await client.query("select set_config('app.actor_id', $1, true)", [userId]);
            await client.query(insert, [IDS.tenantA, `SYN-AMP-90000${index}`]);
          },
          roles as string,
        );
      });
    }
  });

  it('refuses a practitioner, finance and a client contact adding one', async () => {
    for (const [index, [userId, roles]] of [
      [CALLER_USER, 'practitioner'],
      [FINANCE_USER, 'finance'],
      [IDS.ownerA, 'client_contact'],
    ].entries()) {
      await rolledBack(client, async () => {
        await asApiRole(
          client,
          IDS.tenantA,
          async () => {
            await client.query("select set_config('app.actor_id', $1, true)", [userId]);
            await rejectsWith(client, RLS_VIOLATION, insert, [
              IDS.tenantA,
              `SYN-AMP-91000${index}`,
            ]);
          },
          roles as string,
        );
      });
    }
  });

  it('refuses a practitioner recording a calibration on their own amplifier', async () => {
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [CALLER_USER]);
          // Row security filters an UPDATE rather than raising, so the proof is
          // that nothing moved: the row is one this person can see, and it
          // still does not change.
          const updated = await client.query(
            "update kit set calibration_due_at = now() + interval '2 years' where id = $1",
            [KIT_CALLER_AMPLIFIER],
          );
          expect(updated.rowCount).toBe(0);
        },
        'practitioner',
      );
    });
  });

  it('lets the lead practitioner record one', async () => {
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [LEAD_USER]);
          const updated = await client.query(
            'update kit set last_calibrated_at = now(), ' +
              "calibration_due_at = now() + interval '2 years' where id = $1",
            [KIT_CALLER_AMPLIFIER],
          );
          expect(updated.rowCount).toBe(1);
        },
        'lead_practitioner',
      );
    });
  });

  it('grants nobody a delete: an item is stood down, never removed', async () => {
    const { rows } = await client.query<{ privilege_type: string }>(
      'select privilege_type from information_schema.role_table_grants ' +
        "where table_name = 'kit' and grantee = 'app_role'",
    );
    expect([...new Set(rows.map((row) => row.privilege_type))].sort()).toEqual([
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
  });
});

describe('the check-in context and the instruments', () => {
  it('does not block a practitioner with nothing assigned', async () => {
    await rolledBack(client, async () => {
      const context = await contextAs(BARE_USER);
      expect(context.found).toBe(true);
      expect(context.kit_calibration_overdue).toBe(false);
      expect(context.kit_id).toBeNull();
    });
  });

  it('does not block on an overdue spare nobody is carrying', async () => {
    // KIT_SPARE is unassigned and out of date in the fixture above; if an
    // unassigned item counted, every one of these would block.
    await rolledBack(client, async () => {
      expect((await contextAs(CALLER_USER)).kit_calibration_overdue).toBe(false);
    });
  });

  it('blocks when an active amplifier assigned to them is overdue', async () => {
    await rolledBack(client, async () => {
      await seedKit({
        id: KIT_BARE_AMPLIFIER,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareAmplifier,
        kind: 'amplifier',
        assignedTo: BARE,
        due: 'past',
      });
      const context = await contextAs(BARE_USER);
      expect(context.kit_calibration_overdue).toBe(true);
      expect(context.kit_id).toBe(KIT_BARE_AMPLIFIER);
    });
  });

  it('does not block on somebody else’s overdue amplifier', async () => {
    await rolledBack(client, async () => {
      await seedKit({
        id: KIT_BARE_AMPLIFIER,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareAmplifier,
        kind: 'amplifier',
        assignedTo: BARE,
        due: 'past',
      });
      expect((await contextAs(BARE_USER)).kit_calibration_overdue).toBe(true);
      expect((await contextAs(CALLER_USER)).kit_calibration_overdue).toBe(false);
    });
  });

  it('does not block on an overdue item the practice has stood down', async () => {
    await rolledBack(client, async () => {
      await seedKit({
        id: KIT_BARE_AMPLIFIER,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareAmplifier,
        kind: 'amplifier',
        assignedTo: BARE,
        status: 'inactive',
        due: 'past',
      });
      expect((await contextAs(BARE_USER)).kit_calibration_overdue).toBe(false);
    });
  });

  it('does not block on a laptop, which is never calibrated', async () => {
    await rolledBack(client, async () => {
      await seedKit({
        id: KIT_BARE_LAPTOP,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareLaptop,
        kind: 'laptop',
        assignedTo: BARE,
      });
      const context = await contextAs(BARE_USER);
      expect(context.kit_calibration_overdue).toBe(false);
      expect(context.kit_id).toBeNull();
    });
  });

  it('names the one amplifier when there is exactly one, and none when there are two', async () => {
    await rolledBack(client, async () => {
      await seedKit({
        id: KIT_BARE_AMPLIFIER,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareAmplifier,
        kind: 'amplifier',
        assignedTo: BARE,
        due: 'future',
      });
      expect((await contextAs(BARE_USER)).kit_id).toBe(KIT_BARE_AMPLIFIER);
      await seedKit({
        id: KIT_BARE_SECOND,
        tenantId: IDS.tenantA,
        serial: SERIAL.bareSecond,
        kind: 'amplifier',
        assignedTo: BARE,
        due: 'future',
      });
      expect((await contextAs(BARE_USER)).kit_id).toBeNull();
    });
  });
});
