import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type { ClientListResponse } from '../../../app/api/clients/schema';
import { IDS, AUTH, freshDatabase, seedClient, seedTenant } from '../../db/helpers';

/**
 * GET /api/clients, page-size hardening (two review rounds asked for this):
 * at most 50 rows come back with `truncated: true` when more matched, and a
 * `q` shorter than two characters is dropped rather than searched, so a
 * single keystroke can never sweep the whole practice or write an audit row
 * per matching client. app/api/clients/list.ts, app/api/clients/schema.ts.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const CLIENT_COUNT = 60;

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

async function list(query = ''): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(AUTH.ownerA)}` };
  return api.request(`/api/clients${query}`, { headers });
}

/** A UUID shaped like the rest of this file's fixtures, distinct from every reserved id in IDS/AUTH. */
function clientId(i: number): string {
  return `00000000-0000-4000-8000-${String(600_000_000_000 + i).padStart(12, '0')}`;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  for (let i = 0; i < CLIENT_COUNT; i++) {
    // Every family name carries "Zed" so a one-character q ("Z") would, if
    // searched, match all 60 — the case the two-character minimum guards
    // against. Only the seventh client (index 6) is uniquely "Yew".
    const familyName = i === 6 ? 'Yew' : `Zed${i}`;
    await seedClient(owner, IDS.tenantA, clientId(i), IDS.ownerA, familyName);
  }

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/clients — page size', () => {
  it('caps a practice of 60 at 50 rows and flags truncated', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientListResponse;
    expect(body.clients).toHaveLength(50);
    expect(body.truncated).toBe(true);
    // Ordered as today: by record number.
    const mrns = body.clients.map((c) => c.mrn);
    expect(mrns).toEqual([...mrns].sort());
  });
});

describe('GET /api/clients — short search terms', () => {
  it('treats a one-character q as no search: the unfiltered, still-truncated first page', async () => {
    const unfiltered = (await (await list()).json()) as ClientListResponse;
    const oneChar = (await (await list('?q=Z')).json()) as ClientListResponse;
    expect(oneChar.clients).toHaveLength(50);
    expect(oneChar.truncated).toBe(true);
    expect(oneChar.clients.map((c) => c.mrn)).toEqual(unfiltered.clients.map((c) => c.mrn));
  });

  it('searches once the term reaches two characters', async () => {
    const res = await list('?q=Ye');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientListResponse;
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0]?.familyName).toBe('Yew');
    expect(body).not.toHaveProperty('truncated');
  });

  it('treats whitespace-only q the same as absent', async () => {
    const res = await list(`?q=${encodeURIComponent('  ')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientListResponse;
    expect(body.clients).toHaveLength(50);
    expect(body.truncated).toBe(true);
  });
});
