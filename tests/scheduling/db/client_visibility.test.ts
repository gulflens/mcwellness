import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import {
  IDS,
  asApiRole,
  freshDatabase,
  seedClient,
  seedContact,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * app.client_visible_to_practitioner (db/migrations/201_client_visible_to_practitioner.sql):
 * the schedule-based door client-record.md section 2 promises a practitioner
 * ("read the client brief for clients on their schedule only") and section 11
 * requires ("a practitioner not on that client's schedule cannot open the
 * record; the attempt is audited"). Proved three ways: directly against the
 * function, against the row security in db/policies/client/readers.sql that
 * calls it, and against the one HTTP route that already writes a 'refused'
 * audit row on denial (app/api/clients/record.ts, app/api/clients/refused.ts)
 * — a route this stream does not own and does not edit (docs/SPEC/OWNERSHIP.md),
 * so this file exercises what that route does today, not the fix it is still
 * owed (docs/CHANGE-REQUESTS/scheduling-03.md item 3).
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

// This file's own synthetic fixtures (+971 50 000 xxxx phones via the shared
// helpers only; .claude/hooks/no-real-identifiers.sh), distinct from every
// other test file's id block.
const PRACTITIONER_USER = '00000000-0000-4000-8000-000000006001';
const PRACTITIONER_ID = '00000000-0000-4000-8000-000000006002';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000006003';
const OTHER_PRACTITIONER_USER = '00000000-0000-4000-8000-000000006004';
const OTHER_PRACTITIONER_ID = '00000000-0000-4000-8000-000000006005';
const SERVICE_TYPE = '00000000-0000-4000-8000-000000006006';

const CLIENT_TODAY = '00000000-0000-4000-8000-000000006010';
const CONTACT_TODAY = '00000000-0000-4000-8000-000000006011';
const LOCATION_TODAY = '00000000-0000-4000-8000-000000006012';
const CONSENT_DOC = '00000000-0000-4000-8000-000000006013';
const APPOINTMENT_TODAY = '00000000-0000-4000-8000-000000006014';

const CLIENT_NO_VISIT = '00000000-0000-4000-8000-000000006020';

const CLIENT_CANCELLED = '00000000-0000-4000-8000-000000006021';
const LOCATION_CANCELLED = '00000000-0000-4000-8000-000000006022';
const APPOINTMENT_CANCELLED = '00000000-0000-4000-8000-000000006023';

const CLIENT_CANCELLED_LATE = '00000000-0000-4000-8000-000000006030';
const LOCATION_CANCELLED_LATE = '00000000-0000-4000-8000-000000006031';
const APPOINTMENT_CANCELLED_LATE = '00000000-0000-4000-8000-000000006032';

const CLIENT_NO_SHOW = '00000000-0000-4000-8000-000000006033';
const LOCATION_NO_SHOW = '00000000-0000-4000-8000-000000006034';
const APPOINTMENT_NO_SHOW = '00000000-0000-4000-8000-000000006035';

const CLIENT_TOO_OLD = '00000000-0000-4000-8000-000000006024';
const LOCATION_TOO_OLD = '00000000-0000-4000-8000-000000006025';
const APPOINTMENT_TOO_OLD = '00000000-0000-4000-8000-000000006026';

const CLIENT_WITHIN_WINDOW = '00000000-0000-4000-8000-000000006027';
const LOCATION_WITHIN_WINDOW = '00000000-0000-4000-8000-000000006028';
const APPOINTMENT_WITHIN_WINDOW = '00000000-0000-4000-8000-000000006029';

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

async function call(sub: string, method: string, path: string): Promise<Response> {
  return api.request(path, {
    method,
    headers: { authorization: `Bearer ${await mint(sub)}` },
  });
}

/** A visibility check as the practitioner fixture, under row security. */
async function visibleToPractitioner(clientId: string): Promise<boolean> {
  return asApiRole(
    owner,
    IDS.tenantA,
    async () => {
      await owner.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
      const { rows } = await owner.query<{ visible: boolean }>(
        'select app.client_visible_to_practitioner($1) as visible',
        [clientId],
      );
      return rows[0]?.visible ?? false;
    },
    'practitioner',
  );
}

/** Minutes-precise offsets from the real clock: app.client_visible_to_practitioner
 * reads now() itself (it is an RLS-called function, not a domain one; CLAUDE.md
 * rule 4's "time is always an argument" binds domain/scheduling's pure
 * functions, not this SQL door), so the fixtures below are built relative to
 * the moment the test runs rather than a fixed date. */
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}
function ago(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}
function plus45(start: Date): Date {
  return new Date(start.getTime() + 45 * 60_000);
}

const APPOINTMENT_INSERT_SQL =
  'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
  'location_id, delivery_mode, window_start, window_end, travel_buffer_minutes, status) ' +
  "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 15, $9)";

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');

  await seedUser(owner, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_ID, PRACTITIONER_USER);

  // A second, uninvolved practitioner: proves the door is per-practitioner,
  // not per-client — nobody's schedule but the assignee's own grants anything.
  await seedUser(owner, {
    id: OTHER_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner (uninvolved)',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, OTHER_PRACTITIONER_ID, OTHER_PRACTITIONER_USER);

  // CLIENT_TODAY: a confirmed appointment that started an hour ago, plus one
  // of each row every client-record read policy that calls this function
  // gates (readers.sql: client, contact, location, consent, goal) — this is
  // "the record" the first test proves a visible practitioner can read.
  await seedClient(owner, IDS.tenantA, CLIENT_TODAY, IDS.ownerA, 'Today');
  await seedContact(owner, IDS.tenantA, CONTACT_TODAY, CLIENT_TODAY, 'x-visibility-today');
  await seedLocation(owner, IDS.tenantA, LOCATION_TODAY, CLIENT_TODAY, IDS.ownerA);
  await owner.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, created_by) ' +
      "values ($1, $2, 'consent_text', 'consent-text-v1', 'text/plain', " +
      "sha256('consent-text-v1'::bytea), $3)",
    [CONSENT_DOC, IDS.tenantA, IDS.ownerA],
  );
  await owner.query(
    'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, status, method, created_by) values ($1, $2, $3, 'participation', 1, " +
      "$4, 'active', 'app_signature', $5)",
    [IDS.tenantA, CLIENT_TODAY, CONTACT_TODAY, CONSENT_DOC, IDS.ownerA],
  );
  const focusCategory = await owner.query<{ id: string }>(
    "select id from goal_category where tenant_id = $1 and code = 'focus'",
    [IDS.tenantA],
  );
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description) values ' +
      "(gen_random_uuid(), $1, $2, $3, 'Better focus at school')",
    [IDS.tenantA, CLIENT_TODAY, focusCategory.rows[0]?.id],
  );
  const todayStart = hoursAgo(1);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_TODAY,
    IDS.tenantA,
    CLIENT_TODAY,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_TODAY,
    todayStart,
    plus45(todayStart),
    'confirmed',
  ]);

  // CLIENT_NO_VISIT: no appointment at all, with anyone.
  await seedClient(owner, IDS.tenantA, CLIENT_NO_VISIT, IDS.ownerA, 'NoVisit');

  // CLIENT_CANCELLED: the only appointment is cancelled.
  await seedClient(owner, IDS.tenantA, CLIENT_CANCELLED, IDS.ownerA, 'Cancelled');
  await seedLocation(owner, IDS.tenantA, LOCATION_CANCELLED, CLIENT_CANCELLED, IDS.ownerA);
  const cancelledStart = ago(2);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_CANCELLED,
    IDS.tenantA,
    CLIENT_CANCELLED,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_CANCELLED,
    cancelledStart,
    plus45(cancelledStart),
    'cancelled',
  ]);

  // CLIENT_CANCELLED_LATE: called off inside the notice period. Still a
  // cancellation, so still no door — the whole reason the function tests
  // `status not in ('cancelled', 'cancelled_late')` rather than the plain
  // status alone.
  await seedClient(owner, IDS.tenantA, CLIENT_CANCELLED_LATE, IDS.ownerA, 'CancelledLate');
  await seedLocation(
    owner,
    IDS.tenantA,
    LOCATION_CANCELLED_LATE,
    CLIENT_CANCELLED_LATE,
    IDS.ownerA,
  );
  const cancelledLateStart = hoursAgo(3);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_CANCELLED_LATE,
    IDS.tenantA,
    CLIENT_CANCELLED_LATE,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_CANCELLED_LATE,
    cancelledLateStart,
    plus45(cancelledLateStart),
    'cancelled_late',
  ]);

  // CLIENT_NO_SHOW: the practitioner was genuinely sent to this door and
  // nobody answered. Not a cancellation, so the record stays open to them.
  await seedClient(owner, IDS.tenantA, CLIENT_NO_SHOW, IDS.ownerA, 'NoShow');
  await seedLocation(owner, IDS.tenantA, LOCATION_NO_SHOW, CLIENT_NO_SHOW, IDS.ownerA);
  const noShowStart = hoursAgo(4);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_NO_SHOW,
    IDS.tenantA,
    CLIENT_NO_SHOW,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_NO_SHOW,
    noShowStart,
    plus45(noShowStart),
    'no_show',
  ]);

  // CLIENT_TOO_OLD: the only appointment's window started 91 days ago.
  await seedClient(owner, IDS.tenantA, CLIENT_TOO_OLD, IDS.ownerA, 'TooOld');
  await seedLocation(owner, IDS.tenantA, LOCATION_TOO_OLD, CLIENT_TOO_OLD, IDS.ownerA);
  const tooOldStart = ago(91);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_TOO_OLD,
    IDS.tenantA,
    CLIENT_TOO_OLD,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_TOO_OLD,
    tooOldStart,
    plus45(tooOldStart),
    'completed',
  ]);

  // CLIENT_WITHIN_WINDOW: a completed appointment 89 days ago — comfortably
  // inside the 90-day floor (not the exact boundary, which real-clock drift
  // between this insert and the function's own now() would make flaky).
  await seedClient(owner, IDS.tenantA, CLIENT_WITHIN_WINDOW, IDS.ownerA, 'WithinWindow');
  await seedLocation(owner, IDS.tenantA, LOCATION_WITHIN_WINDOW, CLIENT_WITHIN_WINDOW, IDS.ownerA);
  const withinWindowStart = ago(89);
  await owner.query(APPOINTMENT_INSERT_SQL, [
    APPOINTMENT_WITHIN_WINDOW,
    IDS.tenantA,
    CLIENT_WITHIN_WINDOW,
    PRACTITIONER_ID,
    SERVICE_TYPE,
    LOCATION_WITHIN_WINDOW,
    withinWindowStart,
    plus45(withinWindowStart),
    'completed',
  ]);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });

  // From here, the raw-SQL (asApiRole) tests can use savepoints; every fixture
  // above is already committed.
  await owner.query('begin');
});

