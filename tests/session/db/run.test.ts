import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type {
  CloseResponse,
  EventsResponse,
  OpenSessionResponse,
} from '../../../app/api/sessions/schema';
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
 * The visit after the door: appending events, resuming, and closing
 * (docs/SPEC/session-capture.md sections 2, 3 and 4).
 *
 * Everything here is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md): ids of the shape 00000000-0000-4000-8000-*,
 * family names from db/seed/names.ts, never a real person.
 *
 * The clock is the real one rather than a fixture: app.checkin_context reads
 * the database's own now() to find today's booked visit, so a device time
 * near the real now is the only pair of clocks that agree.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f1';
/**
 * The coordinate a practitioner shares at the door, when they share one.
 * A point in the middle of Dubai and nobody's address: what matters about it
 * here is only that it is recorded, and then that it is nowhere in the audit
 * trail.
 */
const DOOR = { lat: 25.2, lng: 55.27 };
const DOCUMENT = '00000000-0000-4000-8000-000000003001';
const SHA = 'c'.repeat(64);
/** Family names from db/seed/names.ts, one per scenario. */
const FAMILY_NAMES = [
  'Bay',
  'Cliff',
  'Creek',
  'Dune',
  'Harbour',
  'Lagoon',
  'Meadow',
  'Orchard',
  'Quarry',
];

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let today: string;

/**
 * A synthetic id in the reserved range, keyed by scenario and slot. The
 * scenario is a two-digit number, so each test's fixtures are visibly its
 * own and no two collide — and the record number seedClient derives from a
 * client id (`MW-` plus its last six characters) stays all digits.
 */
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

type Visit = {
  scenario: string;
  authSub: string;
  practitionerId: string;
  clientId: string;
  sessionId: string;
  appointmentId: string;
};

/**
 * One whole fixture: a credentialed practitioner, a consenting adult client,
 * a booked visit today, and the check-in that opens the session. Each
 * scenario gets its own practitioner because 300's
 * session_one_open_per_practitioner allows exactly one open visit at a time —
 * which is the point of that index, and makes independent tests the natural
 * shape rather than a workaround.
 */
