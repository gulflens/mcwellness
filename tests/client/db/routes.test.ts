import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountClientRecord } from '../../../app/api/clients/mount';
import type {
  ClientRecordResponse,
  CreateClientResponse,
} from '../../../app/api/clients/record-schema';
import { IDS, AUTH, freshDatabase, seedTenant, seedUser } from '../../db/helpers';

/**
 * The client-record routes, mounted the way they will be once
 * docs/CHANGE-REQUESTS/client-record-01.md's app/api/create-api.ts change
 * lands: this test mounts them itself on the api createApi returns
 * (docs/SPEC/OWNERSHIP.md; "Client Record Plan" PR 2). Covers what the plan
 * names specifically: MRN allocation gapless under two concurrent inserts,
 * and the refused audit row for a 404 on a role-plausible attempt.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const PRACTITIONER_ID = '00000000-0000-4000-8000-0000000000e5';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-0000000000e6';
const HOUSEHOLD_ID = '00000000-0000-4000-8000-0000000000e7';
const HOUSEHOLD_AUTH = '00000000-0000-4000-8000-0000000000e8';

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

async function request(sub: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(sub)}`);
  if (init.body) headers.set('content-type', 'application/json');
  return api.request(path, { ...init, headers });
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: PRACTITIONER_ID,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedUser(owner, {
    id: HOUSEHOLD_ID,
    tenantId: IDS.tenantA,
    authId: HOUSEHOLD_AUTH,
    displayName: 'Synthetic Household',
    roles: ['client_contact'],
  });

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

describe('POST /api/clients — MRN allocation', () => {
  it('never allocates the same or a skipped MRN under two concurrent creates', async () => {
    const body = (relationship: string) => ({
      givenName: 'Cedar',
      familyName: 'Concurrent',
      contact: { relationship, phone: '+971500001188' },
    });
    const [first, second] = await Promise.all([
      request(AUTH.ownerA, '/api/clients', { method: 'POST', body: JSON.stringify(body('self')) }),
      request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify(body('mother')),
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const [a, b] = (await Promise.all([first.json(), second.json()])) as [
      CreateClientResponse,
      CreateClientResponse,
    ];
    expect(a.mrn).not.toBe(b.mrn);

    const { rows } = await owner.query<{ n: string }>(
      'select count(distinct mrn)::text as n from client where tenant_id = $1',
      [IDS.tenantA],
    );
    const { rows: total } = await owner.query<{ n: string }>(
      'select count(*)::text as n from client where tenant_id = $1',
      [IDS.tenantA],
    );
    expect(rows[0]?.n).toBe(total[0]?.n);

    const numbers = (
      await owner.query<{ mrn: string }>(
        'select mrn from client where tenant_id = $1 order by mrn',
        [IDS.tenantA],
      )
    ).rows.map((r) => Number(r.mrn.replace('MW-', '')));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe((numbers[i - 1] ?? 0) + 1);
    }
  });
});

describe('a refused attempt is audited', () => {
  it('writes a refused row and a 404 when a role-plausible actor targets a client that is not there', async () => {
    const missingId = '00000000-0000-4000-8000-0000000000e9';
    const requestId = '00000000-0000-4000-8000-0000000000ea';
    const res = await request(AUTH.ownerA, `/api/clients/${missingId}`, {
      headers: { 'x-request-id': requestId },
    });
    expect(res.status).toBe(404);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and entity_type = 'client' " +
        'and entity_id = $1 and request_id = $2',
      [missingId, requestId],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('never writes a refused row for a plain role mismatch — the practitioner has no schedule to check', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000ec';
    const res = await request(PRACTITIONER_AUTH, '/api/clients', {
      method: 'POST',
      headers: { 'x-request-id': requestId },
      body: JSON.stringify({
        givenName: 'Basil',
        familyName: 'Refused',
        contact: { relationship: 'self', phone: '+971500001189' },
      }),
    });
    expect(res.status).toBe(403);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and request_id = $1",
      [requestId],
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('GET /api/clients/:id — whole record', () => {
  it('never carries the identity number, only whether one is on file', async () => {
    const created = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Fern',
          familyName: 'Whole',
          contact: { relationship: 'self', phone: '+971500001190' },
        }),
      })
    ).json()) as CreateClientResponse;
    const res = await request(AUTH.ownerA, `/api/clients/${created.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientRecordResponse;
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).not.toHaveProperty('emiratesId');
    expect(body.contacts[0]?.hasEmiratesId).toBe(false);
  });

  it("lets a client contact read their own client and no one else's", async () => {
    const mine = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Iris',
          familyName: 'Household',
          contact: { relationship: 'self', phone: '+971500001191' },
        }),
      })
    ).json()) as CreateClientResponse;
    const someoneElses = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Hazel',
          familyName: 'NotMine',
          contact: { relationship: 'self', phone: '+971500001192' },
        }),
      })
    ).json()) as CreateClientResponse;
    const mineDetail = (await (
      await request(AUTH.ownerA, `/api/clients/${mine.id}`)
    ).json()) as ClientRecordResponse;
    const myContactId = mineDetail.contacts[0]?.id;
    await owner.query('update contact set user_id = $1 where id = $2', [HOUSEHOLD_ID, myContactId]);

    const own = await request(HOUSEHOLD_AUTH, `/api/clients/${mine.id}`);
    expect(own.status).toBe(200);
    const other = await request(HOUSEHOLD_AUTH, `/api/clients/${someoneElses.id}`);
    expect(other.status).toBe(403);
  });
});
