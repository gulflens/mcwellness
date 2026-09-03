import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import type { ServerStorageProvider } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { mountBilling } from '../../../app/api/billing/routes';
import { mountClientRecord } from '../../../app/api/clients/mount';
import { mountClients } from '../../../app/api/clients/list';
import { sweepErasureFiles } from '../../../app/api/clients/erasure-file-sweep';
import {
  AUTH,
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * Being forgotten, end to end (docs/SPEC/client-record.md section 8): the
 * request, the act, the letter, the files, and what is left afterwards.
 *
 * Against a real database and a real storage seam — the folder implementation,
 * which is the fallback every test runs on (docs/SEAMS.md) — because most of
 * what is worth proving here lives between the two: bytes that must go only
 * after the commit, an invoice that must not go at all, and a record that
 * every list and every search must stop showing.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

const ADMIN_ID = '00000000-0000-4000-8000-000000000201';
const ADMIN_AUTH = '00000000-0000-4000-8000-000000000202';
const LEAD_ID = '00000000-0000-4000-8000-000000000203';
const LEAD_AUTH = '00000000-0000-4000-8000-000000000204';
const PRACTITIONER_ID = '00000000-0000-4000-8000-000000000205';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000000206';
const FINANCE_ID = '00000000-0000-4000-8000-000000000207';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000000208';

/** Three households, because a client can only be erased once. */
const MAIN = {
  client: '00000000-0000-4000-8000-000000000211',
  contact: '00000000-0000-4000-8000-000000000212',
  portalUser: '00000000-0000-4000-8000-000000000213',
  portalAuth: '00000000-0000-4000-8000-00000000021a',
  location: '00000000-0000-4000-8000-000000000214',
  goal: '00000000-0000-4000-8000-000000000215',
  referral: '00000000-0000-4000-8000-000000000216',
  invoicePdf: '00000000-0000-4000-8000-000000000217',
  mrn: 'MW-000901',
};
const ROLLED_BACK = {
  client: '00000000-0000-4000-8000-000000000221',
  contact: '00000000-0000-4000-8000-000000000222',
  portalUser: '00000000-0000-4000-8000-000000000223',
  portalAuth: '00000000-0000-4000-8000-00000000022a',
  location: '00000000-0000-4000-8000-000000000224',
  goal: '00000000-0000-4000-8000-000000000225',
  referral: '00000000-0000-4000-8000-000000000226',
  invoicePdf: '00000000-0000-4000-8000-000000000227',
  mrn: 'MW-000902',
};
const TAXED = {
  client: '00000000-0000-4000-8000-000000000251',
  contact: '00000000-0000-4000-8000-000000000252',
  portalUser: '00000000-0000-4000-8000-000000000253',
  portalAuth: '00000000-0000-4000-8000-00000000025a',
  location: '00000000-0000-4000-8000-000000000254',
  goal: '00000000-0000-4000-8000-000000000255',
  referral: '00000000-0000-4000-8000-000000000256',
  invoicePdf: '00000000-0000-4000-8000-000000000257',
  mrn: 'MW-000904',
};
const SWEPT = {
  client: '00000000-0000-4000-8000-000000000231',
  contact: '00000000-0000-4000-8000-000000000232',
  portalUser: '00000000-0000-4000-8000-000000000233',
  portalAuth: '00000000-0000-4000-8000-00000000023a',
  location: '00000000-0000-4000-8000-000000000234',
  goal: '00000000-0000-4000-8000-000000000235',
  referral: '00000000-0000-4000-8000-000000000236',
  invoicePdf: '00000000-0000-4000-8000-000000000237',
  mrn: 'MW-000903',
};
type Household = typeof MAIN;

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n% synthetic\n');

const SERVICE_TYPE = '00000000-0000-4000-8000-000000000241';
const PRACTITIONER_ROW = '00000000-0000-4000-8000-000000000242';
const SESSION = '00000000-0000-4000-8000-000000000243';
const SESSION_EVENT = '00000000-0000-4000-8000-000000000244';
/** Another practice entirely: its admin holds every role there and none here. */
const OTHER_ADMIN_AUTH = '00000000-0000-4000-8000-000000000245';

let owner: pg.Client;
let pool: pg.Pool;
let dir: string;
let storage: ServerStorageProvider;
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

async function request(
  target: ReturnType<typeof createApi>,
  sub: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(sub)}`);
  // Every POST says what it is sending, body or no body: the API answers 415
  // otherwise (app/api/_middleware/security.ts), and the browser does the same.
  if (init.method === 'POST') headers.set('content-type', 'application/json');
  return target.request(path, {
    ...init,
    body: init.body ?? (init.method === 'POST' ? '{}' : undefined),
    headers,
  });
}

const request2 = request;
const erasurePath = (id: string): string => `/api/clients/${MAIN.client}/erasure-requests/${id}`;

/** A whole household: names in both scripts, a contact who signs in, an address, a goal, two files. */
async function seedHousehold(h: Household): Promise<void> {
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, given_name_ar, ' +
      'family_name_ar, date_of_birth, sex_at_birth, referral_source, preferred_locale, status, ' +
      "created_by) values ($1, $2, $3, 'Willow', 'Meadow', 'صفصاف', 'مرج', '1990-02-02', " +
      "'female', 'website', 'en', 'active', $4)",
    [h.client, IDS.tenantA, h.mrn, IDS.ownerA],
  );
  await owner.query(
    'insert into app_user (id, tenant_id, display_name, email, phone, auth_id, status) ' +
      "values ($1, $2, 'Household Portal', 'household@example.com', '+971500000041', $3, 'active')",
    [h.portalUser, IDS.tenantA, h.portalAuth],
  );
  await owner.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, given_name_ar, ' +
      'family_name_ar, relationship, is_legal_guardian, can_consent, phone, email, ' +
      'whatsapp_opt_in, user_id) values ($1, $2, $3, ' +
      "'Iris', 'Meadow', 'سوسن', 'مرج', 'self', false, true, '+971500000042', " +
      "'iris@example.com', true, $4)",
    [h.contact, IDS.tenantA, h.client, h.portalUser],
  );
  await owner.query('update client set primary_contact_id = $1 where id = $2', [
    h.contact,
    h.client,
  ]);
  await owner.query('begin');
  await owner.query("select set_config('app.actor_roles', 'owner', true)");
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, makani_number, ' +
      'display_address, access_notes, entrance_point, parking_point, community_gate, is_primary, ' +
      "created_by) values ($1, $2, 'client', $3, 'home', 'DXB', '0012345678', 'Villa 9', " +
      "'Ring twice', extensions.st_geogfromtext('SRID=4326;POINT(55.3 25.25)'), " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.3 25.25)'), " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.3 25.25)'), true, $4)",
    [h.location, IDS.tenantA, h.client, IDS.ownerA],
  );
  await owner.query('commit');

  const category = await owner.query<{ id: string }>(
    "select id from goal_category where tenant_id = $1 and code = 'focus'",
    [IDS.tenantA],
  );
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description, status, is_primary) ' +
      "values ($1, $2, $3, $4, 'Wants to settle before bedtime.', 'active', true)",
    [h.goal, IDS.tenantA, h.client, category.rows[0]?.id],
  );

  // Two files with bytes really in the store: one the erasure takes, one it
  // must not. The second is an invoice's own PDF, which tax law keeps.
  for (const [id, kind] of [
    [h.referral, 'referral'],
    [h.invoicePdf, 'invoice'],
  ] as const) {
    const key = `tenant/${IDS.tenantA}/client/${h.client}/${id}`;
    await storage.put(key, PDF_BYTES, 'application/pdf');
    await owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
        "uploaded_by) values ($1, $2, $3, $4, $5, 'application/pdf', sha256($6::bytea), $7)",
      [id, IDS.tenantA, h.client, kind, key, Buffer.from(PDF_BYTES), IDS.ownerA],
    );
  }
  // The invoice that names it. A statement names neither a session nor a
  // purchase, which is the one kind this fixture can write on its own.
  // app.next_invoice_number() takes the practice from the connection's own
  // setting, which a fixture has to stamp for itself.
  await owner.query('begin');
  await owner.query("select set_config('app.tenant_id', $1, true)", [IDS.tenantA]);
  await owner.query(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils, document_id) values ($1, $2, app.next_invoice_number(), 'statement', " +
      'current_date, 70000, 3500, 73500, $3)',
    [IDS.tenantA, h.client, h.invoicePdf],
  );
  await owner.query('commit');
}

/**
 * A completed visit for a household: the two coordinates, the observations,
 * the access notes and an event payload with a note and a point in it — every
 * shape of personal data the 300-series holds, and the measurements beside
 * them that must survive.
 */
async function seedCompletedVisit(h: Household): Promise<void> {
  // Open first, because migration 302 refuses an event on a closed visit —
  // and the order is the real one: a device sends its events while the visit
  // is running, and the close is the last write.
  await owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'delivery_mode, location_id, status, checked_in_at, checked_in_point, pre_rating) values ' +
      "($1, $2, $3, $4, $5, 'home', $6, 'in_progress', now(), " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.31 25.26)'), $7::jsonb)",
    [
      SESSION,
      IDS.tenantA,
      h.client,
      PRACTITIONER_ROW,
      SERVICE_TYPE,
      h.location,
      JSON.stringify([{ key: 'calm', value: 4 }]),
    ],
  );
  await owner.query(
    'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
      "kind, payload, device_at) values ($1, $2, $3, $4, $5, 1, 'observation_recorded', " +
      '$6::jsonb, now())',
    [
      SESSION_EVENT,
      IDS.tenantA,
      SESSION,
      h.client,
      PRACTITIONER_ROW,
      // A note, a coordinate and a timestamp beside two measurements: every
      // shape a payload can hold, and only the two numbers may survive.
      JSON.stringify({
        text: 'Asked after the neighbour',
        at: '2026-09-01T10:00:00Z',
        point: { lng: 55.31, lat: 25.26 },
        rating: 6,
        flagged: true,
      }),
    ],
  );
  await owner.query(
    'update session set status = $2, closed_at = now(), ' +
      "checked_out_point = extensions.st_geogfromtext('SRID=4326;POINT(55.31 25.26)'), " +
      'observations = $3::jsonb, post_rating = $4::jsonb, telemetry = $5::jsonb, ' +
      'signal_quality_score = 0.812 where id = $1',
    [
      SESSION,
      'completed',
      JSON.stringify({ chips: ['settled'], note: 'Told me about the move next month.' }),
      JSON.stringify([{ key: 'calm', value: 7 }]),
      JSON.stringify([{ seconds: 600, artefactPercent: 4 }]),
    ],
  );
  await owner.query(
    'insert into visit_actuals (tenant_id, session_id, client_id, access_issues) ' +
      "values ($1, $2, $3, 'The gate code on file was wrong; the neighbour let me in.')",
    [IDS.tenantA, SESSION, h.client],
  );
}

async function recordRequest(h: Household): Promise<string> {
  const res = await request(api, ADMIN_AUTH, `/api/clients/${h.client}/erasure-requests`, {
    method: 'POST',
    body: JSON.stringify({
      reason: 'The household asked for their record to be removed.',
      requestedByContactId: h.contact,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-erasure-'));
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  for (const [id, authId, displayName, role] of [
    [ADMIN_ID, ADMIN_AUTH, 'Hazel Ridge', 'admin'],
    [LEAD_ID, LEAD_AUTH, 'Rowan Vale', 'lead_practitioner'],
    [PRACTITIONER_ID, PRACTITIONER_AUTH, 'Cedar Bay', 'practitioner'],
    [FINANCE_ID, FINANCE_AUTH, 'Basil Dune', 'finance'],
  ] as const) {
    await seedUser(owner, { id, tenantId: IDS.tenantA, authId, displayName, roles: [role] });
  }

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 11) });
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage,
  });
  mountClients(api);
  mountClientRecord(api);
  mountBilling(api);

  for (const household of [MAIN, ROLLED_BACK, SWEPT, TAXED]) {
    await seedHousehold(household);
  }

  // A second practice, so "another tenant's admin" is a real actor rather than
  // an unknown id.
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Other Studio');
  await seedUser(owner, {
    id: '00000000-0000-4000-8000-000000000246',
    tenantId: IDS.tenantB,
    authId: OTHER_ADMIN_AUTH,
    displayName: 'Juniper Reef',
    roles: ['admin'],
  });

  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'neurofeedback');
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_ROW, PRACTITIONER_ID);
  await seedCompletedVisit(MAIN);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  await rm(dir, { recursive: true, force: true });
});

describe('recording the request', () => {
  it('keeps the number the confirmation will go to, and erases nothing yet', async () => {
    const id = await recordRequest(MAIN);
    const { rows } = await owner.query<{
      requested_by_phone: string | null;
      performed_at: Date | null;
      status: string;
    }>(
      'select e.requested_by_phone, e.performed_at, c.status from erasure_request e ' +
        'join client c on c.id = e.client_id where e.id = $1',
      [id],
    );
    expect(rows[0]?.requested_by_phone).toBe('+971500000042');
    expect(rows[0]?.performed_at).toBeNull();
    // Asking is not doing: this was one statement away from the other until
    // this pull request, and now it is a separate press.
    expect(rows[0]?.status).toBe('active');
  });
});

describe('performing it', () => {
  let requestId: string;

  it('refuses without a reason, and erases nothing', async () => {
    const requests = await owner.query<{ id: string }>(
      'select id from erasure_request where client_id = $1',
      [MAIN.client],
    );
    requestId = requests.rows[0]?.id as string;
    const res = await request(
      api,
      ADMIN_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST' },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reason_required');
    const after = await owner.query('select status from client where id = $1', [MAIN.client]);
    expect(after.rows[0]?.status).toBe('active');
  });

  it('refuses the lead practitioner, who may open an erased record but not make one', async () => {
    const res = await request(
      api,
      LEAD_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'Trying it on.' } },
    );
    expect(res.status).toBe(403);
    const refused = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'refused' and client_id = $1",
      [MAIN.client],
    );
    expect(Number(refused.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('refuses finance, and another practice’s admin, before anything moves', async () => {
    const finance = await request(
      api,
      FINANCE_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'Tidying the ledger.' } },
    );
    expect(finance.status).toBe(403);

    // Another practice entirely: the client is not theirs to find, so this is
    // a not-found rather than a refusal — app.client_status_for is scoped to
    // the caller's own tenant and answers nothing at all.
    const otherPractice = await request(
      api,
      OTHER_ADMIN_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'Curiosity.' } },
    );
    expect(otherPractice.status).toBe(404);

    const after = await owner.query('select status from client where id = $1', [MAIN.client]);
    expect(after.rows[0]?.status).toBe('active');
  });

  it('anonymises the person, keeps the invoice, and files the letter', async () => {
    const res = await request(
      api,
      ADMIN_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'Erasure requested by the household.' } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      request: {
        performedAt: string;
        letterDocumentId: string;
        letterVersion: string;
        summary: Record<string, number>;
      };
      letter: { url: string };
    };

    const client = await owner.query<Record<string, unknown>>(
      'select given_name, family_name, given_name_ar, family_name_ar, date_of_birth, ' +
        'sex_at_birth, referral_source, status from client where id = $1',
      [MAIN.client],
    );
    expect(client.rows[0]).toMatchObject({
      given_name: 'Erased client',
      family_name: 'Erased client',
      given_name_ar: null,
      family_name_ar: null,
      date_of_birth: null,
      sex_at_birth: null,
      referral_source: null,
      status: 'erased',
    });

    const contact = await owner.query<Record<string, unknown>>(
      'select given_name, family_name, given_name_ar, family_name_ar, phone, email, ' +
        'whatsapp_opt_in, user_id from contact where id = $1',
      [MAIN.contact],
    );
    expect(contact.rows[0]).toMatchObject({
      given_name: null,
      family_name: null,
      given_name_ar: null,
      family_name_ar: null,
      phone: null,
      email: null,
      whatsapp_opt_in: false,
      user_id: null,
    });
    const account = await owner.query<{
      status: string;
      email: string | null;
      auth_id: string | null;
    }>('select status, email, auth_id from app_user where id = $1', [MAIN.portalUser]);
    expect(account.rows[0]).toMatchObject({ status: 'archived', email: null, auth_id: null });

    // Only the emirate survives, and the pin sits at its centre.
    const location = await owner.query<{
      makani_number: string | null;
      display_address: string | null;
      access_notes: string | null;
      has_parking: boolean;
      has_gate: boolean;
      lng: number;
      lat: number;
    }>(
      'select makani_number, display_address, access_notes, ' +
        '(parking_point is not null) as has_parking, (community_gate is not null) as has_gate, ' +
        'extensions.st_x(entrance_point::extensions.geometry) as lng, ' +
        'extensions.st_y(entrance_point::extensions.geometry) as lat ' +
        'from location where id = $1',
      [MAIN.location],
    );
    expect(location.rows[0]).toMatchObject({
      makani_number: null,
      display_address: null,
      access_notes: null,
      has_parking: false,
      has_gate: false,
    });
    expect(location.rows[0]?.lng).toBeCloseTo(55.27, 2);
    expect(location.rows[0]?.lat).toBeCloseTo(25.2, 2);

    const goal = await owner.query<{ description: string; status: string }>(
      'select description, status from goal where id = $1',
      [MAIN.goal],
    );
    expect(goal.rows[0]?.description).toBe('');
    // The category and the status are structured history, not personal data.
    expect(goal.rows[0]?.status).toBe('active');

    // The visit: the door, the words and the payload's text go; the
    // measurements stay, because they identify nobody once the record around
    // them is anonymous (migration 105, and the letter says so).
    const session = await owner.query<{
      has_in: boolean;
      has_out: boolean;
      observations: unknown;
      pre_rating: { key: string; value: number }[];
      post_rating: { key: string; value: number }[];
      telemetry: unknown[];
      signal_quality_score: string | null;
      status: string;
    }>(
      'select (checked_in_point is not null) as has_in, (checked_out_point is not null) as has_out, ' +
        'observations, pre_rating, post_rating, telemetry, signal_quality_score, status ' +
        'from session where id = $1',
      [SESSION],
    );
    expect(session.rows[0]).toMatchObject({ has_in: false, has_out: false, observations: null });
    // Migration 302 freezes a closed visit; the erasure is the one thing that
    // may still write to one, and this proves the trigger stood aside.
    expect(session.rows[0]?.status).toBe('completed');
    expect(session.rows[0]?.pre_rating).toEqual([{ key: 'calm', value: 4 }]);
    expect(session.rows[0]?.post_rating).toEqual([{ key: 'calm', value: 7 }]);
    expect(session.rows[0]?.telemetry).toEqual([{ seconds: 600, artefactPercent: 4 }]);
    expect(Number(session.rows[0]?.signal_quality_score)).toBeCloseTo(0.812, 3);

    const event = await owner.query<{ payload: Record<string, unknown> }>(
      'select payload from session_event where id = $1',
      [SESSION_EVENT],
    );
    // Numbers and flags only: the note, the timestamp string and the point are
    // gone, and nothing was left behind by being nested.
    expect(event.rows[0]?.payload).toEqual({ rating: 6, flagged: true });

    const actuals = await owner.query<{ access_issues: string | null }>(
      'select access_issues from visit_actuals where session_id = $1',
      [SESSION],
    );
    expect(actuals.rows[0]?.access_issues).toBeNull();

    // The referral is gone, row and bytes; the invoice's PDF is untouched.
    const documents = await owner.query<{ id: string }>(
      'select id from document where client_id = $1',
      [MAIN.client],
    );
    expect(documents.rows.map((row) => row.id)).toEqual([MAIN.invoicePdf]);
    expect(
      await storage.exists(`tenant/${IDS.tenantA}/client/${MAIN.client}/${MAIN.referral}`),
    ).toBe(false);
    expect(
      await storage.exists(`tenant/${IDS.tenantA}/client/${MAIN.client}/${MAIN.invoicePdf}`),
    ).toBe(true);

    // The invoice itself: not one column of it moved.
    const invoice = await owner.query<{ n: string }>(
      'select count(*)::text as n from invoice where client_id = $1 and document_id = $2 ' +
        'and supplier_legal_name is not null',
      [MAIN.client, MAIN.invoicePdf],
    );
    expect(invoice.rows[0]?.n).toBe('1');

    // The request row records what happened, in counts.
    expect(body.request.summary).toMatchObject({
      contactsAnonymised: 1,
      portalAccountsArchived: 1,
      locationsReduced: 1,
      goalsCleared: 1,
      documentsDeleted: 1,
      documentsKept: 1,
      sessionsCleared: 1,
      sessionEventsCleared: 1,
      visitActualsCleared: 1,
    });
    expect(body.request.performedAt).toBeTruthy();
    expect(body.request.letterVersion).toMatch(/^\d+\.\d+/);

    // And the letter is really there, with the practice's name and the day in it.
    const letter = await api.request(body.letter.url);
    expect(letter.status).toBe(200);
    const text = await letter.text();
    expect(text).toContain('Synthetic Studio');
    expect(text).toMatch(/invoices/i);
    expect(text).not.toContain('{{');

    const filed = await owner.query<{
      kind: string;
      client_id: string | null;
      is_immutable: boolean;
    }>('select kind, client_id, is_immutable from document where id = $1', [
      body.request.letterDocumentId,
    ]);
    // Filed on the request, not on the client, who has no record left to hold it.
    expect(filed.rows[0]).toMatchObject({
      kind: 'erasure_letter',
      client_id: null,
      is_immutable: true,
    });
  });

  it('writes a trail that keeps the field names and withholds every value', async () => {
    const withheld = await owner.query<{ new_values: Record<string, string> }>(
      "select new_values from audit_log where entity_type = 'client' and entity_id = $1 " +
        "and action = 'update' order by occurred_at desc limit 1",
      [MAIN.client],
    );
    const values = withheld.rows[0]?.new_values ?? {};
    expect(Object.keys(values)).toContain('given_name');
    expect(Object.values(values).every((value) => value === '[withheld: erasure]')).toBe(true);

    // And one row that says, in the ordinary way, what was done and why.
    const act = await owner.query<{ reason: string | null; actor_role: string | null }>(
      "select reason, actor_role from audit_log where action = 'erase' and entity_id = $1",
      [MAIN.client],
    );
    expect(act.rows).toHaveLength(1);
    expect(act.rows[0]?.reason).toBe('Erasure requested by the household.');
    expect(act.rows[0]?.actor_role).toContain('admin');
  });

  it('will not be performed twice', async () => {
    const res = await request(
      api,
      ADMIN_AUTH,
      `/api/clients/${MAIN.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'Again.' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('already_erased');
  });
});

