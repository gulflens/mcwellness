import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { googleRouting, straightLineRouting } from '../../../app/api/_middleware/routing';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type { RoutingDayResponse } from '../../../app/api/routing/schema';
import type { EventsResponse } from '../../../app/api/sessions/schema';
import {
  IDS,
  freshDatabase,
  seedClient,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import { seedAppointment, seedConsent, seedConsentDocument } from './helpers';

/**
 * The photograph's door and the day's drives, through the API the server
 * builds (docs/SPEC/practitioner-phone.md sections 4 and 5).
 *
 * The whole of section 4.3's refusal table is exercised here, because each
 * refusal is a different sentence to a device that must know whether to keep
 * the bytes or drop them: a digest that does not match, an event that has not
 * arrived, an event a retake has superseded, a household that has not agreed,
 * somebody else's visit, and a second photograph on a visit that has one.
 *
 * The store is the real local implementation writing to a temporary folder,
 * and the routing seam is the fallback: **nothing here reaches a vendor**, and
 * the day's estimates are the straight-line arithmetic, which is what the
 * laptop runs (docs/SEAMS.md).
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f1';
const WORDING = '00000000-0000-4000-8000-000000003001';
const FAMILY_NAMES = ['Bay', 'Cliff', 'Creek', 'Dune', 'Harbour', 'Lagoon', 'Meadow'];

/** A one-pixel JPEG's worth of nothing. What matters is that it has a digest. */
const PICTURE = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let today: string;
let dir: string;

/**
 * `days` on from a practice day, counted in practice days. `today` is a
 * calendar day in Asia/Dubai — the database names it — so stepping it by whole
 * UTC days counts in the wrong calendar: `${today}T00:00:00+04:00` is already
 * the previous day in UTC, and the day that comes back is one short. Counting
 * on the date parts themselves is exact, and reads no clock at all.
 */
function daysOn(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(date) + days))
    .toISOString()
    .slice(0, 10);
}

function id(scenario: string, slot: number): string {
  return `00000000-0000-4000-8000-000000${scenario}${String(slot).padStart(4, '0')}`;
}

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

