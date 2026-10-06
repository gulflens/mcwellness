import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, freshDatabase, seedTenant, seedUser } from './helpers';
import { PORTAL, PORTAL_HOMES, seedAppointment, seedPortalHousehold } from '../portal/db/support';

/**
 * How far a household's login reaches into the sign-in and staff tables
 * (db/policies/core/household_reach.sql; trunk round 77;
 * docs/CHANGE-REQUESTS/dispatch-03.md item 18).
 *
 * `app_user`, `user_role`, `practitioner`, `credential`, `service_type`,
 * `goal_category`, `scheduling_setting` and `tenant` carried no rule but the
 * practice's own, so a household contact could read, at the database, every
 * sign-in row in the practice — other households' and the staff's, with names,
 * emails and phones. The portal's routes never asked; the floor was missing.
 *
 * Every table in `public` is walked as the mother of the portal's own fixture
 * (tests/portal/db/support.ts), row by row: nothing about a client who is not
 * hers, no sign-in that is not hers, no staff row, and of the eight tables
 * exactly what `EXPECTED` below says. The person who is both staff and a
 * household contact (migration 968's colleague) is walked too, and keeps
 * every row a colleague reads. Extra ids in this file's own `e7` block.
 */

const OTHER_TENANT = '000000e7-0000-4000-8000-000000000001';
const OTHER_OWNER = '000000e7-0000-4000-8000-000000000002';
const OTHER_CONTACT_USER = '000000e7-0000-4000-8000-000000000003';
const VISIT_CHILD_A = '000000e7-0000-4000-8000-000000000011';
const VISIT_CHILD_B = '000000e7-0000-4000-8000-000000000012';
const VISIT_ADULT = '000000e7-0000-4000-8000-000000000013';
const VISIT_STRANGER = '000000e7-0000-4000-8000-000000000014';
const COLLEAGUE_CONTACT = '000000e7-0000-4000-8000-000000000021';
/** A service no visit of the mother's uses: the catalogue beyond her own visits. */
const UNUSED_SERVICE = '000000e7-0000-4000-8000-000000000031';

const MOTHERS_CLIENTS: readonly string[] = [PORTAL.childA, PORTAL.childB];

/** The eight tables, and exactly what the mother reads of each. */
const EIGHT = [
  'app_user',
  'user_role',
  'practitioner',
  'credential',
  'service_type',
  'goal_category',
  'scheduling_setting',
  'tenant',
] as const;

const EXPECTED: Record<(typeof EIGHT)[number], string[]> = {
  // Her own sign-in row: GET /api/me and every portal screen's practice line.
  app_user: [PORTAL.motherUser],
  // Her own role, which is the one row that says she is a household.
  user_role: [PORTAL.motherUser],
  // The portal never names the practitioner (docs/SPEC/client-portal.md 3.2).
  practitioner: [],
  credential: [],
  // The service on her own visits (Visits and Home name it), and no other.
  service_type: [PORTAL.serviceType],
  goal_category: [],
  scheduling_setting: [],
  // Her practice's own row: its name, its WhatsApp number, its time zone.
  // The policy's arm here is `id = app.current_tenant_id()`, which is exactly
  // tenant isolation: this expectation passes on main without the new policy
  // and is kept only as a regression guard, not as proof of a narrowing.
  tenant: [IDS.tenantA],
};

/** The column each of the eight is identified by in `EXPECTED`. */
const KEY: Record<(typeof EIGHT)[number], string> = {
  app_user: 'id',
  user_role: 'user_id',
  practitioner: 'id',
  credential: 'id',
  service_type: 'id',
  goal_category: 'id',
  scheduling_setting: 'id',
  tenant: 'id',
};

let owner: pg.Client;
let tables: string[];
/** Every user id that is a household contact's sign-in on one of the mother's clients. */
let familyUsers: string[];

/** Runs `fn` as the API role with a request's stamp, always rolled back. */
async function asActor<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  await owner.query('begin');
  try {
    await owner.query('set local role app_role');
    await owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true), " +
        "set_config('app.actor_id', $3, true)",
      [IDS.tenantA, roles, userId],
    );
    return await fn();
  } finally {
    await owner.query('rollback');
  }
}

/** The stamp the middleware writes for this person: their roles, as resolve_actor lists them. */
async function stampOf(authId: string): Promise<string> {
  const { rows } = await owner.query<{ roles: string[] }>(
    'select roles from app.resolve_actor($1)',
    [authId],
  );
  return rows[0]!.roles.join(',');
}

