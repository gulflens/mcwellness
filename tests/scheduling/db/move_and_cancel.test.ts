import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import type {
  CancelAppointmentResponse,
  ConflictResponse,
  MoveAppointmentResponse,
} from '@app/api/appointments/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  asApiRole,
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
 * Moving a visit, calling one off, and what each costs
 * (docs/SPEC/scheduling-manual.md sections 2, 3, 6.4 and 9;
 * docs/SPEC/billing.md section 4.3).
 *
 * What is proved here, end to end, against a real database:
 *
 * - a move refuses a clash and leaves both rows exactly as they were;
 * - a move that succeeds is two rows, linked, with the original window
 *   untouched on the old one;
 * - the notice period decides the status, and it is the practice's own
 *   figure and not a constant;
 * - billing's trigger takes exactly one credit on `cancelled_late` and none
 *   at all on a plain `cancelled`;
 * - the response hands back the credit that was taken, which is the id
 *   billing's waiver route needs;
 * - a practitioner may call off their own stop and no one else's, and may
 *   not move anything;
 * - the withdrawal door cancels forward only, never late, and only for the
 *   office;
 * - another practice reaches none of it.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

// This stream's own synthetic fixtures, in the reserved range
// (.claude/rules/testing.md); the 6xxx block is this file's, distinct from
// appointments.test.ts's 5xxx.
const AUTH_OWNER_B = '00000000-0000-4000-8000-000000006001';
const AUTH_PRACTITIONER_C = '00000000-0000-4000-8000-000000006002';
const PRACTITIONER_C = '00000000-0000-4000-8000-000000006003';
const PRACTITIONER_C_USER = '00000000-0000-4000-8000-000000006004';
const REFERRAL_DOC = '00000000-0000-4000-8000-000000006005';
const CONTACT_A = '00000000-0000-4000-8000-000000006006';
const CONTACT_B = '00000000-0000-4000-8000-000000006007';
const LOCATION_B = '00000000-0000-4000-8000-000000006008';

// One appointment per test, so nothing here depends on the order the tests run in.
const APPT_MOVE_OK = '00000000-0000-4000-8000-000000006101';
const APPT_MOVE_CLASH = '00000000-0000-4000-8000-000000006102';
const APPT_BLOCKING_THE_CLASH = '00000000-0000-4000-8000-000000006103';
const APPT_CANCEL_IN_TIME = '00000000-0000-4000-8000-000000006104';
const APPT_CANCEL_LATE = '00000000-0000-4000-8000-000000006105';
const APPT_CANCEL_UNFIT = '00000000-0000-4000-8000-000000006106';
const APPT_PRACTITIONER_OWN = '00000000-0000-4000-8000-000000006107';
const APPT_SOMEONE_ELSES = '00000000-0000-4000-8000-000000006108';
const APPT_WITHDRAWAL_FUTURE = '00000000-0000-4000-8000-000000006109';
const APPT_WITHDRAWAL_SOON = '00000000-0000-4000-8000-000000006110';
const APPT_WITHDRAWAL_PAST = '00000000-0000-4000-8000-000000006111';
const APPT_ALREADY_CANCELLED = '00000000-0000-4000-8000-000000006112';
const APPT_MOVE_TWICE = '00000000-0000-4000-8000-000000006113';
const APPT_NOTICE_SETTING = '00000000-0000-4000-8000-000000006114';
const APPT_NO_CREDIT = '00000000-0000-4000-8000-000000006115';

const REASON = 'The family asked for a different day.';

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

/** `hours` from now, to the millisecond, as the window start. */
function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}

async function seedAppointment(
  id: string,
  args: {
    clientId: string;
    practitionerId?: string;
    windowStart: Date;
    status?: string;
  },
): Promise<void> {
  const start = args.windowStart;
  await owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, $9::appointment_status, $10)",
    [
      id,
      IDS.tenantA,
      args.clientId,
      args.practitionerId ?? MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      args.clientId === IDS.clientA ? IDS.locationA : LOCATION_B,
      start,
      new Date(start.getTime() + 45 * 60_000),
      args.status ?? 'confirmed',
      IDS.ownerA,
    ],
  );
}