async function seedVisit(
  scenario: string,
  options: { photoConsent?: boolean; sharePoint?: boolean } = {},
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
  // health_data since 2026-09-09: the check-in door reads it, so a visit
  // cannot be opened without it (db/migrations/961_checkin_reads_health_data.sql).
  const purposes: Array<'participation' | 'home_visit' | 'health_data'> = [
    'participation',
    'home_visit',
    'health_data',
  ];
  for (const [index, purpose] of purposes.entries()) {
    await seedConsent(owner, {
      id: id(scenario, 10 + index),
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      // seedConsent's own union covers the three the check-in gate reads;
      // photo_video is the fourth purpose this module needs and the column
      // takes it, so it is written through the same helper.
      purpose: purpose as 'participation',
      textDocumentId: DOCUMENT,
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
    windowStart: `${today}T08:00:00+04:00`,
    // 'confirmed', not the helper's default 'proposed': migration 201's
    // window opens on a confirmed appointment, and that is what lets the
    // practitioner read the client's own name for the resume offer.
    status: 'confirmed',
  });

  const sessionId = id(scenario, 20);
  const res = await post(`/api/sessions/${sessionId}/events`, authSub, {
    clientId,
    point: options.sharePoint ? DOOR : null,
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

  return { scenario, authSub, practitionerId, clientId, sessionId, appointmentId };
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

type WireEvent = { id: string; seq: number; kind: string; deviceAt: string; payload: unknown };

function flush(
  visit: Visit,
  events: WireEvent[],
  point?: { lat: number; lng: number },
): Promise<Response> {
  // The check-out coordinate rides beside the batch, never inside an event
  // (domain/session/events.ts): session-level, exactly as check-in's own is.
  return post(
    `/api/sessions/${visit.sessionId}/events`,
    visit.authSub,
    point === undefined ? { events } : { events, point },
  );
}

/**
 * The events of a whole visit, ready to post in any order.
 *
 * Every device time is *after* the check-in, which is what a real visit
 * looks like and what the route's own clock window requires: an event
 * claiming to predate the door by more than a quarter of an hour is a device
 * with a wrong clock, not a visit. The offsets are seconds rather than the
 * real forty minutes so the fixture stays inside that window on both sides.
 */
function wholeVisit(visit: Visit, options: { photo?: boolean } = {}): WireEvent[] {
  const at = (secondsAfterCheckIn: number) =>
    new Date(Date.now() + secondsAfterCheckIn * 1000).toISOString();
  const events: WireEvent[] = [
    {
      id: id(visit.scenario, 31),
      seq: 2,
      kind: 'observation_recorded',
      deviceAt: at(1),
      payload: { topic: 'preflight', items: [{ key: 'identity_confirmed', done: true }] },
    },
    {
      id: id(visit.scenario, 32),
      seq: 3,
      kind: 'rating_recorded',
      deviceAt: at(2),
      payload: { phase: 'pre', answers: [{ key: 'sleep', value: 5 }] },
    },
    {
      id: id(visit.scenario, 33),
      seq: 4,
      kind: 'signal_checked',
      deviceAt: at(3),
      payload: { sites: [{ site: 'Cz', quality: 0.9 }], overridden: false },
    },
    {
      id: id(visit.scenario, 34),
      seq: 5,
      kind: 'telemetry_chunk',
      deviceAt: at(5),
      payload: { seconds: 60, artefactPercent: 20, timeInRewardPercent: 50 },
    },
    {
      id: id(visit.scenario, 35),
      seq: 6,
      kind: 'session_ended',
      deviceAt: at(9),
      payload: { startedAt: at(4) },
    },
    {
      id: id(visit.scenario, 36),
      seq: 7,
      kind: 'rating_recorded',
      deviceAt: at(10),
      payload: { phase: 'post', answers: [{ key: 'sleep', value: 8 }] },
    },
    {
      id: id(visit.scenario, 37),
      seq: 8,
      kind: 'observation_recorded',
      deviceAt: at(11),
      payload: { topic: 'post', chips: ['fatigue'], tolerance: 8, engagement: 7, note: null },
    },
  ];
  if (options.photo) {
    events.push({
      id: id(visit.scenario, 38),
      seq: 9,
      kind: 'photo_captured',
      deviceAt: at(12),
      payload: { mimeType: 'image/jpeg', sizeBytes: 200_000, sha256: SHA },
    });
  }
  events.push({
    id: id(visit.scenario, 39),
    seq: 10,
    kind: 'checked_out',
    deviceAt: at(13),
    // Nothing at all: CheckedOutPayload holds no coordinate, by design.
    payload: {},
  });
  return events;
}

const NO_ACTUALS = {
  visitActuals: { salikCrossings: 0, parkingCostFils: 0 },
};

/**
 * A practitioner of another practice entirely: same shape, same roles, same
 * everything but the tenant. Nothing of tenant A is theirs to touch, and the
 * three routes below are asked to say so.
 */
const FOREIGN_USER = '00000000-0000-4000-8000-000000990001';
const FOREIGN_AUTH = '00000000-0000-4000-8000-000000990002';
const FOREIGN_PRACTITIONER = '00000000-0000-4000-8000-000000990003';

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedUser(owner, {
    id: FOREIGN_USER,
    tenantId: IDS.tenantB,
    authId: FOREIGN_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantB, FOREIGN_PRACTITIONER, FOREIGN_USER);
  await seedConsentDocument(owner, IDS.tenantA, DOCUMENT);
  const dates = await owner.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  today = dates.rows[0]!.today;

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

describe('appending events to an open visit', () => {
  it('is idempotent on the event id: the same flush twice stores one row', async () => {
    const visit = await seedVisit('01');
    const events = wholeVisit(visit).slice(0, 3);

    const first = (await (await flush(visit, events)).json()) as EventsResponse;
    expect(first.acknowledged).toHaveLength(3);
    expect(first.refused).toEqual([]);

    const again = (await (await flush(visit, events)).json()) as EventsResponse;
    expect(again.acknowledged).toHaveLength(3);
    expect(again.refused).toEqual([]);

    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from session_event where session_id = $1',
      [visit.sessionId],
    );
    // Three appended plus the one that opened the visit.
    expect(rows[0]!.n).toBe('4');
  });

  it('projects the same visit however the batches arrive', async () => {
    const visit = await seedVisit('02');
    const events = wholeVisit(visit);
    // Backwards, in three pieces, with the middle piece sent twice.
    await flush(visit, events.slice(5));
    await flush(visit, events.slice(2, 5));
    await flush(visit, events.slice(2, 5));
    const last = (await (await flush(visit, events.slice(0, 2))).json()) as EventsResponse;

    expect(last.session.phase).toBe('checked_out');
    expect(last.session.lastSeq).toBe(10);
    const { rows } = await owner.query<{
      pre_rating: unknown;
      post_rating: unknown;
      observation_flag: boolean;
      signal_quality_score: string;
    }>(
      'select pre_rating, post_rating, observation_flag, signal_quality_score from session where id = $1',
      [visit.sessionId],
    );
    expect(rows[0]!.pre_rating).toEqual([{ key: 'sleep', value: 5 }]);
    expect(rows[0]!.post_rating).toEqual([{ key: 'sleep', value: 8 }]);
    expect(rows[0]!.observation_flag).toBe(true);
    // 80% clean x 50% in reward.
    expect(Number(rows[0]!.signal_quality_score)).toBe(0.4);
  });

  it('refuses a second event claiming a position the visit already has', async () => {
    const visit = await seedVisit('03');
    const [first] = wholeVisit(visit);
    await flush(visit, [first!]);

    const clash = { ...first!, id: id('03', 99) };
    const body = (await (await flush(visit, [clash])).json()) as EventsResponse;
    expect(body.acknowledged).toEqual([]);
    expect(body.refused).toEqual([{ id: id('03', 99), reason: 'duplicate_seq' }]);
  });

  it('refuses an event from a device whose clock is hours ahead of the practice', async () => {
    const visit = await seedVisit('04');
    const [first] = wholeVisit(visit);
    const ahead = { ...first!, deviceAt: new Date(Date.now() + 3 * 3600_000).toISOString() };
    const body = (await (await flush(visit, [ahead])).json()) as EventsResponse;
    expect(body.refused).toEqual([{ id: first!.id, reason: 'device_clock_out_of_range' }]);
  });

  it('refuses a setup photo for a client with no photo consent, and says why', async () => {
    const visit = await seedVisit('05');
    const photo: WireEvent = {
      id: id('05', 40),
      seq: 2,
      kind: 'photo_captured',
      deviceAt: new Date().toISOString(),
      payload: { mimeType: 'image/jpeg', sizeBytes: 1000, sha256: SHA },
    };
    const body = (await (await flush(visit, [photo])).json()) as EventsResponse;
    expect(body.refused).toEqual([{ id: photo.id, reason: 'consent_missing_photo_video' }]);

    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and reason = 'consent_missing_photo_video'",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it('shows a practitioner nothing of another practitioner visit', async () => {
    const mine = await seedVisit('06');
    const theirs = await seedVisit('07');
    const [first] = wholeVisit(theirs);
    const res = await post(`/api/sessions/${mine.sessionId}/events`, theirs.authSub, {
      events: [first!],
    });
    // 404, not 403: db/policies/session/practitioner_scope.sql hides another
    // practitioner's visit outright, so "not yours" and "no such visit" are
    // the same answer — and the one that reveals less is the right one.
    expect(res.status).toBe(404);

    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from session_event where session_id = $1',
      [mine.sessionId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('resuming a visit', () => {
  it('offers the visit the practitioner left open, by name and by number', async () => {
    const visit = await seedVisit('08');
    await flush(visit, wholeVisit(visit).slice(0, 2));

    const body = (await (
      await get('/api/sessions/open', visit.authSub)
    ).json()) as OpenSessionResponse;
    expect(body.session).not.toBeNull();
    expect(body.session).toMatchObject({
      id: visit.sessionId,
      clientGivenName: 'Synthetic',
      clientFamilyInitial: 'O',
      serviceName: 'nf-session',
      phase: 'in_progress',
      number: 1,
      of: null,
      lastSeq: 3,
    });
  });

  it('offers nothing to a practitioner with no visit open', async () => {
    const other = await seedVisit('09');
    // Close it, then ask again: the offer is about an open visit, not any visit.
    await flush(other, wholeVisit(other));
    expect(
      (await post(`/api/sessions/${other.sessionId}/close`, other.authSub, NO_ACTUALS)).status,
    ).toBe(200);

    const body = (await (
      await get('/api/sessions/open', other.authSub)
    ).json()) as OpenSessionResponse;
    expect(body.session).toBeNull();
  });
});

describe('closing a visit', () => {
  it('refuses to close a visit the practitioner has not checked out of', async () => {
    const visit = await seedVisit('10');
    await flush(visit, wholeVisit(visit).slice(0, 4));

    const res = await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS);
    expect(res.status).toBe(409);
    expect((await res.json()) as { detail: string }).toMatchObject({ detail: 'not_checked_out' });

    const { rows } = await owner.query<{ status: string }>(
      'select status from session where id = $1',
      [visit.sessionId],
    );
    expect(rows[0]!.status).toBe('in_progress');
  });

  it('closes the visit, the appointment and the visit actuals in one transaction', async () => {
    const visit = await seedVisit('11');
    await flush(visit, wholeVisit(visit));

    const res = await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, {
      visitActuals: {
        driveSeconds: 1500,
        walkSeconds: 120,
        salikCrossings: 2,
        parkingCostFils: 1500,
        accessIssues: 'The gate barrier needs a code from the guard house.',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CloseResponse;
    expect(body).toMatchObject({
      status: 'closed',
      sessionId: visit.sessionId,
      signalQualityScore: 0.4,
      observationFlag: true,
      setupPhotoDocumentId: null,
    });
    expect(body.durationSeconds).toBe(5);

    const session = await owner.query<{
      status: string;
      closed_at: Date | null;
      closed_by: string | null;
      signal_quality_score: string | null;
    }>('select status, closed_at, closed_by, signal_quality_score from session where id = $1', [
      visit.sessionId,
    ]);
    expect(session.rows[0]).toMatchObject({ status: 'completed' });
    expect(session.rows[0]!.closed_at).not.toBeNull();
    expect(Number(session.rows[0]!.signal_quality_score)).toBe(0.4);

    const appointment = await owner.query<{ status: string }>(
      'select status from appointment where id = $1',
      [visit.appointmentId],
    );
    expect(appointment.rows[0]!.status).toBe('completed');

    const actuals = await owner.query<{
      actual_drive_seconds: number;
      salik_crossings: number;
      parking_cost_fils: number;
      access_issues: string;
      client_id: string;
    }>(
      'select actual_drive_seconds, salik_crossings, parking_cost_fils, access_issues, client_id ' +
        'from visit_actuals where session_id = $1',
      [visit.sessionId],
    );
    expect(actuals.rows[0]).toMatchObject({
      actual_drive_seconds: 1500,
      salik_crossings: 2,
      parking_cost_fils: 1500,
      client_id: visit.clientId,
    });

    // Section 8: the close is a sensitive action, logged by name and carrying
    // the request that made it.
    const audit = await owner.query<{ n: string; with_request: string }>(
      'select count(*)::text as n, count(request_id)::text as with_request from audit_log ' +
        "where action = 'session_closed' and entity_id = $1 and client_id = $2",
      [visit.sessionId, visit.clientId],
    );
    expect(audit.rows[0]).toMatchObject({ n: '1', with_request: '1' });
  });

  it('answers a repeated close with the close that already happened', async () => {
    const visit = await seedVisit('12');
    await flush(visit, wholeVisit(visit));

    const first = (await (
      await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS)
    ).json()) as CloseResponse;
    const again = await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS);
    expect(again.status).toBe(200);
    expect(((await again.json()) as CloseResponse).closedAt).toBe(first.closedAt);

    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'session_closed' and entity_id = $1",
      [visit.sessionId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('accepts no further events once the visit is closed', async () => {
    const visit = await seedVisit('13');
    const events = wholeVisit(visit);
    await flush(visit, events);
    await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS);

    const late: WireEvent = {
      id: id('13', 50),
      seq: 11,
      kind: 'telemetry_chunk',
      deviceAt: new Date().toISOString(),
      payload: { seconds: 60, artefactPercent: 0, timeInRewardPercent: 100 },
    };
    const res = await flush(visit, [late]);
    expect(res.status).toBe(409);
    expect((await res.json()) as { detail: string }).toMatchObject({ detail: 'session_closed' });
  });

  it('refuses to change a closed visit at the database, not merely at the route', async () => {
    const visit = await seedVisit('14');
    await flush(visit, wholeVisit(visit));
    await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS);

    // As the owner of the database, with every privilege there is: the guard
    // in 302 is a trigger that raises, not a policy that hides.
    await expect(
      owner.query("update session set observations = '{}'::jsonb where id = $1", [visit.sessionId]),
    ).rejects.toMatchObject({ code: '23001' });

    // And an event appended behind the route's back is refused too.
    await expect(
      owner.query(
        'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
          "kind, payload, device_at) values ($1, $2, $3, $4, $5, 99, 'telemetry_chunk', '{}'::jsonb, now())",
        [id('14', 51), IDS.tenantA, visit.sessionId, visit.clientId, visit.practitionerId],
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('lets a write that would change nothing alone, rather than refusing it', async () => {
    const visit = await seedVisit('25');
    await flush(visit, wholeVisit(visit));
    await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS);

    const before = await owner.query<{ updated_at: Date; closed_at: Date }>(
      'select updated_at, closed_at from session where id = $1',
      [visit.sessionId],
    );

    // A device that was offline through the close replays its outbox, and
    // billing's trigger sits on this exact statement (404). It alters
    // nothing, so it is neither an amendment to refuse nor a change to
    // apply: no rows, and the frozen record untouched.
    const replay = await owner.query("update session set status = 'completed' where id = $1", [
      visit.sessionId,
    ]);
    expect(replay.rowCount).toBe(0);

    const after = await owner.query<{ updated_at: Date; closed_at: Date }>(
      'select updated_at, closed_at from session where id = $1',
      [visit.sessionId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // And a real change is still refused, so the exemption is for no-ops only.
    await expect(
      owner.query("update session set status = 'aborted' where id = $1", [visit.sessionId]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('carries a close with the completion, for a writer who names no closed_at', async () => {
    const visit = await seedVisit('26');
    await flush(visit, wholeVisit(visit));

    // The contract with billing (404_billing_consumption.sql): completing a
    // visit is a plain status update on this stream's own table, and every
    // column the close needs is this stream's to fill in.
    await owner.query("update session set status = 'completed' where id = $1", [visit.sessionId]);

    const { rows } = await owner.query<{
      status: string;
      closed_at: Date | null;
      closed_by: string | null;
    }>('select status, closed_at, closed_by from session where id = $1', [visit.sessionId]);
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.closed_at).not.toBeNull();
    // Nobody was named, so nobody is recorded. The audit row has the actor.
    expect(rows[0]!.closed_by).toBeNull();

    // Stamped, therefore frozen: the transition is the close.
    await expect(
      owner.query("update session set observations = '{}'::jsonb where id = $1", [visit.sessionId]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('refuses a photo_captured event outright, and files no document', async () => {
    // Not consent, and not the store. The practice takes no photographs since
    // its legal advisor's recommendation of 2026-09-09, so every one of these
    // events is refused whatever the household agreed to and whatever the
    // deployment could store: there is no route to send the bytes through and
    // no function left to file them. A device still holding one in its outbox
    // is told to stop asking, and everything else in the same batch lands.
    const visit = await seedVisit('15');
    const flushed = (await (
      await flush(visit, wholeVisit(visit, { photo: true }))
    ).json()) as EventsResponse;

    expect(flushed.refused).toEqual([{ id: id('15', 38), reason: 'consent_missing_photo_video' }]);
    expect(flushed.acknowledged).toHaveLength(8);

    const body = (await (
      await post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS)
    ).json()) as CloseResponse;
    expect(body.setupPhotoDocumentId).toBeNull();

    const documents = await owner.query<{ n: string }>(
      "select count(*)::text as n from document where kind = 'setup_photo' and client_id = $1",
      [visit.clientId],
    );
    expect(documents.rows[0]!.n).toBe('0');
  });

  it('refuses a close for an id that is not a visit, without poisoning its own refusal', async () => {
    const visit = await seedVisit('17');

    // audit_log.entity_id is a uuid column. An unvalidated ':id' reached
    // logRefusal, failed on that type, aborted the request's transaction and
    // took the refusal it was meant to record down with it — so the one
    // record of a bad request was the one thing the bad request destroyed.
    const res = await post('/api/sessions/not-a-uuid/close', visit.authSub, NO_ACTUALS);
    expect(res.status).toBe(400);

    // The visit it was not about is untouched, and the transaction that
    // refused is still a transaction that could have written.
    const { rows } = await owner.query<{ status: string }>(
      'select status from session where id = $1',
      [visit.sessionId],
    );
    expect(rows[0]!.status).toBe('in_progress');
  });

  it('writes one close when two devices ask at the same moment', async () => {
    const visit = await seedVisit('18');
    await flush(visit, wholeVisit(visit));

    // Both requests read an open visit; only one may update a row. Without
    // `closed_at is null` in the predicate and a rowCount check on the
    // answer, the loser wrote a second session_closed audit row and returned
    // a close time it had invented.
    const [a, b] = await Promise.all([
      post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS),
      post(`/api/sessions/${visit.sessionId}/close`, visit.authSub, NO_ACTUALS),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const first = (await a.json()) as CloseResponse;
    const second = (await b.json()) as CloseResponse;
    expect(second.closedAt).toBe(first.closedAt);
    expect(second.signalQualityScore).toBe(first.signalQualityScore);

    const audit = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'session_closed' and entity_id = $1",
      [visit.sessionId],
    );
    expect(audit.rows[0]!.n).toBe('1');

    const actuals = await owner.query<{ n: string }>(
      'select count(*)::text as n from visit_actuals where session_id = $1',
      [visit.sessionId],
    );
    expect(actuals.rows[0]!.n).toBe('1');
  });

  it('never lets a second device open a visit while one is already open', async () => {
    const visit = await seedVisit('16');
    // The same practitioner, a fresh session id, a fresh event id: exactly
    // what a second phone would send (section 2, section 10).
    const res = await post(`/api/sessions/${id('16', 60)}/events`, visit.authSub, {
      clientId: visit.clientId,
      point: null,
      events: [
        {
          id: id('16', 61),
          seq: 1,
          kind: 'session_started',
          deviceAt: new Date().toISOString(),
          payload: { serviceTypeId: SERVICE_TYPE, deliveryMode: 'home', locationId: null },
        },
      ],
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { reasons: string[] }).toMatchObject({
      reasons: ['already_checked_in'],
    });
  });
});

describe('the coordinate at the door', () => {
  it('records the check-out point on the session, and nowhere the audit trail can keep it', async () => {
    const visit = await seedVisit('19', { sharePoint: true });
    const flushed = (await (await flush(visit, wholeVisit(visit), DOOR)).json()) as EventsResponse;
    expect(flushed.refused).toEqual([]);

    const session = await owner.query<{ in_point: boolean; out_point: boolean }>(
      'select checked_in_point is not null as in_point, ' +
        'checked_out_point is not null as out_point from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]).toEqual({ in_point: true, out_point: true });

    // Not inside an event. The stream is the source of truth and it is
    // append-only: a coordinate written there could never be taken out again,
    // and 080_audit_triggers.sql copies a payload into the trail wholesale.
    const events = await owner.query<{ n: string }>(
      "select count(*)::text as n from session_event where session_id = $1 and payload ? 'point'",
      [visit.sessionId],
    );
    expect(events.rows[0]!.n).toBe('0');

    // And nowhere in the trail itself, at any depth: migration 904 drops
    // checked_in_point and checked_out_point outright and strips a `point`
    // key from inside any jsonb object it copies. Section 7 is explicit that
    // the door coordinate is never copied into the audit trail; this is the
    // assertion that it is not. Asked as keys rather than as text, because
    // `appointment_id` contains the letters of `point` and a substring
    // search would have called this passing when it was not looking.
    const trail = await owner.query<{ n: string; offending: string }>(
      'select count(*)::text as n, ' +
        'count(*) filter (where new_values ?| $2 or old_values ?| $2 ' +
        "or jsonb_path_exists(coalesce(new_values, '{}'::jsonb), '$.**.point') " +
        "or jsonb_path_exists(coalesce(old_values, '{}'::jsonb), '$.**.point'))::text " +
        'as offending ' +
        'from audit_log where entity_id = $1 ' +
        'or entity_id in (select id from session_event where session_id = $1)',
      [visit.sessionId, ['point', 'location_point', 'checked_in_point', 'checked_out_point']],
    );
    expect(Number(trail.rows[0]!.n)).toBeGreaterThan(0);
    expect(trail.rows[0]!.offending).toBe('0');
  });

  it('strips a coordinate out of an event payload even if one somehow reaches the table', async () => {
    // The route cannot write this — CheckedOutPayload has no room for a
    // coordinate and zod strips what it does not declare — so this goes in
    // as the owner, behind the route's back, to prove the second guard
    // rather than only the first. Migration 904 reaches inside a jsonb
    // object at any depth; before it, a nested `point` was copied into
    // audit_log.new_values in full and kept for five years in an
    // append-only table.
    const visit = await seedVisit('21', { sharePoint: true });
    const eventId = id('21', 70);
    await owner.query(
      'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
        "kind, payload, device_at) values ($1, $2, $3, $4, $5, 2, 'telemetry_chunk', " +
        '$6::jsonb, now())',
      [
        eventId,
        IDS.tenantA,
        visit.sessionId,
        visit.clientId,
        visit.practitionerId,
        JSON.stringify({ seconds: 60, where: { point: DOOR } }),
      ],
    );

    const { rows } = await owner.query<{ new_values: Record<string, unknown> }>(
      'select new_values from audit_log where entity_id = $1',
      [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.new_values).toMatchObject({ payload: { seconds: 60, where: {} } });
  });

  it('refuses a check-out coordinate on a visit nobody shared one for', async () => {
    // The practitioner declined at the door, and a decline is for the visit,
    // not for the moment. Held by the server rather than trusted from the
    // device: a device that sends one anyway is refused by name.
    const visit = await seedVisit('20');
    const flushed = (await (await flush(visit, wholeVisit(visit), DOOR)).json()) as EventsResponse;
    expect(flushed.refused).toEqual([
      { id: id('20', 39), reason: 'location_not_shared_at_check_in' },
    ]);

    const session = await owner.query<{ in_point: boolean; out_point: boolean }>(
      'select checked_in_point is not null as in_point, ' +
        'checked_out_point is not null as out_point from session where id = $1',
      [visit.sessionId],
    );
    expect(session.rows[0]).toEqual({ in_point: false, out_point: false });
  });
});

describe("another practice's visit", () => {
  /**
   * Row security is the boundary and the route is the courtesy, so each of
   * these is asked at the route and answered by what the caller's own tenant
   * can see. A practitioner of another practice holds a perfectly good token
   * and a perfectly good practitioner row; what they do not hold is any of
   * this visit.
   */
  it('is not there to append events to', async () => {
    const visit = await seedVisit('22');
    const res = await post(`/api/sessions/${visit.sessionId}/events`, FOREIGN_AUTH, {
      events: [
        {
          id: id('22', 80),
          seq: 2,
          kind: 'telemetry_chunk',
          deviceAt: new Date().toISOString(),
          payload: { seconds: 60, artefactPercent: 0, timeInRewardPercent: 100 },
        },
      ],
    });
    // Not 403: a visit another practice cannot see is a visit that is not
    // there, and the same generic refusal app.checkin_context gives.
    expect(res.status).toBe(404);

    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from session_event where id = $1',
      [id('22', 80)],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('is not the visit they are offered to resume', async () => {
    await seedVisit('23');
    const body = (await (
      await get('/api/sessions/open', FOREIGN_AUTH)
    ).json()) as OpenSessionResponse;
    expect(body.session).toBeNull();
  });

  it('is not theirs to close', async () => {
    const visit = await seedVisit('24');
    await flush(visit, wholeVisit(visit));

    const res = await post(`/api/sessions/${visit.sessionId}/close`, FOREIGN_AUTH, NO_ACTUALS);
    expect(res.status).toBe(404);

    const { rows } = await owner.query<{ status: string; closed_at: Date | null }>(
      'select status, closed_at from session where id = $1',
      [visit.sessionId],
    );
    expect(rows[0]).toMatchObject({ status: 'in_progress', closed_at: null });
  });
});
