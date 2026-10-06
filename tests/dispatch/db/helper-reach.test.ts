import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySeed } from '../../../db/seed/apply';
import { generateSeed, SEED_TENANT_ID } from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { freshDatabase, seedTenant, seedUser } from '../../db/helpers';

/**
 * A helper reads nothing of the practice but their own few rows
 * (docs/SPEC/dispatch.md section 15.12; round 76). Every table in `public` is
 * walked, so a table added tomorrow is covered without this file changing:
 * it is refused to a helper unless it is named in `OWN_ROWS` below, and then
 * only the helper's own rows come back. Ids in this file's own 77xx block.
 */

const KEYS = deriveIdentityKeys(Buffer.alloc(32, 7));

const HELPER_USER = '00000000-0000-4000-8000-000000007701';
const AUTH_HELPER = '00000000-0000-4000-8000-000000007702';
const OTHER_TENANT = '00000000-0000-4000-8000-000000007703';
const OTHER_OWNER = '00000000-0000-4000-8000-000000007704';
const OTHER_HELPER = '00000000-0000-4000-8000-000000007705';

/**
 * The tables a helper may read at all, and how many of their own rows each
 * holds by the end of `beforeAll`. Everything else answers nothing.
 */
const OWN_ROWS: Record<string, number> = {
  // Their own sign-in row (GET /api/me reads it) and their own role.
  app_user: 1,
  user_role: 1,
  // Their own consent and switch (GET /api/location/me reads both).
  staff_consent: 1,
  location_sharing: 1,
  // Whom they accompany, which is theirs to read and not to change.
  helper_accompaniment: 1,
};

/** Tables the seed fills, so the sweep below is not vacuously true of empty tables. */
const MUST_HOLD_ROWS = [
  'client',
  'contact',
  'consent',
  'location',
  'document',
  'assessment',
  'appointment',
  'practitioner',
  'service_type',
  'price',
  'package',
  'audit_log',
  'practitioner_position',
  'staff_consent',
  'app_user',
];

let owner: pg.Client;
let tables: string[];

/** Counts a table's rows as a helper would: the API's role, the helper's settings. */
async function countAsHelper(table: string): Promise<number | 'refused'> {
  await owner.query('begin');
  try {
    await owner.query('set local role app_role');
    await owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'helper', true), " +
        "set_config('app.actor_id', $2, true)",
      [SEED_TENANT_ID, HELPER_USER],
    );
    const { rows } = await owner.query<{ n: number }>(
      `select count(*)::int as n from public.${table}`,
    );
    return rows[0]?.n ?? 0;
  } catch (error) {
    // No select granted to the API role at all is a refusal too.
    if ((error as { code?: string }).code === '42501') return 'refused';
    throw error;
  } finally {
    await owner.query('rollback');
  }
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, generateSeed(), KEYS);
  const { rows: practitioners } = await owner.query<{ id: string; user_id: string }>(
    "select id, user_id from practitioner where tenant_id = $1 and status = 'active' order by id limit 1",
    [SEED_TENANT_ID],
  );
  const practitioner = practitioners[0]!;

  // A practitioner sharing, so the staff tables hold somebody else's rows.
  await owner.query(
    'insert into staff_consent (tenant_id, user_id, purpose, notice_version) ' +
      "values ($1, $2, 'location_sharing', '1.1')",
    [SEED_TENANT_ID, practitioner.user_id],
  );
  await owner.query(
    'insert into location_sharing (tenant_id, user_id, sharing_on) values ($1, $2, true)',
    [SEED_TENANT_ID, practitioner.user_id],
  );
  await owner.query(
    'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, accuracy_metres) ' +
      'values ($1, $2, 25.2, 55.27, 10)',
    [SEED_TENANT_ID, practitioner.id],
  );

  // The helper: their role, whom they accompany, their own consent and switch.
  await seedUser(owner, {
    id: HELPER_USER,
    tenantId: SEED_TENANT_ID,
    authId: AUTH_HELPER,
    displayName: 'Synthetic Helper',
    roles: ['helper'],
  });
  await owner.query(
    'insert into helper_accompaniment (tenant_id, helper_user_id, practitioner_id) values ($1, $2, $3)',
    [SEED_TENANT_ID, HELPER_USER, practitioner.id],
  );
  await owner.query(
    'insert into staff_consent (tenant_id, user_id, purpose, notice_version) ' +
      "values ($1, $2, 'location_sharing', '1.1')",
    [SEED_TENANT_ID, HELPER_USER],
  );
  await owner.query(
    'insert into location_sharing (tenant_id, user_id, sharing_on) values ($1, $2, true)',
    [SEED_TENANT_ID, HELPER_USER],
  );

  // A second practice with a helper of its own, which the first never sees.
  await seedTenant(owner, OTHER_TENANT, OTHER_OWNER, 'Synthetic Studio Other');
  await seedUser(owner, {
    id: OTHER_HELPER,
    tenantId: OTHER_TENANT,
    authId: null,
    displayName: 'Synthetic Helper Other',
    roles: ['helper'],
  });

  const { rows } = await owner.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  tables = rows.map((row) => row.tablename);
});

