import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountSessions } from '../../../app/api/sessions/checkin';
import type { CheckInResponse } from '../../../app/api/sessions/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedCredential,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import { seedConsent, seedConsentDocument } from './helpers';

// Everything here is synthetic and stays inside the reserved ranges
// (.claude/rules/testing.md): fixed ids of the shape
// 00000000-0000-4000-8000-*, never a real name or number.
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const SERVICE_TYPE = MORE_IDS.serviceTypeA;
const DOCUMENT = '00000000-0000-4000-8000-000000003001';

const CLIENT_ADULT = '00000000-0000-4000-8000-000000001001';
const CLIENT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000001002';
const CLIENT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000001003';
const CLIENT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000001004';
const CLIENT_NULL_DOB = '00000000-0000-4000-8000-000000001005';

const CONTACT_ADULT = '00000000-0000-4000-8000-000000002001';
const CONTACT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000002002';
const CONTACT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000002003';
const CONTACT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000002004';
const CONTACT_NULL_DOB = '00000000-0000-4000-8000-000000002005';

const SESSION_HAPPY = '00000000-0000-4000-8000-000000005001';
const SESSION_NO_PARTICIPATION = '00000000-0000-4000-8000-000000005002';
const SESSION_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000005003';
const SESSION_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000005004';
const SESSION_NULL_DOB = '00000000-0000-4000-8000-000000005005';
const SESSION_CROSS_TENANT = '00000000-0000-4000-8000-000000005006';
const SESSION_SECOND_WHILE_OPEN = '00000000-0000-4000-8000-000000005007';

const EVENT_HAPPY = '00000000-0000-4000-8000-000000006001';
const EVENT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000006002';
const EVENT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000006003';
const EVENT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000006004';
const EVENT_NULL_DOB = '00000000-0000-4000-8000-000000006005';
const EVENT_CROSS_TENANT = '00000000-0000-4000-8000-000000006006';
const EVENT_SECOND_WHILE_OPEN = '00000000-0000-4000-8000-000000006007';

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

