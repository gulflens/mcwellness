import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@app/api/_middleware/db';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
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
  seedContact,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * Every rule this stream's first pull request promised, proved end to end:
 * a practitioner cannot list or book through the admin routes, and neither
 * can finance; booking is refused before any read at all for the wrong role,
 * with 403 before any conflict check when the assignee lacks a valid
 * credential, and with a plain-code 400 for a row that does not exist, is
 * not active, or does not fit (the wrong delivery mode, the wrong location);
 * a genuine double-booking or a missing consent is refused with 409 and a
 * plain reason; a second tenant sees and reaches none of this; a created
 * appointment leaves exactly one audit row naming its client, and reading a
 * client to build the form is logged too; the exclusion constraints on
 * `appointment` hold even when the API is bypassed entirely, and even when
 * two bookings race each other through the API itself.
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
const INACTIVE_PRACTITIONER = '00000000-0000-4000-8000-000000005010';
const INACTIVE_PRACTITIONER_USER = '00000000-0000-4000-8000-000000005011';
const INACTIVE_SERVICE_TYPE = '00000000-0000-4000-8000-000000005012';
const STUDIO_LOCATION = '00000000-0000-4000-8000-000000005013';
const STUDIO_SERVICE_TYPE = '00000000-0000-4000-8000-000000005014';
const AUTH_FINANCE = '00000000-0000-4000-8000-000000005015';
const FINANCE_USER = '00000000-0000-4000-8000-000000005016';
const CONSENT_DOC = '00000000-0000-4000-8000-000000005017';
const CLIENT_MISSING_PARTICIPATION = '00000000-0000-4000-8000-000000005018';
const CLIENT_MISSING_HOME_VISIT = '00000000-0000-4000-8000-000000005019';
const CONTACT_MISSING_HOME_VISIT = '00000000-0000-4000-8000-000000005020';
const CLIENT_MINOR = '00000000-0000-4000-8000-000000005021';
const CONTACT_MINOR = '00000000-0000-4000-8000-000000005022';
const CLIENT_NULL_DOB = '00000000-0000-4000-8000-000000005023';
const CONTACT_NULL_DOB = '00000000-0000-4000-8000-000000005024';
const CONTACT_A = '00000000-0000-4000-8000-000000005025';
const CONTACT_B = '00000000-0000-4000-8000-000000005026';
const RACE_CLIENT_1 = '00000000-0000-4000-8000-000000005027';
const RACE_CLIENT_2 = '00000000-0000-4000-8000-000000005028';
const CONTACT_RACE_1 = '00000000-0000-4000-8000-000000005029';
const CONTACT_RACE_2 = '00000000-0000-4000-8000-000000005030';
// A home location, one per client that books a 'home' visit: the location-ownership
// rule (create.ts) refuses a home visit against anyone else's address.
const LOCATION_B = '00000000-0000-4000-8000-000000005031';
const LOCATION_INACTIVE = '00000000-0000-4000-8000-000000005032';
const LOCATION_MISSING_PARTICIPATION = '00000000-0000-4000-8000-000000005033';
const LOCATION_MISSING_HOME_VISIT = '00000000-0000-4000-8000-000000005034';
const LOCATION_MINOR = '00000000-0000-4000-8000-000000005035';
const LOCATION_NULL_DOB = '00000000-0000-4000-8000-000000005036';
const LOCATION_RACE_1 = '00000000-0000-4000-8000-000000005037';
const LOCATION_RACE_2 = '00000000-0000-4000-8000-000000005038';
// A well-formed id that names no client at all, in any tenant.
const CLIENT_NONEXISTENT = '00000000-0000-4000-8000-000000005039';

function at(iso: string): Date {
  return new Date(iso);
}
function plus45(start: Date): Date {
  return new Date(start.getTime() + 45 * 60_000);
}

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let firstAppointmentId: string;

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

