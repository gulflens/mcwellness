import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type { CheckInResponse } from '../../../app/api/sessions/schema';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedCredential,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import { seedAppointment, seedConsent, seedConsentDocument } from './helpers';

// Everything here is synthetic and stays inside the reserved ranges
// (.claude/rules/testing.md): fixed ids of the shape
// 00000000-0000-4000-8000-*, never a real name or number.
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

// The route's own clock, fixed so the ±15-minute device-clock window
// (checkin.ts) always passes for the fixture deviceAt values below, rather
// than depending on the wall-clock moment the suite happens to run.
const FIXED_NOW = '2026-09-02T06:32:00.000Z';

const SERVICE_TYPE = MORE_IDS.serviceTypeA;
const DOCUMENT = '00000000-0000-4000-8000-000000003001';

const CLIENT_ADULT = '00000000-0000-4000-8000-000000001001';
const CLIENT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000001002';
const CLIENT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000001003';
const CLIENT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000001004';
const CLIENT_NULL_DOB = '00000000-0000-4000-8000-000000001005';

const CONTACT_ADULT = '00000000-0000-4000-8000-000000002001';
const CONTACT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000002002';
const CONTACT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000002003';
const CONTACT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000002004';
const CONTACT_NULL_DOB = '00000000-0000-4000-8000-000000002005';

const SESSION_HAPPY = '00000000-0000-4000-8000-000000005001';
const SESSION_NO_PARTICIPATION = '00000000-0000-4000-8000-000000005002';
const SESSION_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000005003';
const SESSION_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000005004';
const SESSION_NULL_DOB = '00000000-0000-4000-8000-000000005005';
const SESSION_CROSS_TENANT = '00000000-0000-4000-8000-000000005006';
const SESSION_SECOND_WHILE_OPEN = '00000000-0000-4000-8000-000000005007';
const SESSION_BAD_CLOCK = '00000000-0000-4000-8000-000000005009';
const SESSION_BAD_POINT = '00000000-0000-4000-8000-00000000500a';

const EVENT_HAPPY = '00000000-0000-4000-8000-000000006001';
const EVENT_NO_PARTICIPATION = '00000000-0000-4000-8000-000000006002';
const EVENT_MINOR_NO_GUARDIAN = '00000000-0000-4000-8000-000000006003';
const EVENT_MINOR_WITH_GUARDIAN = '00000000-0000-4000-8000-000000006004';
const EVENT_NULL_DOB = '00000000-0000-4000-8000-000000006005';
const EVENT_CROSS_TENANT = '00000000-0000-4000-8000-000000006006';
const EVENT_SECOND_WHILE_OPEN = '00000000-0000-4000-8000-000000006007';
const EVENT_STOLEN = '00000000-0000-4000-8000-000000006008';
const EVENT_BAD_CLOCK = '00000000-0000-4000-8000-000000006009';
const EVENT_BAD_POINT = '00000000-0000-4000-8000-00000000600a';

// A lead practitioner, distinct from the ordinary practitioner below, whose
// only role in these tests is to try to reach into someone else's session.
const LEAD_USER = '00000000-0000-4000-8000-000000007001';
const LEAD_PRACTITIONER = '00000000-0000-4000-8000-000000007002';
const LEAD_AUTH = '00000000-0000-4000-8000-000000007003';

// A client checked in by record number rather than id (schema.ts's
// clientMrn). Ends in six digits so seedClient's auto-derived mrn
// (`MW-${id.slice(-6)}`) matches app/api/sessions/schema.ts's ClientMrn
// pattern.
const CLIENT_BY_MRN = '00000000-0000-4000-8000-000000900001';
const CONTACT_BY_MRN = '00000000-0000-4000-8000-000000900002';
const SESSION_BY_MRN = '00000000-0000-4000-8000-000000900003';
const EVENT_BY_MRN = '00000000-0000-4000-8000-000000900004';
const APPOINTMENT_BY_MRN = '00000000-0000-4000-8000-000000900005';
// A visit the household was never told about (status 'proposed'): refused at
// the door since the operator's decision of 10 September 2026 (decision 5 of
// docs/OPERATOR/2026-09-10-decisions.md).
const CLIENT_PROPOSED = '00000000-0000-4000-8000-000000001006';
const CONTACT_PROPOSED = '00000000-0000-4000-8000-000000002006';
const SESSION_PROPOSED = '00000000-0000-4000-8000-00000000500b';
const EVENT_PROPOSED = '00000000-0000-4000-8000-00000000600b';
const APPOINTMENT_PROPOSED = '00000000-0000-4000-8000-000000008006';
// A practitioner of its own for that case: every other practitioner here has
// spent its one-open-visit slot by the time the case runs, and the refusal
// under proof is the gate's, not the open-visit constraint's.
const PROPOSED_PRACTITIONER_USER = '00000000-0000-4000-8000-000000900201';
const PROPOSED_PRACTITIONER = '00000000-0000-4000-8000-000000900202';
const PROPOSED_PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000900203';
// The adult's own booked visit, named because the check-in is expected to
// mark it (db/migrations/305_appointment_checked_in.sql). Every fixture in
// this file books a confirmed visit since 10 September 2026, except the one
// below that proves a proposed visit is refused at the door.
const APPOINTMENT_ADULT = '00000000-0000-4000-8000-000000008001';
// A practitioner of its own for the record-number check-in, rather than
// practitionerA: practitionerA's own one-open-visit slot is already spent by
// SESSION_HAPPY for the rest of this file (checking a visit out is out of
// scope for this pull request, same as the "allows a minor..." case below),
// so reusing it here would prove nothing beyond already_checked_in again.
const MRN_PRACTITIONER_USER = '00000000-0000-4000-8000-000000900101';
const MRN_PRACTITIONER = '00000000-0000-4000-8000-000000900102';
const MRN_PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000900103';

