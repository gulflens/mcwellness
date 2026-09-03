import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountSessions } from '../../../app/api/sessions/checkin';
import type { ServiceTypesResponse } from '../../../app/api/sessions/schema';
import {
  AUTH,
  IDS,
  freshDatabase,
  seedCredential,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * GET /api/sessions/service-types (app/api/sessions/service-types.ts): the
 * service types a caller may run a session for today, driving the check-in
 * screen's own picker. Read end to end, through the real HTTP route and a
 * real database, the same way tests/session/db/checkin.test.ts covers the
 * check-in route — the interesting behaviour here is entirely in how the
 * actor's own resolved capabilities (app.resolve_actor,
 * db/migrations/095_actor.sql) are filtered, which a route-only or
 * domain-only test cannot exercise.
 */
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const SERVICE_VALID_A = '00000000-0000-4000-8000-000000200001'; // credentialed, valid today — 'Focus Session'
const SERVICE_VALID_B = '00000000-0000-4000-8000-000000200002'; // credentialed, valid today — 'Alpha Session'
const SERVICE_EXPIRED = '00000000-0000-4000-8000-000000200003'; // credentialed, but valid_to in the past
const SERVICE_NOT_YET = '00000000-0000-4000-8000-000000200004'; // credentialed, but valid_from in the future
const SERVICE_CANNOT_EXECUTE = '00000000-0000-4000-8000-000000200005'; // credentialed, can_execute_session false
const SERVICE_NO_CREDENTIAL = '00000000-0000-4000-8000-000000200006'; // in the catalogue, never credentialed
const SERVICE_RETIRED = '00000000-0000-4000-8000-000000200007'; // credentialed and otherwise valid, but retired

const PRACTITIONER_USER = '00000000-0000-4000-8000-000000201001';
const PRACTITIONER = '00000000-0000-4000-8000-000000201002';

const LEAD_USER = '00000000-0000-4000-8000-000000202001';
const LEAD_PRACTITIONER = '00000000-0000-4000-8000-000000202002';
const LEAD_AUTH = '00000000-0000-4000-8000-000000202003';

// A user with no practitioner or lead_practitioner role at all — the picker
// is never any other role's business, credentials or not.
const CONTACT_USER = '00000000-0000-4000-8000-000000203001';

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

