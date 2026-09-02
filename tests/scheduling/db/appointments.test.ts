import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import { mountAppointments } from '@app/api/appointments/routes';
import type {
  AppointmentListResponse,
  AppointmentOptionsResponse,
  ConflictResponse,
} from '@app/api/appointments/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * Every rule this stream's first pull request promised, proved end to end:
 * a practitioner cannot list or book through the admin routes; booking is
 * refused before any conflict check when the assignee lacks a valid
 * credential; a genuine double-booking is refused with a plain reason; a
 * second tenant sees and reaches none of this; a created appointment leaves
 * exactly one audit row naming its client; and the exclusion constraints on
 * `appointment` hold even when the API is bypassed entirely.
 */

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const KEY = new TextEncoder().encode(SECRET);

// This stream's own synthetic fixtures, distinct from helpers.ts's own IDs
// and phones (+971 50 000 1xxx block; .claude/hooks/no-real-identifiers.sh).
const PRACTITIONER_B = '00000000-0000-4000-8000-000000005001'; // credentialed for nothing
const PRACTITIONER_B_USER = '00000000-0000-4000-8000-000000005002';
const PRACTITIONER_C = '00000000-0000-4000-8000-000000005003'; // a second credentialed provider
const PRACTITIONER_C_USER = '00000000-0000-4000-8000-000000005004';
const CLIENT_INACTIVE = '00000000-0000-4000-8000-000000005005'; // left at the default 'lead' status
const AUTH_OWNER_B = '00000000-0000-4000-8000-000000005006';
const OTHER_APPOINTMENT = '00000000-0000-4000-8000-000000005007';
const BYPASS_1 = '00000000-0000-4000-8000-000000005008';
const BYPASS_2 = '00000000-0000-4000-8000-000000005009';

function at(iso: string): Date {
  return new Date(iso);
}
function plus45(start: Date): Date {
  return new Date(start.getTime() + 45 * 60_000);
}

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

async function call(sub: string, method: string, path: string, body?: unknown): Promise<Response> {
  return api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${await mint(sub)}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);

  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH_OWNER_B, IDS.ownerB]);

  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');

  // The credentialed practitioner: also the "bare practitioner" actor for the
  // refusal and RLS-scope tests, since one person can be both.
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
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  // A second practitioner, credentialed for nothing: books nobody.
  await seedUser(owner, {
    id: PRACTITIONER_B_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner B',
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_B, PRACTITIONER_B_USER);

  // A third practitioner, also credentialed: a different provider for the same client.
  await seedUser(owner, {
    id: PRACTITIONER_C_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner C',
  });
  await seedPractitioner(owner, IDS.tenantA, PRACTITIONER_C, PRACTITIONER_C_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: PRACTITIONER_C,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn',
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await owner.query("update client set status = 'active' where id = $1", [IDS.clientA]);
  await seedClient(owner, IDS.tenantA, IDS.clientB, IDS.ownerA, 'Beta');
  await owner.query("update client set status = 'active' where id = $1", [IDS.clientB]);
  // Left at the default 'lead' status: not bookable.
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, created_by) ' +
      "values ($1, $2, 'MW-INACTIVE', 'Synthetic', 'Inactive', $3)",
    [CLIENT_INACTIVE, IDS.tenantA, IDS.ownerA],
  );

  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
  mountAppointments(api);

  // Everything from here runs inside one ambient transaction, so the raw-SQL
  // (asApiRole) tests can use savepoints; the seeding above is already committed.
  await owner.query('begin');
});

afterAll(async () => {
  await owner.query('rollback');
  await owner.end();
  await pool.end();
});

