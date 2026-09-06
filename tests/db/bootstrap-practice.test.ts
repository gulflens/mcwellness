import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import { applySeed } from '../../db/seed/apply';
import { generateSeed, SEED_TENANT_ID } from '../../db/seed/generate';
import { FAMILY_NAMES, GIVEN_NAMES } from '../../db/seed/names';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { asApiRole, AUTH, freshDatabase, rejectsWith, rolledBack } from './helpers';

/**
 * `app.bootstrap_practice` (migration 956): the way a database that has only
 * ever seen the migrations gets its first practice and its owner, with none of
 * the seed's synthetic people and money.
 *
 * The test that matters is the third one. Every per-practice default in this
 * schema is written twice over: once by a data step in the migration that
 * introduces it, covering a practice that already existed, and from then on by
 * an after-insert trigger on `tenant` for every practice created afterwards.
 * The bootstrap therefore copies no statement — it inserts the tenant and lets
 * those triggers run. What keeps that honest is a comparison against a seeded
 * practice, table by table, over every tenant-scoped table the schema has
 * rather than a list written by hand: a future migration that adds a default
 * without a trigger fails here, rather than on the day production opens.
 */

const KEYS = deriveIdentityKeys(Buffer.alloc(32, 7));
const data = generateSeed();

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

/**
 * The tables the seed fills with its own synthetic practice: its people, its
 * catalogue, its households and its money. No migration writes a row into any
 * of them for a new practice, so they are the difference the comparison below
 * is allowed to find. The list is `tests/db/seed.test.ts`'s, minus `tenant`,
 * which carries no `tenant_id` of its own and so is never enumerated.
 */
const SEED_TABLES = [
  'app_user',
  'user_role',
  'service_type',
  'price',
  'package',
  'package_component',
  'package_price',
  'practitioner',
  'credential',
  'kit',
  'location',
  'client',
  'contact',
  'document',
  'consent',
  'assessment',
];

/** Columns that differ between two databases by construction, and so say nothing. */
const INCOMPARABLE = ['id', 'tenant_id', 'created_at', 'updated_at', 'created_by'];

const OWNER_NAME = `${GIVEN_NAMES[0]?.en ?? ''} ${FAMILY_NAMES[0]?.en ?? ''}`;
const OWNER_EMAIL = 'owner@example.com';

/** Five arguments, the time zone left to its default; and all six. */
const BOOTSTRAP = 'select * from app.bootstrap_practice($1, $2, $3, $4, $5)';
const BOOTSTRAP_WITH_ZONE = 'select * from app.bootstrap_practice($1, $2, $3, $4, $5, $6)';

const GOOD_ARGUMENTS = [
  data.tenant.legalName,
  data.tenant.legalNameAr,
  AUTH.ownerA,
  OWNER_NAME,
  OWNER_EMAIL,
  'Asia/Dubai',
];

/** The same arguments with one of them replaced. */
function withOneChanged(index: number, value: unknown): unknown[] {
  return GOOD_ARGUMENTS.map((argument, i) => (i === index ? value : argument));
}

type Snapshot = {
  /** Table name to row count, for the tables that hold any row at all. */
  counts: Record<string, number>;
  /** Table name to its rows, with the incomparable columns dropped. */
  rows: Record<string, unknown[]>;
};

/** Every ordinary table in `public` that carries a `tenant_id`, the audit trail aside. */
async function tenantScopedTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select c.relname as name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relispartition
        and a.attname = 'tenant_id'
        and a.attnum > 0
        and not a.attisdropped
        and c.relname <> 'audit_log'
      order by c.relname`,
  );
  return rows.map((row) => row.name);
}

async function comparableColumns(client: pg.Client, table: string): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name <> all($2)
      order by ordinal_position`,
    [table, INCOMPARABLE],
  );
  return rows.map((row) => row.column_name);
}

/** What one practice holds, in every tenant-scoped table that holds anything. */
async function snapshot(client: pg.Client, tenantId: string): Promise<Snapshot> {
  const snap: Snapshot = { counts: {}, rows: {} };
  for (const table of await tenantScopedTables(client)) {
    const counted = await client.query<{ n: number }>(
      `select count(*)::int as n from public."${table}" where tenant_id = $1`,
      [tenantId],
    );
    const n = counted.rows[0]?.n ?? 0;
    if (n === 0) continue;
    snap.counts[table] = n;
    const columns = await comparableColumns(client, table);
    const list = columns.map((column) => `"${column}"`).join(', ');
    const order = columns.map((_, i) => i + 1).join(', ');
    const { rows } = await client.query(
      `select ${list} from public."${table}" where tenant_id = $1 order by ${order}`,
      [tenantId],
    );
    snap.rows[table] = rows;
  }
  return snap;
}

/** The same snapshot with the seed's own synthetic content set aside. */
function defaultsOnly(snap: Snapshot): Snapshot {
  const kept = Object.keys(snap.counts).filter((table) => !SEED_TABLES.includes(table));
  return {
    counts: Object.fromEntries(kept.map((table) => [table, snap.counts[table] ?? 0])),
    rows: Object.fromEntries(kept.map((table) => [table, snap.rows[table] ?? []])),
  };
}

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let seeded: Snapshot;
let bootstrapped: Snapshot;
let practiceId: string;
let ownerUserId: string;
let withoutArabicName: number;