async function postCheckIn(
  sessionId: string,
  authSub: string,
  event: {
    id: string;
    clientId: string;
    deliveryMode?: 'home' | 'studio' | 'remote';
    point?: { lat: number; lng: number } | null;
  },
): Promise<Response> {
  return api.request(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      events: [
        {
          id: event.id,
          seq: 1,
          kind: 'session_started',
          deviceAt: '2026-09-02T06:32:00.000Z',
          payload: {
            clientId: event.clientId,
            serviceTypeId: SERVICE_TYPE,
            deliveryMode: event.deliveryMode ?? 'home',
            locationId: null,
            point: event.point === undefined ? { lat: 25.2, lng: 55.27 } : event.point,
          },
        },
      ],
    }),
  });
}

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');

  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedConsentDocument(owner, IDS.tenantA, DOCUMENT);

  // A client contact, wrongly attempting to check someone in.
  await seedUser(owner, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
  });

  const clients: Array<{ id: string; contactId: string; dob: string | null }> = [
    { id: CLIENT_ADULT, contactId: CONTACT_ADULT, dob: '1990-01-01' },
    { id: CLIENT_NO_PARTICIPATION, contactId: CONTACT_NO_PARTICIPATION, dob: '1990-01-01' },
    { id: CLIENT_MINOR_NO_GUARDIAN, contactId: CONTACT_MINOR_NO_GUARDIAN, dob: '2015-01-01' },
    { id: CLIENT_MINOR_WITH_GUARDIAN, contactId: CONTACT_MINOR_WITH_GUARDIAN, dob: '2015-01-01' },
    { id: CLIENT_NULL_DOB, contactId: CONTACT_NULL_DOB, dob: null },
  ];
  for (const [index, fixture] of clients.entries()) {
    await seedClient(owner, IDS.tenantA, fixture.id, IDS.ownerA, `Client ${index}`);
    if (fixture.dob) {
      await owner.query('update client set date_of_birth = $1 where id = $2', [
        fixture.dob,
        fixture.id,
      ]);
    }
    await owner.query(
      'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
        "values ($1, $2, $3, 'mother', true)",
      [fixture.contactId, IDS.tenantA, fixture.id],
    );
  }

  const consent = (
    id: string,
    clientId: string,
    contactId: string,
    purpose: 'participation' | 'minor_participation' | 'home_visit',
  ) =>
    seedConsent(owner, {
      id,
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      purpose,
      textDocumentId: DOCUMENT,
    });

  // CLIENT_ADULT: participation + home_visit — a clean check-in.
  await consent(
    '00000000-0000-4000-8000-000000004001',
    CLIENT_ADULT,
    CONTACT_ADULT,
    'participation',
  );
  await consent('00000000-0000-4000-8000-000000004002', CLIENT_ADULT, CONTACT_ADULT, 'home_visit');
  // CLIENT_NO_PARTICIPATION: home_visit only — participation is the missing reason.
  await consent(
    '00000000-0000-4000-8000-000000004003',
    CLIENT_NO_PARTICIPATION,
    CONTACT_NO_PARTICIPATION,
    'home_visit',
  );
  // CLIENT_MINOR_NO_GUARDIAN: participation + home_visit, no minor_participation.
  await consent(
    '00000000-0000-4000-8000-000000004004',
    CLIENT_MINOR_NO_GUARDIAN,
    CONTACT_MINOR_NO_GUARDIAN,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-000000004005',
    CLIENT_MINOR_NO_GUARDIAN,
    CONTACT_MINOR_NO_GUARDIAN,
    'home_visit',
  );
  // CLIENT_MINOR_WITH_GUARDIAN: all three active.
  await consent(
    '00000000-0000-4000-8000-000000004006',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-000000004007',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'home_visit',
  );
  await consent(
    '00000000-0000-4000-8000-000000004008',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'minor_participation',
  );
  // CLIENT_NULL_DOB: participation + home_visit — the only reason left is the missing date of birth.
  await consent(
    '00000000-0000-4000-8000-000000004009',
    CLIENT_NULL_DOB,
    CONTACT_NULL_DOB,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-00000000400a',
    CLIENT_NULL_DOB,
    CONTACT_NULL_DOB,
    'home_visit',
  );

  // A client belonging to a different tenant, to prove the route's own tenant re-check.
  await seedClient(owner, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Foreign');

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
  mountSessions(api);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('POST /api/sessions/:id/events', () => {
  it('checks a practitioner in and audits it with the client behind the row', async () => {
    const res = await postCheckIn(SESSION_HAPPY, AUTH.practitionerA, {
      id: EVENT_HAPPY,
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CheckInResponse;
    expect(body).toEqual({
      status: 'checked_in',
      sessionId: SESSION_HAPPY,
      checkedInAt: '2026-09-02T06:32:00.000Z',
    });

    const session = await owner.query<{
      status: string;
      client_id: string;
      practitioner_id: string;
      delivery_mode: string;
    }>('select status, client_id, practitioner_id, delivery_mode from session where id = $1', [
      SESSION_HAPPY,
    ]);
    expect(session.rows[0]).toEqual({
      status: 'in_progress',
      client_id: CLIENT_ADULT,
      practitioner_id: MORE_IDS.practitionerA,
      delivery_mode: 'home',
    });

    const event = await owner.query<{ kind: string; client_id: string }>(
      'select kind, client_id from session_event where id = $1',
      [EVENT_HAPPY],
    );
    expect(event.rows[0]).toEqual({ kind: 'session_started', client_id: CLIENT_ADULT });

    // The audit trigger fires on both inserts, and 097's generalised
    // app.audit_client_id names the client on each row.
    const audit = await owner.query<{ entity_type: string; client_id: string }>(
      'select entity_type, client_id from audit_log where entity_id in ($1, $2) order by entity_type',
      [SESSION_HAPPY, EVENT_HAPPY],
    );
    expect(audit.rows).toEqual([
      { entity_type: 'session', client_id: CLIENT_ADULT },
      { entity_type: 'session_event', client_id: CLIENT_ADULT },
    ]);
  });

  it('is idempotent: resending the same event returns the same result and writes nothing twice', async () => {
    const before = await owner.query('select count(*)::int as n from session_event where id = $1', [
      EVENT_HAPPY,
    ]);
    const res = await postCheckIn(SESSION_HAPPY, AUTH.practitionerA, {
      id: EVENT_HAPPY,
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'checked_in',
      sessionId: SESSION_HAPPY,
      checkedInAt: '2026-09-02T06:32:00.000Z',
    });
    const after = await owner.query('select count(*)::int as n from session_event where id = $1', [
      EVENT_HAPPY,
    ]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      await owner.query('select count(*)::int as n from session where id = $1', [SESSION_HAPPY]),
    ).toMatchObject({ rows: [{ n: 1 }] });
  });

  it('refuses a second open visit for the same practitioner while one is already in progress', async () => {
    const res = await postCheckIn(SESSION_SECOND_WHILE_OPEN, AUTH.practitionerA, {
      id: EVENT_SECOND_WHILE_OPEN,
      clientId: CLIENT_MINOR_WITH_GUARDIAN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['already_checked_in'] });
    const rows = await owner.query('select 1 from session where id = $1', [
      SESSION_SECOND_WHILE_OPEN,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('blocks and writes nothing when participation consent is missing', async () => {
    const res = await postCheckIn(SESSION_NO_PARTICIPATION, AUTH.practitionerA, {
      id: EVENT_NO_PARTICIPATION,
      clientId: CLIENT_NO_PARTICIPATION,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'blocked',
      reasons: ['consent_missing_participation'],
    });
    const rows = await owner.query('select 1 from session where id = $1', [
      SESSION_NO_PARTICIPATION,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('blocks a minor without an active guardian consent', async () => {
    const res = await postCheckIn(SESSION_MINOR_NO_GUARDIAN, AUTH.practitionerA, {
      id: EVENT_MINOR_NO_GUARDIAN,
      clientId: CLIENT_MINOR_NO_GUARDIAN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'blocked',
      reasons: ['consent_missing_minor_participation'],
    });
  });

  it('allows a minor once the guardian consent is active', async () => {
    const res = await postCheckIn(SESSION_MINOR_WITH_GUARDIAN, AUTH.practitionerA, {
      id: EVENT_MINOR_WITH_GUARDIAN,
      clientId: CLIENT_MINOR_WITH_GUARDIAN,
    });
    // Blocked above by the still-open SESSION_HAPPY visit — check that one out
    // is out of scope for this pull request, so this proves the consent gate
    // alone by observing the *reason*, not a successful check-in.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['already_checked_in'] });
  });

  it('fails closed when the date of birth is unknown', async () => {
    const res = await postCheckIn(SESSION_NULL_DOB, AUTH.practitionerA, {
      id: EVENT_NULL_DOB,
      clientId: CLIENT_NULL_DOB,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['date_of_birth_unknown'] });
  });

  it("re-verifies the client belongs to the caller's own tenant before writing anything", async () => {
    const res = await postCheckIn(SESSION_CROSS_TENANT, AUTH.practitionerA, {
      id: EVENT_CROSS_TENANT,
      clientId: IDS.clientB,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request', detail: 'client_not_found' });
    const rows = await owner.query('select 1 from session where id = $1', [SESSION_CROSS_TENANT]);
    expect(rows.rowCount).toBe(0);
  });

  it('refuses a role that may never run a session', async () => {
    const res = await postCheckIn('00000000-0000-4000-8000-000000005999', AUTH.contactA, {
      id: '00000000-0000-4000-8000-000000006999',
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(403);
  });

  it('refuses an unknown caller', async () => {
    const res = await postCheckIn('00000000-0000-4000-8000-000000005998', AUTH.unknown, {
      id: '00000000-0000-4000-8000-000000006998',
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(403);
  });
});
