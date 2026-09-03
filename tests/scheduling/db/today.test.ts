import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppointmentListResponse } from '@app/api/appointments/schema';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import {
  AUTH,
  IDS,
  freshDatabase,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * `GET /api/appointments?scope=own` — the practitioner's own day, which
 * app/therapist/today/TodayPage.tsx reads (docs/SPEC/scheduling-manual.md
 * section 5.1).
 *
 * What this file holds the route to: the own scope shows the caller their own
 * stops and nobody else's, even for a role that may read every appointment in
 * the practice; it carries the record number, the age and the location's
 * coordinates that the screen needs; the practice scope carries none of those
 * four, so the coordinator's screen cannot start showing them by accident
 * (section 11); finance is refused either way; and every row read is audited
 * as a list, exactly as the practice scope's rows already were.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

// This file's own synthetic ids, distinct from every other test file's block.
const PRACTITIONER_ONE = '00000000-0000-4000-8000-000000007001';
const PRACTITIONER_ONE_USER = '00000000-0000-4000-8000-000000007002';
const PRACTITIONER_ONE_AUTH = '00000000-0000-4000-8000-000000007003';
const PRACTITIONER_TWO = '00000000-0000-4000-8000-000000007004';
const PRACTITIONER_TWO_USER = '00000000-0000-4000-8000-000000007005';
const FINANCE_USER = '00000000-0000-4000-8000-000000007006';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000007007';
const SERVICE_TYPE = '00000000-0000-4000-8000-000000007008';

const CLIENT_FIRST = '00000000-0000-4000-8000-000000007010';
const LOCATION_FIRST = '00000000-0000-4000-8000-000000007011';
const APPOINTMENT_FIRST = '00000000-0000-4000-8000-000000007012';

const CLIENT_SECOND = '00000000-0000-4000-8000-000000007013';
const LOCATION_SECOND = '00000000-0000-4000-8000-000000007014';
const APPOINTMENT_SECOND = '00000000-0000-4000-8000-000000007015';

const CLIENT_SOMEONE_ELSE = '00000000-0000-4000-8000-000000007016';
const LOCATION_SOMEONE_ELSE = '00000000-0000-4000-8000-000000007017';
const APPOINTMENT_SOMEONE_ELSE = '00000000-0000-4000-8000-000000007018';

// The clock the API is given, fixed so nothing here can turn over midnight
// mid-run. The Dubai calendar date is read straight from Intl rather than from
// domain/scheduling, so the fixture does not lean on the code it checks.
const NOW = new Date();
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(NOW);
// Born the first of January, thirty years back: exactly thirty on any day of
// this year, so the expected age never depends on when the suite runs. The
// appointments themselves sit on today's Dubai day, comfortably inside the
// 90-day window app.client_visible_to_practitioner opens for a practitioner.
const THIRTY_YEARS = 30;
const DATE_OF_BIRTH = `${Number(TODAY.slice(0, 4)) - THIRTY_YEARS}-01-01`;

// Synthetic coordinates, two decimal places: a stretch of Dubai, not a home.
const ENTRANCE = { lng: 55.27, lat: 25.2 };
const PARKING = { lng: 55.28, lat: 25.21 };

function dubaiTime(hour: string): Date {
  return new Date(`${TODAY}T${hour}+04:00`);
}
function plus45(start: Date): Date {
  return new Date(start.getTime() + 45 * 60_000);
}

const APPOINTMENT_INSERT_SQL =
  'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
  'location_id, delivery_mode, window_start, window_end, travel_buffer_minutes, status) ' +
  "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 15, $9)";

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

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

async function list(sub: string, query: string): Promise<Response> {
  return api.request(`/api/appointments?${query}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${await mint(sub)}` },
  });
}

async function appointmentsFrom(res: Response): Promise<AppointmentListResponse['appointments']> {
  const body = (await res.json()) as AppointmentListResponse;
  return body.appointments;
}

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');

  await seedUser(owner, {
    id: PRACTITIONER_ONE_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_ONE_AUTH,
    displayName: 'Synthetic Practitioner One',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_ONE, PRACTITIONER_ONE_USER);

  await seedUser(owner, {
    id: PRACTITIONER_TWO_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner Two',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_TWO, PRACTITIONER_TWO_USER);

  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  // The first stop: a date of birth on file and somewhere to park.
  await seedClient(owner, IDS.tenantA, CLIENT_FIRST, IDS.ownerA, 'First');
  await owner.query('update client set date_of_birth = $2 where id = $1', [
    CLIENT_FIRST,
    DATE_OF_BIRTH,
  ]);
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
      'entrance_point, parking_point, created_by) values ' +
      "($1, $2, 'client', $3, 'home', 'DXB', " +
      'extensions.st_geogfromtext($4), extensions.st_geogfromtext($5), $6)',
    [
      LOCATION_FIRST,
      IDS.tenantA,
      CLIENT_FIRST,
      `SRID=4326;POINT(${ENTRANCE.lng} ${ENTRANCE.lat})`,
      `SRID=4326;POINT(${PARKING.lng} ${PARKING.lat})`,
      IDS.ownerA,
    ],
  );
  const firstStart = dubaiTime('09:00:00');
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_FIRST,
    IDS.tenantA,
    CLIENT_FIRST,
    PRACTITIONER_ONE,
    SERVICE_TYPE,
    LOCATION_FIRST,
    firstStart,
    plus45(firstStart),
    'confirmed',
  ]);

  // The second stop: no date of birth, and nobody has recorded where to park.
  await seedClient(owner, IDS.tenantA, CLIENT_SECOND, IDS.ownerA, 'Second');
  await seedLocation(owner, IDS.tenantA, LOCATION_SECOND, CLIENT_SECOND, IDS.ownerA);
  const secondStart = dubaiTime('11:00:00');
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_SECOND,
    IDS.tenantA,
    CLIENT_SECOND,
    PRACTITIONER_ONE,
    SERVICE_TYPE,
    LOCATION_SECOND,
    secondStart,
    plus45(secondStart),
    'proposed',
  ]);

  // Somebody else's stop, on the same day: the practice sees it, the first
  // practitioner never does.
  await seedClient(owner, IDS.tenantA, CLIENT_SOMEONE_ELSE, IDS.ownerA, 'Elsewhere');
  await seedLocation(owner, IDS.tenantA, LOCATION_SOMEONE_ELSE, CLIENT_SOMEONE_ELSE, IDS.ownerA);
  const elsewhereStart = dubaiTime('13:00:00');
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_SOMEONE_ELSE,
    IDS.tenantA,
    CLIENT_SOMEONE_ELSE,
    PRACTITIONER_TWO,
    SERVICE_TYPE,
    LOCATION_SOMEONE_ELSE,
    elsewhereStart,
    plus45(elsewhereStart),
    'confirmed',
  ]);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now: () => NOW,
  });
});