async function getServiceTypes(authSub: string): Promise<Response> {
  return api.request('/api/sessions/service-types', {
    headers: { authorization: `Bearer ${await mint(authSub)}` },
  });
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');

  await seedServiceType(owner, IDS.tenantA, SERVICE_VALID_A, 'focus-session');
  await owner.query('update service_type set name = $1 where id = $2', [
    'Focus Session',
    SERVICE_VALID_A,
  ]);
  await seedServiceType(owner, IDS.tenantA, SERVICE_VALID_B, 'alpha-session');
  await owner.query('update service_type set name = $1 where id = $2', [
    'Alpha Session',
    SERVICE_VALID_B,
  ]);
  await seedServiceType(owner, IDS.tenantA, SERVICE_EXPIRED, 'expired-session');
  await seedServiceType(owner, IDS.tenantA, SERVICE_NOT_YET, 'future-session');
  await seedServiceType(owner, IDS.tenantA, SERVICE_CANNOT_EXECUTE, 'observe-only-session');
  await seedServiceType(owner, IDS.tenantA, SERVICE_NO_CREDENTIAL, 'uncredentialed-session');
  // Retired (status = 'inactive'): app/api/billing/service-types.ts and
  // checkin.ts's own service_type lookup both already exclude these, and
  // this route must match — a service the practice no longer offers is
  // never on the picker, even for a practitioner still holding a live,
  // execute-capable credential for it (seeded below).
  await seedServiceType(owner, IDS.tenantA, SERVICE_RETIRED, 'retired-session');
  await owner.query("update service_type set status = 'inactive' where id = $1", [SERVICE_RETIRED]);

  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);

  await seedUser(owner, {
    id: LEAD_USER,
    tenantId: IDS.tenantA,
    authId: LEAD_AUTH,
    displayName: 'Synthetic Lead Practitioner',
    roles: ['lead_practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, LEAD_PRACTITIONER, LEAD_USER);

  await seedUser(owner, {
    id: CONTACT_USER,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
  });

  const credential = (
    practitionerId: string,
    serviceTypeId: string,
    validFrom: string,
    validTo: string | null,
    canExecuteSession: boolean,
  ) =>
    seedCredential(owner, {
      tenantId: IDS.tenantA,
      practitionerId,
      serviceTypeId,
      certification: 'bcia_bcn',
      validFrom,
      validTo,
      canExecuteSession,
    });

  // The ordinary practitioner: two valid credentials (out of name order, so
  // the response's own "order by name" is provable), one expired, one not
  // yet valid, and one that cannot execute a session at all.
  await credential(PRACTITIONER, SERVICE_VALID_A, '2020-01-01', null, true);
  await credential(PRACTITIONER, SERVICE_VALID_B, '2020-01-01', null, true);
  await credential(PRACTITIONER, SERVICE_EXPIRED, '2020-01-01', '2020-12-31', true);
  await credential(PRACTITIONER, SERVICE_NOT_YET, '2099-01-01', null, true);
  await credential(PRACTITIONER, SERVICE_CANNOT_EXECUTE, '2020-01-01', null, false);
  // SERVICE_NO_CREDENTIAL: deliberately no credential row at all.
  await credential(PRACTITIONER, SERVICE_RETIRED, '2020-01-01', null, true);

  // The lead practitioner: one valid credential, proving the role, not just
  // the ordinary practitioner, may reach this picker.
  await credential(LEAD_PRACTITIONER, SERVICE_VALID_A, '2020-01-01', null, true);

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

describe('GET /api/sessions/service-types', () => {
  it('lists only the service types the practitioner holds a valid, execute-capable credential for, in name order', async () => {
    const res = await getServiceTypes(AUTH.practitionerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServiceTypesResponse;
    expect(body.serviceTypes.map((s) => s.id)).toEqual([SERVICE_VALID_B, SERVICE_VALID_A]);
    expect(body.serviceTypes[0]).toMatchObject({
      id: SERVICE_VALID_B,
      code: 'alpha-session',
      name: 'Alpha Session',
    });
  });

  it('lets a lead practitioner reach the same picker, scoped to their own credentials', async () => {
    const res = await getServiceTypes(LEAD_AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServiceTypesResponse;
    expect(body.serviceTypes.map((s) => s.id)).toEqual([SERVICE_VALID_A]);
  });

  it('excludes a retired service type even with a valid, execute-capable credential', async () => {
    const res = await getServiceTypes(AUTH.practitionerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServiceTypesResponse;
    expect(body.serviceTypes.map((s) => s.id)).not.toContain(SERVICE_RETIRED);
  });

  it('refuses a role that may never run a session', async () => {
    const res = await getServiceTypes(AUTH.contactA);
    expect(res.status).toBe(403);
  });

  it('refuses an unknown caller', async () => {
    const res = await getServiceTypes(AUTH.unknown);
    expect(res.status).toBe(403);
  });
});

/**
 * The two settings columns the session runner reads from a service
 * (docs/SPEC/session-capture.md sections 3.2 and 3.5): the pre-flight
 * checklist and the 0-10 questions.
 *
 * **Both belong to the trunk**, landing with shared-zone round 14 on
 * `service_type` — a core table this stream may not add a column to. So this
 * suite adds them to its own database, here, exactly as round 14 declares
 * them, and proves the route reads that shape. When round 14 merges, delete
 * the two `alter table` statements below and nothing else changes: the
 * assertions are written against the landed shape, not against this fixture.
 *
 * The test above it is the other half of the same contract — before round
 * 14, on a database with no such columns, the route answers with empty
 * arrays rather than failing, which is why every assertion there passes
 * unchanged.
 */
describe('the service settings the session runner reads', () => {
  beforeAll(async () => {
    await owner.query(
      "alter table service_type add column if not exists preflight_checklist jsonb not null default '[]'::jsonb",
    );
    await owner.query(
      "alter table service_type add column if not exists rating_questions jsonb not null default '[]'::jsonb",
    );
    await owner.query(
      'update service_type set preflight_checklist = $2::jsonb, rating_questions = $3::jsonb where id = $1',
      [
        SERVICE_VALID_A,
        JSON.stringify([
          {
            key: 'identity_confirmed',
            label_en: 'Client identity confirmed',
            label_ar: 'تم تأكيد هوية العميل',
          },
          {
            key: 'environment_suitable',
            label_en: 'Environment suitable',
            label_ar: 'البيئة مناسبة',
          },
        ]),
        JSON.stringify([
          {
            key: 'sleep',
            label_en: 'Sleep last night',
            label_ar: 'النوم الليلة الماضية',
            min: 0,
            max: 10,
          },
        ]),
      ],
    );
  });

  it('serves the checklist and the questions the practice has set for a service', async () => {
    const res = await getServiceTypes(AUTH.practitionerA);
    const body = (await res.json()) as ServiceTypesResponse;
    const service = body.serviceTypes.find((s) => s.id === SERVICE_VALID_A);
    expect(service?.preflightChecklist).toEqual([
      {
        key: 'identity_confirmed',
        labelEn: 'Client identity confirmed',
        labelAr: 'تم تأكيد هوية العميل',
      },
      { key: 'environment_suitable', labelEn: 'Environment suitable', labelAr: 'البيئة مناسبة' },
    ]);
    expect(service?.ratingQuestions).toEqual([
      {
        key: 'sleep',
        labelEn: 'Sleep last night',
        labelAr: 'النوم الليلة الماضية',
        min: 0,
        max: 10,
      },
    ]);
  });

  it('gives a service the practice has set nothing for an empty checklist, not a failure', async () => {
    const res = await getServiceTypes(AUTH.practitionerA);
    const body = (await res.json()) as ServiceTypesResponse;
    const service = body.serviceTypes.find((s) => s.id === SERVICE_VALID_B);
    expect(service?.preflightChecklist).toEqual([]);
    expect(service?.ratingQuestions).toEqual([]);
  });
});
