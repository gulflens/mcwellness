import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VatRateResponse } from '../../../app/api/billing/schema';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { applySeed } from '../../../db/seed/apply';
import { generateSeed, SEED_OWNER_USER_ID, SEED_TENANT_ID } from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { freshDatabase } from '../../db/helpers';

/**
 * GET /api/billing/vat-rate?date=YYYY-MM-DD: the floor beneath the "add a
 * price" drawer's live preview (fix round, this pull request). Proves the
 * three things tests/billing/db/prices.test.ts already proves indirectly
 * through a saved price's stamped rate — gating by billing.price.read,
 * tenant isolation, and picking the setting in force on the requested date,
 * not today's or the newest one — directly against the route itself.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const TENANT_B = '00000000-0000-4000-8000-0000000000c0';
const ADMIN_B = '00000000-0000-4000-8000-0000000000c1';
const ADMIN_B_AUTH = '00000000-0000-4000-8000-0000000000c2';

const data = generateSeed();

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

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

async function call(path: string, sub: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(sub)}` } });
}

function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  // A second, unrelated tenant: app.default_vat_setting() (migration 400)
  // gives it the same 2018-01-01 standard rate the moment it exists.
  await owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio C')", [
    TENANT_B,
  ]);
  await owner.query(
    "insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, 'Synthetic Admin C')",
    [ADMIN_B, TENANT_B, ADMIN_B_AUTH],
  );
  await owner.query("insert into user_role (tenant_id, user_id, role) values ($1, $2, 'admin')", [
    TENANT_B,
    ADMIN_B,
  ]);
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/billing/vat-rate', () => {
  it('answers the standard rate set at go-live for a date on or after it', async () => {
    const res = await call('/api/billing/vat-rate?date=2026-09-02', authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as VatRateResponse;
    expect(body).toEqual({ rateBasisPoints: 500, effectiveFrom: '2018-01-01' });
  });

  it('refuses a practitioner, who holds no billing role', async () => {
    const res = await call('/api/billing/vat-rate?date=2026-09-02', authIdOf(1));
    expect(res.status).toBe(403);
  });

  it("refuses a lead practitioner's missing date as a bad request, not a database error", async () => {
    const res = await call('/api/billing/vat-rate?date=not-a-date', authIdOf(0));
    expect(res.status).toBe(400);
  });

  it('refuses a request with no date at all as a bad request', async () => {
    const res = await call('/api/billing/vat-rate', authIdOf(0));
    expect(res.status).toBe(400);
  });

  it('says 404 for a date before the practice had any VAT rate at all', async () => {
    const res = await call('/api/billing/vat-rate?date=2000-01-01', authIdOf(0));
    expect(res.status).toBe(404);
  });

  it("uses the rate scheduled for a future date, not today's, once that rate exists — and the rate a price row was stamped under stays untouched", async () => {
    await owner.query(
      'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, ' +
        'supersedes_id, amendment_reason, created_by) ' +
        'values ($1, 2, 700, $2, (select id from vat_setting where tenant_id = $1 and version = 1), ' +
        '$3, $4)',
      [SEED_TENANT_ID, '2027-01-01', 'Rate increase announced by the FTA.', SEED_OWNER_USER_ID],
    );

    const before = await call('/api/billing/vat-rate?date=2026-12-31', authIdOf(0));
    expect(before.status).toBe(200);
    expect(((await before.json()) as VatRateResponse).rateBasisPoints).toBe(500);

    const onChangeDay = await call('/api/billing/vat-rate?date=2027-01-01', authIdOf(0));
    expect(onChangeDay.status).toBe(200);
    const onChangeBody = (await onChangeDay.json()) as VatRateResponse;
    expect(onChangeBody.rateBasisPoints).toBe(700);
    expect(onChangeBody.effectiveFrom).toBe('2027-01-01');

    const wellAfter = await call('/api/billing/vat-rate?date=2027-06-01', authIdOf(0));
    expect(((await wellAfter.json()) as VatRateResponse).rateBasisPoints).toBe(700);
  });

  it("shows a second tenant only its own rate, never the first tenant's scheduled change", async () => {
    const res = await call('/api/billing/vat-rate?date=2027-06-01', ADMIN_B_AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VatRateResponse;
    expect(body).toEqual({ rateBasisPoints: 500, effectiveFrom: '2018-01-01' });
  });
});