beforeAll(async () => {
  // A seeded practice first, snapshotted and then discarded: the two cannot
  // share a database, because a second practice is exactly what the function
  // refuses.
  const withSeed = await freshDatabase();
  await applySeed(withSeed, data, KEYS);
  seeded = await snapshot(withSeed, SEED_TENANT_ID);
  await withSeed.end();

  owner = await freshDatabase();
  // The Arabic legal name is the one argument that may be absent. Proved on
  // the empty database and rolled back, because after the real call below
  // there is a practice and every call is refused for that reason instead.
  await owner.query('begin');
  const trial = await owner.query(BOOTSTRAP_WITH_ZONE, withOneChanged(1, null));
  withoutArabicName = trial.rows.length;
  await owner.query('rollback');

  const { rows } = await owner.query<{ practice_id: string; owner_user_id: string }>(
    BOOTSTRAP,
    GOOD_ARGUMENTS.slice(0, 5),
  );
  practiceId = rows[0]?.practice_id ?? '';
  ownerUserId = rows[0]?.owner_user_id ?? '';
  bootstrapped = await snapshot(owner, practiceId);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set; copy .env.example to .env.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

describe('the first practice', () => {
  it('creates one practice, with the names it was given and nothing invented', async () => {
    const { rows } = await owner.query('select * from tenant');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legal_name: data.tenant.legalName,
      legal_name_ar: data.tenant.legalNameAr,
      timezone: 'Asia/Dubai',
      default_emirate: 'DXB',
      // Not registered for VAT, no licence and no address: every one of them is
      // the owner's own to record in Settings, and the function invents none of
      // them (migrations 905 and 956).
      trn: null,
      licence_number: null,
      licensing_authority: null,
      licence_expires_on: null,
      vat_registered: false,
      vat_trn: null,
      location_id: null,
      created_by: null,
    });
  });

  it('creates one owner, bound to the given Auth user', async () => {
    const { rows } = await owner.query(
      'select u.id, u.auth_id, u.display_name, u.email, u.status, u.preferred_locale, r.role ' +
        'from app_user u join user_role r on r.user_id = u.id',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ownerUserId,
      auth_id: AUTH.ownerA,
      display_name: OWNER_NAME,
      email: OWNER_EMAIL,
      status: 'active',
      preferred_locale: 'en',
      role: 'owner',
    });
  });

  it('gives the practice the same defaults a seeded practice has, table by table', () => {
    const expected = defaultsOnly(seeded);
    const actual = defaultsOnly(bootstrapped);
    // The counts first, so a missing table reads as a missing table rather than
    // as a wall of row differences.
    expect(actual.counts).toEqual(expected.counts);
    expect(actual.rows).toEqual(expected.rows);
    // And the comparison is not vacuous: every default-writing migration in
    // this schema is represented (100, 202, 400, 402, 405 and 600).
    expect(Object.keys(actual.counts).sort()).toEqual([
      'goal_category',
      'invoice_number_series',
      'payment_receipt_series',
      'report_number_series',
      'scheduling_setting',
      'vat_setting',
    ]);
  });

  it('writes every row it makes as the system, under one reason', async () => {
    const { rows } = await owner.query<{ actor_type: string; reason: string }>(
      'select actor_type, reason from audit_log group by 1, 2',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_type).toBe('system');
    expect(rows[0]?.reason).toContain('bootstrap_practice');
    const chain = await owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain() as broken',
    );
    expect(chain.rows[0]?.broken).toBeNull();
  });
});

describe('what it refuses', () => {
  it('accepts a practice with no Arabic legal name, which is recorded later', () => {
    expect(withoutArabicName).toBe(1);
  });

  it('refuses a blank name, a missing owner, or a time zone Postgres does not know', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '22023', BOOTSTRAP_WITH_ZONE, withOneChanged(0, '   '));
      await rejectsWith(owner, '22023', BOOTSTRAP_WITH_ZONE, withOneChanged(2, null));
      await rejectsWith(owner, '22023', BOOTSTRAP_WITH_ZONE, withOneChanged(3, ''));
      await rejectsWith(owner, '22023', BOOTSTRAP_WITH_ZONE, withOneChanged(4, null));
      await rejectsWith(owner, '22023', BOOTSTRAP_WITH_ZONE, withOneChanged(5, 'Asia/Nowhere'));
    });
  });

  it('refuses a second practice', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '23505', BOOTSTRAP_WITH_ZONE, withOneChanged(2, AUTH.practitionerA));
    });
  });

  it('is out of the API role’s reach', async () => {
    await rolledBack(owner, () =>
      asApiRole(owner, practiceId, () =>
        rejectsWith(owner, '42501', BOOTSTRAP_WITH_ZONE, GOOD_ARGUMENTS),
      ),
    );
  });
});

describe('the owner it leaves behind', () => {
  it('can sign in through the platform’s own session path', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setSubject(AUTH.ownerA)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(KEY);
    const res = await api.request('/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: ownerUserId,
      displayName: OWNER_NAME,
      tenantId: practiceId,
      roles: ['owner'],
      capabilities: [],
      preferredLocale: 'en',
    });
  });
});
