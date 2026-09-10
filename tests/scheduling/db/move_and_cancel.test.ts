import { SignJWT } from 'jose';
import pg from 'pg';
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
  rejectsWith,
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
const AUTH_FINANCE = '00000000-0000-4000-8000-000000006124';
const FINANCE_USER = '00000000-0000-4000-8000-000000006125';
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
// Called off late and then forgiven, to prove the id the answer hands back is
// one billing's own waiver route will act on.
const APPT_WAIVED = '00000000-0000-4000-8000-000000006123';
// Two visits whose arrival window has already opened: the practitioner is at
// the door, which is the only moment 'unfit_to_attend' can honestly be given.
const APPT_UNFIT_AT_DOOR = '00000000-0000-4000-8000-000000006116';
const APPT_PRACTITIONER_AT_DOOR = '00000000-0000-4000-8000-000000006117';
// A visit with a session already open beneath it: neither moved nor called off.
const APPT_SESSION_OPEN = '00000000-0000-4000-8000-000000006118';
const OPEN_SESSION = '00000000-0000-4000-8000-000000006119';
// A third household, holding no credits at all, so the "no credit to take"
// case does not depend on which other test ran first.
// Confirming a visit: one waiting to be told about, one already told about,
// one already called off, and one belonging to another practice's day.
const APPT_CONFIRM_OK = '00000000-0000-4000-8000-000000006126';
const APPT_CONFIRM_ALREADY = '00000000-0000-4000-8000-000000006127';
const APPT_CONFIRM_SETTLED = '00000000-0000-4000-8000-000000006128';
const APPT_CONFIRM_REFUSED = '00000000-0000-4000-8000-000000006129';
// A visit nobody has been told about, called off well inside the notice
// period: it costs the household nothing, and two of the reasons cannot
// honestly be given about it at all.
const APPT_UNTOLD_LATE = '00000000-0000-4000-8000-000000006130';
const APPT_UNTOLD_REASON = '00000000-0000-4000-8000-000000006131';
/** The visit whose move loses a race to a booking committed mid-request. */
const APPT_RACE = '00000000-0000-4000-8000-000000006132';
/** The booking that wins that race, written from a second connection. */
const APPT_RACE_RIVAL = '00000000-0000-4000-8000-000000006133';
const CLIENT_NO_CREDIT = '00000000-0000-4000-8000-000000006120';
const CONTACT_NO_CREDIT = '00000000-0000-4000-8000-000000006121';
const LOCATION_NO_CREDIT = '00000000-0000-4000-8000-000000006122';

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

/**
 * The calendar day an instant falls on in the practice's own zone, as
 * YYYY-MM-DD. `GET /api/appointments` reads its `date` as a day in Asia/Dubai
 * (app/api/appointments/list.ts opens the day at `+04:00`), so naming that day
 * in UTC asks for the wrong one whenever the instant lands after 20:00 UTC —
 * which, for a window a fixed number of hours out, is decided by the hour the
 * suite happens to start. `en-CA` is the locale whose numeric date is already
 * YYYY-MM-DD, and the zone is read straight from Intl rather than from the
 * route's own constant, so the fixture does not lean on the code it checks.
 */