afterAll(async () => {
  await owner.end();
});

describe('what a helper reads', () => {
  it('walks a practice that holds rows, so nothing below is true of an empty table', async () => {
    for (const table of MUST_HOLD_ROWS) {
      const { rows } = await owner.query<{ n: number }>(
        `select count(*)::int as n from public.${table}`,
      );
      expect(rows[0]?.n, table).toBeGreaterThan(0);
    }
  });

  it('reads no row of any table but their own few, whatever the table', async () => {
    const seen: Record<string, number | 'refused'> = {};
    for (const table of tables) seen[table] = await countAsHelper(table);
    const expected: Record<string, number | 'refused'> = {};
    for (const table of tables) {
      expected[table] = OWN_ROWS[table] ?? (seen[table] === 'refused' ? 'refused' : 0);
    }
    expect(seen).toEqual(expected);
  });

  it('reads only their own row of the tables they may read at all', async () => {
    await owner.query('begin');
    try {
      await owner.query('set local role app_role');
      await owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'helper', true), " +
          "set_config('app.actor_id', $2, true)",
        [SEED_TENANT_ID, HELPER_USER],
      );
      const users = await owner.query<{ id: string }>('select id from app_user');
      expect(users.rows).toEqual([{ id: HELPER_USER }]);
      const roles = await owner.query<{ role: string }>('select role::text as role from user_role');
      expect(roles.rows).toEqual([{ role: 'helper' }]);
      for (const table of ['staff_consent', 'location_sharing']) {
        const own = await owner.query<{ user_id: string }>(`select user_id from ${table}`);
        expect(own.rows, table).toEqual([{ user_id: HELPER_USER }]);
      }
    } finally {
      await owner.query('rollback');
    }
  });

  it("is invisible to another practice: its owner reads none of this helper's rows", async () => {
    await owner.query('begin');
    try {
      await owner.query('set local role app_role');
      await owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true), " +
          "set_config('app.actor_id', $2, true)",
        [OTHER_TENANT, OTHER_OWNER],
      );
      for (const table of [
        'helper_accompaniment',
        'staff_consent',
        'location_sharing',
        'practitioner_position',
      ]) {
        const { rows } = await owner.query<{ n: number }>(
          `select count(*)::int as n from ${table}`,
        );
        expect(rows[0]?.n, table).toBe(0);
      }
      const users = await owner.query<{ id: string }>('select id from app_user where id = $1', [
        HELPER_USER,
      ]);
      expect(users.rows).toEqual([]);
    } finally {
      await owner.query('rollback');
    }
  });

  it('is held there by a policy on every table, so a new table is covered on its first migrate', async () => {
    const { rows } = await owner.query<{ tablename: string }>(
      "select t.tablename from pg_tables t where t.schemaname = 'public' " +
        'and (not t.rowsecurity or not exists (select 1 from pg_policies p ' +
        "where p.schemaname = 'public' and p.tablename = t.tablename " +
        "and p.policyname = 'helper_reach_read' and p.permissive = 'RESTRICTIVE'))",
    );
    expect(rows).toEqual([]);
  });

  it('writes nothing but their own consent, switch and positions', async () => {
    const { rows } = await owner.query<{ tablename: string }>(
      "select t.tablename from pg_tables t where t.schemaname = 'public' " +
        'and not exists (select 1 from pg_policies p ' +
        "where p.schemaname = 'public' and p.tablename = t.tablename " +
        "and p.policyname = 'helper_reach_write' and p.permissive = 'RESTRICTIVE')",
    );
    expect(rows).toEqual([]);
  });
});