// A household with two visits on the same day, and a practitioner of its own
// for the same reason the record-number fixture has one. The check-in happens
// during the second window, and the first must not be the row that gets
// stamped.
const CLIENT_TWO_VISITS = '00000000-0000-4000-8000-000000901001';
const CONTACT_TWO_VISITS = '00000000-0000-4000-8000-000000901002';
const SESSION_TWO_VISITS = '00000000-0000-4000-8000-000000901003';
const EVENT_TWO_VISITS = '00000000-0000-4000-8000-000000901004';
const APPOINTMENT_EARLIER_TODAY = '00000000-0000-4000-8000-000000901005';
const APPOINTMENT_AROUND_NOW = '00000000-0000-4000-8000-000000901006';
const TWO_VISIT_USER = '00000000-0000-4000-8000-000000901101';
const TWO_VISIT_PRACTITIONER = '00000000-0000-4000-8000-000000901102';
const TWO_VISIT_AUTH = '00000000-0000-4000-8000-000000901103';

/**
 * When each of the two-visit household's windows opens, in epoch
 * milliseconds, filled in by the fixture below. The test works out from these
 * which visit the practitioner is standing in, rather than asserting an hour
 * the suite cannot know in advance.
 */
let visitWindows: { earlier: number; later: number };

let owner: pg.Client;
let pool: ReturnType<typeof createPool>;
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

async function postCheckIn(
  sessionId: string,
  authSub: string,
  event: {
    id: string;
    // Exactly one of these two is set by every call site below, matching
    // schema.ts's CheckInRequest, which refuses a body carrying both or
    // neither.
    clientId?: string;
    clientMrn?: string;
    deliveryMode?: 'home' | 'studio' | 'remote';
    point?: { lat: number; lng: number } | null;
    deviceAt?: string;
    seq?: number;
  },
): Promise<Response> {
  return api.request(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await mint(authSub)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(event.clientId === undefined ? {} : { clientId: event.clientId }),
      ...(event.clientMrn === undefined ? {} : { clientMrn: event.clientMrn }),
      point: event.point === undefined ? { lat: 25.2, lng: 55.27 } : event.point,
      events: [
        {
          id: event.id,
          seq: event.seq ?? 1,
          kind: 'session_started',
          deviceAt: event.deviceAt ?? FIXED_NOW,
          payload: {
            serviceTypeId: SERVICE_TYPE,
            deliveryMode: event.deliveryMode ?? 'home',
            locationId: null,
          },
        },
      ],
    }),
  });
}

