import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DriveEstimate, GeoPoint, RoutingProvider } from '@domain/shared/routing';
import { RoutingUnavailableError } from '@domain/shared/routing';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import { OptimiseDayResponse, type PracticeDayResponse } from '@app/api/routing/schema';
import {
  AUTH,
  IDS,
  count,
  freshDatabase,
  seedClient,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * `GET /api/routing/practice-day` and `POST /api/routing/practice-day/optimise`
 * (docs/SPEC/route-planning.md sections 6.1 and 6.2): the practice's whole day
 * as coordinates and drives, and the order of it that drives least.
 *
 * What this file holds the routes to: the answer carries the road and never a
 * household; the calendar's three roles may ask and nobody else may; what the
 * seam answers is cached and not asked for twice; and a vendor that is down is
 * a plainer answer rather than a failure.
 *
 * **The seam here is a fake with a fixed table of drives.** Four synthetic
 * places: a base, two households near it five minutes apart, and one far away.
 * The same figures the rule's own test uses, so the order that drives least is
 * arrived at by the same arithmetic and can be asserted rather than observed.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

// This file's own synthetic ids, distinct from every other test file's block.
const PRACTITIONER = '00000000-0000-4000-8000-000000007101';
const PRACTITIONER_USER = '00000000-0000-4000-8000-000000007102';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000007103';
const FINANCE_USER = '00000000-0000-4000-8000-000000007104';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000007105';
const SERVICE_TYPE = '00000000-0000-4000-8000-000000007106';
const BASE_LOCATION = '00000000-0000-4000-8000-000000007107';

const CLIENT_FAR = '00000000-0000-4000-8000-000000007110';
const LOCATION_FAR = '00000000-0000-4000-8000-000000007111';
const APPT_FIRST = '00000000-0000-4000-8000-000000007112';

const CLIENT_NEAR = '00000000-0000-4000-8000-000000007113';
const LOCATION_NEAR = '00000000-0000-4000-8000-000000007114';
const APPT_SECOND = '00000000-0000-4000-8000-000000007115';

const CLIENT_NEXT_DOOR = '00000000-0000-4000-8000-000000007116';
const LOCATION_NEXT_DOOR = '00000000-0000-4000-8000-000000007117';
const APPT_THIRD = '00000000-0000-4000-8000-000000007118';

/**
 * The four places, as coordinates the fake seam recognises. Two decimal
 * places, a stretch of the emirates and nobody's home.
 */
const POINTS = {
  B: { lat: 25.1, lng: 55.1 },
  L1: { lat: 25.2, lng: 55.2 },
  L2: { lat: 25.6, lng: 55.6 },
  L3: { lat: 25.21, lng: 55.21 },
} as const;

/** The drive between any two of them, in seconds. Metres are ten times that. */
const SECONDS: Record<string, number> = {
  'B:L1': 600,
  'B:L2': 3000,
  'B:L3': 900,
  'L1:L2': 2700,
  'L1:L3': 300,
  'L2:L3': 2400,
};

function nameOf(point: GeoPoint): string {
  for (const [name, known] of Object.entries(POINTS)) {
    if (Math.abs(known.lat - point.lat) < 1e-6 && Math.abs(known.lng - point.lng) < 1e-6) {
      return name;
    }
  }
  throw new Error(`the fake seam knows no place at ${point.lat},${point.lng}`);
}

function drive(from: GeoPoint, to: GeoPoint): DriveEstimate {
  const a = nameOf(from);
  const b = nameOf(to);
  if (a === b) return { seconds: 0, metres: 0, source: 'traffic' };
  const seconds = SECONDS[`${a}:${b}`] ?? SECONDS[`${b}:${a}`];
  if (seconds === undefined) throw new Error(`the fake seam knows no leg ${a} to ${b}`);
  return { seconds, metres: seconds * 10, source: 'traffic' };
}

let calls = 0;

const seam: RoutingProvider = {
  kind: 'google',
  describe: () => 'a fake seam',
  driveMatrix: (legs) => {
    calls += 1;
    return Promise.resolve(legs.map((leg) => drive(leg.from, leg.to)));
  },
  driveGrid: (origins, destinations) => {
    calls += 1;
    return Promise.resolve(origins.map((from) => destinations.map((to) => drive(from, to))));
  },
  dayPicture: () => Promise.resolve(null),
};

/** A seam that answers nothing at all, so the fallback fills every leg. */
const brokenSeam: RoutingProvider = {
  kind: 'google',
  describe: () => 'a fake seam that is down',
  driveMatrix: () => Promise.reject(new RoutingUnavailableError('down')),
  driveGrid: () => Promise.reject(new RoutingUnavailableError('down')),
  dayPicture: () => Promise.resolve(null),
};

const NOW = new Date();
/** Two days ahead, so nothing on it is inside the hour the rule will not move. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
  new Date(NOW.getTime() + 2 * 24 * 60 * 60_000),
);

function dubaiTime(hour: string): Date {
  return new Date(`${DAY}T${hour}+04:00`);
}
function plus45(start: Date): Date {
  return new Date(start.getTime() + 45 * 60_000);
}

const LOCATION_INSERT_SQL =
  'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
  'entrance_point, created_by) values ($1, $2, $3, $4, $5, $6, ' +
  'extensions.st_geogfromtext($7), $8)';

const APPOINTMENT_INSERT_SQL =
  'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
  'location_id, delivery_mode, window_start, window_end, travel_buffer_minutes, status) ' +
  "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 15, 'proposed')";

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let brokenApi: ReturnType<typeof createApi>;

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

async function get(sub: string, query: string): Promise<Response> {
  return api.request(`/api/routing/practice-day?${query}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${await mint(sub)}` },
  });
}

async function post(
  sub: string,
  body: unknown,
  which: ReturnType<typeof createApi> = api,
): Promise<Response> {
  return which.request('/api/routing/practice-day/optimise', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function seedPlace(
  id: string,
  ownerType: 'client' | 'tenant',
  ownerId: string,
  point: GeoPoint,
): Promise<void> {
  await owner.query(LOCATION_INSERT_SQL, [
    id,
    IDS.tenantA,
    ownerType,
    ownerId,
    'home',
    'DXB',
    `SRID=4326;POINT(${point.lng} ${point.lat})`,
    IDS.ownerA,
  ]);
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');

  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
  await seedPlace(BASE_LOCATION, 'tenant', IDS.tenantA, POINTS.B);
  await owner.query('update practitioner set home_base_location_id = $2 where id = $1', [
    PRACTITIONER,
    BASE_LOCATION,
  ]);

  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  const households: [string, string, string, GeoPoint, string][] = [
    [CLIENT_FAR, LOCATION_FAR, APPT_FIRST, POINTS.L2, '09:00:00'],
    [CLIENT_NEAR, LOCATION_NEAR, APPT_SECOND, POINTS.L1, '10:30:00'],
    [CLIENT_NEXT_DOOR, LOCATION_NEXT_DOOR, APPT_THIRD, POINTS.L3, '12:00:00'],
  ];
  for (const [clientId, locationId, appointmentId, point, hour] of households) {
    await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, `Household${hour.slice(0, 2)}`);
    await seedPlace(locationId, 'client', clientId, point);
    const start = dubaiTime(hour);
    await owner.query(APPOINTMENT_INSERT_SQL, [
      appointmentId,
      IDS.tenantA,
      clientId,
      PRACTITIONER,
      SERVICE_TYPE,
      locationId,
      start,
      plus45(start),
    ]);
  }

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  const verifier = createTokenVerifier({ issuer: ISSUER, secret: SECRET });
  api = createApi({ pool, verifier, now: () => NOW, routing: seam });
  brokenApi = createApi({ pool, verifier, now: () => NOW, routing: brokenSeam });
});

afterAll(async () => {
  await owner.end();
  await pool.end();
});

beforeEach(() => {
  calls = 0;
});

describe('GET /api/routing/practice-day', () => {
  it('answers every practitioner with a stop that day, their base, their stops and the drives between', async () => {
    const res = await get(AUTH.ownerA, `date=${DAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PracticeDayResponse;
    expect(body.practitioners).toHaveLength(1);
    const [only] = body.practitioners;
    expect(only?.practitionerId).toBe(PRACTITIONER);
    expect(only?.homeBase?.locationId).toBe(BASE_LOCATION);
    expect(only?.stops.map((s) => s.appointmentId)).toEqual([APPT_FIRST, APPT_SECOND, APPT_THIRD]);
    expect(only?.stops[0]?.point).toEqual(POINTS.L2);
    // A leg per stop, the first from the base.
    expect(only?.legs).toHaveLength(3);
    expect(only?.legs[0]?.fromLocationId).toBe(BASE_LOCATION);
    expect(only?.legs.every((leg) => leg.source === 'traffic')).toBe(true);
  });

  it('names nobody: no client, no practitioner name, no address anywhere in the answer', async () => {
    const res = await get(AUTH.ownerA, `date=${DAY}`);
    const wire = JSON.stringify(await res.json()).toLowerCase();
    for (const forbidden of [
      'mrn',
      'mw-',
      'givenname',
      'familyname',
      'displayname',
      'villa',
      'makani',
      'household',
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('refuses finance and a practitioner: the map is the calendar roles’', async () => {
    expect((await get(FINANCE_AUTH, `date=${DAY}`)).status).toBe(403);
    expect((await get(PRACTITIONER_AUTH, `date=${DAY}`)).status).toBe(403);
  });

  it('writes what the seam answered into the cache, and asks it no second time', async () => {
    await get(AUTH.ownerA, `date=${DAY}`);
    expect(await count(owner, 'drive_estimate')).toBeGreaterThan(0);
    calls = 0;
    await get(AUTH.ownerA, `date=${DAY}`);
    expect(calls).toBe(0);
  });
});

describe('POST /api/routing/practice-day/optimise', () => {
  it('answers a plan whose order drives least, with the figures before and after', async () => {
    const res = await post(AUTH.ownerA, { date: DAY, practitionerId: PRACTITIONER });
    expect(res.status).toBe(200);
    const body = OptimiseDayResponse.parse(await res.json());
    expect(body.kind).toBe('plan');
    if (body.kind !== 'plan') return;
    // Far first, then the two near ones in the order that keeps the most
    // households where they are: 6,300 seconds against the day's own 6,900.
    expect(body.stops.map((s) => s.appointmentId)).toEqual([APPT_FIRST, APPT_THIRD, APPT_SECOND]);
    expect(body.before.driveSeconds).toBe(6900);
    expect(body.after.driveSeconds).toBe(6300);
    expect(body.savedSeconds).toBe(600);
    expect(body.source).toBe('traffic');
    // Every row carries the window the plan was computed against.
    expect(body.stops.map((s) => s.wasWindowStart)).toEqual([
      dubaiTime('09:00:00').toISOString(),
      dubaiTime('12:00:00').toISOString(),
      dubaiTime('10:30:00').toISOString(),
    ]);
    expect(body.stops[0]?.moved).toBe(false);
    expect(body.stops[1]?.moved).toBe(true);
  });

  it('refuses a caller without the calendar roles', async () => {
    expect((await post(FINANCE_AUTH, { date: DAY, practitionerId: PRACTITIONER })).status).toBe(
      403,
    );
    expect(
      (await post(PRACTITIONER_AUTH, { date: DAY, practitionerId: PRACTITIONER })).status,
    ).toBe(403);
  });

  it('refuses a body that is not one', async () => {
    expect((await post(AUTH.ownerA, { date: DAY })).status).toBe(400);
  });

  it('answers a plain refusal, never a 500, when the vendor is down', async () => {
    // With nothing cached and no vendor, every figure is the practice's own
    // straight-line arithmetic and the plan says so.
    await owner.query('delete from drive_estimate');
    const res = await post(AUTH.ownerA, { date: DAY, practitionerId: PRACTITIONER }, brokenApi);
    expect(res.status).toBe(200);
    const body = OptimiseDayResponse.parse(await res.json());
    if (body.kind === 'plan') expect(body.source).toBe('straight-line');
    expect(await count(owner, 'drive_estimate')).toBe(0);
  });
});