afterAll(async () => {
  await owner.query('rollback');
  await owner.end();
  await pool.end();
});

describe('app.client_visible_to_practitioner', () => {
  it('grants a practitioner with a confirmed visit today', async () => {
    expect(await visibleToPractitioner(CLIENT_TODAY)).toBe(true);
  });

  it('refuses a practitioner with no appointment for the client at all', async () => {
    expect(await visibleToPractitioner(CLIENT_NO_VISIT)).toBe(false);
  });

  it('does not grant when the only appointment is cancelled', async () => {
    expect(await visibleToPractitioner(CLIENT_CANCELLED)).toBe(false);
  });

  it('does not grant when the only appointment was cancelled late either', async () => {
    expect(await visibleToPractitioner(CLIENT_CANCELLED_LATE)).toBe(false);
  });

  it('still grants after a no-show: the visit was genuinely theirs', async () => {
    expect(await visibleToPractitioner(CLIENT_NO_SHOW)).toBe(true);
  });

  it('does not grant when the only appointment was 91 days ago', async () => {
    expect(await visibleToPractitioner(CLIENT_TOO_OLD)).toBe(false);
  });

  it('still grants for an appointment comfortably inside the 90-day floor', async () => {
    expect(await visibleToPractitioner(CLIENT_WITHIN_WINDOW)).toBe(true);
  });

  it('grants nothing to a practitioner who is not the appointment’s own assignee', async () => {
    const visible = await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [OTHER_PRACTITIONER_USER]);
        const { rows } = await owner.query<{ visible: boolean }>(
          'select app.client_visible_to_practitioner($1) as visible',
          [CLIENT_TODAY],
        );
        return rows[0]?.visible ?? false;
      },
      'practitioner',
    );
    expect(visible).toBe(false);
  });
});

