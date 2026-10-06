import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocationMeResponse, SharedPositionsResponse } from '@app/api/location/schema';
import type { HelpersResponse } from '@app/api/team/schema';
import { IDS } from '../../db/helpers';
import { PORTAL, startPortalHarness, type PortalHarness } from '../../portal/db/support';

/**
 * The helper through the API (round 76, docs/SPEC/dispatch.md section 15.12):
 * Settings › Team adds, names and revokes one; the helper's own consent,
 * switch and positions through the five location routes, on the shift of the
 * practitioner they accompany; the board's read placing them beside that
 * practitioner; and every other route in the API answering a helper 403 or
 * 404. Ids in this file's own 79xx block; names from db/seed/names.ts;
 * addresses at example.com.
 */

/** The sign-in the portal harness gives the practice's owner. */
const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';
const APPOINTMENT = '00000000-0000-4000-8000-000000007901';
const NOBODY = '00000000-0000-4000-8000-000000007902';

/** 10:30 in Dubai, half an hour into a visit at 10:00: the practitioner's shift is open. */
const NOW = new Date('2026-09-04T10:30:00+04:00');
/** 13:30 the same day: the visit is long over and the shift has closed. */
const AFTER_SHIFT = new Date('2026-09-04T13:30:00+04:00');

const A_FIX = { latitude: 25.2101, longitude: 55.2702, accuracyMetres: 12 };

let h: PortalHarness;
let helper: { userId: string; authId: string };

async function authOf(userId: string): Promise<string> {
  const { rows } = await h.owner.query<{ auth_id: string }>(
    'select auth_id from app_user where id = $1',
    [userId],
  );
  return rows[0]?.auth_id ?? '';
}

async function addHelper(
  authId: string,
  displayName: string,
  email: string,
  practitionerId: string = PORTAL.practitionerRow,
): Promise<Response> {
  return h.callAs('POST', '/api/team/helpers', authId, { displayName, email, practitionerId });
}

async function me(authId: string): Promise<LocationMeResponse> {
  const res = await h.callAs('GET', '/api/location/me', authId);
  expect(res.status).toBe(200);
  return (await res.json()) as LocationMeResponse;
}

async function board(api = h.api): Promise<SharedPositionsResponse> {
  const res = await api.request('/api/location/positions', {
    headers: await h.authHeader(OWNER_AUTH),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SharedPositionsResponse;
}

beforeAll(async () => {
  h = await startPortalHarness(() => NOW);
  const start = new Date('2026-09-04T10:00:00+04:00');
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 'confirmed', $9)",
    [
      APPOINTMENT,
      IDS.tenantA,
      PORTAL.childA,
      PORTAL.practitionerRow,
      PORTAL.serviceType,
      PORTAL.homeChildA,
      start,
      new Date(start.getTime() + 45 * 60_000),
      IDS.ownerA,
    ],
  );
  const res = await addHelper(OWNER_AUTH, 'Juniper Vale', 'juniper.vale@example.com');
  expect(res.status).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  helper = { userId, authId: await authOf(userId) };
});

afterAll(async () => {
  await h.close();
});

