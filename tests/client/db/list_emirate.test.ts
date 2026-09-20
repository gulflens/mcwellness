import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type { ClientListResponse } from '../../../app/api/clients/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * GET /api/clients?emirate=…, the owner's request of 2026-09-20: the list
 * filters by emirate the way it filters by status. The emirate is the one the
 * Emirate column shows — the client's *primary* location — so the filter and
 * the column can never disagree about a row. app/api/clients/list.ts.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

/** UUIDs shaped like the rest of the fixtures, distinct from every reserved id in IDS/AUTH. */
const IN_DUBAI = '00000000-0000-4000-8000-000000680001';
const IN_ABU_DHABI = '00000000-0000-4000-8000-000000680002';
const ACTIVE_IN_ABU_DHABI = '00000000-0000-4000-8000-000000680003';
const NOWHERE_YET = '00000000-0000-4000-8000-000000680004';
const LOCATION = (n: number) => `00000000-0000-4000-8000-00000068010${n}`;
const FINANCE_USER = '00000000-0000-4000-8000-000000680201';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000680202';

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

async function list(query = '', as: string = AUTH.ownerA): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(as)}` };
  return api.request(`/api/clients${query}`, { headers });
}

async function ids(query: string, as: string = AUTH.ownerA): Promise<string[]> {
  const res = await list(query, as);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ClientListResponse;
  return body.clients.map((c) => c.id).sort();
}

/**
 * A home for a client, in the emirate named; `primary` makes it the one the
 * list shows. Both halves of "primary" are written, the flag on the address and
 * the pointer on the client, because the app never writes one without the other
 * (app/api/clients/locations.ts) and a fixture should not be in a state it cannot reach.
 */
async function home(
  locationId: string,
  clientId: string,
  emirate: string,
  primary: boolean,
): Promise<void> {
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, ' +
      "is_primary, created_by) values ($1, $2, 'client', $3, 'home', $4::emirate, " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), $5, $6)",
    [locationId, IDS.tenantA, clientId, emirate, primary, IDS.ownerA],
  );
  if (primary) {
    await owner.query('update client set primary_location_id = $1 where id = $2', [
      locationId,
      clientId,
    ]);
  }
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);

  await seedClient(owner, IDS.tenantA, IN_DUBAI, IDS.ownerA, 'Harbour');
  await seedClient(owner, IDS.tenantA, IN_ABU_DHABI, IDS.ownerA, 'Meadow');
  await seedClient(owner, IDS.tenantA, ACTIVE_IN_ABU_DHABI, IDS.ownerA, 'Quarry');
  await seedClient(owner, IDS.tenantA, NOWHERE_YET, IDS.ownerA, 'Ridge');
  await owner.query("update client set status = 'active' where id = $1", [ACTIVE_IN_ABU_DHABI]);

  await home(LOCATION(1), IN_DUBAI, 'DXB', true);
  // A second address in Sharjah that is NOT the primary one: the column shows
  // Dubai for this client, so a Sharjah filter must not return them.
  await home(LOCATION(2), IN_DUBAI, 'SHJ', false);
  await home(LOCATION(3), IN_ABU_DHABI, 'AUH', true);
  await home(LOCATION(4), ACTIVE_IN_ABU_DHABI, 'AUH', true);

  // A practitioner booked today with one of the two Abu Dhabi clients and with
  // nobody else, and a finance account, which lists clients and reads no address.
  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'neurofeedback');
  await owner.query(
    'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
      'delivery_mode, window_start, window_end, busy_end, status) values ($1, $2, $3, $4, $5, ' +
      "'home', date_trunc('hour', now()), date_trunc('hour', now()) + interval '45 minutes', " +
      "date_trunc('hour', now()) + interval '60 minutes', 'confirmed')",
    [IDS.tenantA, ACTIVE_IN_ABU_DHABI, MORE_IDS.practitionerA, MORE_IDS.serviceTypeA, LOCATION(4)],
  );
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/clients — by emirate', () => {
  it('lists everybody, the client with no address included, when no emirate is asked for', async () => {
    expect(await ids('')).toEqual(
      [IN_DUBAI, IN_ABU_DHABI, ACTIVE_IN_ABU_DHABI, NOWHERE_YET].sort(),
    );
  });

  it('lists only the clients whose primary address is in the emirate asked for', async () => {
    expect(await ids('?emirate=AUH')).toEqual([IN_ABU_DHABI, ACTIVE_IN_ABU_DHABI].sort());
    expect(await ids('?emirate=DXB')).toEqual([IN_DUBAI]);
  });

  it('goes by the primary address the column shows, never by another address on file', async () => {
    expect(await ids('?emirate=SHJ')).toEqual([]);
  });

  it('leaves a client with no address out of every emirate', async () => {
    for (const emirate of ['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ']) {
      expect(await ids(`?emirate=${emirate}`)).not.toContain(NOWHERE_YET);
    }
  });

  it('narrows together with the status filter and with a search, not instead of them', async () => {
    expect(await ids('?emirate=AUH&status=active')).toEqual([ACTIVE_IN_ABU_DHABI]);
    expect(await ids('?emirate=AUH&status=lead')).toEqual([IN_ABU_DHABI]);
    expect(await ids('?emirate=AUH&q=Quarry')).toEqual([ACTIVE_IN_ABU_DHABI]);
    expect(await ids('?emirate=DXB&q=Quarry')).toEqual([]);
  });

  it('refuses an emirate that is not one of the seven, rather than listing everybody', async () => {
    const res = await list('?emirate=Dubai');
    expect(res.status).toBe(400);
  });

  it("narrows a practitioner's own list and no wider: the client they are booked with, of the two in the emirate", async () => {
    const res = await list('?emirate=AUH', AUTH.practitionerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientListResponse;
    expect(body.clients.map((c) => c.id)).toEqual([ACTIVE_IN_ABU_DHABI]);
    expect(body.note).toBe('schedule');
    expect(await ids('?emirate=DXB', AUTH.practitionerA)).toEqual([]);
  });

  it('gives finance, who reads no address, an empty list for every emirate, and its whole list without one', async () => {
    // Why the screen offers finance no such filter (app/admin/clients/ClientsPage.tsx):
    // the route is honest, and for this role honesty is always "nobody".
    expect(await ids('', FINANCE_AUTH)).toHaveLength(4);
    for (const emirate of ['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ']) {
      expect(await ids(`?emirate=${emirate}`, FINANCE_AUTH)).toEqual([]);
    }
  });

  it('says which emirate each listed client is in, so the column agrees with the filter', async () => {
    const res = await list('?emirate=AUH');
    const body = (await res.json()) as ClientListResponse;
    expect(body.clients.map((c) => c.emirate)).toEqual(['AUH', 'AUH']);
  });
});