/**
 * One shared document for every consent below to point at: `text_document_id`
 * is a plain foreign key to `document`, and these tests are about booking, not
 * about the practice's published wording.
 *
 * Kind `referral`, not `consent_text`, at the trunk's ask
 * (docs/CHANGE-REQUESTS/trunk-notes.md, round 14, item 1). A `consent_text`
 * row is the practice's own wording and migration 902 gives it five columns of
 * its own — purpose, locale, version, status, retired_at — which the trunk
 * means to require together with a check constraint. It cannot add that
 * constraint while two fixtures across an ownership line file a bare wording
 * row, so this stands down to the honest stand-in instead.
 */
async function seedReferralDocument(client: pg.Client): Promise<void> {
  await client.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256, created_by) ' +
      "values ($1, $2, 'referral', 'referral-v1', 'text/plain', " +
      "sha256('referral-v1'::bytea), $3)",
    [CONSENT_DOC, IDS.tenantA, IDS.ownerA],
  );
}

async function seedConsent(
  client: pg.Client,
  args: { clientId: string; contactId: string; purpose: string },
): Promise<void> {
  await client.query(
    'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, status, method, created_by) values ($1, $2, $3, $4, 1, $5, 'active', " +
      "'app_signature', $6)",
    [IDS.tenantA, args.clientId, args.contactId, args.purpose, CONSENT_DOC, IDS.ownerA],
  );
}

/** An active client, adult by default, with a guardian contact, a home
 * location of their own (create.ts refuses a home visit at anyone else's
 * address) and the given active consent purposes — everything
 * checkConflicts's consent rule needs. */
