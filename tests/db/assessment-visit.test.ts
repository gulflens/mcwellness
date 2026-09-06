import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type {
  AssessmentListResponse,
  AssessmentVisitsResponse,
} from '../../app/api/assessments/schema';
import {
  AUTH,
  IDS,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedCredential,
  seedPractitioner,
  seedServiceType,
  seedTenant,
} from './helpers';

/**
 * The link from a measurement to the visit that produced it (migration 951,
 * request 2 of docs/CHANGE-REQUESTS/assessment-01.md).
 *
 * Two halves, and the first is the one that binds: `assessment_session_fk`
 * names the visit's tenant, id **and client**, so a measurement can never name
 * another household's visit. The route asks the same question first only so
 * that a caller naming one is told so rather than handed a 500.
 *
 * Every value here is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

/** Ids in the reserved shape, with the slot last so no two clients share an MRN. */
const id = (slot: number): string => `0000000a-0000-4000-8000-${String(slot).padStart(12, '0')}`;

const SERVICE = id(1);
const WORDING = id(2);
const PRACTITIONER = id(3);
const CLIENT_ONE = id(11);
const CLIENT_TWO = id(12);
const CONTACT_ONE = id(21);
const CONTACT_TWO = id(22);
const VISIT_ONE = id(31);
const VISIT_TWO = id(32);
const OPEN_VISIT = id(33);

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
let today: string;

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

async function get(path: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${await mint(AUTH.ownerA)}` } });
}

async function post(path: string, body: unknown): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(AUTH.ownerA)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** A household that has agreed to everything the recording gate reads. */
async function seedHousehold(
  clientId: string,
  contactId: string,
  familyName: string,
): Promise<void> {
  await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, familyName);
  await owner.query("update client set date_of_birth = '1990-01-01' where id = $1", [clientId]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [contactId, IDS.tenantA, clientId],
  );
  for (const purpose of ['participation', 'home_visit']) {
    await owner.query(
      'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
        'text_document_id, status, method) values ($1, $2, $3, $4::consent_purpose, 1, $5, ' +
        "'active', 'app_signature')",
      [IDS.tenantA, clientId, contactId, purpose, WORDING],
    );
  }
}

async function seedVisit(
  visitId: string,
  clientId: string,
  status: 'completed' | 'in_progress',
): Promise<void> {
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'status, checked_in_at) values ($1, $2, $3, $4, $5, $6::session_status, now())',
    [visitId, IDS.tenantA, clientId, PRACTITIONER, SERVICE, status],
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(owner, IDS.tenantA, SERVICE, 'brain-map');
  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, 'consent', $3, 'application/pdf', sha256($4::bytea))",
    [WORDING, IDS.tenantA, `consent-wording-${WORDING}`, `consent-wording-${WORDING}`],
  );
  // The owner treats as well as runs the practice, which is this practice.
  await owner.query('update app_user set auth_id = $2 where id = $1', [IDS.ownerA, AUTH.ownerA]);
  await owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'lead_practitioner')",
    [IDS.tenantA, IDS.ownerA],
  );
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, IDS.ownerA);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: PRACTITIONER,
    serviceTypeId: SERVICE,
    certification: 'vendor_qeeg',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await seedHousehold(CLIENT_ONE, CONTACT_ONE, 'Harbour');
  await seedHousehold(CLIENT_TWO, CONTACT_TWO, 'Meadow');
  await seedVisit(VISIT_ONE, CLIENT_ONE, 'completed');
  await seedVisit(VISIT_TWO, CLIENT_TWO, 'completed');
  await seedVisit(OPEN_VISIT, CLIENT_ONE, 'in_progress');

  const day = await owner.query<{ day: string }>(
    "select to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD') as day",
  );
  today = day.rows[0]?.day ?? '';

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

/** A measurement written straight at the table, bypassing every route. */
const INSERT =
  'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
  'performed_at, instrument, instrument_version, derived, session_id) ' +
  "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, $5)";

// A measurement is never deleted (migration 500's own guard), so every case
// here writes inside a transaction that is rolled back.
describe('the visit a measurement names, at the table', () => {
  it('refuses a visit belonging to another household', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, '23503', INSERT, [
        id(41),
        IDS.tenantA,
        CLIENT_ONE,
        PRACTITIONER,
        VISIT_TWO,
      ]);
    });
  });

  it('accepts the household’s own visit', async () => {
    await rolledBack(owner, async () => {
      await owner.query(INSERT, [id(42), IDS.tenantA, CLIENT_ONE, PRACTITIONER, VISIT_ONE]);
      const { rows } = await owner.query<{ session_id: string | null }>(
        'select session_id from assessment where id = $1',
        [id(42)],
      );
      expect(rows[0]?.session_id).toBe(VISIT_ONE);
    });
  });

  it('accepts a measurement that names no visit at all', async () => {
    await rolledBack(owner, async () => {
      await owner.query(INSERT, [id(43), IDS.tenantA, CLIENT_ONE, PRACTITIONER, null]);
      const { rows } = await owner.query<{ session_id: string | null }>(
        'select session_id from assessment where id = $1',
        [id(43)],
      );
      expect(rows[0]?.session_id).toBeNull();
    });
  });
});

describe('GET /api/assessments/visits', () => {
  it('offers the household’s completed visits and nobody else’s', async () => {
    const res = await get(`/api/assessments/visits?clientId=${CLIENT_ONE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AssessmentVisitsResponse;
    expect(body.visits.map((visit) => visit.id)).toEqual([VISIT_ONE]);
    expect(body.visits[0]?.serviceName).toBe('brain-map');
    expect(body.visits[0]?.on).toBe(today);
  });

  it('refuses a client that is not this practice’s', async () => {
    expect((await get(`/api/assessments/visits?clientId=${IDS.clientB}`)).status).toBe(404);
  });
});

describe('POST /api/assessments, naming the visit', () => {
  const recording = (clientId: string, sessionId: string | null) => ({
    clientId,
    sessionId,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt: `${today}T09:00:00+04:00`,
    derived: {
      kind: 'brain-map',
      provenance: { software: 'Synthetic Suite', softwareVersion: '1.0' },
      condition: 'eyes-closed',
      figures: [{ site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' }],
    },
    conditionNote: null,
    referenceAgeYears: null,
    referenceSex: null,
  });

  it('records the visit and names it back on the list', async () => {
    const created = await post('/api/assessments', recording(CLIENT_ONE, VISIT_ONE));
    expect(created.status).toBe(201);

    const listed = await get(`/api/clients/${CLIENT_ONE}/assessments`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as AssessmentListResponse;
    const row = body.assessments[0]?.current;
    expect(row?.sessionId).toBe(VISIT_ONE);
    expect(row?.visitOn).toBe(today);
    expect(row?.visitServiceName).toBe('brain-map');
  });

  it('records nothing at all where no visit is named', async () => {
    const created = await post('/api/assessments', recording(CLIENT_TWO, null));
    expect(created.status).toBe(201);
    const listed = await get(`/api/clients/${CLIENT_TWO}/assessments`);
    const body = (await listed.json()) as AssessmentListResponse;
    expect(body.assessments[0]?.current.sessionId).toBeNull();
    expect(body.assessments[0]?.current.visitOn).toBeNull();
  });

  it('refuses another household’s visit, and says which field was wrong', async () => {
    const res = await post('/api/assessments', recording(CLIENT_ONE, VISIT_TWO));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'no_such_visit' });
  });

  it('refuses a visit that has not been completed', async () => {
    const res = await post('/api/assessments', recording(CLIENT_ONE, OPEN_VISIT));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'no_such_visit' });
  });
});