const PRACTICE_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' });
function practiceDay(at: Date): string {
  return PRACTICE_DAY.format(at);
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
      args.clientId === IDS.clientA
        ? IDS.locationA
        : args.clientId === IDS.clientB
          ? LOCATION_B
          : LOCATION_NO_CREDIT,
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

/**
 * The call-out fee billing charged for a visit that did not happen, in fils,
 * and null when it charged nothing (migration 408, the founder's decision of
 * 2026-09-04: one fee, never a session).
 */
async function feeCharged(appointmentId: string): Promise<number | null> {
  const { rows } = await owner.query<{ gross_fils: number }>(
    "select gross_fils from invoice where appointment_id = $1 and kind = 'call_out_fee'",
    [appointmentId],
  );
  return rows[0]?.gross_fils ?? null;
}

async function statusOf(appointmentId: string): Promise<{
  status: string;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  rescheduled_from_id: string | null;
  reassigned_from_practitioner_id: string | null;
  window_start: Date;
}> {
  const { rows } = await owner.query(
    'select status::text as status, cancellation_reason::text as cancellation_reason, ' +
      'cancelled_at, rescheduled_from_id, reassigned_from_practitioner_id, window_start ' +
      'from appointment where id = $1',
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

  // Finance: records money, arranges nothing (scheduling-manual.md section 2).
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_FINANCE,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  // A client contact, for the deny case on the policy read.
  await seedUser(owner, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
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
    [CLIENT_NO_CREDIT, CONTACT_NO_CREDIT, LOCATION_NO_CREDIT, 'Gamma'],
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
  await seedAppointment(APPT_RACE, { clientId: IDS.clientA, windowStart: hoursFromNow(800) });
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
  await seedAppointment(APPT_NO_CREDIT, {
    clientId: CLIENT_NO_CREDIT,
    windowStart: hoursFromNow(3),
  });
  await seedAppointment(APPT_WAIVED, { clientId: IDS.clientA, windowStart: hoursFromNow(7) });
  // Windows already open. Practitioner A holds both, two hours apart, which is
  // clear of the one hour each occupies (a 45-minute window plus a 15-minute
  // travel buffer) with room to spare — the two `hoursFromNow` calls read the
  // clock a moment apart, and a gap of exactly one hour would land on that.
  await seedAppointment(APPT_UNFIT_AT_DOOR, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(-1),
  });
  await seedAppointment(APPT_PRACTITIONER_AT_DOOR, {
    clientId: IDS.clientB,
    windowStart: hoursFromNow(-3),
  });
  await seedAppointment(APPT_SESSION_OPEN, {
    clientId: CLIENT_NO_CREDIT,
    windowStart: hoursFromNow(700),
  });

  // Both on the household that holds credits, so "nothing was taken" is a
  // fact about the rule rather than about an empty ledger.
  await seedAppointment(APPT_UNTOLD_LATE, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(9),
    status: 'proposed',
  });
  await seedAppointment(APPT_UNTOLD_REASON, {
    clientId: IDS.clientA,
    windowStart: hoursFromNow(12),
    status: 'proposed',
  });

  // Four for the confirmation door. Each on its own client-and-window so the
  // exclusion constraints hold them apart, and each far enough out that the
  // notice period is not in play.
  // All four on the third household, whose visits no other test in this file
  // counts: the withdrawal door's own test asserts how many of one client's
  // future visits it cancelled, and a visit added here for a client it names
  // would change that number without changing anything it is about.
  for (const [id, hours, status] of [
    [APPT_CONFIRM_OK, 300, 'proposed'],
    [APPT_CONFIRM_ALREADY, 320, 'confirmed'],
    [APPT_CONFIRM_SETTLED, 340, 'cancelled'],
    [APPT_CONFIRM_REFUSED, 360, 'proposed'],
  ] as const) {
    await seedAppointment(id, {
      clientId: CLIENT_NO_CREDIT,
      windowStart: hoursFromNow(hours),
      status,
    });
  }

  // Credits for the households whose late cancellations should take one.
  // The third household deliberately holds none.
  await giveCredit(IDS.clientA);
  await giveCredit(IDS.clientA);
  await giveCredit(IDS.clientA);
  await giveCredit(IDS.clientB);

  // A session already open on one visit, so both routes can be held to
  // refusing underneath one.
  //
  // Written straight in, and the appointment deliberately left reading
  // `confirmed` rather than `checked_in`. Migration 305 now flips the status at
  // check-in, so in ordinary life the status test in both routes catches this
  // first; this fixture is the state the two guards disagree about, which is
  // the only state in which the open-session check can be proved to do
  // anything at all.
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'appointment_id, delivery_mode, checked_in_at, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', now(), $7)",
    [
      OPEN_SESSION,
      IDS.tenantA,
      CLIENT_NO_CREDIT,
      MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      APPT_SESSION_OPEN,
      IDS.ownerA,
    ],
  );

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
    // And nobody was handed anything. The column migration 210 added is set by
    // a reassignment alone (docs/SPEC/dispatch.md section 6.3), so a plain move
    // — the same practitioner, a new window — leaves it empty.
    expect(after.reassigned_from_practitioner_id).toBeNull();
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

  it('answers a slot taken while the move was in flight with its own 409, not an internal error', async () => {
    /**
     * The one refusal this route has never delivered (the review of the day
     * map's pull request, finding S3, a defect older than that piece).
     *
     * A booking committed between the conflict read and the insert is caught
     * by the exclusion constraint as `23P01`, which aborts the Postgres
     * transaction. The route *returned* its 409 body, and
     * `withRequestContext`'s guard for exactly that case then found the
     * transaction unusable and replaced the answer with `{"error":"internal"}`
     * 500. The data was always safe; what the coordinator read was an internal
     * error instead of "that slot is taken". Raised rather than returned, the
     * body survives the rollback.
     *
     * The race is arranged honestly and not simulated. A second connection
     * inserts the rival booking and holds its transaction open: read committed
     * hides an uncommitted row, so this move's own reads and `checkConflicts`
     * pass, and its insert then blocks on the exclusion index until that
     * transaction commits — at which point it is refused. The two paths are
     * told apart by `conflictsWithAppointmentId`, which `checkConflicts` fills
     * in and the constraint cannot.
     */
    const target = hoursFromNow(820);
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
          CLIENT_NO_CREDIT,
          MORE_IDS.practitionerA,
          MORE_IDS.serviceTypeA,
          LOCATION_NO_CREDIT,
          target,
          new Date(target.getTime() + 45 * 60_000),
          IDS.ownerA,
        ],
      );
      pending = call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_RACE}/move`, {
        windowStart: target.toISOString(),
      });
      // Long enough for the request to finish its reads and block on the
      // index, and far inside both the ten-second request budget and the
      // API role's ten-second statement timeout.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await rival.query('commit');
      const res = await pending;
      pending = null;
      expect(res.status).toBe(409);
      const body = (await res.json()) as ConflictResponse;
      expect(body.error).toBe('conflict');
      expect(body.issues.map((issue) => issue.code)).toContain('practitioner_overlap');
      // Null, and not the rival's id: this refusal came from the constraint at
      // write time, which is the path that used to answer 500.
      expect(body.issues[0]?.conflictsWithAppointmentId).toBeNull();
      // And nothing is left half-done: the visit still stands where it was.
      expect((await statusOf(APPT_RACE)).status).toBe('confirmed');
    } finally {
      await pending;
      // The rival really committed, so the ambient rollback the rest of this
      // file leans on will not sweep it away. Taken back on its own
      // connection, which commits at once and holds no lock anybody waits on.
      await rival.query('delete from appointment where id = $1', [APPT_RACE_RIVAL]);
      await rival.end();
    }
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

  it('refuses to move a visit somebody has already started delivering', async () => {
    // Moving it would retire the appointment the open session still points at,
    // and closing that session later would complete a superseded row while its
    // replacement stood for ever.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SESSION_OPEN}/move`, {
      windowStart: hoursFromNow(710).toISOString(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('session_open');
    expect((await statusOf(APPT_SESSION_OPEN)).status).toBe('confirmed');
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

  it('refuses finance, who record money without arranging the day', async () => {
    const res = await call(AUTH_FINANCE, 'POST', `/api/appointments/${APPT_MOVE_OK}/move`, {
      windowStart: hoursFromNow(100).toISOString(),
    });
    expect(res.status).toBe(403);
  });

  it("shows another practice's owner nothing to move", async () => {
    const res = await call(AUTH_OWNER_B, 'POST', `/api/appointments/${APPT_MOVE_OK}/move`, {
      windowStart: hoursFromNow(100).toISOString(),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/appointments/:id/confirm', () => {
  it("records the household as told, and the visit then stands on its practitioner's own day", async () => {
    // Before: the visit exists, and the practitioner it belongs to cannot see
    // it. That is the rule OWN_STATUS_FILTER states and it is right — nobody
    // should drive to a house that is not expecting them — and until this
    // route existed there was no way out of it (docs/CHANGE-REQUESTS/qa-01.md
    // item 1).
    const day = practiceDay(hoursFromNow(300));
    const before = await call(AUTH.practitionerA, 'GET', `/api/appointments?date=${day}&scope=own`);
    expect(before.status).toBe(200);
    expect(
      ((await before.json()) as { appointments: { id: string }[] }).appointments.map((a) => a.id),
    ).not.toContain(APPT_CONFIRM_OK);

    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CONFIRM_OK}/confirm`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: APPT_CONFIRM_OK, status: 'confirmed' });
    expect((await statusOf(APPT_CONFIRM_OK)).status).toBe('confirmed');

    const after = await call(AUTH.practitionerA, 'GET', `/api/appointments?date=${day}&scope=own`);
    expect(
      ((await after.json()) as { appointments: { id: string }[] }).appointments.map((a) => a.id),
    ).toContain(APPT_CONFIRM_OK);
  });

  it('needs no reason: confirming records a telephone call, it takes nothing back', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_CONFIRM_REFUSED}/confirm`,
      {},
      null,
    );
    expect(res.status).toBe(200);
    expect((await statusOf(APPT_CONFIRM_REFUSED)).status).toBe('confirmed');
  });

  it('writes the whole of it to the trail, before and after, with the person who said so', async () => {
    const { rows } = await owner.query<{ action: string; before: unknown; after: unknown }>(
      'select action, old_values as before, new_values as after from audit_log ' +
        "where entity_type = 'appointment' and entity_id = $1 and action = 'update' " +
        'order by id desc limit 1',
      [APPT_CONFIRM_OK],
    );
    expect((rows[0]?.before as { status?: string })?.status).toBe('proposed');
    expect((rows[0]?.after as { status?: string })?.status).toBe('confirmed');
  });

  it('refuses a visit already confirmed, so nothing is announced twice', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_CONFIRM_ALREADY}/confirm`,
      {},
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('appointment_not_proposed');
  });

  it('never brings a visit that has already happened back to life', async () => {
    const res = await call(
      AUTH.ownerA,
      'POST',
      `/api/appointments/${APPT_CONFIRM_SETTLED}/confirm`,
      {},
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('appointment_not_proposed');
    expect((await statusOf(APPT_CONFIRM_SETTLED)).status).toBe('cancelled');
  });

  it("refuses a practitioner: telling a household its visit is arranged is the office's act", async () => {
    const res = await call(
      AUTH.practitionerA,
      'POST',
      `/api/appointments/${APPT_CONFIRM_ALREADY}/confirm`,
      {},
    );
    expect(res.status).toBe(403);
  });

  it('refuses finance, who record money without arranging the day', async () => {
    const res = await call(
      AUTH_FINANCE,
      'POST',
      `/api/appointments/${APPT_CONFIRM_ALREADY}/confirm`,
      {},
    );
    expect(res.status).toBe(403);
  });

  it("shows another practice's owner nothing to confirm", async () => {
    const res = await call(
      AUTH_OWNER_B,
      'POST',
      `/api/appointments/${APPT_CONFIRM_ALREADY}/confirm`,
      {},
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/appointments/:id/cancel', () => {
  it('calls a visit off outside the notice period, free and with the session kept', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_IN_TIME}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled');
    expect(body.noticeHours).toBe(24);
    expect(body.callOutFeeNetFils).toBeNull();
    expect(body.callOutFeeVatFils).toBeNull();
    expect(body.callOutFeeGrossFils).toBeNull();
    expect(body.feeInvoiceId).toBeNull();

    const row = await statusOf(APPT_CANCEL_IN_TIME);
    expect(row.status).toBe('cancelled');
    expect(row.cancellation_reason).toBe('client_request');
    expect(row.cancelled_at).not.toBeNull();
    expect(await creditsTaken(APPT_CANCEL_IN_TIME)).toBe(0);
    expect(await feeCharged(APPT_CANCEL_IN_TIME)).toBeNull();
  });

  it('calls a visit off inside the notice period, charges one fee, and names it for the waiver', async () => {
    expect(await creditsTaken(APPT_CANCEL_LATE)).toBe(0);

    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_LATE}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    // AED 150, the practice's own scheduling_setting.unfit_fee_fils — net,
    // with no VAT on top because the practice is not registered for it, so all
    // three figures are the same one (migration 406). Apart, so a screen can
    // name the same figure before the act and after it.
    expect(body.callOutFeeNetFils).toBe(15_000);
    expect(body.callOutFeeVatFils).toBe(0);
    expect(body.callOutFeeGrossFils).toBe(15_000);
    expect(body.feeInvoiceId).not.toBeNull();

    expect((await statusOf(APPT_CANCEL_LATE)).status).toBe('cancelled_late');
    // The founder's rule of 2026-09-04, at the seam the office actually
    // touches: the family pays a fee and keeps every session it bought.
    expect(await creditsTaken(APPT_CANCEL_LATE)).toBe(0);
    expect(await feeCharged(APPT_CANCEL_LATE)).toBe(15_000);

    // And the id handed back is that charge, which is what billing's waiver
    // route is addressed by.
    const { rows } = await owner.query<{ id: string }>(
      "select id from invoice where appointment_id = $1 and kind = 'call_out_fee'",
      [APPT_CANCEL_LATE],
    );
    expect(rows[0]?.id).toBe(body.feeInvoiceId);
  });

  it('refuses "could not go ahead at the door" for a visit nobody has driven to yet', async () => {
    // Two hundred hours away. Without this rule it is a way to take a whole
    // session from a household for a visit weeks off, by choosing the one
    // reason that skips the notice period.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_CANCEL_UNFIT}/cancel`, {
      reason: 'unfit_to_attend',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reason_too_early');
    expect((await statusOf(APPT_CANCEL_UNFIT)).status).toBe('confirmed');
    expect(await creditsTaken(APPT_CANCEL_UNFIT)).toBe(0);
  });

  it('refuses it in the database too, so the door is not the only thing holding it', async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [
          MORE_IDS.practitionerUserA,
        ]);
        await expect(
          owner.query('select * from app.cancel_own_appointment($1, $2, $3)', [
            APPT_CANCEL_UNFIT,
            'cancelled_late',
            'unfit_to_attend',
          ]),
        ).rejects.toMatchObject({ code: '22023' });
      },
      'practitioner',
    );
  });

  it('counts it as late once the window has opened, whatever the calendar said', async () => {
    // The window opened an hour ago; on the calendar this visit was booked long
    // in advance, and none of that notice reached the practitioner at the door.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNFIT_AT_DOOR}/cancel`, {
      reason: 'unfit_to_attend',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect((await statusOf(APPT_UNFIT_AT_DOOR)).cancellation_reason).toBe('unfit_to_attend');
    expect(await creditsTaken(APPT_UNFIT_AT_DOOR)).toBe(0);
    expect(await feeCharged(APPT_UNFIT_AT_DOOR)).toBe(15_000);
  });

  it('charges the fee to a household holding no credits at all', async () => {
    // This case used to be the awkward one: the client held nothing to take,
    // so billing queued an exception and nobody was charged for a journey the
    // practice had made. A fee does not depend on a package, so it is now the
    // ordinary case.
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_NO_CREDIT}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect(body.callOutFeeNetFils).toBe(15_000);
    expect(body.feeInvoiceId).not.toBeNull();
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

  it('lets a practitioner call off their own stop, and charges the fee for it', async () => {
    const res = await call(
      AUTH.practitionerA,
      'POST',
      `/api/appointments/${APPT_PRACTITIONER_AT_DOOR}/cancel`,
      { reason: 'unfit_to_attend' },
      'Nobody was home and the session could not go ahead.',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect((await statusOf(APPT_PRACTITIONER_AT_DOOR)).status).toBe('cancelled_late');

    // The fee really was charged, and no session was taken.
    expect(await creditsTaken(APPT_PRACTITIONER_AT_DOOR)).toBe(0);
    expect(await feeCharged(APPT_PRACTITIONER_AT_DOOR)).toBe(15_000);

    // And the answer says nothing about it, which is a limit rather than a
    // denial. A practitioner reads a client's ledger only through
    // app.client_visible_to_practitioner — confirmed visits only — and the
    // visit they have just called off has this moment dropped out of it. No
    // screen they use asks for these two fields, and waiving a fee is not
    // theirs in any case.
    expect(body.callOutFeeNetFils).toBeNull();
    expect(body.callOutFeeVatFils).toBeNull();
    expect(body.callOutFeeGrossFils).toBeNull();
    expect(body.feeInvoiceId).toBeNull();
  });

  it('takes nothing from a household never told about the visit, however close the window', async () => {
    // Nine hours out, well inside the practice's twenty-four, and still not
    // late: `proposed` is a slot the practice was holding and had mentioned to
    // nobody, so there was no notice to break
    // (docs/CHANGE-REQUESTS/qa-01.md item 5).
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNTOLD_LATE}/cancel`, {
      reason: 'practice_request',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled');
    expect(body.callOutFeeNetFils).toBeNull();
    expect(body.callOutFeeVatFils).toBeNull();
    expect(body.callOutFeeGrossFils).toBeNull();
    expect(body.feeInvoiceId).toBeNull();
    expect((await statusOf(APPT_UNTOLD_LATE)).status).toBe('cancelled');
    // The household holds credits; billing's trigger fires on cancelled_late
    // and this is not one, so nothing was charged and nothing was touched.
    expect(await creditsTaken(APPT_UNTOLD_LATE)).toBe(0);
    expect(await feeCharged(APPT_UNTOLD_LATE)).toBeNull();
  });

  it('refuses to record that a family called off a visit they were never told about', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNTOLD_REASON}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('household_not_told');
    expect((await statusOf(APPT_UNTOLD_REASON)).status).toBe('proposed');
  });

  it('refuses "could not go ahead at the door" about a visit on nobody\'s day', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_UNTOLD_REASON}/cancel`, {
      reason: 'unfit_to_attend',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('household_not_told');
    expect((await statusOf(APPT_UNTOLD_REASON)).status).toBe('proposed');
  });

  it('refuses to call off a visit somebody has already started delivering', async () => {
    const res = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_SESSION_OPEN}/cancel`, {
      reason: 'client_request',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('session_open');
    // Untouched, and nothing charged: a family should not pay a call-out fee
    // for a visit a practitioner is at that moment delivering.
    expect((await statusOf(APPT_SESSION_OPEN)).status).toBe('confirmed');
    expect(await creditsTaken(APPT_SESSION_OPEN)).toBe(0);
    expect(await feeCharged(APPT_SESSION_OPEN)).toBeNull();
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

  it('hands back an id billing will actually act on: the waiver forgives the fee', async () => {
    const available = async () =>
      Number(
        (
          await owner.query<{ n: string }>(
            "select count(*)::text as n from entitlement where client_id = $1 and status = 'available'",
            [IDS.clientA],
          )
        ).rows[0]?.n ?? 0,
      );
    const before = await available();

    const cancelled = await call(AUTH.ownerA, 'POST', `/api/appointments/${APPT_WAIVED}/cancel`, {
      reason: 'client_request',
    });
    expect(cancelled.status).toBe(200);
    const body = (await cancelled.json()) as CancelAppointmentResponse;
    expect(body.status).toBe('cancelled_late');
    expect(body.callOutFeeNetFils).toBe(15_000);
    // The family's sessions are untouched, before the waiver and after it.
    expect(await available()).toBe(before);

    // The whole point of answering with the id: one call, and the fee is
    // forgiven (docs/SPEC/billing.md section 4.3).
    const waived = await call(
      AUTH.ownerA,
      'POST',
      `/api/billing/invoices/${body.feeInvoiceId}/waiver`,
      { reason: 'The practice moved it at the last minute.' },
      'The practice moved it at the last minute.',
    );
    expect(waived.status).toBe(201);
    expect(await available()).toBe(before);

    // And what happened is still on the record: the visit stays late-cancelled
    // and the charge stays on the ledger, marked as forgiven rather than
    // deleted.
    expect((await statusOf(APPT_WAIVED)).status).toBe('cancelled_late');
    const { rows } = await owner.query<{ gross_fils: number; waived_at: Date | null }>(
      'select gross_fils, waived_at from invoice where id = $1',
      [body.feeInvoiceId],
    );
    expect(rows[0]?.gross_fils).toBe(15_000);
    expect(rows[0]?.waived_at).not.toBeNull();
  });

  it('refuses finance here too', async () => {
    // scheduling-manual.md section 2 names the owner, an admin, a lead
    // practitioner and a practitioner; finance is absent from that table on
    // purpose, and is refused before any appointment is read.
    const res = await call(
      AUTH_FINANCE,
      'POST',
      `/api/appointments/${APPT_WITHDRAWAL_FUTURE}/cancel`,
      { reason: 'client_request' },
    );
    expect(res.status).toBe(403);
    expect((await statusOf(APPT_WITHDRAWAL_FUTURE)).status).toBe('confirmed');
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

describe("the practice's cancellation policy", () => {
  it('answers the two figures the practice actually holds', async () => {
    const res = await call(AUTH.ownerA, 'GET', '/api/appointments/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ noticeHours: 24, unfitFeeFils: 15000 });
  });

  it('lets a practitioner read it: a notice period is a promise, not a secret', async () => {
    // They need it — the cancel path quotes it back — and the row policy says
    // the same (db/policies/scheduling/scheduling_setting_access.sql).
    const res = await call(AUTH.practitionerA, 'GET', '/api/appointments/settings');
    expect(res.status).toBe(200);
  });

  it("refuses a client contact, who is told the policy in the practice's own words", async () => {
    const res = await call(AUTH.contactA, 'GET', '/api/appointments/settings');
    expect(res.status).toBe(403);
  });

  it("shows another practice its own figures and never this one's", async () => {
    // Tenant B has its own settings row, created with its tenant; the read is
    // scoped by app.current_tenant_id() and by tenant_isolation beneath it.
    await owner.query('commit');
    await owner.query('update scheduling_setting set notice_hours = 6 where tenant_id = $1', [
      IDS.tenantB,
    ]);
    try {
      const mine = await call(AUTH.ownerA, 'GET', '/api/appointments/settings');
      expect((await mine.json()).noticeHours).toBe(24);
      const theirs = await call(AUTH_OWNER_B, 'GET', '/api/appointments/settings');
      expect((await theirs.json()).noticeHours).toBe(6);
    } finally {
      await owner.query('update scheduling_setting set notice_hours = 24 where tenant_id = $1', [
        IDS.tenantB,
      ]);
      await owner.query('begin');
    }
  });

  it('lets the owner change it, and records why', async () => {
    await owner.query('commit');
    try {
      const res = await call(
        AUTH.ownerA,
        'PATCH',
        '/api/appointments/settings',
        { noticeHours: 48 },
        'The founder asked for two days.',
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ noticeHours: 48, unfitFeeFils: 15000 });

      const { rows } = await owner.query<{ reason: string; changed_fields: string[] }>(
        "select reason, changed_fields from audit_log where entity_type = 'scheduling_setting' " +
          "and action = 'update' order by occurred_at desc limit 1",
      );
      expect(rows[0]?.reason).toBe('The founder asked for two days.');
      expect(rows[0]?.changed_fields).toContain('notice_hours');
    } finally {
      await owner.query('update scheduling_setting set notice_hours = 24 where tenant_id = $1', [
        IDS.tenantA,
      ]);
      await owner.query('begin');
    }
  });

  it('refuses a practitioner, at the route and at the row policy alike', async () => {
    const res = await call(
      AUTH.practitionerA,
      'PATCH',
      '/api/appointments/settings',
      { noticeHours: 1 },
      'Trying it on.',
    );
    expect(res.status).toBe(403);

    // And beneath the route: the same write, made directly as a practitioner,
    // matches no row at all (scheduling_setting_write is restrictive, so it
    // narrows tenant_isolation rather than replacing it).
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        const updated = await owner.query('update scheduling_setting set notice_hours = 1');
        expect(updated.rowCount).toBe(0);
      },
      'practitioner',
    );
    // Unchanged, whichever way it was asked.
    const { rows } = await owner.query<{ notice_hours: number }>(
      'select notice_hours from scheduling_setting where tenant_id = $1',
      [IDS.tenantA],
    );
    expect(rows[0]?.notice_hours).toBe(24);
  });

  it('refuses a change with no reason, and one that changes nothing', async () => {
    const noReason = await call(
      AUTH.ownerA,
      'PATCH',
      '/api/appointments/settings',
      { noticeHours: 48 },
      null,
    );
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).code).toBe('reason_required');

    const empty = await call(AUTH.ownerA, 'PATCH', '/api/appointments/settings', {}, 'Nothing.');
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe('invalid_request');
  });

  it('refuses a figure outside what the column will hold', async () => {
    const res = await call(
      AUTH.ownerA,
      'PATCH',
      '/api/appointments/settings',
      { noticeHours: 400 },
      'A typo.',
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it("gives no practice a way to reach another practice's row", async () => {
    // Not a route test: the row is addressed by the caller's own tenant, so
    // there is no id to aim elsewhere. This is the floor beneath that —
    // an update as tenant B touches nothing of tenant A's, whatever it asks.
    await asApiRole(owner, IDS.tenantB, async () => {
      const updated = await owner.query('update scheduling_setting set notice_hours = 1');
      expect(updated.rowCount).toBe(1);
    });
    const { rows } = await owner.query<{ notice_hours: number }>(
      'select notice_hours from scheduling_setting where tenant_id = $1',
      [IDS.tenantA],
    );
    expect(rows[0]?.notice_hours).toBe(24);
  });

  it('grants no practice the power to create or remove a policy row', async () => {
    // 202 grants app_role select and update and nothing else, so the one row a
    // practice has is the row it keeps: there is no path to two notice periods
    // or to none.
    // Each inside its own savepoint: a refused statement aborts the
    // transaction, and the second would otherwise fail for that reason rather
    // than for its own.
    await asApiRole(owner, IDS.tenantA, async () => {
      await rejectsWith(owner, '42501', 'insert into scheduling_setting (tenant_id) values ($1)', [
        IDS.tenantA,
      ]);
      await rejectsWith(owner, '42501', 'delete from scheduling_setting');
    });
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
      // Every future visit this client still had — the two named below, plus
      // the three other tests in this file left standing for them
      // (APPT_SOMEONE_ELSES, APPT_BLOCKING_THE_CLASH and
      // APPT_PRACTITIONER_OWN) — and not the completed one behind them, nor
      // the one at the door whose window opened three hours ago.
      expect(rows[0]?.cancelled).toBe(5);

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
