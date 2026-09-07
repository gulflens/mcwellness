import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import type { ReorderResponse } from '@app/api/appointments/schema';
import {
  AUTH,
  IDS,
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
 * `POST /api/appointments/reorder` — several visits of one practitioner's day
 * moved in one transaction, which is how the day map applies an optimised
 * order (docs/SPEC/route-planning.md section 5.7).
 *
 * What this file holds the route to: a swap that would clash with itself goes
 * through, because every old row is retired before any new one is taken; every
 * row it writes carries the coordinator's reason; a plan computed against a day
 * that has since moved is refused whole and writes nothing; a visit a household
 * has been told about is not in a plan's moves at all; a clash with a visit
 * outside the plan rolls the whole thing back rather than applying half of it;
 * and only the calendar's three roles may ask.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);
const REASON = 'Day optimised on the map';

// This file's own synthetic ids, distinct from every other test file's block.
const PRACTITIONER = '00000000-0000-4000-8000-000000008101';
const PRACTITIONER_USER = '00000000-0000-4000-8000-000000008102';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000008103';
const FINANCE_USER = '00000000-0000-4000-8000-000000008104';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000008105';
const SERVICE_TYPE = '00000000-0000-4000-8000-000000008106';
const REFERRAL_DOC = '00000000-0000-4000-8000-000000008107';

const CLIENT_A = '00000000-0000-4000-8000-000000008110';
const CONTACT_A = '00000000-0000-4000-8000-000000008111';
const LOCATION_A = '00000000-0000-4000-8000-000000008112';
const APPT_A = '00000000-0000-4000-8000-000000008113';

const CLIENT_B = '00000000-0000-4000-8000-000000008114';
const CONTACT_B = '00000000-0000-4000-8000-000000008115';
const LOCATION_B = '00000000-0000-4000-8000-000000008116';
const APPT_B = '00000000-0000-4000-8000-000000008117';

const CLIENT_C = '00000000-0000-4000-8000-000000008118';
const CONTACT_C = '00000000-0000-4000-8000-000000008119';
const LOCATION_C = '00000000-0000-4000-8000-000000008120';
const APPT_C = '00000000-0000-4000-8000-000000008121';

const CLIENT_D = '00000000-0000-4000-8000-000000008122';
const CONTACT_D = '00000000-0000-4000-8000-000000008123';
const LOCATION_D = '00000000-0000-4000-8000-000000008124';
/** Told about, and so never in a plan's moves. */
const APPT_CONFIRMED = '00000000-0000-4000-8000-000000008125';
/** Not in any plan, and standing in the way of one of the new windows. */
const APPT_OTHER = '00000000-0000-4000-8000-000000008126';

const NOW = new Date();
/** Three days ahead: every visit is comfortably clear of the coming hour. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
  new Date(NOW.getTime() + 3 * 24 * 60 * 60_000),
);

function iso(hhmm: string): string {
  return new Date(`${DAY}T${hhmm}:00+04:00`).toISOString();
}
function plus45(start: string): string {
  return new Date(new Date(start).getTime() + 45 * 60_000).toISOString();
}

/** The window APPT_OTHER already holds, which nothing in a plan may land on. */
const OTHER_WINDOW = iso('16:00');

const APPOINTMENT_INSERT_SQL =
  'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
  'location_id, delivery_mode, window_start, window_end, travel_buffer_minutes, status, ' +
  "created_by) values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 15, $9, $10)";

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

async function call(sub: string, body: unknown, reason: string | null = REASON): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await mint(sub)}`,
    'content-type': 'application/json',
  };
  if (reason !== null) headers['x-reason'] = reason;
  return api.request('/api/appointments/reorder', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

type Row = { id: string; status: string; window_start: Date; rescheduled_from_id: string | null };

async function statusOf(id: string): Promise<Row> {
  const { rows } = await owner.query<Row>(
    'select id, status::text as status, window_start, rescheduled_from_id from appointment where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no appointment ${id}`);
  return row;
}