/** A credit the client holds, of the kind billing's trigger can take. */
async function giveCredit(clientId: string): Promise<void> {
  await owner.query(
    'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version) ' +
      "values ($1, $2, $3, 'complimentary', 0, 500, 1)",
    [IDS.tenantA, clientId, MORE_IDS.serviceTypeA],
  );
}

async function creditsTaken(appointmentId: string): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(
    'select count(*)::text as n from entitlement where consumed_by_appointment_id = $1',
    [appointmentId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function statusOf(appointmentId: string): Promise<{
  status: string;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  rescheduled_from_id: string | null;
  window_start: Date;
}> {
  const { rows } = await owner.query(
    'select status::text as status, cancellation_reason::text as cancellation_reason, ' +
      'cancelled_at, rescheduled_from_id, window_start from appointment where id = $1',
    [appointmentId],
  );
  return rows[0] as never;
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

  // A second practitioner, so "their own stop" means something.
  await seedUser(owner, {
    id: PRACTITIONER_C_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_PRACTITIONER_C,
    displayName: 'Synthetic Practitioner C',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_C, PRACTITIONER_C_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: PRACTITIONER_C,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  // Kind `referral`, not `consent_text`: what this stands in for is any
  // document a consent can point at (docs/CHANGE-REQUESTS/trunk-notes.md,
  // round 14, item 1).
  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, created_by) ' +
      "values ($1, $2, 'referral', 'referral-v1', 'text/plain', sha256('referral-v1'::bytea), $3)",
    [REFERRAL_DOC, IDS.tenantA, IDS.ownerA],
  );

  for (const [clientId, contactId, locationId, familyName] of [
    [IDS.clientA, CONTACT_A, IDS.locationA, 'Alpha'],
    [IDS.clientB, CONTACT_B, LOCATION_B, 'Beta'],
  ] as const) {
    await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, familyName);
    await owner.query(
      "update client set status = 'active', date_of_birth = '1990-01-01' where id = $1",
      [clientId],
    );
    await seedContact(owner, IDS.tenantA, contactId, clientId, `x-move-${contactId}`);
    await seedLocation(owner, IDS.tenantA, locationId, clientId, IDS.ownerA);
    for (const purpose of ['participation', 'home_visit']) {
      await owner.query(
        'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
          "text_document_id, status, method, created_by) values ($1, $2, $3, $4, 1, $5, 'active', " +
          "'app_signature', $6)",
        [IDS.tenantA, clientId, contactId, purpose, REFERRAL_DOC, IDS.ownerA],
      );
    }
  }

  // Every appointment this file acts on, committed before the ambient
  // transaction opens: the API runs on its own connection and would not see a
  // row written inside it.
  await seedAppointment(APPT_MOVE_OK, { clientId: IDS.clientA, windowStart: hoursFromNow(72) });
  await seedAppointment(APPT_MOVE_CLASH, { clientId: IDS.clientA, windowStart: hoursFromNow(96) });
  await seedAppointment(APPT_BLOCKING_THE_CLASH, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(120),
  });
  await seedAppointment(APPT_CANCEL_IN_TIME, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(48),
  });
  await seedAppointment(APPT_CANCEL_LATE, { clientId: IDS.clientA, windowStart: hoursFromNow(5) });
  await seedAppointment(APPT_CANCEL_UNFIT, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(200),
  });
  await seedAppointment(APPT_PRACTITIONER_OWN, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(30),
  });
  await seedAppointment(APPT_SOMEONE_ELSES, {
    clientId: IDS.clientB,
    practitionerId: PRACTITIONER_C,
    windowStart: hoursFromNow(34),
  });
  await seedAppointment(APPT_WITHDRAWAL_FUTURE, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(400),
  });
  await seedAppointment(APPT_WITHDRAWAL_SOON, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(2),
  });
  await seedAppointment(APPT_WITHDRAWAL_PAST, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(-400),
    status: 'completed',
  });
  await seedAppointment(APPT_ALREADY_CANCELLED, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(500),
    status: 'no_show',
  });
  await seedAppointment(APPT_MOVE_TWICE, { clientId: IDS.clientA, windowStart: hoursFromNow(600) });
  // Eighteen hours out: late under the practice's own twenty-four, in time
  // under twelve. The one fixture whose whole point is the difference.
  await seedAppointment(APPT_NOTICE_SETTING, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(18),
  });
  await seedAppointment(APPT_NO_CREDIT, { clientId: IDS.clientB, windowStart: hoursFromNow(3) });

  // Credits for the two clients whose late cancellations should take one.
  await giveCredit(IDS.clientA);
  await giveCredit(IDS.clientA);
  await giveCredit(IDS.clientA);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });

  // Everything above is committed; from here the raw-SQL checks run inside one
  // ambient transaction, which read-committed lets see the API's own commits.
  await owner.query('begin');
});

