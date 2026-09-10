import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { straightLineRouting } from '@app/api/_middleware/routing';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import type { BoardResponse } from '@app/api/appointments/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedContact,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * The board (docs/SPEC/dispatch.md sections 4, 9 and 10): every practitioner
 * with a row, each visit with its facts and its state, one `list` audit row
 * per visit shown, and the three roles admitted while everyone else is
 * refused. Ids in this file's own 7xxx block of the reserved range.
 *
 * The routing seam here is the deterministic fallback, so the drive that
 * makes the last visit unreachable is arithmetic and reaches no vendor
 * (docs/SEAMS.md).
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

const AUTH_FINANCE = '00000000-0000-4000-8000-000000007001';
const FINANCE_USER = '00000000-0000-4000-8000-000000007002';
const PRACTITIONER_IDLE = '00000000-0000-4000-8000-000000007003';
const PRACTITIONER_IDLE_USER = '00000000-0000-4000-8000-000000007004';
const AUTH_PRACTITIONER_IDLE = '00000000-0000-4000-8000-000000007005';
const CONTACT_A = '00000000-0000-4000-8000-000000007006';
const AUTH_OWNER_B = '00000000-0000-4000-8000-000000007007';
const LOCATION_FAR = '00000000-0000-4000-8000-000000007008';
const PRACTITIONER_GONE = '00000000-0000-4000-8000-000000007009';
const PRACTITIONER_GONE_USER = '00000000-0000-4000-8000-000000007010';
const PRACTITIONER_LEFT = '00000000-0000-4000-8000-000000007011';
const PRACTITIONER_LEFT_USER = '00000000-0000-4000-8000-000000007012';
const LOCATION_OFF = '00000000-0000-4000-8000-000000007013';
/** A second household, erased at its own request, and the home it owns. */
const CLIENT_ERASED = '00000000-0000-4000-8000-000000007014';
const LOCATION_ERASED = '00000000-0000-4000-8000-000000007015';
const APPT_CLOSED = '00000000-0000-4000-8000-000000007101';
const APPT_OPEN = '00000000-0000-4000-8000-000000007102';
const APPT_NEXT = '00000000-0000-4000-8000-000000007103';
const APPT_LEFT = '00000000-0000-4000-8000-000000007104';
const APPT_OFF = '00000000-0000-4000-8000-000000007105';
const APPT_MOVED = '00000000-0000-4000-8000-000000007106';
/** The erased household's own visit, on a day of its own. */
const APPT_ERASED = '00000000-0000-4000-8000-000000007107';
/** A later day again: one door closed, the next called off, the third still to come. */
const APPT_AFTER_DONE = '00000000-0000-4000-8000-000000007108';
const APPT_AFTER_OFF = '00000000-0000-4000-8000-000000007109';
const APPT_AFTER_NEXT = '00000000-0000-4000-8000-000000007110';
const SESSION_CLOSED = '00000000-0000-4000-8000-000000007201';
const SESSION_OPEN = '00000000-0000-4000-8000-000000007202';

const DATE = '2026-09-04';
const at = (time: string) => new Date(`${DATE}T${time}:00+04:00`);
// The clock the API runs on: 10:50 on the day, after the second door opened.
const NOW = at('10:50');

/**
 * A later day, kept apart from the day above so the erased household's visit
 * cannot change what any of the other cases read.
 */
