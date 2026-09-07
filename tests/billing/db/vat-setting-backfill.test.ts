import { readdir, readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreatePriceResponse } from '../../../app/api/billing/schema';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import {
  applyPolicies,
  connect,
  requireDatabaseUrl,
  resetDatabase,
  syncLocalApiRolePassword,
} from '../../../db/runner/apply';
import { hasRollbackBlock, isLocalDatabaseUrl, listMigrationFiles } from '../../../db/runner/plan';

/**
 * Proves migration 400_billing_catalogue.sql's backfill: a tenant that
 * already exists the moment the migration runs gets exactly one vat_setting
 * row, the UAE standard rate, without waiting on any setting screen.
 *
 * freshDatabase() (tests/db/helpers.ts) always applies every migration,
 * 400 included, to an empty schema in one pass — there is never a tenant for
 * the backfill to find, which is the right behaviour on a database that has
 * never had one, but proves nothing about the backfill itself. This test
 * instead applies every migration up to 400, inserts a tenant — the "a real
 * tenant" and "the synthetic practice" cases the migration's own comment
 * names — and only then applies 400, mirroring exactly what
 * db/runner/apply.ts's runMigrations() does per file, scoped to a cutoff it
 * doesn't expose. Nothing here edits db/runner; every piece it borrows is
 * imported, not changed.
 */

const MIGRATIONS_DIR = new URL('../../../db/migrations/', import.meta.url);

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const NOW = () => new Date('2026-09-02T08:00:00.000Z');

const TENANT_ID = '00000000-0000-4000-8000-0000000000d0';
const OWNER_ID = '00000000-0000-4000-8000-0000000000d1';
const OWNER_AUTH = '00000000-0000-4000-8000-0000000000d2';
const SERVICE_TYPE_ID = '00000000-0000-4000-8000-0000000000d3';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

/** One migration file, applied exactly as db/runner/apply.ts's runMigrations()
 * applies each pending file: rollback block required, one transaction,
 * recorded in schema_migration. */
async function applyMigrationFile(client: pg.Client, filename: string): Promise<void> {
  const sql = await readFile(new URL(filename, MIGRATIONS_DIR), 'utf8');
  if (!hasRollbackBlock(sql)) {
    throw new Error(`${filename} has no "-- rollback:" block.`);
  }
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migration (filename) values ($1)', [filename]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  sub: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return api.request(path, init);
}

beforeAll(async () => {
  const url = requireDatabaseUrl();
  if (!isLocalDatabaseUrl(url)) {
    throw new Error('This test only runs against a local database.');
  }
  if ((process.env.APP_ENV ?? 'development') !== 'development') {
    throw new Error('This test only runs with APP_ENV=development.');
  }

  owner = await connect(url);
  await resetDatabase(owner);
  await owner.query(
    'create table if not exists schema_migration (filename text primary key, ' +
      'applied_at timestamptz not null default now())',
  );
  await owner.query('alter table schema_migration enable row level security');

  const files = listMigrationFiles(await readdir(MIGRATIONS_DIR));
  const before400 = files.filter((f) => f.number < 400);
  const from400 = files.filter((f) => f.number >= 400);
  if (!from400.some((f) => f.number === 400)) {
    throw new Error('db/migrations/400_billing_catalogue.sql is missing.');
  }

  for (const file of before400) {
    await applyMigrationFile(owner, file.filename);
  }

  // The tenant exists BEFORE migration 400 runs.
  await owner.query(
    "insert into tenant (id, legal_name) values ($1, 'Synthetic Backfill Practice')",
    [TENANT_ID],
  );

  // 400 first, which is what this test is about; then the rest of the
  // billing range, so the policies applied below have every table they name.
  for (const file of from400) {
    await applyMigrationFile(owner, file.filename);
  }
  await applyPolicies(owner);

  await owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, ' +
      "'Synthetic Backfill Owner')",
    [OWNER_ID, TENANT_ID, OWNER_AUTH],
  );
  await owner.query("insert into user_role (tenant_id, user_id, role) values ($1, $2, 'owner')", [
    TENANT_ID,
    OWNER_ID,
  ]);
  await owner.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, 'nf-session', 'Neurofeedback session', 45, array['home']::delivery_mode[])",
    [SERVICE_TYPE_ID, TENANT_ID],
  );

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  await syncLocalApiRolePassword(owner, apiUrl);
  pool = createPool(apiUrl);
  // createApi's own `now` option reaches mountBilling from inside createApi
  // itself now that round 5 (docs/CHANGE-REQUESTS/billing-01.md) mounts it
  // there: a second, manual mountBilling call on the same Hono instance
  // would only add a second, shadowed handler for the same path (Hono
  // answers from whichever handler was registered first).
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now: NOW,
  });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe("migration 400's vat_setting backfill", () => {
  it('gives a tenant that already existed exactly one vat_setting: the UAE standard rate from 2018', async () => {
    const { rows } = await owner.query<{
      version: number;
      rate_basis_points: number;
      effective_from: string;
      supersedes_id: string | null;
      amendment_reason: string;
    }>(
      'select version, rate_basis_points, effective_from::text, supersedes_id, amendment_reason ' +
        'from vat_setting where tenant_id = $1',
      [TENANT_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      rate_basis_points: 500,
      effective_from: '2018-01-01',
      supersedes_id: null,
      amendment_reason: 'standard rate at go-live',
    });
  });

  it('lets a price be set straight away, with no setting endpoint, carrying that rate', async () => {
    const res = await call('POST', '/api/billing/prices', OWNER_AUTH, {
      serviceTypeId: SERVICE_TYPE_ID,
      listPriceFils: 90_000,
      validFrom: '2026-09-02',
      amendmentReason: 'Setting the launch price.',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreatePriceResponse;
    // The rate the row is stamped with is the standard rate the backfill
    // wrote; the money beside it is what this practice would charge today,
    // and it holds no VAT registration (migration 406).
    expect(body.price.vatRateBasisPoints).toBe(500);
    expect(body.price.vatFils).toBe(0);
    expect(body.price.grossFils).toBe(90_000);
  });
});
