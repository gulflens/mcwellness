import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { AppointmentListResponse } from '../../app/api/appointments/schema';
import type { PricesResponse } from '../../app/api/billing/schema';
import type { ClientRecordResponse } from '../../app/api/clients/record-schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed, SEED_TODAY } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase } from './helpers';

/**
 * Proves that `createApi` (app/api/create-api.ts) actually mounts the four
 * routes the streams' own change requests asked for
 * (docs/CHANGE-REQUESTS/billing-01.md, scheduling-01.md, session-capture-01.md,
 * client-record-01.md CR-03):
 * unlike each stream's own tests/<stream>/db suite, which mounts its routes
 * by hand on the instance createApi returns, this file calls createApi()
 * exactly as the server does and hits the routes it builds unassisted. If a
 * future edit ever drops one of the four mount calls, the route falls back
 * to the catch-all 404 and one of the tests below fails loudly rather than
 * the gap passing silently.
 */
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
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

function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  // No manual mounting here on purpose: this is the whole point of the file.
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/billing/prices', () => {
  it('answers the seeded owner with the practice prices (an empty list, before any exist)', async () => {
    const res = await call('GET', '/api/billing/prices', authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PricesResponse;
    expect(Array.isArray(body.prices)).toBe(true);
    // The seed writes no price rows (db/seed/generate.ts), so a fresh
    // practice's list is empty rather than absent — mountBilling answering
    // 200 with a real shape either way is what this proves.
    expect(body.prices).toEqual([]);
  });
});

describe('GET /api/appointments', () => {
  it("answers the seeded owner with the practice's day, as a list", async () => {
    const res = await call('GET', `/api/appointments?date=${SEED_TODAY}`, authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentListResponse;
    expect(Array.isArray(body.appointments)).toBe(true);
  });
});

describe('POST /api/sessions/:id/events', () => {
  it('refuses an invalid body with 400, not the unmounted-route 404', async () => {
    const sessionId = '00000000-0000-4000-8000-0000000000f9';
    // Missing every required field: this is about the route existing and
    // reaching its own validation, not about a well-formed check-in.
    const res = await call('POST', `/api/sessions/${sessionId}/events`, authIdOf(0), {});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/clients/:id', () => {
  it("answers the seeded owner with the client's record, not the unmounted-route 404", async () => {
    const client = data.clients[0];
    if (!client) throw new Error('No seeded client.');
    const res = await call('GET', `/api/clients/${client.id}`, authIdOf(0));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientRecordResponse;
    expect(body.id).toBe(client.id);
    expect(Array.isArray(body.contacts)).toBe(true);
  });
});