describe('what is left of an erased record', () => {
  it('opens only for the lead practitioner and the owner, and only with a reason', async () => {
    const noReason = await request(api, LEAD_AUTH, `/api/clients/${MAIN.client}`);
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).error).toBe('reason_required');

    const opened = await request(api, LEAD_AUTH, `/api/clients/${MAIN.client}`, {
      headers: { 'x-reason': 'Answering the household about their erasure.' },
    });
    expect(opened.status).toBe(200);

    // The admin who performed it may not open it afterwards, and the
    // practitioner never could.
    for (const auth of [ADMIN_AUTH, PRACTITIONER_AUTH, FINANCE_AUTH]) {
      const refused = await request(api, auth, `/api/clients/${MAIN.client}`, {
        headers: { 'x-reason': 'Curiosity.' },
      });
      expect(refused.status).toBe(403);
    }
  });

  it('hands its own erasure record to the same short list, and asks them why', async () => {
    // The admin who performed it is refused the record and refused this with
    // it; the lead practitioner is asked why, as everywhere else.
    const refused = await request(api, ADMIN_AUTH, `/api/clients/${MAIN.client}/erasure-requests`, {
      headers: { 'x-reason': 'Checking my own work.' },
    });
    expect(refused.status).toBe(403);

    const noReason = await request(api, LEAD_AUTH, `/api/clients/${MAIN.client}/erasure-requests`);
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).error).toBe('reason_required');

    const read = await request(api, LEAD_AUTH, `/api/clients/${MAIN.client}/erasure-requests`, {
      headers: { 'x-reason': 'Answering the household about their erasure.' },
    });
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      requests: { performedAt: string | null; notifyPhone: string | null; filesPending: number }[];
    };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.performedAt).toBeTruthy();
    // The one contact detail that outlives the erasure, and the only way the
    // confirmation can still be sent (migration 104).
    expect(body.requests[0]?.notifyPhone).toBe('+971500000042');
    // One, and the file is already gone: the after-commit hook removed the
    // bytes and had no database to say so with. The count means "not yet
    // confirmed", and the sweep is what confirms it.
    expect(body.requests[0]?.filesPending).toBe(1);

    // Reading it is itself a read, and the trail says so.
    const listed = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'erasure_request' " +
        "and action = 'list' and client_id = $1",
      [MAIN.client],
    );
    expect(Number(listed.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('records what happened and is not rewritten afterwards', async () => {
    const request = await owner.query<{ id: string }>(
      'select id from erasure_request where client_id = $1',
      [MAIN.client],
    );
    const id = request.rows[0]?.id as string;
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          // The row says what an erasure did. Row security says which rows an
          // admin may reach and never which columns, so the guard trigger
          // (migration 105) is what refuses this.
          await rejectsWith(
            owner,
            '42501',
            "update erasure_request set summary = '{}'::jsonb where id = $1",
            [id],
          );
          await rejectsWith(
            owner,
            '42501',
            "update erasure_request set reason = 'something else' where id = $1",
            [id],
          );
          await rejectsWith(owner, '42501', 'delete from erasure_request where id = $1', [id]);
          // The letter is the one thing that may still be written.
          await owner.query('update erasure_request set letter_sent_at = now() where id = $1', [
            id,
          ]);
        },
        'admin',
      );
    });
  });

  it('keeps the number the letter goes to until the letter has gone and the files are clear', async () => {
    const request = await owner.query<{ id: string; requested_by_phone: string | null }>(
      'select id, requested_by_phone from erasure_request where client_id = $1',
      [MAIN.client],
    );
    const id = request.rows[0]?.id as string;
    // Still there: the letter has not been sent, so there is still something
    // to send it to.
    expect(request.rows[0]?.requested_by_phone).toBe('+971500000042');
    const beforeSweep = await sweepErasureFiles(owner, storage);
    expect(beforeSweep.some((one) => one.erasureRequestId === id)).toBe(true);
    const held = await owner.query<{ phone: string | null }>(
      'select requested_by_phone as phone from erasure_request where id = $1',
      [id],
    );
    expect(held.rows[0]?.phone).toBe('+971500000042');

    // The practice says it has sent the letter, and the next sweep takes the
    // number with it: that was the whole of its purpose.
    const sent = await request2(api, ADMIN_AUTH, `${erasurePath(id)}/letter-sent`, {
      method: 'POST',
    });
    expect(sent.status).toBe(200);
    await sweepErasureFiles(owner, storage);
    const after = await owner.query<{ phone: string | null; cleared: Date | null }>(
      'select requested_by_phone as phone, files_cleared_at as cleared from erasure_request ' +
        'where id = $1',
      [id],
    );
    expect(after.rows[0]?.phone).toBeNull();
    expect(after.rows[0]?.cleared).not.toBeNull();
  });

  it('is in no list, and answers to no search by its own record number', async () => {
    const list = await request(api, ADMIN_AUTH, '/api/clients');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { clients: { id: string }[] };
    expect(body.clients.map((row) => row.id)).not.toContain(MAIN.client);

    const search = await request(api, ADMIN_AUTH, `/api/clients?q=${MAIN.mrn}`);
    expect(((await search.json()) as { clients: unknown[] }).clients).toHaveLength(0);
  });

  it('is behind no practitioner’s schedule door, and no balance route', async () => {
    const visible = await owner.query<{ visible: boolean }>(
      'select app.client_visible_to_practitioner($1) as visible',
      [MAIN.client],
    );
    expect(visible.rows[0]?.visible).toBe(false);

    for (const auth of [FINANCE_AUTH, ADMIN_AUTH]) {
      const balance = await request(api, auth, `/api/billing/clients/${MAIN.client}/balance`);
      expect([403, 404]).toContain(balance.status);
    }
  });
});

