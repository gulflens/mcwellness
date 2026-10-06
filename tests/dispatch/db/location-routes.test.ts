import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import type { LocationMeResponse, SharedPositionsResponse } from '@app/api/location/schema';
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
 * The live-location routes (docs/SPEC/dispatch.md section 15): the person's
 * own consent, switch and positions, and the board's read of the last
 * position of everybody sharing. Ids in this file's own 76xx block.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

const IDLE_USER = '00000000-0000-4000-8000-000000007601';
const IDLE = '00000000-0000-4000-8000-000000007602';
const AUTH_IDLE = '00000000-0000-4000-8000-000000007603';
const LEAD_USER = '00000000-0000-4000-8000-000000007604';
const AUTH_LEAD = '00000000-0000-4000-8000-000000007605';
const FINANCE_USER = '00000000-0000-4000-8000-000000007606';
const AUTH_FINANCE = '00000000-0000-4000-8000-000000007607';
const APPOINTMENT = '00000000-0000-4000-8000-000000007608';

/**
 * 10:30 in Dubai, half an hour into a visit that opened at 10:00: the shift is
 * open. A day in the past on purpose: since migration 212 the database stamps
 * a position with its own clock, which is always later than this one, so a
 * position is never "before the shift opened" whatever time the suite runs.
 */
const NOW = new Date('2026-09-04T10:30:00+04:00');
/** The same day at 13:30: the visit is long over, the tail has passed, the shift is closed. */
const AFTER_SHIFT = new Date('2026-09-04T13:30:00+04:00');

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
/** The same API with its clock after the shift has closed. */
let evening: ReturnType<typeof createApi>;

function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function call(sub: string, method: string, path: string, body?: unknown): Promise<Response> {
  return api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const A_FIX = { latitude: 25.2101, longitude: 55.2702, accuracyMetres: 12 };

async function me(sub: string): Promise<LocationMeResponse> {
  return (await (await call(sub, 'GET', '/api/location/me')).json()) as LocationMeResponse;
}

async function shared(sub: string = AUTH.ownerA): Promise<SharedPositionsResponse['positions']> {
  const res = await call(sub, 'GET', '/api/location/positions');
  expect(res.status).toBe(200);
  return ((await res.json()) as SharedPositionsResponse).positions;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  // A practitioner with nothing booked today: no shift, so nothing is written.
  await seedUser(owner, {
    id: IDLE_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_IDLE,
    displayName: 'Synthetic Practitioner Idle',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, IDLE, IDLE_USER);
  await seedUser(owner, {
    id: LEAD_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_LEAD,
    displayName: 'Synthetic Lead',
    roles: ['lead_practitioner'],
  });
  await seedUser(owner, {
    id: MORE_IDS.adminUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.adminA,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_FINANCE,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });
  await seedUser(owner, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
  });
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  const start = new Date('2026-09-04T10:00:00+04:00');
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 'confirmed', $9)",
    [
      APPOINTMENT,
      IDS.tenantA,
      IDS.clientA,
      MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      IDS.locationA,
      start,
      new Date(start.getTime() + 45 * 60_000),
      IDS.ownerA,
    ],
  );

  pool = createPool(process.env.API_DATABASE_URL ?? '');
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    keyOf: () => 'test',
    now: () => NOW,
  });
  evening = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    keyOf: () => 'test',
    now: () => AFTER_SHIFT,
  });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('the practitioner, before consenting', () => {
  it('is told they can share, have not consented, and are on shift', async () => {
    expect(await me(AUTH.practitionerA)).toEqual({
      eligible: true,
      noticeVersion: '1.2',
      consent: null,
      sharingOn: false,
      shiftOpen: true,
    });
  });

  it('cannot send a position without consent', async () => {
    const res = await call(AUTH.practitionerA, 'POST', '/api/location/positions', A_FIX);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'position_refused', code: 'no_consent' });
  });

  it('cannot turn sharing on without consent', async () => {
    const res = await call(AUTH.practitionerA, 'PUT', '/api/location/sharing', { on: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'no_consent' });
  });

  it('cannot consent to a notice other than the one in force', async () => {
    const res = await call(AUTH.practitionerA, 'POST', '/api/location/consent', {
      noticeVersion: '0.9',
    });
    expect(res.status).toBe(409);
  });
});