describe('POST /api/appointments', () => {
  it('creates a proposed appointment for the owner', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T05:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'proposed',
      deliveryMode: 'home',
      windowStart: '2026-09-10T05:00:00.000Z',
      windowEnd: '2026-09-10T05:45:00.000Z',
      client: { id: IDS.clientA },
      practitioner: { id: MORE_IDS.practitionerA },
      serviceType: { id: MORE_IDS.serviceTypeA },
      location: { id: IDS.locationA },
    });
  });

  it('is refused for a bare practitioner role: booking is never theirs to do', async () => {
    const res = await call(AUTH.practitionerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T13:00:00.000Z',
    });
    expect(res.status).toBe(403);
  });

  it('is refused with 403, before any conflict check, when the assignee holds no valid credential', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: PRACTITIONER_B,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T08:00:00.000Z',
    });
    expect(res.status).toBe(403);
  });

  it('is refused with 409 and a plain reason when it would double-book the practitioner', async () => {
    // 05:20 overlaps the first appointment's buffered window (04:45-06:00Z).
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientB,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T05:20:00.000Z',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(body.issues.map((i) => i.code)).toContain('practitioner_overlap');
  });

  it('is refused with 409 when it would double-book the client, even with a different practitioner', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: PRACTITIONER_C,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T05:10:00.000Z',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(body.issues.map((i) => i.code)).toContain('client_overlap');
  });

  it('is refused with 409 when the client is not active', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_INACTIVE,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T09:00:00.000Z',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(body.issues.map((i) => i.code)).toContain('client_inactive');
  });

  it("cannot reach another tenant's client or practitioner at all", async () => {
    const res = await call(AUTH_OWNER_B, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T10:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/appointments', () => {
  it('is refused for a bare practitioner role: the admin day view is not their own day', async () => {
    const res = await call(AUTH.practitionerA, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(403);
  });

  it("lists the day's appointments for the owner, and nothing that was refused", async () => {
    const res = await call(AUTH.ownerA, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentListResponse;
    // Every scenario above except the first one was refused and wrote nothing.
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0]).toMatchObject({
      status: 'proposed',
      client: { id: IDS.clientA },
      practitioner: { id: MORE_IDS.practitionerA },
    });
  });

  it("shows a second tenant's owner none of the first tenant's day", async () => {
    const res = await call(AUTH_OWNER_B, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentListResponse;
    expect(body.appointments).toEqual([]);
  });
});

describe('GET /api/appointments/options', () => {
  it("offers the credentialed practitioner but not the uncredentialed one, and the client's own location", async () => {
    const res = await call(
      AUTH.ownerA,
      'GET',
      `/api/appointments/options?clientId=${IDS.clientA}&serviceTypeId=${MORE_IDS.serviceTypeA}&date=2026-09-10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentOptionsResponse;
    expect(body.serviceTypes.some((s) => s.id === MORE_IDS.serviceTypeA)).toBe(true);
    const practitionerIds = body.practitioners.map((p) => p.id);
    expect(practitionerIds).toContain(MORE_IDS.practitionerA);
    expect(practitionerIds).not.toContain(PRACTITIONER_B);
    expect(body.locations.map((l) => l.id)).toContain(IDS.locationA);
  });
});

describe('the audit trail', () => {
  it('names the appointment and its client on the row the create route wrote', async () => {
    const { rows } = await owner.query<{
      action: string;
      entity_type: string;
      client_id: string;
      actor_id: string;
    }>(
      'select action, entity_type, client_id, actor_id from audit_log ' +
        "where entity_type = 'appointment' and action = 'insert' and client_id = $1",
      [IDS.clientA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'insert',
      entity_type: 'appointment',
      client_id: IDS.clientA,
      actor_id: IDS.ownerA,
    });
  });
});

describe('the database floor beneath the API', () => {
  const BYPASS_START = at('2026-09-10T12:00:00.000Z');
  const BYPASS_SQL =
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
    'location_id, delivery_mode, window_start, window_end, travel_buffer_minutes) ' +
    "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 15)";

  it('refuses a raw write that would double-book a practitioner, even bypassing the API entirely', async () => {
    await asApiRole(owner, IDS.tenantA, async () => {
      await owner.query(BYPASS_SQL, [
        BYPASS_1,
        IDS.tenantA,
        IDS.clientA,
        MORE_IDS.practitionerA,
        MORE_IDS.serviceTypeA,
        IDS.locationA,
        BYPASS_START,
        plus45(BYPASS_START),
      ]);
      const secondStart = at('2026-09-10T12:10:00.000Z');
      await rejectsWith(owner, '23P01', BYPASS_SQL, [
        BYPASS_2,
        IDS.tenantA,
        IDS.clientB,
        MORE_IDS.practitionerA,
        MORE_IDS.serviceTypeA,
        IDS.locationA,
        secondStart,
        plus45(secondStart),
      ]);
    });
  });

  it('refuses a bare practitioner role writing an appointment at all', async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await rejectsWith(owner, '42501', BYPASS_SQL, [
          BYPASS_1,
          IDS.tenantA,
          IDS.clientA,
          MORE_IDS.practitionerA,
          MORE_IDS.serviceTypeA,
          IDS.locationA,
          BYPASS_START,
          plus45(BYPASS_START),
        ]);
      },
      'practitioner',
    );
  });

  it('shows a bare practitioner only the appointments assigned to them', async () => {
    const otherStart = at('2026-09-10T14:00:00.000Z');
    await owner.query(BYPASS_SQL, [
      OTHER_APPOINTMENT,
      IDS.tenantA,
      IDS.clientB,
      PRACTITIONER_C,
      MORE_IDS.serviceTypeA,
      IDS.locationA,
      otherStart,
      plus45(otherStart),
    ]);
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [
          MORE_IDS.practitionerUserA,
        ]);
        const { rows } = await owner.query<{ practitioner_id: string }>(
          'select practitioner_id from appointment',
        );
        expect(rows).toEqual([{ practitioner_id: MORE_IDS.practitionerA }]);
      },
      'practitioner',
    );
  });
});
