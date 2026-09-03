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
 * names specifically: MRN allocation gapless under two concurrent inserts and
 * still correct once the highest-MRN client is erased, and which refused
 * attempts are audited and which are not (third review round, issues 12
 * and 13).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const PRACTITIONER_ID = '00000000-0000-4000-8000-0000000000e5';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-0000000000e6';
const HOUSEHOLD_ID = '00000000-0000-4000-8000-0000000000e7';
const HOUSEHOLD_AUTH = '00000000-0000-4000-8000-0000000000e8';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000f1';
const ADMIN_AUTH = '00000000-0000-4000-8000-0000000000f2';

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
  await seedUser(owner, {
    id: ADMIN_ID,
    tenantId: IDS.tenantA,
    authId: ADMIN_AUTH,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
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

  it('still allocates the next number after the highest-MRN client is erased', async () => {
    const highest = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Juniper',
          familyName: 'Highest',
          contact: { relationship: 'self', phone: '+971500001196' },
        }),
      })
    ).json()) as CreateClientResponse;
    const expectedNext = highest.mrn.replace(/(\d+)$/, (digits) =>
      String(Number(digits) + 1).padStart(digits.length, '0'),
    );

    const erased = await request(AUTH.ownerA, `/api/clients/${highest.id}/erasure-requests`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Household asked to be forgotten' }),
    });
    expect(erased.status).toBe(201);

    // As admin, not owner: db/policies/client/readers.sql hides an erased row from
    // admin, so this is the case app.next_mrn (db/migrations/100_client_record.sql)
    // exists for — an owner-only request would never have exercised the bug.
    const next = (await (
      await request(ADMIN_AUTH, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Sequoia',
          familyName: 'NextInLine',
          contact: { relationship: 'self', phone: '+971500001197' },
        }),
      })
    ).json()) as CreateClientResponse;
    expect(next.mrn).toBe(expectedNext);
  });
});

describe('a refused attempt is audited', () => {
  it('writes nothing for a 404 on an id that was never a client — nothing to name', async () => {
    const missingId = '00000000-0000-4000-8000-0000000000fc';
    const requestId = '00000000-0000-4000-8000-0000000000fd';
    const res = await request(AUTH.ownerA, `/api/clients/${missingId}`, {
      headers: { 'x-request-id': requestId },
    });
    expect(res.status).toBe(404);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and request_id = $1",
      [requestId],
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('writes a refused row for a role refusal on a collection — POST /api/clients names no row', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000ec';
    const res = await request(PRACTITIONER_AUTH, '/api/clients', {
      method: 'POST',
      headers: { 'x-request-id': requestId },
      body: JSON.stringify({
        givenName: 'Basil',
        familyName: 'Cliff',
        contact: { relationship: 'self', phone: '+971500001189' },
      }),
    });
    expect(res.status).toBe(403);
    // The row is found by its request id, not by its entity: a collection action names
    // no row, so the entity is a fresh id rather than the caller's own `x-request-id`,
    // which a signed-in actor could otherwise point at any uuid they chose (security
    // review of pull request 35). The correlation the test needs is the request id,
    // and that still holds.
    const { rows } = await owner.query<{ n: string; entity_id: string }>(
      'select count(*)::text as n, min(entity_id::text) as entity_id from audit_log ' +
        "where action = 'refused' and entity_type = 'client' and client_id is null " +
        'and request_id = $1',
      [requestId],
    );
    expect(rows[0]?.n).toBe('1');
    expect(rows[0]?.entity_id).not.toBe(requestId);
  });

  it('writes a refused row for a 403 that names a row which exists — a practitioner reading any client', async () => {
    const created = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Clove',
          familyName: 'NamedRow',
          contact: { relationship: 'self', phone: '+971500001198' },
        }),
      })
    ).json()) as CreateClientResponse;
    const requestId = '00000000-0000-4000-8000-0000000000fe';

    // The scheduling door is shut (app.client_visible_to_practitioner always answers
    // false, db/migrations/100_client_record.sql), so a practitioner is refused every
    // client, this real one included — a 403, not a 404, and logged as one.
    const res = await request(PRACTITIONER_AUTH, `/api/clients/${created.id}`, {
      headers: { 'x-request-id': requestId },
    });
    expect(res.status).toBe(403);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and entity_type = 'client' " +
        'and entity_id = $1 and client_id = $1 and request_id = $2',
      [created.id, requestId],
    );
    expect(rows[0]?.n).toBe('1');
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

  it('opens an erased record only with a reason, even for the owner', async () => {
    const created = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Rowan',
          familyName: 'Erased',
          contact: { relationship: 'self', phone: '+971500001193' },
        }),
      })
    ).json()) as CreateClientResponse;
    await owner.query("update client set status = 'erased' where id = $1", [created.id]);

    const withoutReason = await request(AUTH.ownerA, `/api/clients/${created.id}`);
    expect(withoutReason.status).toBe(400);
    expect(((await withoutReason.json()) as { error: string }).error).toBe('reason_required');

    const withReason = await request(AUTH.ownerA, `/api/clients/${created.id}`, {
      headers: { 'x-reason': 'Confirming the erasure for a compliance check' },
    });
    expect(withReason.status).toBe(200);
  });
});

describe('erased is read-only, even for the owner', () => {
  it('refuses to edit demographics or add a contact once a client is erased', async () => {
    const created = (await (
      await request(AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Sable',
          familyName: 'Locked',
          contact: { relationship: 'self', phone: '+971500001194' },
        }),
      })
    ).json()) as CreateClientResponse;
    await owner.query("update client set status = 'erased' where id = $1", [created.id]);

    const patch = await request(AUTH.ownerA, `/api/clients/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ referralSource: 'instagram' }),
    });
    expect(patch.status).toBe(400);
    expect(((await patch.json()) as { error: string }).error).toBe('erased');

    const addContact = await request(AUTH.ownerA, `/api/clients/${created.id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ relationship: 'mother', phone: '+971500001195' }),
    });
    expect(addContact.status).toBe(400);
    expect(((await addContact.json()) as { error: string }).error).toBe('erased');
  });
});