async function seedConsentingClient(
  client: pg.Client,
  clientId: string,
  familyName: string,
  contactId: string,
  locationId: string,
  purposes: readonly string[],
  dateOfBirth: string | null = '1990-01-01',
): Promise<void> {
  await seedClient(client, IDS.tenantA, clientId, IDS.ownerA, familyName);
  await client.query("update client set status = 'active', date_of_birth = $2 where id = $1", [
    clientId,
    dateOfBirth,
  ]);
  await seedContact(client, IDS.tenantA, contactId, clientId, `identity-${contactId}`);
  await seedLocation(client, IDS.tenantA, locationId, clientId, IDS.ownerA);
  for (const purpose of purposes) {
    await seedConsent(client, { clientId, contactId, purpose });
  }
}

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);

  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH_OWNER_B, IDS.ownerB]);

  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  // A second service, offering both home and studio, for the location-ownership tests.
  await owner.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, 'brain-map-studio', 'Brain map (studio)', 60, '{home,studio}')",
    [STUDIO_SERVICE_TYPE, IDS.tenantA],
  );
  await owner.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, 'inactive-service', 'Inactive service', 60, '{home}')",
    [INACTIVE_SERVICE_TYPE, IDS.tenantA],
  );
  await owner.query("update service_type set status = 'inactive' where id = $1", [
    INACTIVE_SERVICE_TYPE,
  ]);

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
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: STUDIO_SERVICE_TYPE,
    certification: 'vendor_qeeg',
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

  // A fourth practitioner, credentialed but not active.
  await seedUser(owner, {
    id: INACTIVE_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner Inactive',
  });
  await seedPractitioner(owner, IDS.tenantA, INACTIVE_PRACTITIONER, INACTIVE_PRACTITIONER_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: INACTIVE_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn',
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await owner.query("update practitioner set status = 'inactive' where id = $1", [
    INACTIVE_PRACTITIONER,
  ]);

  // Finance: reads nothing here (scheduling-manual.md section 2).
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: AUTH_FINANCE,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  await seedReferralDocument(owner);

  await seedConsentingClient(owner, IDS.clientA, 'Alpha', CONTACT_A, IDS.locationA, [
    'participation',
    'home_visit',
  ]);
  // Arabic name: proves the appointment list route surfaces it, the way the
  // clients table's own route already does (PR 26 fix round, item 6).
  await owner.query('update client set given_name_ar = $1, family_name_ar = $2 where id = $3', [
    'أيريس',
    'ألفا',
    IDS.clientA,
  ]);
  await seedConsentingClient(owner, IDS.clientB, 'Beta', CONTACT_B, LOCATION_B, [
    'participation',
    'home_visit',
  ]);
  // Left at the default 'lead' status: not bookable. No consent needed to prove that.
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, created_by) ' +
      "values ($1, $2, 'MW-INACTIVE', 'Synthetic', 'Inactive', $3)",
    [CLIENT_INACTIVE, IDS.tenantA, IDS.ownerA],
  );
  await seedLocation(owner, IDS.tenantA, LOCATION_INACTIVE, CLIENT_INACTIVE, IDS.ownerA);
  // Active and adult, but no contact and no consent at all: every purpose missing.
  await seedClient(owner, IDS.tenantA, CLIENT_MISSING_PARTICIPATION, IDS.ownerA, 'NoConsent');
  await owner.query(
    "update client set status = 'active', date_of_birth = '1990-01-01' where id = $1",
    [CLIENT_MISSING_PARTICIPATION],
  );
  await seedLocation(
    owner,
    IDS.tenantA,
    LOCATION_MISSING_PARTICIPATION,
    CLIENT_MISSING_PARTICIPATION,
    IDS.ownerA,
  );
  // Adult, participation only: missing home_visit for a home booking (not for a studio one).
  await seedConsentingClient(
    owner,
    CLIENT_MISSING_HOME_VISIT,
    'NoHomeVisit',
    CONTACT_MISSING_HOME_VISIT,
    LOCATION_MISSING_HOME_VISIT,
    ['participation'],
  );
  // A minor by date of birth, participation and home_visit active, minor_participation not: missing exactly that.
  await seedConsentingClient(
    owner,
    CLIENT_MINOR,
    'Minor',
    CONTACT_MINOR,
    LOCATION_MINOR,
    ['participation', 'home_visit'],
    '2015-01-01',
  );
  // No date of birth on file at all: fails closed exactly like an actual minor.
  await seedConsentingClient(
    owner,
    CLIENT_NULL_DOB,
    'NullDob',
    CONTACT_NULL_DOB,
    LOCATION_NULL_DOB,
    ['participation', 'home_visit'],
    null,
  );
  await seedConsentingClient(owner, RACE_CLIENT_1, 'Race1', CONTACT_RACE_1, LOCATION_RACE_1, [
    'participation',
    'home_visit',
  ]);
  await seedConsentingClient(owner, RACE_CLIENT_2, 'Race2', CONTACT_RACE_2, LOCATION_RACE_2, [
    'participation',
    'home_visit',
  ]);

  // The tenant's studio.
  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, created_by) ' +
      "values ($1, $2, 'tenant', $2, 'studio', 'DXB', " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), $3)",
    [STUDIO_LOCATION, IDS.tenantA, IDS.ownerA],
  );
  await owner.query('update tenant set location_id = $2 where id = $1', [
    IDS.tenantA,
    STUDIO_LOCATION,
  ]);

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });

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
      client: { id: IDS.clientA, givenNameAr: 'أيريس', familyNameAr: 'ألفا' },
      practitioner: { id: MORE_IDS.practitionerA },
      serviceType: { id: MORE_IDS.serviceTypeA },
      location: { id: IDS.locationA },
    });
    firstAppointmentId = body.id;
  });

  async function clientReadCount(clientId: string): Promise<number> {
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'client' and action = 'read' " +
        'and entity_id = $1',
      [clientId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  it('is refused for a bare practitioner role, before any read: booking is never theirs to do', async () => {
    const before = await clientReadCount(IDS.clientA);
    const res = await call(AUTH.practitionerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T13:00:00.000Z',
    });
    expect(res.status).toBe(403);
    // No new client read was logged for this refusal: the count is unchanged.
    expect(await clientReadCount(IDS.clientA)).toBe(before);
  });

  it('is refused for finance, before any read: booking is never theirs to do either', async () => {
    const res = await call(AUTH_FINANCE, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T13:05:00.000Z',
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

  it('is refused with a plain code when the practitioner is not active', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: INACTIVE_PRACTITIONER,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T11:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('practitioner_inactive');
  });

  it('is refused with a plain code when the service type is not active', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: INACTIVE_SERVICE_TYPE,
      locationId: IDS.locationA,
      deliveryMode: 'home',
      windowStart: '2026-09-10T11:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('service_type_inactive');
  });

  it('is refused with a plain code for a delivery mode the service does not offer', async () => {
    // Guards the delivery_modes::text[] cast: nf-session offers only 'home'.
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: IDS.locationA,
      deliveryMode: 'studio',
      windowStart: '2026-09-10T11:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('delivery_mode_unavailable');
  });

  it("is refused with a plain code when a home visit is booked against a location that is not the client's own", async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: STUDIO_LOCATION,
      deliveryMode: 'home',
      windowStart: '2026-09-10T11:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('location_mismatch');
  });

  it('is refused with a plain code when a studio visit is booked against a location that is not the studio', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientA,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: STUDIO_SERVICE_TYPE,
      locationId: IDS.locationA,
      deliveryMode: 'studio',
      windowStart: '2026-09-10T11:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('location_mismatch');
  });

  it("books a studio visit against the tenant's studio", async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_MISSING_HOME_VISIT, // home_visit consent is not needed for a studio visit
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: STUDIO_SERVICE_TYPE,
      locationId: STUDIO_LOCATION,
      deliveryMode: 'studio',
      windowStart: '2026-09-10T10:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'proposed', deliveryMode: 'studio' });
  });

  it('is refused with 409 and a plain reason when it would double-book the practitioner', async () => {
    // 05:20 falls inside the first appointment's own window (05:00-05:45Z).
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: IDS.clientB,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: LOCATION_B,
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
      locationId: LOCATION_INACTIVE,
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
      windowStart: '2026-09-10T10:30:00.000Z',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/appointments: consent', () => {
  const windowStart = '2026-09-10T07:00:00.000Z';

  it('is refused with 409 when participation is not active', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_MISSING_PARTICIPATION,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: LOCATION_MISSING_PARTICIPATION,
      deliveryMode: 'home',
      windowStart,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(
      body.issues.some(
        (i) => i.code === 'consent_missing' && i.message.includes('(participation)'),
      ),
    ).toBe(true);
  });

  it('is refused with 409 when home_visit is not active, for a home visit', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_MISSING_HOME_VISIT,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: LOCATION_MISSING_HOME_VISIT,
      deliveryMode: 'home',
      windowStart,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(
      body.issues.some((i) => i.code === 'consent_missing' && i.message.includes('(home_visit)')),
    ).toBe(true);
    expect(
      body.issues.some(
        (i) => i.code === 'consent_missing' && i.message.includes('(participation)'),
      ),
    ).toBe(false);
  });

  it('is refused with 409 when minor_participation is not active for a client under 18', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_MINOR,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: LOCATION_MINOR,
      deliveryMode: 'home',
      windowStart,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(
      body.issues.some(
        (i) => i.code === 'consent_missing' && i.message.includes('(minor_participation)'),
      ),
    ).toBe(true);
  });

  it('fails closed and requires minor_participation when no date of birth is on file', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments', {
      clientId: CLIENT_NULL_DOB,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId: LOCATION_NULL_DOB,
      deliveryMode: 'home',
      windowStart,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictResponse;
    expect(
      body.issues.some(
        (i) => i.code === 'consent_missing' && i.message.includes('(minor_participation)'),
      ),
    ).toBe(true);
  });
});

