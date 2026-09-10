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

async function get(path: string, sub: string, reason?: string): Promise<Response> {
  return api.request(path, {
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      ...(reason === undefined ? {} : { 'x-reason': reason }),
    },
  });
}

async function feed(path: string, sub: string, reason?: string): Promise<ActivityResponse> {
  const res = await get(path, sub, reason);
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
    // An admin does not reach it at all, and a 404 is what says so: a 403
    // would confirm that a record with that id exists.
    const asAdmin = await get(`/api/audit/activity?clientId=${ERASED}&limit=50`, ADMIN_AUTH);
    expect(asAdmin.status).toBe(404);
    // And the record that stands is there for both.
    const standing = await feed(`/api/audit/activity?clientId=${STANDING}&limit=50`, ADMIN_AUTH);
    expect(standing.events.length).toBeGreaterThan(0);
  });

  it('asks the owner for a reason before it narrows to an erased record', async () => {
    // The same door the record timeline holds (docs/SPEC/client-record.md
    // section 8 step 3): the history of an erased record opens for the owner
    // and the lead practitioner, and only with a reason typed.
    const withoutReason = await get(`/api/audit/activity?clientId=${ERASED}&limit=50`, AUTH.ownerA);
    expect(withoutReason.status).toBe(400);
    expect(await withoutReason.json()).toMatchObject({ error: 'reason_required' });

    const withReason = await feed(
      `/api/audit/activity?clientId=${ERASED}&limit=50`,
      AUTH.ownerA,
      'The household asked what the record still held.',
    );
    expect(withReason.events.length).toBeGreaterThan(0);

    // The reason that read needed is the whole point of the row
    // (docs/SPEC/audit.md section 6): a second read narrowed to the same
    // erased record shows the first read's own reason, rather than nulling
    // it the way an ordinary read's reason is nulled.
    const again = await feed(
      `/api/audit/activity?clientId=${ERASED}&limit=50`,
      AUTH.ownerA,
      'Checking again before the letter goes out.',
    );
    const priorRead = again.events.find(
      (event) => event.entityType === 'client' && event.kind === 'read',
    );
    expect(priorRead?.reason).toBe('The household asked what the record still held.');
  });

  it('keeps an erased household out of the unfiltered feed until a reason is typed', async () => {
    const withoutReason = await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    expect(withoutReason.events.some((event) => event.clientId === ERASED)).toBe(false);
    // The record that stands is in the same page, so this is the erasure gate
    // narrowing the feed and not an empty answer.
    expect(withoutReason.events.some((event) => event.clientId === STANDING)).toBe(true);

    const withReason = await feed(
      '/api/audit/activity?limit=100',
      AUTH.ownerA,
      'Reviewing what the practice erased last month.',
    );
    expect(withReason.events.some((event) => event.clientId === ERASED)).toBe(true);
  });

  it('keeps a break-glass reason on the unfiltered feed, row by row, not once for the whole request', async () => {
    // The read that break-glass access forces a reason for: opening the
    // erased record itself, narrowed by clientId, exactly as the earlier
    // test above does. The reason is this read's own.
    const breakGlassReason = 'Confirming what the household says the practice still holds.';
    await feed(`/api/audit/activity?clientId=${ERASED}&limit=50`, AUTH.ownerA, breakGlassReason);

    // An ordinary read of the record that stands, with a reason typed on the
    // request but not one this read needed — the case this round's amendment
    // means to silence (docs/SPEC/audit.md section 9, the 10 September note).
    const ordinaryReason = "Checking the household's own file before the call.";
    await feed(`/api/audit/activity?clientId=${STANDING}&limit=50`, AUTH.ownerA, ordinaryReason);

    // Now the *unfiltered* feed, itself opened with a reason so a senior
    // actor can see the erased household's rows at all. Both rows above are
    // somewhere in it, scattered among other clients' rows — this is the
    // shape the narrowed feed never has to resolve, because there every row
    // already belongs to the one client the request itself checked.
    const wide = await feed(
      '/api/audit/activity?entityType=client&action=read&limit=100',
      AUTH.ownerA,
      "Reviewing the practice's whole trail before the audit.",
    );

    const erasedRead = wide.events.find(
      (event) => event.clientId === ERASED && event.reason === breakGlassReason,
    );
    expect(erasedRead?.kind).toBe('read');

    // The ordinary read's own reason was typed on its request too, but its
    // client is not erased, so the per-row flag never keeps it — the same
    // silencing rule an ordinary read already gets everywhere else.
    const standingRead = wide.events.find(
      (event) => event.clientId === STANDING && event.kind === 'read',
    );
    expect(standingRead).toBeTruthy();
    expect(standingRead?.reason).toBeNull();
  });

  it('refuses a practitioner, whose oversight it is not', async () => {
    expect((await get('/api/audit/activity', PRACTITIONER_AUTH)).status).toBe(403);
    expect((await get('/api/audit/filters', PRACTITIONER_AUTH)).status).toBe(403);
  });

  it('shows the trail its own reading, and never promises more from a short page', async () => {
    // The feed writes one `audit.activity` row per request, and the catalogue
    // has a sentence for it, so the second reading shows the first.
    await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    const body = await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    const own = body.events.filter((event) => event.entityType === 'audit_log');
    expect(own.length).toBeGreaterThan(0);
    expect(own[0]?.sentence).toContain('trail');
    expect(own[0]?.kind).toBe('read');

    // And the page is cut after the catalogue has spoken: a page that says
    // there is more is a full page, never a short one the screen would then
    // read as "nothing matches".
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const path = `/api/audit/activity?limit=3${cursor === null ? '' : `&before=${cursor}`}`;
      const answer: ActivityResponse = await feed(path, AUTH.ownerA);
      if (!answer.hasMore) break;
      expect(answer.events.length).toBe(3);
      expect(answer.nextBefore).not.toBeNull();
      cursor = answer.nextBefore;
    }
  });

  it('records a read of the record when it is narrowed to one', async () => {
    // The access report next door counts `read` and `list` rows, so a screen
    // narrowed to one household has to leave one behind or the report omits
    // exactly the looking it is there to describe.
    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    await feed(`/api/audit/activity?clientId=${STANDING}&limit=50`, AUTH.ownerA);
    const after = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);

    // And the unfiltered feed names no record, so it writes none.
    const wide = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    await feed('/api/audit/activity?limit=100', AUTH.ownerA);
    const after2 = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where client_id = $1 and action = 'read'",
      [STANDING],
    );
    expect(Number(after2.rows[0]?.n)).toBe(Number(wide.rows[0]?.n));
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