describe('Settings › Team: helpers', () => {
  it('adds a helper with a sign-in, the helper role and whom they accompany', async () => {
    const { rows } = await h.owner.query<{ role: string; practitioner_id: string }>(
      'select r.role::text as role, a.practitioner_id from user_role r ' +
        'join helper_accompaniment a on a.helper_user_id = r.user_id and a.ended_at is null ' +
        'where r.user_id = $1',
      [helper.userId],
    );
    expect(rows).toEqual([{ role: 'helper', practitioner_id: PORTAL.practitionerRow }]);
    expect(helper.authId).not.toBe('');
  });

  it('lets the owner alone add one: an admin is refused', async () => {
    for (const auth of [
      PORTAL.adminAuth,
      PORTAL.leadAuth,
      PORTAL.practitionerAuth,
      PORTAL.financeAuth,
      PORTAL.motherAuth,
      helper.authId,
    ]) {
      expect((await addHelper(auth, 'Aspen Field', 'aspen.field@example.com')).status, auth).toBe(
        403,
      );
    }
  });

  it('lists the helpers with whom each accompanies, and the practitioners to choose from', async () => {
    const res = await h.callAs('GET', '/api/team/helpers', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HelpersResponse;
    expect(body.helpers.find((row) => row.userId === helper.userId)).toEqual({
      userId: helper.userId,
      displayName: 'Juniper Vale',
      status: 'active',
      accompanies: { practitionerId: PORTAL.practitionerRow, displayName: 'Basil Vale' },
    });
    expect(body.practitioners).toEqual([
      { practitionerId: PORTAL.practitionerRow, displayName: 'Basil Vale' },
    ]);
    expect((await h.callAs('GET', '/api/team/helpers', PORTAL.leadAuth)).status).toBe(403);
  });

  it('shows a helper in the team list as a helper', async () => {
    const res = await h.callAs('GET', '/api/team', OWNER_AUTH);
    const { members } = (await res.json()) as { members: { id: string; roles: string[] }[] };
    expect(members.find((m) => m.id === helper.userId)?.roles).toEqual(['helper']);
  });

  it('refuses a practitioner who is not one, leaving no person and no sign-in behind', async () => {
    const res = await addHelper(OWNER_AUTH, 'Rowan Field', 'rowan.field@example.com', NOBODY);
    expect(res.status).toBe(409);
    const { rows } = await h.owner.query(
      "select 1 from app_user where email = 'rowan.field@example.com'",
    );
    expect(rows).toEqual([]);
    // The address is free again.
    expect((await addHelper(OWNER_AUTH, 'Rowan Field', 'rowan.field@example.com')).status).toBe(
      201,
    );
  });

  it('lets an admin read the helpers, and refuses them a change of whom one goes with', async () => {
    expect((await h.callAs('GET', '/api/team/helpers', PORTAL.adminAuth)).status).toBe(200);
    const res = await h.callAs('PUT', `/api/team/helpers/${helper.userId}`, PORTAL.adminAuth, {
      practitionerId: PORTAL.practitionerRow,
    });
    expect(res.status).toBe(403);
    expect(
      (
        await h.callAs('PUT', `/api/team/helpers/${helper.userId}`, OWNER_AUTH, {
          practitionerId: PORTAL.practitionerRow,
        })
      ).status,
    ).toBe(200);
  });

  it('refuses a working role for a helper with its own code, and nothing moves', async () => {
    const res = await h.callAs('PUT', `/api/team/${helper.userId}/roles/practitioner`, OWNER_AUTH);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'helper_holds_no_other_role' });
    const { rows } = await h.owner.query<{ role: string }>(
      'select role::text as role from user_role where user_id = $1',
      [helper.userId],
    );
    expect(rows).toEqual([{ role: 'helper' }]);
  });

  it('refuses the helper role on the colleague invite, with its own code', async () => {
    const res = await h.callAs('POST', '/api/team', OWNER_AUTH, {
      displayName: 'Aspen Field',
      email: 'aspen.field@example.com',
      roles: ['finance', 'helper'],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'helper_holds_no_other_role' });
    const { rows } = await h.owner.query(
      "select 1 from app_user where email = 'aspen.field@example.com'",
    );
    expect(rows).toEqual([]);
  });

  it('refuses a colleague as a helper: the route reaches helpers only', async () => {
    const res = await h.callAs('PUT', `/api/team/helpers/${PORTAL.finance}`, OWNER_AUTH, {
      practitionerId: PORTAL.practitionerRow,
    });
    expect(res.status).toBe(404);
  });
});

describe("the helper's own location", () => {
  it('signs in as a helper, and reads their own name and role', async () => {
    const res = await h.callAs('GET', '/api/me', helper.authId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: 'Juniper Vale', roles: ['helper'] });
  });

  it('is told whom they accompany, by first name, and that the shift is open', async () => {
    expect(await me(helper.authId)).toEqual({
      eligible: true,
      noticeVersion: '1.2',
      consent: null,
      sharingOn: false,
      shiftOpen: true,
      accompanies: 'Basil',
    });
  });

  it('cannot send a position before agreeing', async () => {
    const res = await h.callAs('POST', '/api/location/positions', helper.authId, A_FIX);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'no_consent' });
  });

  it('agrees for themselves, which turns sharing on, and sends a position', async () => {
    expect(
      (await h.callAs('POST', '/api/location/consent', helper.authId, { noticeVersion: '1.2' }))
        .status,
    ).toBe(204);
    expect((await me(helper.authId)).sharingOn).toBe(true);
    expect((await h.callAs('POST', '/api/location/positions', helper.authId, A_FIX)).status).toBe(
      204,
    );
    const { rows } = await h.owner.query<{ practitioner_id: string | null }>(
      'select practitioner_id from practitioner_position where user_id = $1',
      [helper.userId],
    );
    expect(rows).toEqual([{ practitioner_id: null }]);
  });

  it('shows on the board beside the practitioner they accompany, marked as a helper', async () => {
    const answer = await board();
    expect(answer.positions).toEqual([]);
    expect(answer.helpers).toEqual([
      {
        accompaniesPractitionerId: PORTAL.practitionerRow,
        firstName: 'Juniper',
        latitude: A_FIX.latitude,
        longitude: A_FIX.longitude,
        accuracyMetres: A_FIX.accuracyMetres,
        recordedAt: expect.any(String),
        ageMinutes: 0,
      },
    ]);
  });

  it('is refused off the practitioner’s shift, and leaves the board once it closes', async () => {
    const evening = h.apiWith({ now: () => AFTER_SHIFT });
    const res = await evening.request('/api/location/positions', {
      method: 'POST',
      headers: { ...(await h.authHeader(helper.authId)), 'content-type': 'application/json' },
      body: JSON.stringify(A_FIX),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'off_shift' });
    expect((await board(evening)).helpers).toEqual([]);
  });

  it('stops at once when the switch is turned off', async () => {
    expect(
      (await h.callAs('PUT', '/api/location/sharing', helper.authId, { on: false })).status,
    ).toBe(204);
    expect((await board()).helpers).toEqual([]);
    const res = await h.callAs('POST', '/api/location/positions', helper.authId, A_FIX);
    expect(await res.json()).toMatchObject({ code: 'sharing_off' });
    expect(
      (await h.callAs('PUT', '/api/location/sharing', helper.authId, { on: true })).status,
    ).toBe(204);
    expect((await board()).helpers).toHaveLength(1);
  });

  it('forgets every position on withdrawal', async () => {
    expect(
      (await h.callAs('POST', '/api/location/consent/withdraw', helper.authId, {})).status,
    ).toBe(204);
    const { rows } = await h.owner.query<{ n: number }>(
      'select count(*)::int as n from practitioner_position where user_id = $1',
      [helper.userId],
    );
    expect(rows[0]?.n).toBe(0);
    expect(await me(helper.authId)).toMatchObject({ consent: null, sharingOn: false });
  });
});