afterAll(async () => {
  await owner.query('rollback');
  await owner.end();
  await pool.end();
});

describe('POST /api/appointments/:id/move', () => {
  it('moves a visit to a new window and links the two rows', async () => {
    const to = hoursFromNow(80);
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_MOVE_OK}/move`, {
      windowStart: to.toISOString(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MoveAppointmentResponse;

    // The old row keeps the window the household was actually promised.
    const before = await statusOf(APPT_MOVE_OK);
    expect(before.status).toBe('rescheduled');
    expect(before.window_start.getTime()).toBe(new Date(body.movedFrom.windowStart).getTime());
    expect(before.cancelled_at).toBeNull();

    // And the new one names it.
    const after = await statusOf(body.appointment.id);
    expect(after.rescheduled_from_id).toBe(APPT_MOVE_OK);
    expect(after.window_start.getTime()).toBe(to.getTime());
    // The status carries over: the visit was confirmed and moving it did not
    // make it less booked.
    expect(after.status).toBe('confirmed');
  });

  it('refuses a move into a window the practitioner already has', async () => {
    // APPT_BLOCKING_THE_CLASH sits at +120h for a different client; moving
    // this one on top of it is the double-booking the exclusion constraints
    // and checkConflicts both exist to stop.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_MOVE_CLASH}/move`, {
      windowStart: hoursFromNow(120).toISOString(),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(body.issues.map((issue) => issue.code)).toContain('practitioner_overlap');
    expect(body.issues[0]?.conflictsWithAppointmentId).toBe(APPT_BLOCKING_THE_CLASH);

    // And nothing moved: a refused move leaves both rows exactly as they were.
    expect((await statusOf(APPT_MOVE_CLASH)).status).toBe('confirmed');
    expect((await statusOf(APPT_BLOCKING_THE_CLASH)).status).toBe('confirmed');
  });

  it('lets a visit be moved a second time, as a chain and not as two claims on one row', async () => {
    const first = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_MOVE_TWICE}/move`, {
      windowStart: hoursFromNow(610).toISOString(),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as MoveAppointmentResponse;

    const second = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${firstBody.appointment.id}/move`,
      { windowStart: hoursFromNow(620).toISOString() },
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as MoveAppointmentResponse;

    expect((await statusOf(APPT_MOVE_TWICE)).status).toBe('rescheduled');
    expect((await statusOf(firstBody.appointment.id)).rescheduled_from_id).toBe(APPT_MOVE_TWICE);
    expect((await statusOf(secondBody.appointment.id)).rescheduled_from_id).toBe(
      firstBody.appointment.id,
    );
  });

  it('refuses to move a visit that is already settled', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_ALREADY_CANCELLED}/move`,
      { windowStart: hoursFromNow(510).toISOString() },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('appointment_settled');
  });

  it('refuses a move with no reason given', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_MOVE_OK}/move`,
      { windowStart: hoursFromNow(90).toISOString() },
      null,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reason_required');
  });

  it('refuses a practitioner, who requests a change rather than making one', async () => {
    const res = await call(
      AUTH.practitionerA,
      'POST',
      `/api/appointments/${APPT_PRACTITIONER_OWN}/move`,
      { windowStart: hoursFromNow(31).toISOString() },
    );
    expect(res.status).toBe(403);
  });

  it("shows another practice's owner nothing to move", async () => {
    const res = await call(AUTH_OWNER_B, 'POST', `/api/appointments/${APPT_MOVE_OK}/move`, {
      windowStart: hoursFromNow(100).toISOString(),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/appointments/:id/cancel', () => {
  it('calls a visit off outside the notice period without taking a credit', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_IN_TIME}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled');
    expect(body.noticeHours).toBe(24);
    expect(body.creditConsumed).toBe(false);
    expect(body.waiverEntitlementId).toBeNull();

    const row = await statusOf(APPT_CANCEL_IN_TIME);
    expect(row.status).toBe('cancelled');
    expect(row.cancellation_reason).toBe('client_request');
    expect(row.cancelled_at).not.toBeNull();
    expect(await creditsTaken(APPT_CANCEL_IN_TIME)).toBe(0);
  });

  it('calls a visit off inside the notice period, takes exactly one credit, and names it for the waiver', async () => {
    const before = await creditsTaken(APPT_CANCEL_LATE);
    expect(before).toBe(0);

    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_LATE}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect(body.creditConsumed).toBe(true);
    expect(body.waiverEntitlementId).not.toBeNull();

    expect((await statusOf(APPT_CANCEL_LATE)).status).toBe('cancelled_late');
    // Exactly one, not none and not two: billing's trigger is idempotent and
    // this is the whole of what a late cancellation costs.
    expect(await creditsTaken(APPT_CANCEL_LATE)).toBe(1);

    // And the id handed back is that credit, which is what billing's waiver
    // route is addressed by.
    const { rows } = await owner.query<{ id: string; consumption_kind: string }>(
      'select id, consumption_kind::text as consumption_kind from entitlement ' +
        'where consumed_by_appointment_id = $1',
      [APPT_CANCEL_LATE],
    );
    expect(rows[0]?.id).toBe(body.waiverEntitlementId);
    expect(rows[0]?.consumption_kind).toBe('late_cancellation');
  });

  it('counts a visit that could not go ahead at the door as late, whatever the calendar said', async () => {
    // Two hundred hours' notice on the calendar, and none at all at the door.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_UNFIT}/cancel`, {
      reason: 'unfit_to_attend',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect((await statusOf(APPT_CANCEL_UNFIT)).cancellation_reason).toBe('unfit_to_attend');
    expect(await creditsTaken(APPT_CANCEL_UNFIT)).toBe(1);
  });

  it('says plainly when a late cancellation found no credit to take', async () => {
    // Client B holds none: billing queues an exception instead, and the
    // response must not claim a charge that never happened.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_NO_CREDIT}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect(body.creditConsumed).toBe(false);
    expect(body.waiverEntitlementId).toBeNull();
  });

  it("reads the practice's own notice period rather than a constant", async () => {
    // The practice moves to a twelve-hour notice period. The visit is
    // eighteen hours out: late under twenty-four, in time under twelve, so
    // the answer changes with the setting and with nothing else.
    await owner.query('commit');
    await owner.query('update scheduling_setting set notice_hours = 12 where tenant_id = $1', [
      IDS.tenantA,
    ]);
    try {
      const res = await call(
        AUTH.ownerA,
        'POST',
        `/api/appointments/${APPT_NOTICE_SETTING}/cancel`,
        { reason: 'client_request' },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as CancelAppointmentResponse;
      expect(body.noticeHours).toBe(12);
      expect(body.status).toBe('cancelled');
    } finally {
      await owner.query('update scheduling_setting set notice_hours = 24 where tenant_id = $1', [
        IDS.tenantA,
      ]);
      await owner.query('begin');
    }
  });

  it('lets a practitioner call off their own stop', async () => {
    const res = await call(
      AUTH.practitionerA,
      'POST',
      `/api/appointments/${APPT_PRACTITIONER_OWN}/cancel`,
      { reason: 'unfit_to_attend' },
      'Nobody was home and the session could not go ahead.',
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as CancelAppointmentResponse).status).toBe('cancelled_late');
    expect((await statusOf(APPT_PRACTITIONER_OWN)).status).toBe('cancelled_late');
  });

  it("refuses a practitioner somebody else's stop, without telling them it exists", async () => {
    const res = await call(
      AUTH.practitionerA,
      'POST',
      `/api/appointments/${APPT_SOMEONE_ELSES}/cancel`,
      { reason: 'unfit_to_attend' },
    );
    expect(res.status).toBe(404);
    expect((await statusOf(APPT_SOMEONE_ELSES)).status).toBe('confirmed');
  });

  it('refuses a cancellation with no reason given', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_WITHDRAWAL_FUTURE}/cancel`,
      { reason: 'client_request' },
      null,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reason_required');
  });

  it('refuses a reason nobody chooses, so no visit is called off as a withdrawn consent', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_WITHDRAWAL_FUTURE}/cancel`,
      { reason: 'consent_withdrawn' },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it("shows another practice's owner nothing to cancel", async () => {
    const res = await call(
      AUTH_OWNER_B,
      'POST',
      `/api/appointments/${APPT_WITHDRAWAL_FUTURE}/cancel`,
      { reason: 'client_request' },
    );
    expect(res.status).toBe(404);
    expect((await statusOf(APPT_WITHDRAWAL_FUTURE)).status).toBe('confirmed');
  });
});