/** A table's rows, as this stamp reads them, or `refused` when the API role has no select. */
async function rowsAs(
  userId: string,
  roles: string,
  table: string,
): Promise<Record<string, unknown>[] | 'refused'> {
  return asActor(userId, roles, async () => {
    try {
      await owner.query('savepoint walk');
      const { rows } = await owner.query<{ r: Record<string, unknown> }>(
        `select to_jsonb(t) as r from public.${table} t`,
      );
      return rows.map((row) => row.r);
    } catch (error) {
      if ((error as { code?: string }).code === '42501') return 'refused';
      throw error;
    }
  });
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);

  // Visits on every record, so `appointment` and `service_type` have rows
  // that are hers and rows that are not.
  await seedAppointment(owner, {
    id: VISIT_CHILD_A,
    clientId: PORTAL.childA,
    inDays: 2,
    hour: 9,
    status: 'confirmed',
  });
  await seedAppointment(owner, {
    id: VISIT_CHILD_B,
    clientId: PORTAL.childB,
    inDays: 3,
    hour: 9,
    status: 'confirmed',
  });
  await seedAppointment(owner, {
    id: VISIT_ADULT,
    clientId: PORTAL.adultClient,
    inDays: 2,
    hour: 12,
    status: 'confirmed',
    serviceTypeId: PORTAL.brainMapService,
  });
  await seedAppointment(owner, {
    id: VISIT_STRANGER,
    clientId: PORTAL.strangerClient,
    inDays: 4,
    hour: 9,
    status: 'confirmed',
    serviceTypeId: PORTAL.brainMapService,
  });
  await owner.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, 'synthetic-unused', 'Synthetic unused', 30, '{studio}')",
    [UNUSED_SERVICE, IDS.tenantA],
  );

  // The staff tables hold rows a household must not read.
  await owner.query(
    'insert into credential (tenant_id, practitioner_id, service_type_id, certification, valid_from, ' +
      "can_execute_session) values ($1, $2, $3, 'Synthetic certificate', '2026-01-01', true)",
    [IDS.tenantA, PORTAL.practitionerRow, PORTAL.serviceType],
  );
  await owner.query(
    "insert into goal_category (tenant_id, code, name) values ($1, 'synthetic-focus', 'Synthetic focus')",
    [IDS.tenantA],
  );
  const { rows: settings } = await owner.query<{ n: number }>(
    'select count(*)::int as n from scheduling_setting where tenant_id = $1',
    [IDS.tenantA],
  );
  if (settings[0]!.n === 0) {
    await owner.query('insert into scheduling_setting (tenant_id) values ($1)', [IDS.tenantA]);
  }

  // Migration 968's colleague: the practitioner is also a contact of the
  // stranger's record, and so holds client_contact beside practitioner.
  await owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
    [IDS.tenantA, PORTAL.practitioner],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, family_name) ' +
      "values ($1, $2, $3, $4, 'other', 'Basil', 'Vale')",
    [COLLEAGUE_CONTACT, IDS.tenantA, PORTAL.strangerClient, PORTAL.practitioner],
  );

  // A second practice with a household of its own, which the first never sees.
  await seedTenant(owner, OTHER_TENANT, OTHER_OWNER, 'Synthetic Studio Other');
  await seedUser(owner, {
    id: OTHER_CONTACT_USER,
    tenantId: OTHER_TENANT,
    authId: null,
    displayName: 'Synthetic Contact Other',
    roles: ['client_contact'],
  });

  const { rows } = await owner.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  tables = rows.map((row) => row.tablename);

  const { rows: family } = await owner.query<{ user_id: string }>(
    'select distinct user_id from contact where client_id = any($1::uuid[]) and user_id is not null',
    [MOTHERS_CLIENTS],
  );
  familyUsers = family.map((row) => row.user_id);
});

afterAll(async () => {
  await owner.end();
});