afterAll(async () => {
  await owner.end();
  await pool.end();
});

describe("GET /api/appointments?scope=own — the practitioner's own day", () => {
  it('shows the caller their own stops, in window order, and nobody else’s', async () => {
    const res = await list(PRACTITIONER_ONE_AUTH, `date=${TODAY}&scope=own`);
    expect(res.status).toBe(200);
    const appointments = await appointmentsFrom(res);
    expect(appointments.map((a) => a.id)).toEqual([APPOINTMENT_FIRST, APPOINTMENT_SECOND]);
  });

  it('carries the record number, the age and the coordinates the screen needs', async () => {
    const res = await list(PRACTITIONER_ONE_AUTH, `date=${TODAY}&scope=own`);
    const [first] = await appointmentsFrom(res);
    expect(first?.client.mrn).toMatch(/^MW-/);
    expect(first?.client.age).toBe(THIRTY_YEARS);
    expect(first?.location.entrancePoint).toEqual(ENTRANCE);
    expect(first?.location.parkingPoint).toEqual(PARKING);
  });

  it('says null, not nothing, when the practice holds no age and no parking point', async () => {
    const res = await list(PRACTITIONER_ONE_AUTH, `date=${TODAY}&scope=own`);
    const appointments = await appointmentsFrom(res);
    const second = appointments.find((a) => a.id === APPOINTMENT_SECOND);
    expect(second?.client.age).toBeNull();
    expect(second?.location.parkingPoint).toBeNull();
    expect(second?.location.entrancePoint).toEqual(ENTRANCE);
  });

  it('means own even for a role that may read every appointment in the practice', async () => {
    // The owner reads the whole practice under scheduling_read_scope, so the
    // route's own practitioner_id predicate is the only thing narrowing this.
    const res = await list(AUTH.ownerA, `date=${TODAY}&scope=own`);
    expect(res.status).toBe(200);
    // The owner is nobody's practitioner here, so their own day is empty —
    // not a refusal, and not somebody else's day either.
    expect(await appointmentsFrom(res)).toEqual([]);
  });

  it('is refused for finance, the same as the practice scope', async () => {
    expect((await list(FINANCE_AUTH, `date=${TODAY}&scope=own`)).status).toBe(403);
    expect((await list(FINANCE_AUTH, `date=${TODAY}`)).status).toBe(403);
  });

  it('refuses a scope it does not have', async () => {
    expect((await list(PRACTITIONER_ONE_AUTH, `date=${TODAY}&scope=week`)).status).toBe(400);
  });

  it('audits one list row per stop shown', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'list' " +
        "and entity_type = 'appointment' and entity_id = $1 and actor_id = $2",
      [APPOINTMENT_FIRST, PRACTITIONER_ONE_USER],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/appointments — the practice scope carries none of it', () => {
  it('shows the coordinator the whole day, without a record number, an age or a coordinate', async () => {
    const res = await list(AUTH.ownerA, `date=${TODAY}`);
    expect(res.status).toBe(200);
    const appointments = await appointmentsFrom(res);
    expect(appointments.map((a) => a.id)).toEqual([
      APPOINTMENT_FIRST,
      APPOINTMENT_SECOND,
      APPOINTMENT_SOMEONE_ELSE,
    ]);
    for (const appointment of appointments) {
      expect(appointment.client.mrn).toBeUndefined();
      expect(appointment.client.age).toBeUndefined();
      expect(appointment.location.entrancePoint).toBeUndefined();
      expect(appointment.location.parkingPoint).toBeUndefined();
    }
  });

  it('is still refused for a bare practitioner: the whole practice is not their day', async () => {
    expect((await list(PRACTITIONER_ONE_AUTH, `date=${TODAY}`)).status).toBe(403);
  });
});
