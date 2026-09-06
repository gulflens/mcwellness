import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type {
  AccessReportResponse,
  ActivityFilters,
  ActivityResponse,
} from '../../app/api/audit/schema';
import { AUTH, IDS, freshDatabase, seedClient, seedTenant, seedUser } from './helpers';

/**
 * The activity feed and the access report (docs/SPEC/audit.md section 9, views
 * 2 and 4), through the API the server actually builds.
 *
 * What matters here is who reaches the trail, what a line is allowed to carry,
 * and that an erased household does not walk out of the record's own screens
 * and into a global feed.
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const id = (slot: number): string => `0000000d-0000-4000-8000-${String(slot).padStart(12, '0')}`;
const ADMIN_USER = id(1);
const ADMIN_AUTH = id(2);
const PRACTITIONER_USER = id(3);
const PRACTITIONER_AUTH = id(4);
const STANDING = id(11);
const ERASED = id(12);

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
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

async function get(path: string, sub: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(sub)}` } });
}

async function feed(path: string, sub: string): Promise<ActivityResponse> {
  const res = await get(path, sub);
  expect(res.status).toBe(200);
  return (await res.json()) as ActivityResponse;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $2 where id = $1', [IDS.ownerA, AUTH.ownerA]);
  await seedUser(owner, {
    id: ADMIN_USER,
    tenantId: IDS.tenantA,
    authId: ADMIN_AUTH,
    displayName: 'Synthetic Coordinator',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  // The audit triggers stamp whoever the session says is acting.
  await owner.query(
    "select set_config('app.actor_id', $1, false), set_config('app.tenant_id', $2, false), " +
      "set_config('app.actor_roles', 'owner', false)",
    [IDS.ownerA, IDS.tenantA],
  );
  await seedClient(owner, IDS.tenantA, STANDING, IDS.ownerA, 'Harbour');
  await seedClient(owner, IDS.tenantA, ERASED, IDS.ownerA, 'Meadow');
  await owner.query("update client set status = 'erased' where id = $1", [ERASED]);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/audit/activity', () => {
  it('answers the practice’s trail as sentences, newest first', async () => {
    const body = await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(event.sentence.length).toBeGreaterThan(0);
      // Never a raw diff: the catalogue writes the line, so no JSON reaches a
      // browser (docs/SPEC/audit.md section 9, the rendering rule).
      expect(event.sentence).not.toContain('{');
    }
    const ids = body.events.map((event) => BigInt(event.id));
    expect([...ids].sort((a, b) => (a < b ? 1 : -1))).toEqual(ids);
  });

  it('names the record by its number and never by a name', async () => {
    const body = await feed(`/api/audit/activity?clientId=${STANDING}&limit=50`, AUTH.ownerA);
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(event.clientId).toBe(STANDING);
      expect(event.clientMrn).toMatch(/^MW-/);
      expect(event.sentence).not.toContain('Harbour');
    }
  });

  it('narrows by who acted, by kind of row and by day', async () => {
    const byActor = await feed(`/api/audit/activity?actorId=${IDS.ownerA}&limit=100`, AUTH.ownerA);
    expect(byActor.events.length).toBeGreaterThan(0);
    for (const event of byActor.events) expect(event.actor?.id).toBe(IDS.ownerA);

    const byEntity = await feed('/api/audit/activity?entityType=client&limit=100', AUTH.ownerA);
    expect(byEntity.events.length).toBeGreaterThan(0);
    for (const event of byEntity.events) expect(event.entityType).toBe('client');

    // Nothing was written in 2020, and the window is inclusive of both ends.
    const old = await feed('/api/audit/activity?from=2020-01-01&to=2020-12-31', AUTH.ownerA);
    expect(old.events).toEqual([]);
  });

  it('keeps an erased household with the owner and the lead practitioner', async () => {
    const asOwner = await feed(`/api/audit/activity?clientId=${ERASED}&limit=50`, AUTH.ownerA);
    expect(asOwner.events.length).toBeGreaterThan(0);
    const asAdmin = await feed(`/api/audit/activity?clientId=${ERASED}&limit=50`, ADMIN_AUTH);
    expect(asAdmin.events).toEqual([]);
    // And the record that stands is there for both.
    const standing = await feed(`/api/audit/activity?clientId=${STANDING}&limit=50`, ADMIN_AUTH);
    expect(standing.events.length).toBeGreaterThan(0);
  });

  it('refuses a practitioner, whose oversight it is not', async () => {
    expect((await get('/api/audit/activity', PRACTITIONER_AUTH)).status).toBe(403);
    expect((await get('/api/audit/filters', PRACTITIONER_AUTH)).status).toBe(403);
  });

  it('records that somebody read the trail, once for the request', async () => {
    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'audit.activity'",
    );
    await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    const after = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'audit.activity'",
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);
  });
});

describe('GET /api/audit/filters', () => {
  it('offers the practice’s own people and the words the trail actually uses', async () => {
    const res = await get('/api/audit/filters', AUTH.ownerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityFilters;
    expect(body.actors.map((person) => person.id)).toContain(IDS.ownerA);
    expect(body.entityTypes).toContain('client');
    expect(body.actions).toContain('insert');
    // Sorted, and each word said once.
    expect([...body.actions].sort()).toEqual(body.actions);
    expect(new Set(body.actions).size).toBe(body.actions.length);
  });
});

describe('GET /api/audit/access-report', () => {
  it('says who has opened a record, how often and when', async () => {
    // Two reads by the owner, through the record's own timeline.
    await get(`/api/clients/${STANDING}/timeline`, AUTH.ownerA);
    await get(`/api/clients/${STANDING}/timeline`, AUTH.ownerA);

    const res = await get(`/api/audit/access-report?clientId=${STANDING}`, AUTH.ownerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccessReportResponse;
    expect(body.client.id).toBe(STANDING);
    const reader = body.readers.find((each) => each.actorId === IDS.ownerA);
    expect(reader).toBeTruthy();
    expect(reader?.reads).toBeGreaterThanOrEqual(2);
    expect(reader?.entityTypes).toContain('client');
    expect(new Date(reader?.lastAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(reader?.firstAt ?? 0).getTime(),
    );
  });

  it('asks an admin for a reason before it opens an erased record, and then refuses it', async () => {
    // An erased record is the owner's and the lead practitioner's; an admin
    // does not reach it at all, which is a 404 rather than a 403.
    expect((await get(`/api/audit/access-report?clientId=${ERASED}`, ADMIN_AUTH)).status).toBe(404);

    const withoutReason = await get(`/api/audit/access-report?clientId=${ERASED}`, AUTH.ownerA);
    expect(withoutReason.status).toBe(400);
    expect(await withoutReason.json()).toMatchObject({ error: 'reason_required' });

    const withReason = await api.request(`/api/audit/access-report?clientId=${ERASED}`, {
      headers: {
        authorization: `Bearer ${await mint(AUTH.ownerA)}`,
        'x-reason': 'The household asked who had seen the record.',
      },
    });
    expect(withReason.status).toBe(200);
  });

  it('is itself a read of the record', async () => {
    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    await get(`/api/audit/access-report?clientId=${STANDING}`, AUTH.ownerA);
    const after = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    expect(Number(after.rows[0]?.n)).toBeGreaterThan(Number(before.rows[0]?.n));
  });
});
