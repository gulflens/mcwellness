import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import type { ConflictResponse, MoveAppointmentResponse } from '@app/api/appointments/schema';
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
 * Reassignment (docs/SPEC/dispatch.md section 6): a visit handed to another
 * practitioner as two rows, the household keeping the window it was promised,
 * the new row naming who it was taken from. Ids in this file's own 73xx block
 * of the reserved range.
 *
 * What is proved here, end to end, against a real database:
 *
 * - the two rows, linked, with `reassigned_from_practitioner_id` on the new
 *   one and nothing of the sort on the old one, and the reason on the trail;
 * - the window may move at the same time, or stay exactly as it was;
 * - the four refusals the act makes before it consults a rule at all;
 * - the new practitioner's credential and their freedom, both enforced;
 * - the three roles that may not do it;
 * - and a whole rollback when the second write loses a race (spec 13).
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

/** The practitioner every visit here is handed to: credentialed and free. */
const PRACTITIONER_B = '00000000-0000-4000-8000-000000007301';
const PRACTITIONER_B_USER = '00000000-0000-4000-8000-000000007302';
const AUTH_PRACTITIONER_B = '00000000-0000-4000-8000-000000007303';
/** A third, holding no credential at all: the one nobody may be handed to. */
const PRACTITIONER_C = '00000000-0000-4000-8000-000000007304';
const PRACTITIONER_C_USER = '00000000-0000-4000-8000-000000007305';
const AUTH_PRACTITIONER_C = '00000000-0000-4000-8000-000000007306';
const LOCATION_B = '00000000-0000-4000-8000-000000007307';
const CONTACT_A = '00000000-0000-4000-8000-000000007308';
const CONTACT_B = '00000000-0000-4000-8000-000000007309';
const AUTH_FINANCE = '00000000-0000-4000-8000-000000007310';
const FINANCE_USER = '00000000-0000-4000-8000-000000007311';
const CONSENT_TEXT = '00000000-0000-4000-8000-000000007312';
const SESSION_OPEN = '00000000-0000-4000-8000-000000007313';
/** Another practice's owner, who must reach none of this one's day. */
const AUTH_OWNER_B = '00000000-0000-4000-8000-000000007317';

// One visit per case, each at its own hour so none of them clash with each
// other on the practitioner they all start on.
const APPT_RACE = '00000000-0000-4000-8000-000000007320';
const APPT_OK = '00000000-0000-4000-8000-000000007321';
const APPT_SAME = '00000000-0000-4000-8000-000000007322';
const APPT_CLASH = '00000000-0000-4000-8000-000000007323';
const APPT_SETTLED = '00000000-0000-4000-8000-000000007324';
const APPT_OPEN = '00000000-0000-4000-8000-000000007325';
const APPT_UNCERTIFIED = '00000000-0000-4000-8000-000000007326';
const APPT_MOVED_TOO = '00000000-0000-4000-8000-000000007327';
/** The one an admin hands on, rather than the owner. */
const APPT_ADMIN = '00000000-0000-4000-8000-000000007332';
/** The one visit already on the practitioner everything is handed to. */
const APPT_B_ELEVEN = '00000000-0000-4000-8000-000000007328';
/** The booking that wins the race, written from a second connection. */
const APPT_RACE_RIVAL = '00000000-0000-4000-8000-000000007329';
/** Well-shaped ids belonging to nothing, for the two "not found" refusals. */
const APPT_UNKNOWN = '00000000-0000-4000-8000-000000007330';
const PRACTITIONER_UNKNOWN = '00000000-0000-4000-8000-000000007331';
/** A fourth who has left the practice, credential and all. */
const PRACTITIONER_LEFT = '00000000-0000-4000-8000-000000007314';
const PRACTITIONER_LEFT_USER = '00000000-0000-4000-8000-000000007315';
const AUTH_PRACTITIONER_LEFT = '00000000-0000-4000-8000-000000007316';

const DATE = '2026-09-04';
const at = (time: string) => new Date(`${DATE}T${time}:00+04:00`);

const REASON = 'The first practitioner is unwell.';

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
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