describe('somebody with no day of their own', () => {
  it('is told they cannot share, and is refused every write', async () => {
    for (const sub of [AUTH.ownerA, AUTH.adminA, AUTH_FINANCE, AUTH.contactA]) {
      expect((await me(sub)).eligible, sub).toBe(false);
      expect(
        (await call(sub, 'POST', '/api/location/consent', { noticeVersion: '1.2' })).status,
        sub,
      ).toBe(403);
      expect((await call(sub, 'PUT', '/api/location/sharing', { on: true })).status, sub).toBe(403);
      expect((await call(sub, 'POST', '/api/location/positions', A_FIX)).status, sub).toBe(403);
    }
  });
});

describe('consenting, sharing and the board', () => {
  it('records the consent, turns sharing on, and writes a position on shift', async () => {
    const res = await call(AUTH.practitionerA, 'POST', '/api/location/consent', {
      noticeVersion: '1.2',
    });
    expect(res.status).toBe(204);
    const now = await me(AUTH.practitionerA);
    expect(now.consent?.noticeVersion).toBe('1.2');
    expect(now.sharingOn).toBe(true);
    expect((await call(AUTH.practitionerA, 'POST', '/api/location/positions', A_FIX)).status).toBe(
      204,
    );
  });

  it('shows the owner, an admin and the lead the last position, with how old it is', async () => {
    for (const sub of [AUTH.ownerA, AUTH.adminA, AUTH_LEAD]) {
      expect(await shared(sub), sub).toEqual([
        {
          practitionerId: MORE_IDS.practitionerA,
          latitude: A_FIX.latitude,
          longitude: A_FIX.longitude,
          accuracyMetres: A_FIX.accuracyMetres,
          // The database's own clock (migration 212), not the caller's.
          recordedAt: expect.any(String),
          ageMinutes: 0,
        },
      ]);
    }
  });

  it("stops showing a position once that person's shift has closed", async () => {
    const res = await evening.request('/api/location/positions', {
      headers: { authorization: `Bearer ${await mint(AUTH.ownerA)}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SharedPositionsResponse).positions).toEqual([]);
  });

  it('refuses the board read to a practitioner, finance and a household', async () => {
    for (const sub of [AUTH.practitionerA, AUTH_FINANCE, AUTH.contactA]) {
      expect((await call(sub, 'GET', '/api/location/positions')).status, sub).toBe(403);
    }
  });

  it('records who looked, by id, and never where', async () => {
    const { rows } = await owner.query<{
      action: string;
      client_id: string | null;
      new_values: unknown;
      old_values: unknown;
    }>(
      'select action, client_id, new_values, old_values from audit_log ' +
        "where entity_type = 'practitioner_position'",
    );
    // Three board reads above, one position each.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toEqual({ action: 'read', client_id: null, new_values: null, old_values: null });
    }
    const { rows: anywhere } = await owner.query<{ n: number }>(
      'select count(*)::int as n from audit_log ' +
        "where coalesce(new_values::text, '') || coalesce(old_values::text, '') like '%25.2101%'",
    );
    expect(anywhere[0]?.n).toBe(0);
  });

  it('refuses a position from somebody with consent and no shift today', async () => {
    expect(
      (await call(AUTH_IDLE, 'POST', '/api/location/consent', { noticeVersion: '1.2' })).status,
    ).toBe(204);
    const res = await call(AUTH_IDLE, 'POST', '/api/location/positions', A_FIX);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'off_shift' });
    expect((await me(AUTH_IDLE)).shiftOpen).toBe(false);
  });

  it('stops at once when the switch is turned off, and the board says nothing', async () => {
    expect(
      (await call(AUTH.practitionerA, 'PUT', '/api/location/sharing', { on: false })).status,
    ).toBe(204);
    const res = await call(AUTH.practitionerA, 'POST', '/api/location/positions', A_FIX);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'sharing_off' });
    expect(await shared()).toEqual([]);
    expect(
      (await call(AUTH.practitionerA, 'PUT', '/api/location/sharing', { on: true })).status,
    ).toBe(204);
    expect(await shared()).toHaveLength(1);
  });

  it('forgets everything on withdrawal: the consent, the switch and every position', async () => {
    expect(
      (await call(AUTH.practitionerA, 'POST', '/api/location/consent/withdraw', {})).status,
    ).toBe(204);
    expect(await me(AUTH.practitionerA)).toMatchObject({ consent: null, sharingOn: false });
    expect(await shared()).toEqual([]);
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from practitioner_position where practitioner_id = $1',
      [MORE_IDS.practitionerA],
    );
    expect(rows[0]?.n).toBe(0);
    const { rows: consents } = await owner.query<{ withdrawn: boolean }>(
      'select withdrawn_at is not null as withdrawn from staff_consent where user_id = $1',
      [MORE_IDS.practitionerUserA],
    );
    // Kept as evidence that it was given and withdrawn, not deleted.
    expect(consents).toEqual([{ withdrawn: true }]);
  });

  it('audits the consent and the switch under the person and a reason', async () => {
    const { rows } = await owner.query<{ entity_type: string; reason: string | null }>(
      'select entity_type, reason from audit_log where actor_id = $1 ' +
        "and entity_type in ('staff_consent', 'location_sharing') order by id",
      [MORE_IDS.practitionerUserA],
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row.reason, row.entity_type).toMatch(/location/);
  });
});

describe('withdrawal always works, and a stale notice pauses sharing', () => {
  it('lets somebody who is no longer eligible withdraw, switch off, and be forgotten', async () => {
    // The idle practitioner consented above. Give them a position, then take
    // away their role and their working row: they can no longer share, and
    // they must still be able to stop.
    await owner.query(
      'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, ' +
        'accuracy_metres, created_by) values ($1, $2, 25.2, 55.27, 10, $3)',
      [IDS.tenantA, IDLE, IDLE_USER],
    );
    await owner.query("delete from user_role where user_id = $1 and role = 'practitioner'", [
      IDLE_USER,
    ]);
    await owner.query("update practitioner set status = 'inactive' where id = $1", [IDLE]);

    expect((await me(AUTH_IDLE)).eligible).toBe(false);
    expect((await me(AUTH_IDLE)).consent?.noticeVersion).toBe('1.2');
    expect((await call(AUTH_IDLE, 'PUT', '/api/location/sharing', { on: false })).status).toBe(204);
    expect((await call(AUTH_IDLE, 'POST', '/api/location/consent/withdraw', {})).status).toBe(204);
    expect(await me(AUTH_IDLE)).toMatchObject({ consent: null, sharingOn: false });
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from practitioner_position where practitioner_id = $1',
      [IDLE],
    );
    expect(rows[0]?.n).toBe(0);
    // Turning sharing back on is still refused to somebody who cannot share.
    expect((await call(AUTH_IDLE, 'PUT', '/api/location/sharing', { on: true })).status).toBe(403);
  });

  it('pauses sharing when the notice has changed since the person agreed', async () => {
    // Practitioner A agrees again, then the practice's notice moves on: their
    // consent now names an older version than the one in force.
    expect(
      (await call(AUTH.practitionerA, 'POST', '/api/location/consent', { noticeVersion: '1.2' }))
        .status,
    ).toBe(204);
    expect((await call(AUTH.practitionerA, 'POST', '/api/location/positions', A_FIX)).status).toBe(
      204,
    );
    expect(await shared()).toHaveLength(1);
    await owner.query(
      'update staff_consent set withdrawn_at = now() where user_id = $1 and withdrawn_at is null',
      [MORE_IDS.practitionerUserA],
    );
    await owner.query(
      'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
        "values ($1, $2, 'location_sharing', '1.0', $2)",
      [IDS.tenantA, MORE_IDS.practitionerUserA],
    );

    const status = await me(AUTH.practitionerA);
    expect(status.consent?.noticeVersion).toBe('1.0');
    expect(status.noticeVersion).toBe('1.2');
    const res = await call(AUTH.practitionerA, 'POST', '/api/location/positions', A_FIX);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'notice_changed' });
    // And the board no longer shows the position sent under the old notice.
    expect(await shared()).toEqual([]);
  });
});