beforeAll(async () => {
  owner = await freshDatabase();

  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');

  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedServiceType(owner, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  await seedUser(owner, {
    id: LEAD_USER,
    tenantId: IDS.tenantA,
    authId: LEAD_AUTH,
    displayName: 'Synthetic Lead Practitioner',
    roles: ['lead_practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, LEAD_PRACTITIONER, LEAD_USER);

  await seedConsentDocument(owner, IDS.tenantA, DOCUMENT);

  // A client contact, wrongly attempting to check someone in.
  await seedUser(owner, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Contact',
    roles: ['client_contact'],
  });

  const clients: Array<{ id: string; contactId: string; dob: string | null }> = [
    { id: CLIENT_ADULT, contactId: CONTACT_ADULT, dob: '1990-01-01' },
    { id: CLIENT_NO_PARTICIPATION, contactId: CONTACT_NO_PARTICIPATION, dob: '1990-01-01' },
    { id: CLIENT_MINOR_NO_GUARDIAN, contactId: CONTACT_MINOR_NO_GUARDIAN, dob: '2015-01-01' },
    { id: CLIENT_MINOR_WITH_GUARDIAN, contactId: CONTACT_MINOR_WITH_GUARDIAN, dob: '2015-01-01' },
    { id: CLIENT_NULL_DOB, contactId: CONTACT_NULL_DOB, dob: null },
  ];
  for (const [index, fixture] of clients.entries()) {
    await seedClient(owner, IDS.tenantA, fixture.id, IDS.ownerA, `Client ${index}`);
    if (fixture.dob) {
      await owner.query('update client set date_of_birth = $1 where id = $2', [
        fixture.dob,
        fixture.id,
      ]);
    }
    await owner.query(
      'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
        "values ($1, $2, $3, 'mother', true)",
      [fixture.contactId, IDS.tenantA, fixture.id],
    );
  }

  const consent = (
    id: string,
    clientId: string,
    contactId: string,
    purpose: 'participation' | 'minor_participation' | 'home_visit' | 'health_data',
  ) =>
    seedConsent(owner, {
      id,
      tenantId: IDS.tenantA,
      clientId,
      givenByContactId: contactId,
      purpose,
      textDocumentId: DOCUMENT,
    });

  // CLIENT_ADULT: participation + home_visit — a clean check-in.
  await consent(
    '00000000-0000-4000-8000-000000004001',
    CLIENT_ADULT,
    CONTACT_ADULT,
    'participation',
  );
  await consent('00000000-0000-4000-8000-000000004002', CLIENT_ADULT, CONTACT_ADULT, 'home_visit');
  // CLIENT_NO_PARTICIPATION: home_visit only — participation is the missing reason.
  await consent(
    '00000000-0000-4000-8000-000000004003',
    CLIENT_NO_PARTICIPATION,
    CONTACT_NO_PARTICIPATION,
    'home_visit',
  );
  // CLIENT_MINOR_NO_GUARDIAN: participation + home_visit, no minor_participation.
  await consent(
    '00000000-0000-4000-8000-000000004004',
    CLIENT_MINOR_NO_GUARDIAN,
    CONTACT_MINOR_NO_GUARDIAN,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-000000004005',
    CLIENT_MINOR_NO_GUARDIAN,
    CONTACT_MINOR_NO_GUARDIAN,
    'home_visit',
  );
  // CLIENT_MINOR_WITH_GUARDIAN: all three active.
  await consent(
    '00000000-0000-4000-8000-000000004006',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-000000004007',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'home_visit',
  );
  await consent(
    '00000000-0000-4000-8000-000000004008',
    CLIENT_MINOR_WITH_GUARDIAN,
    CONTACT_MINOR_WITH_GUARDIAN,
    'minor_participation',
  );
  // CLIENT_NULL_DOB: participation + home_visit — the only reason left is the missing date of birth.
  await consent(
    '00000000-0000-4000-8000-000000004009',
    CLIENT_NULL_DOB,
    CONTACT_NULL_DOB,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-00000000400a',
    CLIENT_NULL_DOB,
    CONTACT_NULL_DOB,
    'home_visit',
  );

  // Every scenario gets health_data, because since 2026-09-09 the door reads
  // it and no visit opens without it — so leaving it off would make every case
  // below fail on that one reason and never reach the reason it is about
  // (db/migrations/961_checkin_reads_health_data.sql). The test that this
  // consent itself gates a visit is its own case, further down.
  for (const [index, [client, contact]] of (
    [
      [CLIENT_ADULT, CONTACT_ADULT],
      [CLIENT_NO_PARTICIPATION, CONTACT_NO_PARTICIPATION],
      [CLIENT_MINOR_NO_GUARDIAN, CONTACT_MINOR_NO_GUARDIAN],
      [CLIENT_MINOR_WITH_GUARDIAN, CONTACT_MINOR_WITH_GUARDIAN],
      [CLIENT_NULL_DOB, CONTACT_NULL_DOB],
    ] as const
  ).entries()) {
    await consent(
      `00000000-0000-4000-8000-0000000041${String(index).padStart(2, '0')}`,
      client,
      contact,
      'health_data',
    );
  }

  // app.checkin_context (db/migrations/301_checkin_context.sql) now finds a
  // client only when the caller's own practitioner row holds a booked
  // appointment with them today (Asia/Dubai) — session-capture.md section
  // 3.1's "blocks if appointment not today". Every client this suite checks
  // in successfully, or expects to reach the consent gate at all, needs one:
  // without it every case below would fail earlier, on not_booked_today,
  // never reaching the reason under test.
  await seedLocation(owner, IDS.tenantA, IDS.locationA, CLIENT_ADULT, IDS.ownerA);
  const dates = await owner.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  const today = dates.rows[0]!.today;
  // An explicit +04:00 offset, and an hour apart per client: the exclusion
  // constraint's busy window is 45 minutes plus the default 15-minute
  // travel buffer, exactly an hour, so practitionerA's own five same-day
  // appointments below never collide with one another.
  const at = (hour: string) => `${today}T${hour}:00:00+04:00`;
  const bookToday = (
    id: string,
    appointmentClientId: string,
    hour: string,
    practitionerId: string = MORE_IDS.practitionerA,
    // Confirmed by default: since 10 September 2026 a proposed visit is
    // refused at the door, and every fixture but the one that proves that
    // books a visit the household was told about.
    status: 'proposed' | 'confirmed' = 'confirmed',
  ) =>
    seedAppointment(owner, {
      id,
      tenantId: IDS.tenantA,
      clientId: appointmentClientId,
      practitionerId,
      serviceTypeId: SERVICE_TYPE,
      locationId: IDS.locationA,
      windowStart: at(hour),
      status,
    });
  await bookToday(APPOINTMENT_ADULT, CLIENT_ADULT, '08', MORE_IDS.practitionerA);
  await bookToday('00000000-0000-4000-8000-000000008002', CLIENT_NO_PARTICIPATION, '09');
  await bookToday('00000000-0000-4000-8000-000000008003', CLIENT_MINOR_NO_GUARDIAN, '10');
  await bookToday('00000000-0000-4000-8000-000000008004', CLIENT_MINOR_WITH_GUARDIAN, '11');
  await bookToday('00000000-0000-4000-8000-000000008005', CLIENT_NULL_DOB, '12');

  // A practitioner of its own for the record-number check-in (see
  // MRN_PRACTITIONER_USER's own comment above), credentialed exactly as
  // practitionerA is.
  await seedUser(owner, {
    id: MRN_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: MRN_PRACTITIONER_AUTH,
    displayName: 'Synthetic Mrn Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MRN_PRACTITIONER, MRN_PRACTITIONER_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MRN_PRACTITIONER,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });

  // A clean client, checked in by record number instead of an id.
  await seedClient(owner, IDS.tenantA, CLIENT_BY_MRN, IDS.ownerA, 'ByMrn');
  await owner.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_BY_MRN,
  ]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [CONTACT_BY_MRN, IDS.tenantA, CLIENT_BY_MRN],
  );
  await consent(
    '00000000-0000-4000-8000-00000000400b',
    CLIENT_BY_MRN,
    CONTACT_BY_MRN,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-00000000400c',
    CLIENT_BY_MRN,
    CONTACT_BY_MRN,
    'home_visit',
  );
  await consent(
    '00000000-0000-4000-8000-000000004120',
    CLIENT_BY_MRN,
    CONTACT_BY_MRN,
    'health_data',
  );
  await bookToday(APPOINTMENT_BY_MRN, CLIENT_BY_MRN, '13', MRN_PRACTITIONER);

  // A practitioner and a clean client whose only visit today is one the
  // household was never told about.
  await seedUser(owner, {
    id: PROPOSED_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: PROPOSED_PRACTITIONER_AUTH,
    displayName: 'Synthetic Proposed Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, PROPOSED_PRACTITIONER, PROPOSED_PRACTITIONER_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: PROPOSED_PRACTITIONER,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await seedClient(owner, IDS.tenantA, CLIENT_PROPOSED, IDS.ownerA, 'Proposed');
  await owner.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_PROPOSED,
  ]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [CONTACT_PROPOSED, IDS.tenantA, CLIENT_PROPOSED],
  );
  await consent(
    '00000000-0000-4000-8000-000000004130',
    CLIENT_PROPOSED,
    CONTACT_PROPOSED,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-000000004131',
    CLIENT_PROPOSED,
    CONTACT_PROPOSED,
    'home_visit',
  );
  await consent(
    '00000000-0000-4000-8000-000000004132',
    CLIENT_PROPOSED,
    CONTACT_PROPOSED,
    'health_data',
  );
  await bookToday(APPOINTMENT_PROPOSED, CLIENT_PROPOSED, '14', PROPOSED_PRACTITIONER, 'proposed');

  // The two-visit household. Both windows are placed against the database's
  // own clock rather than at a fixed hour, because the route picks the
  // appointment by where now() falls: the second contains this moment, the
  // first finished a little over an hour before it. (Checked in the small
  // hours, the earlier window falls outside today's Dubai day and is not a
  // candidate at all — the assertion below then holds for the plainer reason,
  // and holds either way.)
  await seedUser(owner, {
    id: TWO_VISIT_USER,
    tenantId: IDS.tenantA,
    authId: TWO_VISIT_AUTH,
    displayName: 'Synthetic Two Visit Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, TWO_VISIT_PRACTITIONER, TWO_VISIT_USER);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: TWO_VISIT_PRACTITIONER,
    serviceTypeId: SERVICE_TYPE,
    certification: 'bcia_bcn',
    validFrom: '2020-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await seedClient(owner, IDS.tenantA, CLIENT_TWO_VISITS, IDS.ownerA, 'TwoVisits');
  await owner.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_TWO_VISITS,
  ]);
  await owner.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', true)",
    [CONTACT_TWO_VISITS, IDS.tenantA, CLIENT_TWO_VISITS],
  );
  await consent(
    '00000000-0000-4000-8000-00000000400d',
    CLIENT_TWO_VISITS,
    CONTACT_TWO_VISITS,
    'participation',
  );
  await consent(
    '00000000-0000-4000-8000-00000000400e',
    CLIENT_TWO_VISITS,
    CONTACT_TWO_VISITS,
    'home_visit',
  );
  await consent(
    '00000000-0000-4000-8000-000000004121',
    CLIENT_TWO_VISITS,
    CONTACT_TWO_VISITS,
    'health_data',
  );
  // The first visit opens the Dubai day; the second is the one this check-in
  // happens inside, ten minutes after its window opened — except in the first
  // seventy minutes after midnight, when there is no room behind now() for a
  // second window and it is placed at 01:10 instead. Both are read back as
  // epoch milliseconds so the test can work out, independently of the query
  // under test, which window this moment actually belongs to.
  const dayStart =
    "(date_trunc('day', now() at time zone 'Asia/Dubai')::date::timestamp " +
    "at time zone 'Asia/Dubai')";
  const windows = await owner.query<{
    earlier: string;
    earlier_ms: string;
    later: string;
    later_ms: string;
  }>(
    `select ${dayStart}::text as earlier, ` +
      `(extract(epoch from ${dayStart}) * 1000)::bigint::text as earlier_ms, ` +
      `greatest(now() - interval '10 minutes', ${dayStart} + interval '70 minutes')::text ` +
      'as later, ' +
      `(extract(epoch from greatest(now() - interval '10 minutes', ` +
      `${dayStart} + interval '70 minutes')) * 1000)::bigint::text as later_ms`,
  );
  visitWindows = {
    earlier: Number(windows.rows[0]!.earlier_ms),
    later: Number(windows.rows[0]!.later_ms),
  };
  for (const [id, windowStart] of [
    [APPOINTMENT_EARLIER_TODAY, windows.rows[0]!.earlier],
    [APPOINTMENT_AROUND_NOW, windows.rows[0]!.later],
  ] as const) {
    await seedAppointment(owner, {
      id,
      tenantId: IDS.tenantA,
      clientId: CLIENT_TWO_VISITS,
      practitionerId: TWO_VISIT_PRACTITIONER,
      serviceTypeId: SERVICE_TYPE,
      locationId: IDS.locationA,
      windowStart,
      status: 'confirmed',
    });
  }

  // A client belonging to a different tenant, to prove the route's own tenant re-check.
  await seedClient(owner, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Foreign');

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  // createApi's own `now` option reaches mountSessions from inside createApi
  // itself now that round 5 (docs/CHANGE-REQUESTS/session-capture-01.md)
  // mounts it there: a second, manual mountSessions call on the same Hono
  // instance would only add a second, shadowed handler for the same path,
  // since Hono answers a request from whichever handler was registered
  // first — the fixed clock below would never be reached.
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now: () => new Date(FIXED_NOW),
  });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

async function refusalsFor(entityId: string) {
  const { rows } = await owner.query<{
    action: string;
    entity_type: string;
    entity_id: string;
    client_id: string | null;
    reason: string;
  }>(
    'select action, entity_type, entity_id, client_id, reason from audit_log ' +
      "where action = 'refused' and entity_id = $1",
    [entityId],
  );
  return rows;
}

describe('POST /api/sessions/:id/events', () => {
  it('checks a practitioner in and audits it with the client behind the row', async () => {
    const res = await postCheckIn(SESSION_HAPPY, AUTH.practitionerA, {
      id: EVENT_HAPPY,
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CheckInResponse;
    expect(body).toEqual({
      status: 'checked_in',
      sessionId: SESSION_HAPPY,
      // No photo_video consent on this fixture, so the runner never offers
      // the camera (app/therapist/session/PostStep.tsx). The server refuses
      // a photo event either way.
      // The last placement, for the pre-flight's own button
      // (docs/SPEC/practitioner-phone.md section 4.5). Null here: this client
      // has no completed visit behind them, so there is nothing to show and no
      // button to show it with.
      checkedInAt: FIXED_NOW,
    });

    const session = await owner.query<{
      status: string;
      client_id: string;
      practitioner_id: string;
      delivery_mode: string;
    }>('select status, client_id, practitioner_id, delivery_mode from session where id = $1', [
      SESSION_HAPPY,
    ]);
    expect(session.rows[0]).toEqual({
      status: 'in_progress',
      client_id: CLIENT_ADULT,
      practitioner_id: MORE_IDS.practitionerA,
      delivery_mode: 'home',
    });

    const event = await owner.query<{ kind: string; client_id: string; created_by: string }>(
      'select kind, client_id, created_by from session_event where id = $1',
      [EVENT_HAPPY],
    );
    expect(event.rows[0]).toEqual({
      kind: 'session_started',
      client_id: CLIENT_ADULT,
      created_by: MORE_IDS.practitionerUserA,
    });

    // And the booked visit behind it now says a practitioner is standing in
    // the household's hall (db/migrations/305_appointment_checked_in.sql,
    // called by the route inside this same transaction). Until this existed
    // the row stayed at 'confirmed' for the whole visit, and every guard
    // phrased as "a checked-in visit cannot be moved or cancelled" was
    // written against a status nothing ever wrote.
    const appointment = await owner.query<{ status: string }>(
      'select status::text as status from appointment where id = $1',
      [APPOINTMENT_ADULT],
    );
    expect(appointment.rows[0]).toEqual({ status: 'checked_in' });

    // The audit trigger fires on both inserts, and 097's generalised
    // app.audit_client_id names the client on each row.
    const audit = await owner.query<{ entity_type: string; client_id: string }>(
      'select entity_type, client_id from audit_log where entity_id in ($1, $2) order by entity_type',
      [SESSION_HAPPY, EVENT_HAPPY],
    );
    expect(audit.rows).toEqual([
      { entity_type: 'session', client_id: CLIENT_ADULT },
      { entity_type: 'session_event', client_id: CLIENT_ADULT },
    ]);
  });

  it('checks a practitioner in by record number, writing the resolved client id, not the mrn', async () => {
    const res = await postCheckIn(SESSION_BY_MRN, MRN_PRACTITIONER_AUTH, {
      id: EVENT_BY_MRN,
      clientMrn: `MW-${CLIENT_BY_MRN.slice(-6)}`,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      status: 'checked_in',
      sessionId: SESSION_BY_MRN,
      checkedInAt: FIXED_NOW,
    });

    const session = await owner.query<{ client_id: string; practitioner_id: string }>(
      'select client_id, practitioner_id from session where id = $1',
      [SESSION_BY_MRN],
    );
    expect(session.rows[0]).toEqual({
      client_id: CLIENT_BY_MRN,
      practitioner_id: MRN_PRACTITIONER,
    });

    // A confirmed visit is marked checked in at the door (305). Until 10
    // September 2026 this case booked a proposed visit and proved the check-in
    // went ahead regardless; the operator's decision 5 reversed that, and the
    // case below proves the refusal.
    const appointment = await owner.query<{ status: string }>(
      'select status::text as status from appointment where id = $1',
      [APPOINTMENT_BY_MRN],
    );
    expect(appointment.rows[0]).toEqual({ status: 'checked_in' });
  });

  it('stamps the visit the practitioner is standing in, not the earliest of the day', async () => {
    // A household with two visits on one day. Picking the day's first
    // appointment stamps the wrong one, and the wrong one is then the row the
    // close settles and the right one stays live for ever.
    //
    // Which visit is the right answer depends on the hour the suite runs, so
    // it is worked out here from the two seeded windows rather than assumed:
    // the window containing this moment, or failing that the nearer of the
    // two. That is the rule the route's ordering implements, written a second
    // time and independently. For all but the first seventy minutes of the
    // Dubai day the answer is the later window, which is exactly the case
    // ordering by window_start alone gets wrong.
    const WINDOW_MS = 45 * 60 * 1000;
    const distance = (opens: number, at: number) =>
      at < opens ? opens - at : Math.max(0, at - (opens + WINDOW_MS));
    const at = Date.now();
    const standingIn =
      distance(visitWindows.later, at) < distance(visitWindows.earlier, at)
        ? APPOINTMENT_AROUND_NOW
        : APPOINTMENT_EARLIER_TODAY;
    const untouched =
      standingIn === APPOINTMENT_AROUND_NOW ? APPOINTMENT_EARLIER_TODAY : APPOINTMENT_AROUND_NOW;

    const res = await postCheckIn(SESSION_TWO_VISITS, TWO_VISIT_AUTH, {
      id: EVENT_TWO_VISITS,
      clientId: CLIENT_TWO_VISITS,
    });
    expect(res.status).toBe(201);

    const session = await owner.query<{ appointment_id: string }>(
      'select appointment_id from session where id = $1',
      [SESSION_TWO_VISITS],
    );
    expect(session.rows[0]).toEqual({ appointment_id: standingIn });

    const statuses = await owner.query<{ id: string; status: string }>(
      'select id, status::text as status from appointment where id = any($1)',
      [[standingIn, untouched]],
    );
    expect(statuses.rows).toEqual(
      expect.arrayContaining([
        { id: standingIn, status: 'checked_in' },
        { id: untouched, status: 'confirmed' },
      ]),
    );
  });

  it('refuses a body naming both clientId and clientMrn', async () => {
    const sessionId = '00000000-0000-4000-8000-000000900006';
    const res = await api.request(`/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await mint(AUTH.practitionerA)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clientId: CLIENT_ADULT,
        clientMrn: `MW-${CLIENT_BY_MRN.slice(-6)}`,
        point: { lat: 25.2, lng: 55.27 },
        events: [
          {
            id: '00000000-0000-4000-8000-000000900007',
            seq: 1,
            kind: 'session_started',
            deviceAt: FIXED_NOW,
            payload: { serviceTypeId: SERVICE_TYPE, deliveryMode: 'home', locationId: null },
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const rows = await owner.query('select 1 from session where id = $1', [sessionId]);
    expect(rows.rowCount).toBe(0);
  });

  it('refuses a body naming neither clientId nor clientMrn', async () => {
    const sessionId = '00000000-0000-4000-8000-000000900008';
    const res = await api.request(`/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await mint(AUTH.practitionerA)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        point: { lat: 25.2, lng: 55.27 },
        events: [
          {
            id: '00000000-0000-4000-8000-000000900009',
            seq: 1,
            kind: 'session_started',
            deviceAt: FIXED_NOW,
            payload: { serviceTypeId: SERVICE_TYPE, deliveryMode: 'home', locationId: null },
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('is idempotent: resending the same event returns the same result and writes nothing twice', async () => {
    const before = await owner.query('select count(*)::int as n from session_event where id = $1', [
      EVENT_HAPPY,
    ]);
    const res = await postCheckIn(SESSION_HAPPY, AUTH.practitionerA, {
      id: EVENT_HAPPY,
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'checked_in',
      sessionId: SESSION_HAPPY,
      checkedInAt: FIXED_NOW,
    });
    const after = await owner.query('select count(*)::int as n from session_event where id = $1', [
      EVENT_HAPPY,
    ]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      await owner.query('select count(*)::int as n from session where id = $1', [SESSION_HAPPY]),
    ).toMatchObject({ rows: [{ n: 1 }] });
  });

  it("refuses a lead practitioner another practitioner's session id, without handing it back or dropping the event", async () => {
    const res = await postCheckIn(SESSION_HAPPY, LEAD_AUTH, {
      id: EVENT_STOLEN,
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
    // Not silently dropped as a false "resend": no row for this event exists anywhere.
    const dropped = await owner.query('select 1 from session_event where id = $1', [EVENT_STOLEN]);
    expect(dropped.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_HAPPY)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_HAPPY,
        client_id: null,
        reason: 'session_not_yours',
      },
    ]);
  });

  it('rejects a device clock far outside the server window, before writing anything', async () => {
    const res = await postCheckIn(SESSION_BAD_CLOCK, AUTH.practitionerA, {
      id: EVENT_BAD_CLOCK,
      clientId: CLIENT_ADULT,
      deviceAt: '2026-09-02T09:00:00.000Z', // 2h28m after FIXED_NOW
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'bad_request',
      detail: 'device_clock_out_of_range',
    });
    const rows = await owner.query('select 1 from session where id = $1', [SESSION_BAD_CLOCK]);
    expect(rows.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_BAD_CLOCK)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_BAD_CLOCK,
        client_id: null,
        reason: 'device_clock_out_of_range',
      },
    ]);
  });

  it('rejects a geo point outside the boundary of the earth', async () => {
    const res = await postCheckIn(SESSION_BAD_POINT, AUTH.practitionerA, {
      id: EVENT_BAD_POINT,
      clientId: CLIENT_ADULT,
      point: { lat: 200, lng: 55.27 },
    });
    expect(res.status).toBe(400);
    const rows = await owner.query('select 1 from session where id = $1', [SESSION_BAD_POINT]);
    expect(rows.rowCount).toBe(0);
  });

  it('refuses a second open visit for the same practitioner while one is already in progress', async () => {
    const res = await postCheckIn(SESSION_SECOND_WHILE_OPEN, AUTH.practitionerA, {
      id: EVENT_SECOND_WHILE_OPEN,
      clientId: CLIENT_MINOR_WITH_GUARDIAN,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['already_checked_in'] });
    const rows = await owner.query('select 1 from session where id = $1', [
      SESSION_SECOND_WHILE_OPEN,
    ]);
    expect(rows.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_SECOND_WHILE_OPEN)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_SECOND_WHILE_OPEN,
        client_id: CLIENT_MINOR_WITH_GUARDIAN,
        reason: 'already_checked_in',
      },
    ]);
  });

  it("blocks and writes nothing when participation consent is missing, leaving exactly one 'refused' audit row", async () => {
    const res = await postCheckIn(SESSION_NO_PARTICIPATION, AUTH.practitionerA, {
      id: EVENT_NO_PARTICIPATION,
      clientId: CLIENT_NO_PARTICIPATION,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      status: 'blocked',
      reasons: ['consent_missing_participation'],
    });
    const rows = await owner.query('select 1 from session where id = $1', [
      SESSION_NO_PARTICIPATION,
    ]);
    expect(rows.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_NO_PARTICIPATION)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_NO_PARTICIPATION,
        client_id: CLIENT_NO_PARTICIPATION,
        reason: 'consent_missing_participation',
      },
    ]);
  });

  it("blocks a visit the household was never told about, writing nothing but the 'refused' row", async () => {
    // The operator's decision of 10 September 2026 (decision 5): a proposed
    // visit is the office's to confirm, not the practitioner's to run.
    const res = await postCheckIn(SESSION_PROPOSED, PROPOSED_PRACTITIONER_AUTH, {
      id: EVENT_PROPOSED,
      clientId: CLIENT_PROPOSED,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['visit_not_confirmed'] });
    const rows = await owner.query('select 1 from session where id = $1', [SESSION_PROPOSED]);
    expect(rows.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_PROPOSED)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_PROPOSED,
        client_id: CLIENT_PROPOSED,
        reason: 'visit_not_confirmed',
      },
    ]);
    const appointment = await owner.query<{ status: string }>(
      'select status::text as status from appointment where id = $1',
      [APPOINTMENT_PROPOSED],
    );
    expect(appointment.rows[0]).toEqual({ status: 'proposed' });
  });

  it('blocks a minor without an active guardian consent', async () => {
    const res = await postCheckIn(SESSION_MINOR_NO_GUARDIAN, AUTH.practitionerA, {
      id: EVENT_MINOR_NO_GUARDIAN,
      clientId: CLIENT_MINOR_NO_GUARDIAN,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      status: 'blocked',
      reasons: ['consent_missing_minor_participation'],
    });
  });

  it('allows a minor once the guardian consent is active', async () => {
    const res = await postCheckIn(SESSION_MINOR_WITH_GUARDIAN, AUTH.practitionerA, {
      id: EVENT_MINOR_WITH_GUARDIAN,
      clientId: CLIENT_MINOR_WITH_GUARDIAN,
    });
    // Blocked above by the still-open SESSION_HAPPY visit — check that one out
    // is out of scope for this pull request, so this proves the consent gate
    // alone by observing the *reason*, not a successful check-in.
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['already_checked_in'] });
  });

  it('fails closed when the date of birth is unknown', async () => {
    const res = await postCheckIn(SESSION_NULL_DOB, AUTH.practitionerA, {
      id: EVENT_NULL_DOB,
      clientId: CLIENT_NULL_DOB,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: 'blocked', reasons: ['date_of_birth_unknown'] });
  });

  it("re-verifies the client belongs to the caller's own tenant before writing anything, leaving a refused row with no client_id", async () => {
    const res = await postCheckIn(SESSION_CROSS_TENANT, AUTH.practitionerA, {
      id: EVENT_CROSS_TENANT,
      clientId: IDS.clientB,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request', detail: 'not_booked_today' });
    const rows = await owner.query('select 1 from session where id = $1', [SESSION_CROSS_TENANT]);
    expect(rows.rowCount).toBe(0);
    expect(await refusalsFor(SESSION_CROSS_TENANT)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: SESSION_CROSS_TENANT,
        client_id: null,
        reason: 'not_booked_today',
      },
    ]);
  });

  it('refuses a role that may never run a session, leaving a refused row with no client_id', async () => {
    const sessionId = '00000000-0000-4000-8000-000000005999';
    const res = await postCheckIn(sessionId, AUTH.contactA, {
      id: '00000000-0000-4000-8000-000000006999',
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(403);
    expect(await refusalsFor(sessionId)).toEqual([
      {
        action: 'refused',
        entity_type: 'session',
        entity_id: sessionId,
        client_id: null,
        reason: 'wrong_role',
      },
    ]);
  });

  it('refuses an unknown caller', async () => {
    const res = await postCheckIn('00000000-0000-4000-8000-000000005998', AUTH.unknown, {
      id: '00000000-0000-4000-8000-000000006998',
      clientId: CLIENT_ADULT,
    });
    expect(res.status).toBe(403);
  });
});