describe('app.cancel_future_appointments', () => {
  it('cancels forward only, never late, and stamps the reason on the trail', async () => {
    await asApiRole(owner, IDS.tenantA, async () => {
      await owner.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      const { rows } = await owner.query<{ cancelled: number }>(
        'select app.cancel_future_appointments($1, $2) as cancelled',
        [IDS.clientB, 'The household withdrew its participation consent.'],
      );
      // Every future visit this client still had — the two named below and
      // the two other tests in this file left standing for them
      // (APPT_SOMEONE_ELSES and APPT_BLOCKING_THE_CLASH) — and not the
      // completed one behind them.
      expect(rows[0]?.cancelled).toBe(4);

      const future = await owner.query(
        'select id, status::text as status, cancellation_reason::text as reason ' +
          'from appointment where id = any($1) order by window_start',
        [[APPT_WITHDRAWAL_SOON, APPT_WITHDRAWAL_FUTURE, APPT_WITHDRAWAL_PAST]],
      );
      const byId = new Map(future.rows.map((r) => [r.id as string, r]));
      // Two hours out, well inside the notice period, and still not late: a
      // withdrawal is a right exercised, not a late cancellation.
      expect(byId.get(APPT_WITHDRAWAL_SOON)?.status).toBe('cancelled');
      expect(byId.get(APPT_WITHDRAWAL_SOON)?.reason).toBe('consent_withdrawn');
      expect(byId.get(APPT_WITHDRAWAL_FUTURE)?.status).toBe('cancelled');
      // A visit already delivered is a fact about a day that has passed.
      expect(byId.get(APPT_WITHDRAWAL_PAST)?.status).toBe('completed');

      // No credit is taken, because nothing was written cancelled_late.
      const taken = await owner.query<{ n: string }>(
        'select count(*)::text as n from entitlement where consumed_by_appointment_id = any($1)',
        [[APPT_WITHDRAWAL_SOON, APPT_WITHDRAWAL_FUTURE]],
      );
      expect(Number(taken.rows[0]?.n)).toBe(0);

      // The caller's own words, on the rows it caused.
      const trail = await owner.query<{ reason: string }>(
        "select reason from audit_log where entity_type = 'appointment' and action = 'update' " +
          'and entity_id = any($1)',
        [[APPT_WITHDRAWAL_SOON, APPT_WITHDRAWAL_FUTURE]],
      );
      expect(trail.rows.length).toBe(2);
      for (const row of trail.rows) {
        expect(row.reason).toBe('The household withdrew its participation consent.');
      }
    });
  });

  it('refuses a practitioner, and a reason that says nothing', async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [
          MORE_IDS.practitionerUserA,
        ]);
        await expect(
          owner.query('select app.cancel_future_appointments($1, $2)', [IDS.clientA, 'Because.']),
        ).rejects.toMatchObject({ code: '42501' });
      },
      'practitioner',
    );
    await asApiRole(owner, IDS.tenantA, async () => {
      await owner.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      await expect(
        owner.query('select app.cancel_future_appointments($1, $2)', [IDS.clientA, '   ']),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it("reaches nothing in another practice, even for that practice's own client", async () => {
    await asApiRole(owner, IDS.tenantB, async () => {
      await owner.query("select set_config('app.actor_id', $1, true)", [IDS.ownerB]);
      const { rows } = await owner.query<{ cancelled: number }>(
        'select app.cancel_future_appointments($1, $2) as cancelled',
        [IDS.clientA, 'A withdrawal in the wrong practice.'],
      );
      expect(rows[0]?.cancelled).toBe(0);
    });
  });
});