describe('the row security this function gates (db/policies/client/readers.sql)', () => {
  it("reads that client's row and record for a practitioner on their schedule", async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
        const client = await owner.query('select id from client where id = $1', [CLIENT_TODAY]);
        expect(client.rowCount).toBe(1);
        const contact = await owner.query('select id from contact where id = $1', [CONTACT_TODAY]);
        expect(contact.rowCount).toBe(1);
        const location = await owner.query('select id from location where id = $1', [
          LOCATION_TODAY,
        ]);
        expect(location.rowCount).toBe(1);
        const consent = await owner.query('select id from consent where client_id = $1', [
          CLIENT_TODAY,
        ]);
        expect(consent.rowCount).toBe(1);
        const goal = await owner.query('select id from goal where client_id = $1', [CLIENT_TODAY]);
        expect(goal.rowCount).toBe(1);
      },
      'practitioner',
    );
  });

  it('shows nothing of a client the practitioner has no visit with', async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
        const client = await owner.query('select id from client where id = $1', [CLIENT_NO_VISIT]);
        expect(client.rowCount).toBe(0);
      },
      'practitioner',
    );
  });
});

describe('GET /api/clients/:id refuses and audits a practitioner outside the client’s schedule', () => {
  it('answers 403 and writes one refused audit row naming the client', async () => {
    const res = await call(PRACTITIONER_AUTH, 'GET', `/api/clients/${CLIENT_NO_VISIT}`);
    expect(res.status).toBe(403);

    const { rows } = await owner.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      client_id: string;
    }>(
      "select action, entity_type, entity_id, client_id from audit_log where action = 'refused' " +
        "and entity_type = 'client' and entity_id = $1",
      [CLIENT_NO_VISIT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'refused',
      entity_type: 'client',
      entity_id: CLIENT_NO_VISIT,
      client_id: CLIENT_NO_VISIT,
    });
  });
});