async function linkedFrom(id: string): Promise<string | null> {
  return (await statusOf(id)).rescheduled_from_id;
}

/** Every live window this practitioner holds, so "nothing was written" can be asserted. */
async function proposedWindows(): Promise<string[]> {
  const { rows } = await owner.query<{ window_start: Date; status: string }>(
    'select window_start, status::text as status from appointment ' +
      "where practitioner_id = $1 and status not in ('cancelled', 'cancelled_late', 'rescheduled') " +
      'order by window_start, id',
    [PRACTITIONER],
  );
  return rows.map((r) => `${r.window_start.toISOString()}:${r.status}`);
}

/** The one plan every refusal case starts from: a swap of the first and the last. */
function validBody() {
  return {
    date: DAY,
    practitionerId: PRACTITIONER,
    moves: [
      {
        appointmentId: APPT_A,
        windowStart: iso('12:00'),
        wasWindowStart: iso('09:00'),
        travelBufferMinutes: 20,
      },
      {
        appointmentId: APPT_C,
        windowStart: iso('09:00'),
        wasWindowStart: iso('12:00'),
        travelBufferMinutes: 25,
      },
    ],
  };
}

async function seedHousehold(
  clientId: string,
  contactId: string,
  locationId: string,
  familyName: string,
): Promise<void> {
  await seedClient(owner, IDS.tenantA, clientId, IDS.ownerA, familyName);
  await owner.query(
    "update client set status = 'active', date_of_birth = '1990-01-01' where id = $1",
    [clientId],
  );
  await seedContact(owner, IDS.tenantA, contactId, clientId, `x-reorder-${contactId}`);
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

async function seedAppointment(
  id: string,
  clientId: string,
  locationId: string,
  windowStart: string,
  status: 'proposed' | 'confirmed',
): Promise<void> {
  await owner.query(APPOINTMENT_INSERT_SQL, [
    id,
    IDS.tenantA,
    clientId,
    PRACTITIONER,
    SERVICE_TYPE,
    locationId,
    windowStart,
    plus45(windowStart),
    status,
    IDS.ownerA,
  ]);
}

/** Puts the day back exactly as it was seeded, so each case starts from the same day. */
async function resetTheDay(): Promise<void> {
  await owner.query('delete from appointment where practitioner_id = $1', [PRACTITIONER]);
  await seedAppointment(APPT_A, CLIENT_A, LOCATION_A, iso('09:00'), 'proposed');
  await seedAppointment(APPT_B, CLIENT_B, LOCATION_B, iso('10:30'), 'proposed');
  await seedAppointment(APPT_C, CLIENT_C, LOCATION_C, iso('12:00'), 'proposed');
  await seedAppointment(APPT_CONFIRMED, CLIENT_D, LOCATION_D, iso('13:30'), 'confirmed');
  await seedAppointment(APPT_OTHER, CLIENT_D, LOCATION_D, OTHER_WINDOW, 'proposed');
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');

  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: PRACTITIONER,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, created_by) ' +
      "values ($1, $2, 'referral', 'referral-reorder', 'text/plain', " +
      "sha256('referral-reorder'::bytea), $3)",
    [REFERRAL_DOC, IDS.tenantA, IDS.ownerA],
  );

  await seedHousehold(CLIENT_A, CONTACT_A, LOCATION_A, 'Alpha');
  await seedHousehold(CLIENT_B, CONTACT_B, LOCATION_B, 'Beta');
  await seedHousehold(CLIENT_C, CONTACT_C, LOCATION_C, 'Gamma');
  await seedHousehold(CLIENT_D, CONTACT_D, LOCATION_D, 'Delta');

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

beforeEach(resetTheDay);