describe('POST /api/appointments: a concurrent booking', () => {
  it('lets exactly one of two simultaneous overlapping bookings through, and refuses the other with a conflict, not a crash', async () => {
    const payloadFor = (clientId: string, locationId: string) => ({
      clientId,
      practitionerId: MORE_IDS.practitionerA,
      serviceTypeId: MORE_IDS.serviceTypeA,
      locationId,
      deliveryMode: 'home',
      windowStart: '2026-09-10T16:00:00.000Z',
    });
    const [resA, resB] = await Promise.all([
      call(AUTH.ownerA, 'POST', '/api/appointments', payloadFor(RACE_CLIENT_1, LOCATION_RACE_1)),
      call(AUTH.ownerA, 'POST', '/api/appointments', payloadFor(RACE_CLIENT_2, LOCATION_RACE_2)),
    ]);
    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const refused = resA.status === 409 ? resA : resB;
    const body = (await refused.json()) as ConflictResponse;
    expect(body.issues.some((i) => i.code === 'practitioner_overlap')).toBe(true);
  });
});

describe('GET /api/appointments', () => {
  it('is refused for a bare practitioner role: the admin day view is not their own day', async () => {
    const res = await call(AUTH.practitionerA, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(403);
  });

  it('is refused for finance: scheduling-manual.md section 2 grants finance nothing here', async () => {
    const res = await call(AUTH_FINANCE, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(403);
  });

  it("lists the day's appointments for the owner, including the one created earlier", async () => {
    const res = await call(AUTH.ownerA, 'GET', '/api/appointments?date=2026-09-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentListResponse;
    expect(body.appointments.length).toBeGreaterThanOrEqual(1);
    const first = body.appointments.find((a) => a.id === firstAppointmentId);
    expect(first).toMatchObject({
      status: 'proposed',
      client: { id: IDS.clientA, givenNameAr: 'أيريس', familyNameAr: 'ألفا' },
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

  it('is refused for a bare practitioner role', async () => {
    const res = await call(
      AUTH.practitionerA,
      'GET',
      `/api/appointments/options?clientId=${IDS.clientA}`,
    );
    expect(res.status).toBe(403);
  });

  it("reaches none of the first tenant's services, practitioners or locations for a second tenant's owner", async () => {
    const res = await call(
      AUTH_OWNER_B,
      'GET',
      `/api/appointments/options?clientId=${IDS.clientA}&serviceTypeId=${MORE_IDS.serviceTypeA}&date=2026-09-10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentOptionsResponse;
    expect(body.serviceTypes.some((s) => s.id === MORE_IDS.serviceTypeA)).toBe(false);
    expect(body.practitioners.some((p) => p.id === MORE_IDS.practitionerA)).toBe(false);
    expect(body.locations.some((l) => l.id === IDS.locationA)).toBe(false);
  });

  it('answers a client id that names nobody with empty locations, and logs no client read for it', async () => {
    const readCount = async (): Promise<number> => {
      const { rows } = await owner.query<{ n: string }>(
        "select count(*)::text as n from audit_log where entity_type = 'client' and action = 'read' " +
          'and entity_id = $1',
        [CLIENT_NONEXISTENT],
      );
      return Number(rows[0]?.n ?? 0);
    };
    const before = await readCount();
    const res = await call(
      AUTH.ownerA,
      'GET',
      `/api/appointments/options?clientId=${CLIENT_NONEXISTENT}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentOptionsResponse;
    expect(body.locations).toEqual([]);
    // Proven in the practice before it is logged as read (options.ts): a
    // client id that names nobody at all must never write an audit row
    // claiming a client was read.
    expect(await readCount()).toBe(before);
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

  it('logs a client read for the booking that used clientA, and for the options call that asked about them', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'client' and action = 'read' " +
        'and entity_id = $1 and actor_id = $2',
      [IDS.clientA, IDS.ownerA],
    );
    // At least the successful booking and the options call above.
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(2);
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
        // By this point several of practitionerA's own bookings exist (the
        // earlier successful ones in this file); every row seen must be theirs,
        // and OTHER_APPOINTMENT (practitioner C's) must not be among them.
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.every((r) => r.practitioner_id === MORE_IDS.practitionerA)).toBe(true);
      },
      'practitioner',
    );
  });

  it('shows finance no appointment rows at all, even though the practice has several', async () => {
    await asApiRole(
      owner,
      IDS.tenantA,
      async () => {
        await owner.query("select set_config('app.actor_id', $1, true)", [FINANCE_USER]);
        const { rows } = await owner.query('select 1 from appointment');
        expect(rows).toEqual([]);
      },
      'finance',
    );
  });
});