describe('what a household reads of the sign-in and staff tables', () => {
  it('walks tables that hold rows, so nothing below is true of an empty table', async () => {
    for (const table of EIGHT) {
      const { rows } = await owner.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where ${table === 'tenant' ? 'id' : 'tenant_id'} = $1`,
        [IDS.tenantA],
      );
      // The practice's own row is the only one its table holds for it.
      if (table === 'tenant') expect(rows[0]?.n, table).toBe(1);
      else expect(rows[0]?.n, table).toBeGreaterThan(EXPECTED[table].length);
    }
  });

  it('reads exactly its own rows of the eight tables, and nothing else in them', async () => {
    const seen: Record<string, unknown> = {};
    for (const table of EIGHT) {
      const rows = await rowsAs(PORTAL.motherUser, 'client_contact', table);
      seen[table] =
        rows === 'refused' ? 'refused' : rows.map((row) => row[KEY[table]] as string).sort();
    }
    const expected: Record<string, unknown> = {};
    for (const table of EIGHT) expected[table] = [...EXPECTED[table]].sort();
    expect(seen).toEqual(expected);
  });

  it('reads no row, of any table, about a client who is not hers or a person outside her family', async () => {
    const strays: string[] = [];
    for (const table of tables) {
      const rows = await rowsAs(PORTAL.motherUser, 'client_contact', table);
      if (rows === 'refused') continue;
      for (const row of rows) {
        const where = `${table} ${String(row.id ?? row.user_id ?? '')}`;
        if ('tenant_id' in row && row.tenant_id !== IDS.tenantA) strays.push(`${where}: tenant`);
        if ('client_id' in row && row.client_id !== null) {
          if (!MOTHERS_CLIENTS.includes(row.client_id as string)) strays.push(`${where}: client`);
        }
        if ('user_id' in row && row.user_id !== null && table !== 'contact') {
          if (row.user_id !== PORTAL.motherUser) strays.push(`${where}: user`);
        }
        if (table === 'app_user' && row.id !== PORTAL.motherUser) strays.push(`${where}: sign-in`);
        if (table === 'contact') {
          if (!MOTHERS_CLIENTS.includes(row.client_id as string)) strays.push(`${where}: contact`);
          if (row.user_id !== null && !familyUsers.includes(row.user_id as string))
            strays.push(`${where}: contact user`);
        }
        if (table === 'location') {
          const ownHome =
            row.owner_type === 'client' &&
            MOTHERS_CLIENTS.includes(row.owner_id as string) &&
            MOTHERS_CLIENTS.some((client) => PORTAL_HOMES[client] === row.id);
          if (!ownHome) strays.push(`${where}: location`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("reads none of another household's sign-in rows, nor any member of staff's", async () => {
    const users = await rowsAs(PORTAL.motherUser, 'client_contact', 'app_user');
    expect(users).not.toBe('refused');
    const ids = (users as Record<string, unknown>[]).map((row) => row.id);
    for (const other of [
      PORTAL.adultUser,
      PORTAL.minorUser,
      PORTAL.admin,
      PORTAL.leadPractitioner,
      PORTAL.practitioner,
      PORTAL.finance,
      IDS.ownerA,
      OTHER_CONTACT_USER,
    ]) {
      expect(ids, other).not.toContain(other);
    }
  });

  it('is the same floor for every household: the adult reads her own row and her own service', async () => {
    const users = await rowsAs(PORTAL.adultUser, 'client_contact', 'app_user');
    expect((users as Record<string, unknown>[]).map((row) => row.id)).toEqual([PORTAL.adultUser]);
    const services = await rowsAs(PORTAL.adultUser, 'client_contact', 'service_type');
    expect((services as Record<string, unknown>[]).map((row) => row.id)).toEqual([
      PORTAL.brainMapService,
    ]);
  });
});

describe('the colleague who is also a household contact (migration 968)', () => {
  it('is stamped with both roles, as the middleware stamps every request', async () => {
    expect(await stampOf(PORTAL.practitionerAuth)).toBe('practitioner,client_contact');
  });

  it('keeps every row a colleague reads, on every table', async () => {
    const both = await stampOf(PORTAL.practitionerAuth);
    const lost: string[] = [];
    for (const table of tables) {
      const asColleague = await rowsAs(PORTAL.practitioner, 'practitioner', table);
      const asBoth = await rowsAs(PORTAL.practitioner, both, table);
      if (asColleague === 'refused') continue;
      if (asBoth === 'refused' || asBoth.length < asColleague.length) lost.push(table);
    }
    expect(lost).toEqual([]);
  });

  it('reads the staff rows of the eight tables, as any practitioner does', async () => {
    const both = await stampOf(PORTAL.practitionerAuth);
    for (const table of EIGHT) {
      const asColleague = await rowsAs(PORTAL.practitioner, 'practitioner', table);
      const asBoth = await rowsAs(PORTAL.practitioner, both, table);
      expect(asBoth, table).toEqual(asColleague);
    }
    const users = await rowsAs(PORTAL.practitioner, both, 'app_user');
    expect((users as Record<string, unknown>[]).length).toBeGreaterThan(1);
  });
});

/**
 * One write as the mother, with chosen guards taken away first. The older
 * guards are dropped as the table owner inside the test's own transaction and
 * come back with its rollback, so each case below can show that
 * `household_reach_write` refuses the write alone — and, with that policy
 * dropped too, that the same write goes through, so the refusal is the
 * policy's and not something else's.
 */
async function writeWithout(
  guards: readonly string[],
  sql: string,
  params: readonly unknown[],
): Promise<{ rowCount: number } | { code: string }> {
  await owner.query('begin');
  try {
    for (const guard of guards) await owner.query(guard);
    await owner.query('set local role app_role');
    await owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'client_contact', true), " +
        "set_config('app.actor_id', $2, true)",
      [IDS.tenantA, PORTAL.motherUser],
    );
    try {
      const result = await owner.query(sql, [...params]);
      return { rowCount: result.rowCount ?? 0 };
    } catch (error) {
      return { code: (error as { code?: string }).code ?? 'unknown' };
    }
  } finally {
    await owner.query('rollback');
  }
}

const dropOwnPolicy = (table: string) => `drop policy household_reach_write on public.${table}`;

describe('what a household writes to the eight tables', () => {
  it("is refused its practice's own row by household_reach_write alone", async () => {
    const sql = "update tenant set legal_name = 'Synthetic Renamed' where id = $1";
    // The older guard: migration 905's trigger refuses a household as well.
    const older = ['alter table public.tenant disable trigger guard_tenant_identity'];
    expect(await writeWithout([], sql, [IDS.tenantA])).toEqual({ code: '42501' });
    expect(await writeWithout(older, sql, [IDS.tenantA])).toEqual({ code: '42501' });
    expect(await writeWithout([...older, dropOwnPolicy('tenant')], sql, [IDS.tenantA])).toEqual({
      rowCount: 1,
    });
  });

  it("is refused its own sign-in row by household_reach_write alone, and reaches nobody else's through the new policies", async () => {
    const sql = "update app_user set display_name = 'Synthetic Renamed' where id = $1";
    // The older guard: role_guard.sql's admin_updates_only hides every row from
    // an update by anybody but the owner or an admin, so on main these answer
    // "nothing to update".
    const older = ['drop policy admin_updates_only on public.app_user'];
    for (const id of [PORTAL.motherUser, PORTAL.admin]) {
      expect(await writeWithout([], sql, [id]), id).toEqual({ rowCount: 0 });
    }
    // Without it, the new policies alone: her own row is refused by
    // household_reach_write's check, and nobody else's row is reachable at all
    // (household_reach_read and household_reach_write both hide it).
    expect(await writeWithout(older, sql, [PORTAL.motherUser])).toEqual({ code: '42501' });
    expect(await writeWithout(older, sql, [PORTAL.admin])).toEqual({ rowCount: 0 });
    // And with them gone too the writes go through, so neither answer was vacuous.
    expect(
      await writeWithout([...older, dropOwnPolicy('app_user')], sql, [PORTAL.motherUser]),
    ).toEqual({ rowCount: 1 });
    expect(
      await writeWithout(
        [
          ...older,
          dropOwnPolicy('app_user'),
          'drop policy household_reach_read on public.app_user',
        ],
        sql,
        [PORTAL.admin],
      ),
    ).toEqual({ rowCount: 1 });
  });

  it('is refused a new role, service or goal category by household_reach_write alone', async () => {
    const cases = [
      {
        table: 'user_role',
        sql: "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
        params: [IDS.tenantA, PORTAL.finance],
      },
      {
        table: 'service_type',
        sql:
          'insert into service_type (tenant_id, code, name, duration_minutes, delivery_modes) ' +
          "values ($1, 'synthetic-new', 'Synthetic new', 30, '{studio}')",
        params: [IDS.tenantA],
      },
      {
        table: 'goal_category',
        sql: "insert into goal_category (tenant_id, code, name) values ($1, 'synthetic', 'Synthetic')",
        params: [IDS.tenantA],
      },
    ] as const;
    for (const { table, sql, params } of cases) {
      // The older guard on each: admin_inserts_only (role_guard.sql for
      // user_role and service_type, client/writers.sql for goal_category).
      const older = [`drop policy admin_inserts_only on public.${table}`];
      expect(await writeWithout([], sql, params), table).toEqual({ code: '42501' });
      expect(await writeWithout(older, sql, params), table).toEqual({ code: '42501' });
      expect(await writeWithout([...older, dropOwnPolicy(table)], sql, params), table).toEqual({
        rowCount: 1,
      });
    }
  });

  it('is held by two restrictive policies on each of the eight tables', async () => {
    const { rows } = await owner.query<{ tablename: string; policyname: string }>(
      'select tablename, policyname from pg_policies ' +
        "where schemaname = 'public' and policyname in ('household_reach_read', 'household_reach_write') " +
        "and permissive = 'RESTRICTIVE' order by tablename, policyname",
    );
    const expected = [...EIGHT].sort().flatMap((table) => [
      { tablename: table, policyname: 'household_reach_read' },
      { tablename: table, policyname: 'household_reach_write' },
    ]);
    expect(rows).toEqual(expected);
  });
});
