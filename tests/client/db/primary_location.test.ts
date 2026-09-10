import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import { AUTH, IDS, freshDatabase, seedClient, seedTenant } from '../../db/helpers';

/**
 * `client.primary_location_id` is set whenever a location is created with
 * `isPrimary: true` or patched to it (app/api/clients/locations.ts,
 * makePrimary): the walk of 10 September found the client list's Emirate
 * column empty for every client enrolled through the app because nothing but
 * the seed ever wrote the link.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

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

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(AUTH.ownerA)}`);
  if (init.body) headers.set('content-type', 'application/json');
  return api.request(path, { ...init, headers });
}

const home = {
  label: 'home',
  emirate: 'DXB',
  entranceLat: 25.2048,
  entranceLng: 55.2708,
  isPrimary: true,
};

async function primaryOf(clientId: string): Promise<string | null> {
  const { rows } = await owner.query<{ primary_location_id: string | null }>(
    'select primary_location_id from client where id = $1',
    [clientId],
  );
  return rows[0]?.primary_location_id ?? null;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
  mountClientRecord(api);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('client.primary_location_id', () => {
  it('is set when a primary location is added', async () => {
    const res = await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify(home),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await primaryOf(IDS.clientA)).toBe(id);
  });

  it('moves to a second location marked primary, and demotes the first', async () => {
    const first = await primaryOf(IDS.clientA);
    const res = await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify({ ...home, label: 'work', isPrimary: true }),
    });
    const { id } = (await res.json()) as { id: string };
    expect(await primaryOf(IDS.clientA)).toBe(id);
    const { rows } = await owner.query<{ is_primary: boolean }>(
      'select is_primary from location where id = $1',
      [first],
    );
    expect(rows[0]?.is_primary).toBe(false);
  });

  it('follows a patch that marks an existing location primary', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "select id from location where owner_id = $1 and label = 'home'",
      [IDS.clientA],
    );
    const homeId = rows[0]?.id as string;
    const res = await request(`/api/clients/${IDS.clientA}/locations/${homeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    });
    expect(res.status).toBe(200);
    expect(await primaryOf(IDS.clientA)).toBe(homeId);
  });

  it('leaves the link alone when a location is added that is not primary', async () => {
    const before = await primaryOf(IDS.clientA);
    await request(`/api/clients/${IDS.clientA}/locations`, {
      method: 'POST',
      body: JSON.stringify({ ...home, label: 'other', isPrimary: false }),
    });
    expect(await primaryOf(IDS.clientA)).toBe(before);
  });
});