const DATE_ERASED = '2026-09-05';
/** A later day again, for the one case about which visit "on the way" follows. */
const DATE_AFTER = '2026-09-06';
const on = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`);

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
let api: ReturnType<typeof createApi>;
/** The same API on a deployment with no routing seam configured at all. */
let mapless: ReturnType<typeof createApi>;

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

async function get(
  sub: string,
  path: string,
  which: ReturnType<typeof createApi> = api,
): Promise<Response> {
  return which.request(path, { headers: { authorization: `Bearer ${await mint(sub)}` } });
}

async function seedAppointment(
  id: string,
  windowStart: Date,
  status: string,
  locationId: string = IDS.locationA,
  practitionerId: string = MORE_IDS.practitionerA,
  clientId: string = IDS.clientA,
): Promise<void> {
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, $9::appointment_status, $10)",
    [
      id,
      IDS.tenantA,
      clientId,
      practitionerId,
      MORE_IDS.serviceTypeA,
      locationId,
      windowStart,
      new Date(windowStart.getTime() + 45 * 60_000),
      status,
      IDS.ownerA,
    ],
  );
}

/** A session at a door, opened when the practitioner arrived and closed when they left, if they did. */
async function seedSession(
  id: string,
  appointmentId: string,
  checkedInAt: Date,
  closedAt: Date | null,
): Promise<void> {
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'delivery_mode, status, checked_in_at, closed_at, appointment_id, created_by) values ' +
      "($1, $2, $3, $4, $5, 'home', $6::session_status, $7, $8, $9, $10)",
    [
      id,
      IDS.tenantA,
      IDS.clientA,
      MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      closedAt === null ? 'in_progress' : 'completed',
      checkedInAt,
      closedAt,
      appointmentId,
      MORE_IDS.practitionerUserA,
    ],
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH_OWNER_B, IDS.ownerB]);
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');

  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  // A second practitioner with nothing on: an idle row is still a row (spec 4.2).
  await seedUser(owner, {
    id: PRACTITIONER_IDLE_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_PRACTITIONER_IDLE,
    displayName: 'Synthetic Practitioner Idle',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_IDLE, PRACTITIONER_IDLE_USER);
  // Two who have left the practice. One has nothing on the day and is not a
  // row on the board at all; the other still has a visit against their name,
  // and a visit that has not been reassigned must not vanish with them
  // (spec 4.2).
  await seedUser(owner, {
    id: PRACTITIONER_GONE_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner Gone',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_GONE, PRACTITIONER_GONE_USER);
  await seedUser(owner, {
    id: PRACTITIONER_LEFT_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner Left',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_LEFT, PRACTITIONER_LEFT_USER);
  await owner.query("update practitioner set status = 'inactive' where id = any($1::uuid[])", [
    [PRACTITIONER_GONE, PRACTITIONER_LEFT],
  ]);
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
  // The admin: admitted to the board like the owner, but standing inside the
  // erasure gate rather than outside it, which is what the erased household's
  // case below turns on (spec 5, amended).
  await seedUser(owner, {
    id: MORE_IDS.adminUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.adminA,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });

  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await owner.query(
    "update client set status = 'active', date_of_birth = '1990-01-01' where id = $1",
    [IDS.clientA],
  );
  await seedContact(owner, IDS.tenantA, CONTACT_A, IDS.clientA, 'x-board-a');
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  // The same household's second address, out at the eastern edge of the
  // emirate: about 35km of straight line from the first, which is over an
  // hour of driving once the road factor is applied. The drive itself is what
  // makes the last visit unreachable, so section 5's rule is exercised
  // through the same matrix the optimiser uses rather than through a clock
  // wound forward.
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, created_by) ' +
      "values ($1, $2, 'client', $3, 'home', 'DXB', " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.62 25.20)'), $4)",
    [LOCATION_FAR, IDS.tenantA, IDS.clientA, IDS.ownerA],
  );

  // A third address of the same household, and the only place on the day that
  // nobody is driving to: both visits at it are settled.
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, created_by) ' +
      "values ($1, $2, 'client', $3, 'home', 'DXB', " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.40 25.30)'), $4)",
    [LOCATION_OFF, IDS.tenantA, IDS.clientA, IDS.ownerA],
  );

  // The day: one visit closed at 09:40, one checked in at 10:00 and still open
  // at 10:50, one still to come at 11:00 — which cannot be reached in time —
  // and two the day is done with: one called off and one moved (spec 4.4).
  await seedAppointment(APPT_CLOSED, at('09:00'), 'completed');
  await seedAppointment(APPT_OPEN, at('10:00'), 'checked_in');
  await seedAppointment(APPT_NEXT, at('11:00'), 'confirmed', LOCATION_FAR);
  await seedAppointment(APPT_OFF, at('12:00'), 'cancelled', LOCATION_OFF);
  await seedAppointment(APPT_MOVED, at('13:00'), 'rescheduled', LOCATION_OFF);
  await seedAppointment(APPT_LEFT, at('14:00'), 'confirmed', IDS.locationA, PRACTITIONER_LEFT);
  await seedSession(SESSION_CLOSED, APPT_CLOSED, at('09:02'), at('09:40'));
  await seedSession(SESSION_OPEN, APPT_OPEN, at('10:03'), null);

  // A second household, erased at its own request, with a home of its own and
  // one visit at that home on a day of its own. The erasure gate
  // (db/policies/client/readers.sql) hides both the client row and the
  // locations it owns from an admin, and shows them to the owner and the lead
  // practitioner (spec 5, amended).
  await seedClient(owner, IDS.tenantA, CLIENT_ERASED, IDS.ownerA, 'Dune');
  await seedLocation(owner, IDS.tenantA, LOCATION_ERASED, CLIENT_ERASED, IDS.ownerA);
  await seedAppointment(
    APPT_ERASED,
    on(DATE_ERASED, '10:00'),
    'confirmed',
    LOCATION_ERASED,
    MORE_IDS.practitionerA,
    CLIENT_ERASED,
  );
  await owner.query("update client set status = 'erased' where id = $1", [CLIENT_ERASED]);

  // A day later still, with a call-off in the middle of it: the 09:00 door was
  // closed, the 10:00 visit was called off, and the practitioner is driving to
  // the 11:00 one. A visit called off did not happen, so it is not what they
  // are coming from (spec 4.4).
  await seedAppointment(APPT_AFTER_DONE, on(DATE_AFTER, '09:00'), 'completed');
  await seedAppointment(APPT_AFTER_OFF, on(DATE_AFTER, '10:00'), 'cancelled');
  await seedAppointment(APPT_AFTER_NEXT, on(DATE_AFTER, '11:00'), 'confirmed');

  pool = createPool(process.env.API_DATABASE_URL ?? '');
  const verifier = createTokenVerifier({ issuer: ISSUER, secret: SECRET });
  api = createApi({
    pool,
    verifier,
    keyOf: () => 'test',
    routing: straightLineRouting({ timeZone: 'Asia/Dubai' }),
    now: () => NOW,
  });
  mapless = createApi({ pool, verifier, keyOf: () => 'test', now: () => NOW });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/appointments/board', () => {
  it('answers every practitioner with a row, each visit with its facts and its state', async () => {
    const res = await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoardResponse;
    expect(body.date).toBe(DATE);
    expect(body.latenessAvailable).toBe(true);
    expect(body.practitioners.map((p) => p.displayName).sort()).toEqual([
      'Synthetic Practitioner A',
      'Synthetic Practitioner Idle',
      'Synthetic Practitioner Left',
    ]);
    const idle = body.practitioners.find((p) => p.practitionerId === PRACTITIONER_IDLE);
    expect(idle?.visits).toEqual([]);
    const busy = body.practitioners.find((p) => p.practitionerId === MORE_IDS.practitionerA);
    expect(busy?.visits.map((v) => [v.appointmentId, v.state])).toEqual([
      [APPT_CLOSED, 'finished'],
      [APPT_OPEN, 'at_the_door'],
      [APPT_NEXT, 'running_late'],
      // The two the map's own status list leaves out, which is why the board
      // asks for every status (spec 4.4).
      [APPT_OFF, 'called_off'],
      [APPT_MOVED, 'moved'],
    ]);
    const next = busy?.visits[2];
    expect(next?.lateness?.late).toBe(true);
    expect(next?.client).toEqual({
      id: IDS.clientA,
      givenName: expect.any(String),
      familyName: 'Alpha',
    });
    expect(next?.serviceType.durationMinutes).toBeGreaterThan(0);
    expect(next?.emirate).toBe('DXB');
    expect(busy?.visits[0]?.closedAt).toBe(at('09:40').toISOString());
    expect(busy?.visits[1]?.checkedInAt).toBe(at('10:03').toISOString());
  });

  it('writes one list row per visit shown, as the schedule does', async () => {
    // The row is the visit and it names the household, which is the shape
    // `GET /api/appointments` already writes (spec 9): the board is the same
    // disclosure on a different screen, so it leaves the same trail. Counted
    // twice over — six rows against this household, and six rows in the whole
    // trail — so the idle practitioner's empty row, which discloses nobody,
    // writes nothing.
    const count = async (where: string, params: unknown[]): Promise<number> => {
      const { rows } = await owner.query<{ n: string }>(
        `select count(*)::text as n from audit_log where action = 'list' and entity_type = 'appointment'${where}`,
        params,
      );
      return Number(rows[0]?.n);
    };
    const beforeHousehold = await count(' and client_id = $1', [IDS.clientA]);
    const beforeAll = await count('', []);
    await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    expect((await count(' and client_id = $1', [IDS.clientA])) - beforeHousehold).toBe(6);
    expect((await count('', [])) - beforeAll).toBe(6);

    // And each row names a visit rather than the household six times over, so
    // the timeline can say which visits were on the screen.
    const { rows: named } = await owner.query<{ entity_id: string }>(
      "select distinct entity_id from audit_log where action = 'list' " +
        "and entity_type = 'appointment' and client_id = $1",
      [IDS.clientA],
    );
    expect(named.map((row) => row.entity_id).sort()).toEqual(
      [APPT_CLOSED, APPT_OPEN, APPT_NEXT, APPT_OFF, APPT_MOVED, APPT_LEFT].sort(),
    );
  });

  it('prices only the drives the rule can ask for, never a door nobody is going to', async () => {
    await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    // Both visits at the third address are settled, so no drive is ever
    // priced to or from it — not by this read and not by any before it.
    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from drive_estimate ' +
        'where from_location_id = $1 or to_location_id = $1',
      [LOCATION_OFF],
    );
    expect(Number(rows[0]?.n)).toBe(0);
    // And the drive the rule does ask for is priced: the leg from the door
    // the practitioner is at to the one they cannot reach in time.
    const priced = await owner.query<{ n: string }>(
      'select count(*)::text as n from drive_estimate ' +
        'where from_location_id = $1 and to_location_id = $2',
      [IDS.locationA, LOCATION_FAR],
    );
    expect(Number(priced.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('answers without a routing seam, saying so rather than refusing the screen', async () => {
    const res = await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`, mapless);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoardResponse;
    expect(body.latenessAvailable).toBe(false);
    const visits = body.practitioners.flatMap((p) => p.visits);
    expect(visits.map((v) => v.lateness)).toEqual(visits.map(() => null));
    // The facts still decide the states; only the lateness is unknown.
    const busy = body.practitioners.find((p) => p.practitionerId === MORE_IDS.practitionerA);
    expect(busy?.visits.map((v) => v.state)).toEqual([
      'finished',
      'at_the_door',
      'agreed',
      'called_off',
      'moved',
    ]);
  });

  it("lists the practice's current practitioners, and a leaver only while a visit is still theirs", async () => {
    const res = await get(AUTH.ownerA, `/api/appointments/board?date=${DATE}`);
    const body = (await res.json()) as BoardResponse;
    expect(body.practitioners.map((p) => p.practitionerId)).not.toContain(PRACTITIONER_GONE);
    const left = body.practitioners.find((p) => p.practitionerId === PRACTITIONER_LEFT);
    expect(left?.visits.map((v) => v.appointmentId)).toEqual([APPT_LEFT]);
    // The row says which of the two it is, because a leaver may hold a visit
    // and may not be handed one: the screen filters its own target list on
    // this rather than offering somebody the route refuses (spec 6.2).
    expect(left?.active).toBe(false);
    expect(
      body.practitioners.filter((p) => p.practitionerId !== PRACTITIONER_LEFT).map((p) => p.active),
    ).toEqual([true, true]);
    // Row order is the practice's own list, by name (spec 4.2).
    expect(body.practitioners.map((p) => p.displayName)).toEqual([
      'Synthetic Practitioner A',
      'Synthetic Practitioner Idle',
      'Synthetic Practitioner Left',
    ]);
  });

  it('reads "on the way" from the last visit that happened, past one called off', async () => {
    // Spec 4.4 turns "on the way" on the previous visit being closed. A visit
    // called off never took place, so a practitioner who closed the 09:00 door
    // is on the way to the 11:00 one and not merely agreed to it.
    const res = await get(AUTH.ownerA, `/api/appointments/board?date=${DATE_AFTER}`);
    const body = (await res.json()) as BoardResponse;
    const busy = body.practitioners.find((p) => p.practitionerId === MORE_IDS.practitionerA);
    expect(busy?.visits.map((v) => [v.appointmentId, v.state])).toEqual([
      [APPT_AFTER_DONE, 'finished'],
      [APPT_AFTER_OFF, 'called_off'],
      [APPT_AFTER_NEXT, 'on_the_way'],
    ]);
  });

  it("keeps an erased household's home visit off an admin's board and on the owner's", async () => {
    // The gate hides the erased household's client row and the locations it
    // owns from an admin; `readDay` joins `location`, so a home visit of that
    // household forms no row at all and takes no place in the admin's walk.
    // The owner is outside the gate and sees the day whole (spec 5, amended).
    const adminBoard = (await (
      await get(AUTH.adminA, `/api/appointments/board?date=${DATE_ERASED}`)
    ).json()) as BoardResponse;
    expect(adminBoard.practitioners.flatMap((p) => p.visits.map((v) => v.appointmentId))).toEqual(
      [],
    );

    const ownerBoard = (await (
      await get(AUTH.ownerA, `/api/appointments/board?date=${DATE_ERASED}`)
    ).json()) as BoardResponse;
    expect(ownerBoard.practitioners.flatMap((p) => p.visits.map((v) => v.appointmentId))).toEqual([
      APPT_ERASED,
    ]);
  });

  it('admits the lead practitioner and refuses a practitioner, finance and a household', async () => {
    // The seeded owner is also the lead practitioner in the helpers' fixture,
    // and the admin is admitted by the erased-household case above.
    // Refusals are what this case proves.
    for (const sub of [AUTH.practitionerA, AUTH_FINANCE, AUTH.contactA]) {
      const res = await get(sub, `/api/appointments/board?date=${DATE}`);
      expect(res.status).toBe(403);
    }
  });

  it('refuses a malformed date before reading anything', async () => {
    const res = await get(AUTH.ownerA, '/api/appointments/board?date=yesterday');
    expect(res.status).toBe(400);
  });

  it('refuses a well-shaped date that is not a day', async () => {
    // The shape is right and the day does not exist; the schedule's own
    // validation refuses it rather than handing Postgres an invalid date.
    const res = await get(AUTH.ownerA, '/api/appointments/board?date=2026-13-45');
    expect(res.status).toBe(400);
  });

  it("shows another practice nothing of this one's day", async () => {
    const res = await get(AUTH_OWNER_B, `/api/appointments/board?date=${DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoardResponse;
    // Not merely stop-free: the other practice's own rows are not there either.
    expect(body.practitioners).toEqual([]);
  });
});