describe('a rendered tax document', () => {
  it('is kept when the billing stream has linked one to its invoice', async ({ skip }) => {
    // billing_document is the billing worktree's pull request 54: it names the
    // rendered PDF of every invoice and receipt, with a foreign key to
    // `document` and no `on delete`. Before it lands there is nothing to
    // prove, and app.erase_client asks the same question this test does
    // (migration 105).
    const present = await owner.query<{ table: string | null }>(
      "select to_regclass('public.billing_document')::text as table",
    );
    if (!present.rows[0]?.table) {
      skip();
      return;
    }

    const documentId = '00000000-0000-4000-8000-000000000258';
    const key = `tenant/${IDS.tenantA}/client/${TAXED.client}/${documentId}`;
    await storage.put(key, PDF_BYTES, 'application/pdf');
    await owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
        "uploaded_by) values ($1, $2, $3, 'report', $4, 'application/pdf', sha256($5::bytea), $6)",
      [documentId, IDS.tenantA, TAXED.client, key, Buffer.from(PDF_BYTES), IDS.ownerA],
    );
    // Filed as an ordinary kind on purpose: what keeps it is the link, not the
    // word on the row.
    await owner.query('insert into billing_document (tenant_id, document_id) values ($1, $2)', [
      IDS.tenantA,
      documentId,
    ]);

    const requestId = await recordRequest(TAXED);
    const res = await request(
      api,
      ADMIN_AUTH,
      `/api/clients/${TAXED.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'The household asked.' } },
    );
    expect(res.status).toBe(200);

    const kept = await owner.query<{ n: string }>(
      'select count(*)::text as n from document where id = $1',
      [documentId],
    );
    expect(kept.rows[0]?.n).toBe('1');
    expect(await storage.exists(key)).toBe(true);
  });
});

describe('the files, and only after the commit', () => {
  it('removes nothing when the request rolls back', async () => {
    const requestId = await recordRequest(ROLLED_BACK);
    // A store that will not take the letter: the route raises, the transaction
    // rolls back, and the after-commit work is discarded unrun.
    const refusing: ServerStorageProvider = {
      ...storage,
      put: async () => {
        throw new Error('synthetic store failure');
      },
    };
    const failing = createApi({
      pool,
      verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
      storage: refusing,
    });
    mountClientRecord(failing);
    const res = await request(
      failing,
      ADMIN_AUTH,
      `/api/clients/${ROLLED_BACK.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'The store is about to refuse.' } },
    );
    expect(res.status).toBe(500);

    // Nothing moved, and nothing was deleted: the household is exactly as it was.
    const client = await owner.query<{ status: string; given_name: string }>(
      'select status, given_name from client where id = $1',
      [ROLLED_BACK.client],
    );
    expect(client.rows[0]).toMatchObject({ status: 'active', given_name: 'Willow' });
    expect(
      await storage.exists(
        `tenant/${IDS.tenantA}/client/${ROLLED_BACK.client}/${ROLLED_BACK.referral}`,
      ),
    ).toBe(true);
  });

  it('records what the store would not take, and sweeps it up afterwards', async () => {
    const requestId = await recordRequest(SWEPT);
    const stubborn: ServerStorageProvider = {
      ...storage,
      delete: async () => {
        throw new Error('synthetic store failure');
      },
    };
    const undeleting = createApi({
      pool,
      verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
      storage: stubborn,
    });
    mountClientRecord(undeleting);
    const res = await request(
      undeleting,
      ADMIN_AUTH,
      `/api/clients/${SWEPT.client}/erasure-requests/${requestId}/execute`,
      { method: 'POST', headers: { 'x-reason': 'The store will not delete today.' } },
    );
    // The erasure stands: a store that will not forget is an operational fact,
    // not this request's refusal.
    expect(res.status).toBe(200);
    const key = `tenant/${IDS.tenantA}/client/${SWEPT.client}/${SWEPT.referral}`;
    expect(await storage.exists(key)).toBe(true);

    const pending = await owner.query<{ n: number; cleared: Date | null }>(
      'select jsonb_array_length(storage_keys_pending) as n, files_cleared_at as cleared ' +
        'from erasure_request where id = $1',
      [requestId],
    );
    expect(pending.rows[0]?.n).toBe(1);
    expect(pending.rows[0]?.cleared).toBeNull();

    // The sweep comes back for it with a store that answers.
    const swept = await sweepErasureFiles(owner, storage);
    expect(swept.some((one) => one.erasureRequestId === requestId && one.cleared === 1)).toBe(true);
    expect(await storage.exists(key)).toBe(false);

    const after = await owner.query<{ n: number; cleared: Date | null }>(
      'select jsonb_array_length(storage_keys_pending) as n, files_cleared_at as cleared ' +
        'from erasure_request where id = $1',
      [requestId],
    );
    expect(after.rows[0]?.n).toBe(0);
    expect(after.rows[0]?.cleared).not.toBeNull();
  });
});