async function post(path: string, authSub: string, body: unknown): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, authSub: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(authSub)}` } });
}

type Visit = {
  scenario: string;
  authSub: string;
  practitionerId: string;
  clientId: string;
  sessionId: string;
  locationId: string;
};

/** A credentialed practitioner, a consenting adult, a booked visit today, checked in. */
async function seedVisit(
  scenario: string,
  options: { photoConsent?: boolean; hour?: string } = {},
): Promise<Visit> {
  const userId = id(scenario, 1);
  const authSub = id(scenario, 2);
  const practitionerId = id(scenario, 3);
  const clientId = id(scenario, 4);
  const contactId = id(scenario, 5);
  const locationId = id(scenario, 6);
  const appointmentId = id(scenario, 7);

  await seedUser(owner, {
    id: userId,
    tenantId: IDS.tenantA,
    authId: authSub,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, practitionerId, userId);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await seedClient(
    owner,
    IDS.tenantA,
    clientId,
    IDS.ownerA,
    FAMILY_NAMES[Number(scenario) - 1] ?? 'Ridge',
  );
  await owner.query("update client set date_of_birth = '1990-01-01' where id = $1", [clientId]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [contactId, IDS.tenantA, clientId],
  );
  const purposes = [
    'participation',
    'home_visit',
    // Read at the door since 2026-09-09; without it no visit opens.
    'health_data',
    ...(options.photoConsent ? ['photo_video'] : []),
  ];
  for (const [index, purpose] of purposes.entries()) {
    await seedConsent(owner, {
      id: id(scenario, 10 + index),
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      purpose: purpose as 'participation',
      textDocumentId: WORDING,
    });
  }
  await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
  await seedAppointment(owner, {
    id: appointmentId,
    tenantId: IDS.tenantA,
    clientId,
    practitionerId,
    serviceTypeId: SERVICE_TYPE,
    locationId,
    windowStart: `${today}T${options.hour ?? '08'}:00:00+04:00`,
    status: 'confirmed',
  });

  const sessionId = id(scenario, 20);
  const res = await post(`/api/sessions/${sessionId}/events`, authSub, {
    clientId,
    point: null,
    events: [
      {
        id: id(scenario, 21),
        seq: 1,
        kind: 'session_started',
        deviceAt: new Date().toISOString(),
        payload: { serviceTypeId: SERVICE_TYPE, deliveryMode: 'home', locationId: null },
      },
    ],
  });
  expect(res.status, `check-in for scenario ${scenario}`).toBe(201);
  return { scenario, authSub, practitionerId, clientId, sessionId, locationId };
}

/** The `photo_captured` event that names a digest, flushed as the device flushes it. */
async function flushPhotoEvent(visit: Visit, bytes: Uint8Array, slot = 30): Promise<Response> {
  return post(`/api/sessions/${visit.sessionId}/events`, visit.authSub, {
    events: [
      {
        id: id(visit.scenario, slot),
        seq: slot,
        kind: 'photo_captured',
        deviceAt: new Date().toISOString(),
        payload: { mimeType: 'image/jpeg', sizeBytes: bytes.byteLength, sha256: digestOf(bytes) },
      },
    ],
  });
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedConsentDocument(owner, IDS.tenantA, WORDING);
  const dates = await owner.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  today = dates.rows[0]!.today;

  dir = await mkdtemp(join(tmpdir(), 'mcwellness-photo-'));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage: localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 5) }),
    // The fallback, which is what the laptop runs and what reaches nothing.
    routing: straightLineRouting({ timeZone: 'Asia/Dubai' }),
  });
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("the day's drives, under the fallback", () => {
  it('answers a leg per stop after the first, every one a straight-line estimate', async () => {
    const visit = await seedVisit('12', { hour: '06' });
    // A second stop for the same practitioner, later in the day.
    const secondClient = id('12', 50);
    const secondLocation = id('12', 51);
    await seedClient(owner, IDS.tenantA, secondClient, IDS.ownerA, 'Quarry');
    await seedLocation(owner, IDS.tenantA, secondLocation, secondClient, IDS.ownerA);
    await owner.query(
      'update location set entrance_point = ' +
        "extensions.st_geogfromtext('SRID=4326;POINT(55.40 25.35)') where id = $1",
      [secondLocation],
    );
    await seedAppointment(owner, {
      id: id('12', 52),
      tenantId: IDS.tenantA,
      clientId: secondClient,
      practitionerId: visit.practitionerId,
      serviceTypeId: SERVICE_TYPE,
      locationId: secondLocation,
      windowStart: `${today}T15:00:00+04:00`,
      status: 'confirmed',
    });

    const res = await get(`/api/routing/day?date=${today}`, visit.authSub);
    expect(res.status).toBe(200);
    const day = (await res.json()) as RoutingDayResponse;
    // No home base on this practitioner, so one leg for two stops.
    expect(day.legs).toHaveLength(1);
    expect(day.legs[0]?.source).toBe('straight-line');
    expect(day.legs[0]?.seconds).toBeGreaterThan(0);
    // The fallback draws no picture, and says so rather than showing a frame.
    expect(day.pictureUrl).toBeNull();
    expect(day.mapAvailable).toBe(false);

    // Written back, keyed by the pair and the hour, so the second ask is free.
    const cached = await owner.query<{ n: string; source: string }>(
      'select count(*)::text as n, min(source::text) as source from drive_estimate',
    );
    expect(cached.rows[0]?.n).toBe('1');
    expect(cached.rows[0]?.source).toBe('straight-line');

    const again = await get(`/api/routing/day?date=${today}`, visit.authSub);
    expect(((await again.json()) as RoutingDayResponse).legs).toEqual(day.legs);
    const still = await owner.query<{ n: string }>(
      'select count(*)::text as n from drive_estimate',
    );
    expect(still.rows[0]?.n).toBe('1');
  });

  it('answers an empty day without reaching for an estimate', async () => {
    const visit = await seedVisit('13', { hour: '07' });
    const res = await get(`/api/routing/day?date=${daysOn(today, 8)}`, visit.authSub);
    expect(res.status).toBe(200);
    expect((await res.json()) as RoutingDayResponse).toMatchObject({
      legs: [],
      pictureUrl: null,
      mapAvailable: false,
    });
  });

  it('answers no picture at all under the fallback', async () => {
    const visit = await seedVisit('14', { hour: '09' });
    const res = await get(`/api/routing/day-picture?date=${today}&v=anything`, visit.authSub);
    expect(res.status).toBe(404);
  });

  it('writes no coordinate to the audit trail', async () => {
    const visit = await seedVisit('15', { hour: '11' });
    await get(`/api/routing/day?date=${today}`, visit.authSub);
    // The row's own timestamps are stripped before the substring test: they
    // carry microseconds, so a row written at hh:mm:55.2xxxxx would otherwise
    // match a longitude it does not hold (CI failed exactly so at 21:27:55 on
    // 2026-09-09, about once in six hundred runs).
    const trail = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'drive_estimate' " +
        "and (new_values - array['created_at', 'updated_at', 'fetched_at'])::text like '%55.2%'",
    );
    expect(trail.rows[0]?.n).toBe('0');
  });
});

describe("the day's drives, asked for by the hour", () => {
  /**
   * The one place in this file where the real implementation is used, and it
   * reaches nothing: a fake `fetch` collects what would have been sent
   * (docs/SEAMS.md, and the same rule as
   * app/api/_middleware/routing/seam.test.ts — **no test calls Google**).
   *
   * What is proved: a compute-route-matrix request carries a single departure
   * time, so the route asks once per hour bucket rather than once for the day.
   * Asked in one call, an afternoon drive was priced with the morning's
   * traffic and then written to the cache under the afternoon's own hour — a
   * wrong figure, kept for thirty days.
   */
  const FAKE_KEY = 'not-a-real-key-0000000000000000';

  type MatrixCall = { departureTime: string | undefined; origins: number };

  function googleApi(calls: MatrixCall[]): ReturnType<typeof createApi> {
    const fetchImpl = ((_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        departureTime?: string;
        origins: unknown[];
      };
      calls.push({ departureTime: body.departureTime, origins: body.origins.length });
      return Promise.resolve(
        Response.json(
          body.origins.map((_origin, index) => ({
            originIndex: index,
            destinationIndex: index,
            duration: '900s',
            distanceMeters: 9000,
          })),
        ),
      );
    }) as unknown as typeof fetch;
    return createApi({
      pool,
      verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
      storage: localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 5) }),
      routing: googleRouting({ apiKey: FAKE_KEY, timeZone: 'Asia/Dubai', fetchImpl }),
    });
  }

  it('asks once per hour bucket, each with its own departure', async () => {
    const visit = await seedVisit('20', { hour: '19' });
    // A day a week out, so every departure is still to come and the request
    // carries one rather than being asked about a drive already made.
    const date = daysOn(today, 7);

    // Three stops, four hours apart: two legs, leaving in two different hours.
    for (const [index, hour] of ['08', '12', '16'].entries()) {
      const clientId = id('20', 60 + index);
      const locationId = id('20', 70 + index);
      await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, `Ridge${index}`);
      await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
      await owner.query(
        'update location set entrance_point = ' +
          `extensions.st_geogfromtext('SRID=4326;POINT(55.${40 + index} 25.${30 + index})') ` +
          'where id = $1',
        [locationId],
      );
      await seedAppointment(owner, {
        id: id('20', 80 + index),
        tenantId: IDS.tenantA,
        clientId,
        practitionerId: visit.practitionerId,
        serviceTypeId: SERVICE_TYPE,
        locationId,
        windowStart: `${date}T${hour}:00:00+04:00`,
        status: 'confirmed',
      });
    }

    const calls: MatrixCall[] = [];
    const api = googleApi(calls);
    const res = await api.request(`/api/routing/day?date=${date}`, {
      headers: { authorization: `Bearer ${await mint(visit.authSub)}` },
    });
    expect(res.status).toBe(200);
    const day = (await res.json()) as RoutingDayResponse;
    expect(day.legs).toHaveLength(2);
    expect(day.legs.every((leg) => leg.source === 'traffic')).toBe(true);

    // One call per hour bucket, each carrying that hour's own leg and its own
    // departure — not one call for the day under the first leg's hour.
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.origins)).toEqual([1, 1]);
    const departures = calls.map((call) => call.departureTime);
    expect(departures.every((departure) => typeof departure === 'string')).toBe(true);
    expect(new Set(departures).size).toBe(2);

    // And each figure is cached under the hour it was actually asked about.
    const cached = await owner.query<{ hour_bucket: number }>(
      'select hour_bucket from drive_estimate where from_location_id = any($1::uuid[]) ' +
        'order by hour_bucket',
      [[id('20', 70), id('20', 71)]],
    );
    expect(cached.rows.map((row) => row.hour_bucket)).toHaveLength(2);
    expect(new Set(cached.rows.map((row) => row.hour_bucket)).size).toBe(2);
  });
});

describe('the events route and the store', () => {
  it('refuses a photo_captured event even where the store could hold the bytes', async () => {
    // This file's API is built with a real document store, which is what once
    // made the difference: the event was taken here and refused where there
    // was nowhere to put a picture. Since 2026-09-09 the store is beside the
    // point — the practice takes no photographs, and a deployment that could
    // hold one still has nothing to hold, because nothing may make one.
    const visit = await seedVisit('16', { photoConsent: true, hour: '13' });
    const body = (await (await flushPhotoEvent(visit, PICTURE)).json()) as EventsResponse;
    expect(body.refused).toEqual([
      { id: body.refused[0]!.id, reason: 'consent_missing_photo_video' },
    ]);
    expect(body.acknowledged).toHaveLength(0);
  });
});