describe('POST /api/appointments/reorder', () => {
  it('swaps two visits in one transaction: both retired, both standing again, each linked to what it replaced', async () => {
    const res = await call(AUTH.ownerA, validBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReorderResponse;
    expect(body.appointments).toHaveLength(2);
    expect(body.movedFrom.map((m) => m.id)).toEqual([APPT_A, APPT_C]);
    expect((await statusOf(APPT_A)).status).toBe('rescheduled');
    expect((await statusOf(APPT_C)).status).toBe('rescheduled');
    // The window each household was promised is still on the row it was promised on.
    expect((await statusOf(APPT_A)).window_start.toISOString()).toBe(iso('09:00'));
    for (const row of body.appointments) expect(row.status).toBe('proposed');
    expect(body.appointments[0]?.windowStart).toBe(iso('12:00'));
    expect(body.appointments[1]?.windowStart).toBe(iso('09:00'));
    const first = body.appointments[0];
    if (!first) throw new Error('no appointment came back');
    expect(await linkedFrom(first.id)).toBe(APPT_A);
  });

  it('records the reason on every row it writes', async () => {
    const res = await call(AUTH.ownerA, validBody());
    const body = (await res.json()) as ReorderResponse;
    const { rows } = await owner.query<{ reason: string }>(
      "select reason from audit_log where entity_type = 'appointment' and entity_id = any($1) " +
        "and action = 'insert' order by id",
      [body.appointments.map((a) => a.id)],
    );
    expect(rows.map((r) => r.reason)).toEqual([REASON, REASON]);
  });

  it('refuses without a reason, and writes nothing', async () => {
    const before = await proposedWindows();
    const res = await call(AUTH.ownerA, validBody(), null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('reason_required');
    expect(await proposedWindows()).toEqual(before);
  });

  it('refuses the same visit named twice, and writes nothing', async () => {
    const before = await proposedWindows();
    const body = validBody();
    const res = await call(AUTH.ownerA, {
      ...body,
      moves: [body.moves[0], body.moves[0]],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_request');
    expect(await proposedWindows()).toEqual(before);
  });

  it('refuses a plan computed against a window that has since moved, and writes nothing', async () => {
    const before = await proposedWindows();
    const body = validBody();
    const res = await call(AUTH.ownerA, {
      ...body,
      moves: [{ ...body.moves[0], wasWindowStart: iso('08:00') }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('stale_plan');
    expect(await proposedWindows()).toEqual(before);
  });

  it('refuses a visit the household has already been told about', async () => {
    const before = await proposedWindows();
    const res = await call(AUTH.ownerA, {
      date: DAY,
      practitionerId: PRACTITIONER,
      moves: [
        {
          appointmentId: APPT_CONFIRMED,
          windowStart: iso('14:00'),
          wasWindowStart: iso('13:30'),
          travelBufferMinutes: 15,
        },
      ],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('stale_plan');
    expect(await proposedWindows()).toEqual(before);
  });

  it('rolls the whole thing back when one new window clashes with a visit outside the plan', async () => {
    const before = await proposedWindows();
    // APPT_OTHER belongs to the same practitioner and is not in the moves;
    // the second move lands on top of it.
    const res = await call(AUTH.ownerA, {
      date: DAY,
      practitionerId: PRACTITIONER,
      moves: [
        {
          appointmentId: APPT_A,
          windowStart: iso('12:00'),
          wasWindowStart: iso('09:00'),
          travelBufferMinutes: 20,
        },
        {
          appointmentId: APPT_C,
          windowStart: OTHER_WINDOW,
          wasWindowStart: iso('12:00'),
          travelBufferMinutes: 15,
        },
      ],
    });
    expect(res.status).toBe(409);
    // Nothing retired, nothing inserted: the transaction rolled back whole.
    expect(await proposedWindows()).toEqual(before);
    expect((await statusOf(APPT_A)).status).toBe('proposed');
  });

  it('refuses a caller who is not the calendar', async () => {
    expect((await call(FINANCE_AUTH, validBody())).status).toBe(403);
    expect((await call(PRACTITIONER_AUTH, validBody())).status).toBe(403);
  });
});
