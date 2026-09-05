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
const OTHER_PICTURE = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 1]);
const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let today: string;
let dir: string;

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

/** The photograph's own door, exactly as the device calls it. */
async function putPhoto(
  sessionId: string,
  authSub: string,
  bytes: Uint8Array,
  options: { digest?: string; type?: string } = {},
): Promise<Response> {
  return api.request(`/api/sessions/${sessionId}/photo`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': options.type ?? 'image/jpeg',
      'x-photo-sha256': options.digest ?? digestOf(bytes),
    },
    // `BodyInit` is typed from the DOM lib, which does not know a Uint8Array
    // over a plain ArrayBuffer is one. It is, and the runtime takes it.
    body: bytes as unknown as BodyInit,
  });
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

describe('filing the setup photograph', () => {
  it('files the row, the bytes and the link, and audits it with the document id alone', async () => {
    const visit = await seedVisit('01', { photoConsent: true });
    expect((await flushPhotoEvent(visit, PICTURE)).status).toBe(200);

    const res = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(res.status).toBe(201);
    const filed = (await res.json()) as { status: string; documentId: string };
    expect(filed.status).toBe('filed');

    const document = await owner.query<{
      kind: string;
      client_id: string;
      sha256: Buffer;
      storage_key: string;
      is_immutable: boolean;
    }>('select kind, client_id, sha256, storage_key, is_immutable from document where id = $1', [
      filed.documentId,
    ]);
    expect(document.rows[0]?.kind).toBe('setup_photo');
    expect(document.rows[0]?.client_id).toBe(visit.clientId);
    expect(document.rows[0]?.sha256.toString('hex')).toBe(digestOf(PICTURE));
    expect(document.rows[0]?.is_immutable).toBe(true);
    // A key of ids alone: no session id, no record number, nothing that says
    // whose file it is (docs/SEAMS.md).
    expect(document.rows[0]?.storage_key).toBe(
      `tenant/${IDS.tenantA}/client/${visit.clientId}/${filed.documentId}`,
    );

    const session = await owner.query<{ linked: string | null }>(
      'select setup_photo_document_id as linked from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]?.linked).toBe(filed.documentId);

    const trail = await owner.query<{ new_values: { documentId?: string } | null }>(
      "select new_values from audit_log where action = 'session.photo_filed' and entity_id = $1",
      [visit.sessionId],
    );
    expect(trail.rows).toHaveLength(1);
    expect(trail.rows[0]?.new_values).toEqual({ documentId: filed.documentId });
  });

  it('is idempotent on the same digest and refuses a different one', async () => {
    const visit = await seedVisit('02', { photoConsent: true });
    await flushPhotoEvent(visit, PICTURE);
    const first = (await (await putPhoto(visit.sessionId, visit.authSub, PICTURE)).json()) as {
      documentId: string;
    };

    const again = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'filed', documentId: first.documentId });

    // A filed evidence document is never replaced (docs/SEAMS.md).
    const other = await putPhoto(visit.sessionId, visit.authSub, OTHER_PICTURE);
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ detail: 'document_exists' });
  });

  it('waits for the event that names the digest, and drops a superseded one', async () => {
    const visit = await seedVisit('03', { photoConsent: true });

    // No event yet: retryable, and the device asks again after its next flush.
    const pending = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ detail: 'photo_event_pending' });

    // The event names a different picture: this one has been retaken.
    await flushPhotoEvent(visit, OTHER_PICTURE);
    const superseded = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(superseded.status).toBe(409);
    expect(await superseded.json()).toMatchObject({ detail: 'photo_superseded' });
  });

  it('refuses bytes that do not match the digest the device declared', async () => {
    const visit = await seedVisit('04', { photoConsent: true });
    await flushPhotoEvent(visit, PICTURE);
    const res = await putPhoto(visit.sessionId, visit.authSub, OTHER_PICTURE, {
      digest: digestOf(PICTURE),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ detail: 'digest_mismatch' });
  });

  it('refuses a household that has not agreed, and audits the refusal', async () => {
    const visit = await seedVisit('05');
    // The event itself is refused for the same reason, so the picture reaches
    // the door with nothing naming it. Consent is still the first question
    // asked, so the answer is the consent's own and not "the event has not
    // arrived yet" (spec section 4.3, section 13's forged PUT).
    await flushPhotoEvent(visit, PICTURE);
    const res = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ detail: 'consent_missing_photo_video' });

    const refusal = await owner.query<{ reason: string | null; client_id: string | null }>(
      "select reason, client_id from audit_log where action = 'refused' " +
        "and entity_type = 'session' and entity_id = $1",
      [visit.sessionId],
    );
    expect(refusal.rows).toHaveLength(1);
    expect(refusal.rows[0]?.reason).toBe('consent_missing_photo_video');
    expect(refusal.rows[0]?.client_id).toBe(visit.clientId);

    const documents = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'setup_photo' and client_id = $1",
      [visit.clientId],
    );
    expect(documents.rows[0]?.n).toBe('0');
  });

  it("refuses another practitioner's visit, without confirming it exists", async () => {
    const mine = await seedVisit('06', { photoConsent: true, hour: '10' });
    const theirs = await seedVisit('07', { photoConsent: true, hour: '12' });
    await flushPhotoEvent(theirs, PICTURE);
    const res = await putPhoto(theirs.sessionId, mine.authSub, PICTURE);
    // A flat 404, not a 403: db/policies/session/practitioner_scope.sql shows
    // a practitioner only their own visits, so somebody else's is simply not
    // there — and an answer that said "forbidden" would confirm the id names a
    // real visit.
    expect(res.status).toBe(404);

    const documents = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'setup_photo' and client_id = $1",
      [theirs.clientId],
    );
    expect(documents.rows[0]?.n).toBe('0');
  });

  it('refuses anything that is not one of the three image types', async () => {
    const visit = await seedVisit('08', { photoConsent: true, hour: '14' });
    await flushPhotoEvent(visit, PICTURE);
    const res = await putPhoto(visit.sessionId, visit.authSub, PICTURE, {
      type: 'application/pdf',
    });
    expect(res.status).toBe(415);
  });

  it('files after the visit has closed, which is when an offline day delivers', async () => {
    const visit = await seedVisit('09', { photoConsent: true, hour: '16' });
    await flushPhotoEvent(visit, PICTURE);
    // Close the visit as the practitioner's own device would, with the
    // check-out already in.
    await post(`/api/sessions/${visit.sessionId}/events`, visit.authSub, {
      events: [
        {
          id: id(visit.scenario, 40),
          seq: 40,
          kind: 'checked_out',
          deviceAt: new Date().toISOString(),
          payload: {},
        },
      ],
    });
    const closed = await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, {
      visitActuals: {
        driveSeconds: null,
        walkSeconds: null,
        salikCrossings: 0,
        parkingCostFils: 0,
        accessIssues: null,
      },
    });
    expect(closed.status).toBe(200);

    const res = await putPhoto(visit.sessionId, visit.authSub, PICTURE);
    expect(res.status).toBe(201);
    const filed = (await res.json()) as { documentId: string };
    const session = await owner.query<{ linked: string | null }>(
      'select setup_photo_document_id as linked from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]?.linked).toBe(filed.documentId);
  });
});