async function call(
  sub: string,
  method: string,
  path: string,
  body?: unknown,
  reason: string | null = REASON,
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (reason !== null) headers['x-reason'] = reason;
  return api.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedAppointment(
  id: string,
  windowStart: Date,
  status = 'confirmed',
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
      clientId === IDS.clientA ? IDS.locationA : LOCATION_B,
      windowStart,
      new Date(windowStart.getTime() + 45 * 60_000),
      status,
      IDS.ownerA,
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
  await seedUser(owner, {
    id: PRACTITIONER_B_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_PRACTITIONER_B,
    displayName: 'Synthetic Practitioner B',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_B, PRACTITIONER_B_USER);
  // The third holds no credential of any kind, so being handed a visit is
  // refused on the certification and not on the diary (spec 6.2).
  await seedUser(owner, {
    id: PRACTITIONER_C_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_PRACTITIONER_C,
    displayName: 'Synthetic Practitioner C',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_C, PRACTITIONER_C_USER);
  // A fourth who has left. Their credential is still on file and still valid,
  // so the only thing standing between them and a visit is their standing in
  // the practice — and the board still draws a leaver's row while they hold
  // visits that day (spec 4.2), which makes that row a reachable drag target.
  await seedUser(owner, {
    id: PRACTITIONER_LEFT_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_PRACTITIONER_LEFT,
    displayName: 'Synthetic Practitioner Left',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_LEFT, PRACTITIONER_LEFT_USER);
  await owner.query("update practitioner set status = 'inactive' where id = $1", [
    PRACTITIONER_LEFT,
  ]);
  for (const practitionerId of [MORE_IDS.practitionerA, PRACTITIONER_B, PRACTITIONER_LEFT]) {
    await seedCredential(owner, {
      tenantId: IDS.tenantA,
      practitionerId,
      serviceTypeId: MORE_IDS.serviceTypeA,
      certification: 'bcia_bcn',
      validFrom: '2020-01-01',
      validTo: null,
      canExecuteSession: true,
    });
  }

  // The admin: one of the three roles the act admits, and the one
  // `board.test.ts` says is proved admitted here rather than there.
  await seedUser(owner, {
    id: MORE_IDS.adminUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.adminA,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
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

  // The wording a consent points at. Kind `referral`, as the scheduling
  // stream's own fixtures use, standing in for any document a consent names.
  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, created_by) ' +
      "values ($1, $2, 'referral', 'referral-v1', 'text/plain', sha256('referral-v1'::bytea), $3)",
    [CONSENT_TEXT, IDS.tenantA, IDS.ownerA],
  );

  for (const [clientId, contactId, locationId, familyName] of [
    [IDS.clientA, CONTACT_A, IDS.locationA, 'Ridge'],
    [IDS.clientB, CONTACT_B, LOCATION_B, 'Valley'],
  ] as const) {
    await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, familyName);
    await owner.query(
      "update client set status = 'active', date_of_birth = '1990-01-01' where id = $1",
      [clientId],
    );
    await seedContact(owner, IDS.tenantA, contactId, clientId, `x-reassign-${contactId}`);
    await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
    for (const purpose of ['participation', 'home_visit']) {
      await owner.query(
        'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
          "text_document_id, status, method, created_by) values ($1, $2, $3, $4, 1, $5, 'active', " +
          "'app_signature', $6)",
        [IDS.tenantA, clientId, contactId, purpose, CONSENT_TEXT, IDS.ownerA],
      );
    }
  }

  // Practitioner A's day: one visit per case, an hour apart. A window is
  // forty-five minutes and the default travel buffer fifteen, so an hourly
  // spacing is exactly clear of itself.
  await seedAppointment(APPT_ADMIN, at('07:00'));
  await seedAppointment(APPT_RACE, at('08:00'));
  await seedAppointment(APPT_OK, at('09:00'));
  await seedAppointment(APPT_SAME, at('10:00'));
  await seedAppointment(APPT_CLASH, at('11:00'));
  await seedAppointment(APPT_SETTLED, at('12:00'), 'completed');
  await seedAppointment(APPT_OPEN, at('13:00'));
  await seedAppointment(APPT_UNCERTIFIED, at('14:00'));
  await seedAppointment(APPT_MOVED_TOO, at('15:00'));
  // The one thing already on practitioner B, for another household, so a
  // reassignment of the 11:00 visit onto them is a genuine double-booking.
  await seedAppointment(APPT_B_ELEVEN, at('11:00'), 'confirmed', PRACTITIONER_B, IDS.clientB);

  // A session already open beneath one visit, the appointment deliberately
  // left reading `confirmed`: the state in which the open-session guard is
  // the only thing standing between a reassignment and a visit in progress.
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'appointment_id, delivery_mode, status, checked_in_at, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', 'in_progress', $7, $8)",
    [
      SESSION_OPEN,
      IDS.tenantA,
      IDS.clientA,
      MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      APPT_OPEN,
      at('13:05'),
      MORE_IDS.practitionerUserA,
    ],
  );

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('POST /api/appointments/:id/reassign', () => {
  it('hands a visit to another practitioner as two rows, the household keeping its window', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_OK}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;
    expect(body.appointment.practitioner.id).toBe(PRACTITIONER_B);
    expect(body.appointment.windowStart).toBe(at('09:00').toISOString());
    expect(body.movedFrom.id).toBe(APPT_OK);
    const rows = await owner.query<{
      id: string;
      status: string;
      practitioner_id: string;
      rescheduled_from_id: string | null;
      reassigned_from_practitioner_id: string | null;
    }>(
      'select id, status::text as status, practitioner_id, rescheduled_from_id, reassigned_from_practitioner_id ' +
        'from appointment where id = $1 or rescheduled_from_id = $1 order by created_at',
      [APPT_OK],
    );
    expect(rows.rows).toEqual([
      {
        id: APPT_OK,
        status: 'rescheduled',
        practitioner_id: MORE_IDS.practitionerA,
        rescheduled_from_id: null,
        reassigned_from_practitioner_id: null,
      },
      {
        id: body.appointment.id,
        status: 'confirmed',
        practitioner_id: PRACTITIONER_B,
        rescheduled_from_id: APPT_OK,
        reassigned_from_practitioner_id: MORE_IDS.practitionerA,
      },
    ]);
    const trail = await owner.query<{ reason: string }>(
      "select reason from audit_log where entity_type = 'appointment' and entity_id = $1 and action = 'insert'",
      [body.appointment.id],
    );
    expect(trail.rows[0]?.reason).toBe(REASON);
  });

  it('admits an admin, who hands a visit on exactly as the owner does', async () => {
    const res = await call(AUTH.adminA, 'POST', `/api/appointments/${APPT_ADMIN}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;
    expect(body.appointment.practitioner.id).toBe(PRACTITIONER_B);
    const rows = await owner.query<{
      id: string;
      status: string;
      practitioner_id: string;
      reassigned_from_practitioner_id: string | null;
    }>(
      'select id, status::text as status, practitioner_id, reassigned_from_practitioner_id ' +
        'from appointment where id = $1 or rescheduled_from_id = $1 order by created_at',
      [APPT_ADMIN],
    );
    expect(rows.rows).toEqual([
      {
        id: APPT_ADMIN,
        status: 'rescheduled',
        practitioner_id: MORE_IDS.practitionerA,
        reassigned_from_practitioner_id: null,
      },
      {
        id: body.appointment.id,
        status: 'confirmed',
        practitioner_id: PRACTITIONER_B,
        reassigned_from_practitioner_id: MORE_IDS.practitionerA,
      },
    ]);
  });

  it('may move the window at the same time', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_MOVED_TOO}/reassign`, {
      practitionerId: PRACTITIONER_B,
      windowStart: at('16:00').toISOString(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;
    expect(body.appointment.windowStart).toBe(at('16:00').toISOString());
    expect(body.movedFrom.windowStart).toBe(at('15:00').toISOString());
  });

  it('refuses the same practitioner, a settled visit, and one with a session open', async () => {
    const same = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: MORE_IDS.practitionerA,
    });
    expect(same.status).toBe(400);
    expect(((await same.json()) as { code: string }).code).toBe('same_practitioner');
    const settled = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SETTLED}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(settled.status).toBe(400);
    expect(((await settled.json()) as { code: string }).code).toBe('appointment_settled');
    const open = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_OPEN}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(open.status).toBe(400);
    expect(((await open.json()) as { code: string }).code).toBe('session_open');
  });

  it('refuses the same practitioner however the id is typed', async () => {
    // A uuid is the same id in either case, and every lookup normalises it —
    // so a gate that compares the raw text lets an upper-case id past and
    // commits a reassignment of a visit to the practitioner who already has
    // it: a retired row, and a replacement naming itself as the one it was
    // taken from.
    const countRows = async (): Promise<number> => {
      const { rows } = await owner.query<{ n: string }>(
        'select count(*)::text as n from appointment where client_id = $1',
        [IDS.clientA],
      );
      return Number(rows[0]?.n);
    };
    const before = await countRows();
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: MORE_IDS.practitionerA.toUpperCase(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('same_practitioner');
    // And with a free window as well, which is the shape that would otherwise
    // go all the way through: nothing on the day clashes with it, so only the
    // gate itself stands between the request and a committed pair of rows.
    const andMoved = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: MORE_IDS.practitionerA.toUpperCase(),
      windowStart: at('20:00').toISOString(),
    });
    expect(andMoved.status).toBe(400);
    expect(((await andMoved.json()) as { code: string }).code).toBe('same_practitioner');
    expect(await countRows()).toBe(before);
    const untouched = await owner.query<{ status: string; practitioner_id: string }>(
      'select status::text as status, practitioner_id from appointment where id = $1',
      [APPT_SAME],
    );
    expect(untouched.rows[0]).toEqual({
      status: 'confirmed',
      practitioner_id: MORE_IDS.practitionerA,
    });
  });

  it('refuses a practitioner who has left the practice, credential or no credential', async () => {
    // The booking route refuses an inactive practitioner outright
    // (`practitioner_not_found` is the honest answer here, because the picker
    // never offers a leaver): a visit is handed to somebody who works here.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: PRACTITIONER_LEFT,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('practitioner_not_found');
    const untouched = await owner.query<{ status: string; practitioner_id: string }>(
      'select status::text as status, practitioner_id from appointment where id = $1',
      [APPT_SAME],
    );
    expect(untouched.rows[0]).toEqual({
      status: 'confirmed',
      practitioner_id: MORE_IDS.practitionerA,
    });
  });

  it('refuses a practitioner who is not certified for that service on that day, and one who is not free', async () => {
    const uncertified = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_UNCERTIFIED}/reassign`,
      { practitionerId: PRACTITIONER_C },
    );
    expect(uncertified.status).toBe(403);
    const clash = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CLASH}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(clash.status).toBe(409);
    const body = (await clash.json()) as ConflictResponse;
    expect(body.issues.map((i) => i.code)).toContain('practitioner_overlap');
    expect(body.issues[0]?.conflictsWithAppointmentId).toBe(APPT_B_ELEVEN);
    const untouched = await owner.query<{ status: string }>(
      'select status::text as status from appointment where id = $1',
      [APPT_CLASH],
    );
    expect(untouched.rows[0]).toEqual({ status: 'confirmed' });
  });

  it('insists on a reason, and refuses a practitioner, finance and a household', async () => {
    const noReason = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_SAME}/reassign`,
      { practitionerId: PRACTITIONER_B },
      null,
    );
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { code: string }).code).toBe('reason_required');
    for (const sub of [AUTH.practitionerA, AUTH_FINANCE, AUTH.contactA]) {
      const res = await call(sub, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
        practitionerId: PRACTITIONER_B,
      });
      expect(res.status).toBe(403);
    }
    // Refused before anything was written, so the visit is still where it was.
    const untouched = await owner.query<{ status: string; practitioner_id: string }>(
      'select status::text as status, practitioner_id from appointment where id = $1',
      [APPT_SAME],
    );
    expect(untouched.rows[0]).toEqual({
      status: 'confirmed',
      practitioner_id: MORE_IDS.practitionerA,
    });
  });

  it("shows another practice nothing of this one's day, and moves none of it", async () => {
    // Spec section 10: another practice reaches neither route. Their own
    // owner, with a well-formed body and a reason, sees only that there is no
    // such visit — row security hides it before the route can refuse it for
    // any other reason.
    const res = await call(AUTH_OWNER_B, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('appointment_not_found');
    const untouched = await owner.query<{ status: string; practitioner_id: string }>(
      'select status::text as status, practitioner_id from appointment where id = $1',
      [APPT_SAME],
    );
    expect(untouched.rows[0]).toEqual({
      status: 'confirmed',
      practitioner_id: MORE_IDS.practitionerA,
    });
  });

  it('refuses a request it cannot read, a visit that is not there, and a practitioner who is not', async () => {
    const malformedBody = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_SAME}/reassign`,
      { practitionerId: 'the other one' },
    );
    expect(malformedBody.status).toBe(400);
    expect(((await malformedBody.json()) as { code: string }).code).toBe('invalid_request');
    const malformedPath = await call(
      AUTH.ownerA,
      'POST',
      '/api/appointments/the-one-at-ten/reassign',
      {
        practitionerId: PRACTITIONER_B,
      },
    );
    expect(malformedPath.status).toBe(400);
    expect(((await malformedPath.json()) as { code: string }).code).toBe('invalid_request');
    const missing = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNKNOWN}/reassign`, {
      practitionerId: PRACTITIONER_B,
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe('appointment_not_found');

    // Nobody of that id in this practice — and the household is never looked
    // at to find that out, so the trail gains no `read` row for them either.
    const readsOfTheHousehold = async (): Promise<number> => {
      const { rows } = await owner.query<{ n: string }>(
        "select count(*)::text as n from audit_log where action = 'read' " +
          "and entity_type = 'client' and entity_id = $1",
        [IDS.clientA],
      );
      return Number(rows[0]?.n);
    };
    const before = await readsOfTheHousehold();
    const nobody = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SAME}/reassign`, {
      practitionerId: PRACTITIONER_UNKNOWN,
    });
    expect(nobody.status).toBe(400);
    expect(((await nobody.json()) as { code: string }).code).toBe('practitioner_not_found');
    expect(await readsOfTheHousehold()).toBe(before);
  });

  it('rolls the whole thing back when the second write loses a race', async () => {
    /**
     * The refusal that only exists between the two writes, arranged honestly
     * and not simulated — the same harness `tests/scheduling/db/move_and_cancel.test.ts`
     * uses for a move, which spec section 13 asks for here too.
     *
     * A second connection inserts a rival booking for the practitioner this
     * visit is being handed to and holds its transaction open: read committed
     * hides an uncommitted row, so this request's own reads and
     * `checkConflicts` pass on a day that does not have it. The request then
     * queues at `app.audit_chain` while writing the household's `read` row —
     * the rival's own insert holds that lock until it commits — and resumes
     * the moment the rival commits, so by the time it retires the old row and
     * inserts the new one the rival is there and the exclusion constraint
     * refuses it at once as `23P01`. Raised rather than returned, the 409
     * survives the rollback of the aborted transaction, and the visit is left
     * standing on the practitioner it started on rather than retired with
     * nothing put in its place.
     */
    const target = at('18:00');
    const rival = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await rival.connect();
    let pending: Promise<Response> | null = null;
    try {
      await rival.query('begin');
      await rival.query(
        'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
          "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 'confirmed', $9)",
        [
          APPT_RACE_RIVAL,
          IDS.tenantA,
          IDS.clientB,
          PRACTITIONER_B,
          MORE_IDS.serviceTypeA,
          LOCATION_B,
          target,
          new Date(target.getTime() + 45 * 60_000),
          IDS.ownerA,
        ],
      );
      pending = call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_RACE}/reassign`, {
        practitionerId: PRACTITIONER_B,
        windowStart: target.toISOString(),
      });
      // Long enough for the request to finish its reads and block on the
      // index, and far inside both the ten-second request budget and the API
      // role's ten-second statement timeout.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await rival.query('commit');
      const res = await pending;
      pending = null;
      expect(res.status).toBe(409);
      const body = (await res.json()) as ConflictResponse;
      expect(body.error).toBe('conflict');
      expect(body.issues.map((issue) => issue.code)).toContain('practitioner_overlap');
      // Null, and not the rival's id: this refusal came from the constraint
      // at write time, which is the path a returned body would have lost.
      expect(body.issues[0]?.conflictsWithAppointmentId).toBeNull();
      // And nothing is left half-done: the visit still stands where it was,
      // on the practitioner it was being taken from, with no row beside it.
      const after = await owner.query<{ status: string; practitioner_id: string }>(
        'select status::text as status, practitioner_id from appointment where id = $1',
        [APPT_RACE],
      );
      expect(after.rows[0]).toEqual({
        status: 'confirmed',
        practitioner_id: MORE_IDS.practitionerA,
      });
      const replacement = await owner.query(
        'select 1 from appointment where rescheduled_from_id = $1',
        [APPT_RACE],
      );
      expect(replacement.rows).toEqual([]);
    } finally {
      await pending;
      // The rival really committed, so it is taken back on its own
      // connection, which commits at once and holds no lock anybody waits on.
      await rival.query('delete from appointment where id = $1', [APPT_RACE_RIVAL]);
      await rival.end();
    }
  });
});

describe('migration 210', () => {
  it('adds who a reassigned visit was taken from, set only beside a reschedule link', async () => {
    const { rows } = await owner.query<{ is_nullable: string; data_type: string }>(
      'select is_nullable, data_type from information_schema.columns ' +
        "where table_name = 'appointment' and column_name = 'reassigned_from_practitioner_id'",
    );
    expect(rows).toEqual([{ is_nullable: 'YES', data_type: 'uuid' }]);
    const guard = await owner.query<{ conname: string }>(
      "select conname from pg_constraint where conname = 'appointment_reassigned_implies_rescheduled'",
    );
    expect(guard.rows).toHaveLength(1);
  });
});