describe('every other route, for a helper', () => {
  /**
   * The routes a helper is meant to reach: their own location, and who they
   * are. Everything ahead of the fence answers anybody and is not about a
   * helper: the health checks, the development door, the portal's invitation
   * door, the website's enquiry door and the local store's signed links.
   */
  const ALLOWED = [
    /^\/api\/location\/(me|consent|consent\/withdraw|sharing|positions)$/,
    /^\/api\/me(\/password-changed)?$/,
    /^\/api\/health(\/deep)?$/,
    /^\/api\/dev\//,
    /^\/api\/portal\/invite\//,
    /^\/api\/storage\//,
  ];
  /** The website's enquiry door: public, ahead of the fence, by method. */
  const PUBLIC = new Set(['POST /api/enquiries', 'OPTIONS /api/enquiries']);

  it('answers 403 or 404 to every mounted route but their own location and session', async () => {
    const seen = new Set<string>();
    const answers: Record<string, number> = {};
    for (const route of h.api.routes) {
      if (route.method === 'ALL') continue;
      if (!route.path.startsWith('/api/')) continue;
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ALLOWED.some((allowed) => allowed.test(route.path)) || PUBLIC.has(key)) continue;
      const path = route.path.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, NOBODY);
      const write = route.method !== 'GET' && route.method !== 'HEAD';
      const res = await h.api.request(path, {
        method: route.method,
        headers: {
          ...(await h.authHeader(helper.authId)),
          ...(write ? { 'content-type': 'application/json' } : {}),
        },
        ...(write ? { body: '{}' } : {}),
      });
      answers[key] = res.status;
    }
    // Enough routes walked that this is the API and not a corner of it.
    expect(Object.keys(answers).length).toBeGreaterThan(100);
    const wrong = Object.fromEntries(
      Object.entries(answers).filter(([, status]) => status !== 403 && status !== 404),
    );
    expect(wrong).toEqual({});
  });

  it('answers the board read 403: a helper sees nobody’s position, their own included', async () => {
    expect((await h.callAs('GET', '/api/location/positions', helper.authId)).status).toBe(403);
  });
});

describe('revoking a helper', () => {
  it('is refused to a lead', async () => {
    expect(
      (await h.callAs('DELETE', `/api/team/helpers/${helper.userId}`, PORTAL.leadAuth)).status,
    ).toBe(403);
  });

  it('is refused to an admin', async () => {
    expect(
      (await h.callAs('DELETE', `/api/team/helpers/${helper.userId}`, PORTAL.adminAuth)).status,
    ).toBe(403);
  });

  it('ends the accompaniment and shuts the sign-in, for the owner', async () => {
    expect(
      (await h.callAs('DELETE', `/api/team/helpers/${helper.userId}`, OWNER_AUTH)).status,
    ).toBe(200);
    const { rows } = await h.owner.query<{ status: string; standing: number }>(
      'select u.status::text as status, (select count(*)::int from helper_accompaniment a ' +
        'where a.helper_user_id = u.id and a.ended_at is null) as standing ' +
        'from app_user u where u.id = $1',
      [helper.userId],
    );
    expect(rows).toEqual([{ status: 'suspended', standing: 0 }]);
    // The fence answers a suspended sign-in as it answers nobody at all.
    expect((await h.callAs('GET', '/api/location/me', helper.authId)).status).toBe(403);
  });
});