describe('the link to a previous placement', () => {
  it('signs a short-lived link and writes the read to the trail first', async () => {
    const visit = await seedVisit('10', { photoConsent: true, hour: '18' });
    await flushPhotoEvent(visit, PICTURE);
    const filed = (await (await putPhoto(visit.sessionId, visit.authSub, PICTURE)).json()) as {
      documentId: string;
    };

    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_id = $1",
      [filed.documentId],
    );
    const res = await get(`/api/sessions/photo/${filed.documentId}/link`, visit.authSub);
    expect(res.status).toBe(200);
    const link = (await res.json()) as { url: string; expiresInSeconds: number };
    expect(link.expiresInSeconds).toBeGreaterThan(0);
    // The local implementation serves its own bytes, and they are the ones
    // filed.
    const bytes = await api.request(link.url);
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PICTURE);

    const after = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_id = $1",
      [filed.documentId],
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);
  });

  it('answers a document that is not a setup photo with a flat not-found', async () => {
    const visit = await seedVisit('11', { hour: '20' });
    // The consent wording is a real document this caller could otherwise read.
    const res = await get(`/api/sessions/photo/${WORDING}/link`, visit.authSub);
    expect(res.status).toBe(404);
  });
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
    const tomorrow = new Date(`${today}T00:00:00+04:00`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 8);
    const res = await get(
      `/api/routing/day?date=${tomorrow.toISOString().slice(0, 10)}`,
      visit.authSub,
    );
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
    const trail = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'drive_estimate' " +
        "and new_values::text like '%55.2%'",
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
    const marker = new Date(`${today}T12:00:00Z`);
    marker.setUTCDate(marker.getUTCDate() + 7);
    const date = marker.toISOString().slice(0, 10);

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
  it('takes a photo_captured event now that there is somewhere to put the bytes', async () => {
    const visit = await seedVisit('16', { photoConsent: true, hour: '13' });
    const body = (await (await flushPhotoEvent(visit, PICTURE)).json()) as EventsResponse;
    expect(body.refused).toEqual([]);
    expect(body.acknowledged).toHaveLength(1);
  });
});
