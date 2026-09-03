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
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * `GET /api/clients/:id` and the schedule-based door
 * (docs/SPEC/client-record.md sections 2 and 11: "a practitioner not on that
 * client's schedule cannot open the record; the attempt is audited").
 *
 * The route used to pass `scheduledClientIds: []` unconditionally, which was
 * honest while `app.client_visible_to_practitioner` was a stub answering
 * false for everyone. Migration 201 (the scheduling stream, pull request 34,
 * now on `main`) gives that function the real window, so the six read
 * policies open the record to a practitioner holding a visit — and a route
 * still passing an empty list would refuse someone the database had just
 * admitted, and write a `refused` row about them
 * (docs/CHANGE-REQUESTS/scheduling-03.md item 3).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const IDLE_PRACTITIONER_USER = '00000000-0000-4000-8000-0000000000a7';
const IDLE_PRACTITIONER = '00000000-0000-4000-8000-0000000000b7';
const IDLE_PRACTITIONER_AUTH = '00000000-0000-4000-8000-0000000000ad';
const SCHEDULED_CLIENT = '00000000-0000-4000-8000-0000000000c7';
const UNSCHEDULED_CLIENT = '00000000-0000-4000-8000-0000000000c8';
const LOCATION = '00000000-0000-4000-8000-0000000000d7';

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

async function read(clientId: string, requestId: string): Promise<Response> {
  return api.request(`/api/clients/${clientId}`, {
    headers: {
      authorization: `Bearer ${await mint(AUTH.practitionerA)}`,
      'x-request-id': requestId,
    },
  });
}

async function list(sub: string, requestId?: string): Promise<ClientListResponse> {
  const headers = new Headers({ authorization: `Bearer ${await mint(sub)}` });
  if (requestId) headers.set('x-request-id', requestId);
  return (await (await api.request('/api/clients', { headers })).json()) as ClientListResponse;
}

async function refusedRows(clientId: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    "select count(*)::int as n from audit_log where action = 'refused' and entity_id = $1",
    [clientId],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  // A second practitioner who is booked with nobody.
  await seedUser(owner, {
    id: IDLE_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: IDLE_PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner Two',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, IDLE_PRACTITIONER, IDLE_PRACTITIONER_USER);
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'neurofeedback');
  await seedClient(owner, IDS.tenantA, SCHEDULED_CLIENT, IDS.ownerA, 'Meadow');
  await seedClient(owner, IDS.tenantA, UNSCHEDULED_CLIENT, IDS.ownerA, 'Orchard');
  await seedLocation(owner, IDS.tenantA, LOCATION, SCHEDULED_CLIENT, IDS.ownerA);

  // A visit today, confirmed: the plainest case migration 201's window admits.
  await owner.query(
    'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
      'delivery_mode, window_start, window_end, busy_end, status) values ($1, $2, $3, $4, $5, ' +
      "'home', date_trunc('hour', now()), date_trunc('hour', now()) + interval '45 minutes', " +
      "date_trunc('hour', now()) + interval '60 minutes', 'confirmed')",
    [IDS.tenantA, SCHEDULED_CLIENT, MORE_IDS.practitionerA, MORE_IDS.serviceTypeA, LOCATION],
  );

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('a practitioner and the client record', () => {
  it('opens the record of a client they hold a visit with, and is not audited as refused', async () => {
    const res = await read(SCHEDULED_CLIENT, '00000000-0000-4000-8000-0000000000f7');
    expect(res.status).toBe(200);
    expect(await refusedRows(SCHEDULED_CLIENT)).toBe(0);
  });

  it('lists exactly the clients they are booked with, and nothing else', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000f9';
    const res = await list(AUTH.practitionerA, requestId);
    // The practice holds two clients; this practitioner holds a visit with one.
    expect(res.clients.map((c) => c.id)).toEqual([SCHEDULED_CLIENT]);
    expect(res.note).toBe('schedule');

    // Audited per client seen, the same as any other list read (audit.md section 5).
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'list' and entity_type = 'client' " +
        'and request_id = $1 and entity_id = $2',
      [requestId, SCHEDULED_CLIENT],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('answers a practitioner booked with nobody an empty list, and says which kind of empty', async () => {
    const res = await list(IDLE_PRACTITIONER_AUTH);
    expect(res.clients).toHaveLength(0);
    // Not "nobody matches" but "you are booked with nobody": the screen says so.
    expect(res.note).toBe('schedule');
  });

  it('is refused a client they hold no visit with, and the attempt is audited', async () => {
    const res = await read(UNSCHEDULED_CLIENT, '00000000-0000-4000-8000-0000000000f8');
    expect(res.status).toBe(403);
    // Section 11: the attempt is audited, not merely turned away.
    expect(await refusedRows(UNSCHEDULED_CLIENT)).toBe(1);
  });
});
