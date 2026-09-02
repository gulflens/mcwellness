import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  freshDatabase,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import { seedAppointment, seedConsent, seedConsentDocument } from './helpers';

/**
 * Direct coverage of app.checkin_context (db/migrations/301_checkin_context.sql):
 * the security-definer door app/api/sessions/checkin.ts reads a client's
 * check-in context through now that client-record's own restrictive read
 * policies (pull request 21, branch client-record, not merged into this
 * worktree) would otherwise stop a practitioner reading a client's status,
 * date of birth or consent at all. tests/session/db/checkin.test.ts already
 * proves the route's behaviour end to end; this file exercises the function
 * on its own, at the database, including things that file cannot reach
 * directly: a client that genuinely belongs to another tenant, resolution by
 * record number, and every way the appointment-binding rule this pull
 * request adds can fail (no appointment, yesterday's, a cancelled one,
 * another practitioner's).
 *
 * found is no longer just "this client is in my tenant": it is also "I have
 * a booked visit with this client today" — the caller's own practitioner row
 * (resolved from app.actor_id) must hold an appointment for the resolved
 * client whose window overlaps today's half-open Dubai day [today 00:00,
 * tomorrow 00:00) and whose status is proposed, confirmed or checked_in.
 * There is no role exception: a lead practitioner or owner acting through a
 * practitioner row is bound by exactly the same rule as an ordinary
 * practitioner.
 */

const DOCUMENT = '00000000-0000-4000-8000-000000103001';

const CLIENT_ADULT = IDS.clientA; // tenant A, booked today with the caller
const CLIENT_MINOR = '00000000-0000-4000-8000-000000101002';
const CLIENT_NULL_DOB = '00000000-0000-4000-8000-000000101003';
const CLIENT_MARKETING_ONLY = '00000000-0000-4000-8000-000000101004';
const CLIENT_NO_APPOINTMENT = '00000000-0000-4000-8000-000000101005';
const CLIENT_YESTERDAY = '00000000-0000-4000-8000-000000101006';
const CLIENT_CANCELLED = '00000000-0000-4000-8000-000000101007';
const CLIENT_OTHER_PRACTITIONER = '00000000-0000-4000-8000-000000101008';
// The two midnight edges of the half-open Dubai-day range
// (db/migrations/301_checkin_context.sql): booked exactly at today's own
// midnight is the inclusive lower edge (found); booked exactly at
// tomorrow's is the exclusive upper edge — tomorrow's own day, not found.
const CLIENT_MIDNIGHT_START = '00000000-0000-4000-8000-000000101009';
const CLIENT_MIDNIGHT_END = '00000000-0000-4000-8000-000000101010';
const CLIENT_FOREIGN = IDS.clientB; // tenant B — never visible to a tenant A caller
// Ends in six digits so its auto-derived mrn (seedClient: `MW-${id.slice(-6)}`)
// satisfies app/api/sessions/schema.ts's ClientMrn pattern.
const CLIENT_BY_MRN = '00000000-0000-4000-8000-000000900002';

const CONTACT_ADULT = '00000000-0000-4000-8000-000000102001';
const CONTACT_MARKETING = '00000000-0000-4000-8000-000000102002';

// The caller: an ordinary practitioner, whose own appointments are the only
// ones that may ever satisfy their own check-in context.
const CALLER_USER = MORE_IDS.practitionerUserA;
const CALLER_PRACTITIONER = MORE_IDS.practitionerA;
// A second practitioner, distinct from the caller, so "booked for someone
// else" has a row to point at.
const OTHER_PRACTITIONER_USER = '00000000-0000-4000-8000-000000107001';
const OTHER_PRACTITIONER = '00000000-0000-4000-8000-000000107002';

const APPT_ADULT = '00000000-0000-4000-8000-000000110001';
const APPT_MINOR = '00000000-0000-4000-8000-000000110002';
const APPT_NULL_DOB = '00000000-0000-4000-8000-000000110003';
const APPT_MARKETING = '00000000-0000-4000-8000-000000110004';
const APPT_BY_MRN = '00000000-0000-4000-8000-000000110005';
const APPT_YESTERDAY = '00000000-0000-4000-8000-000000110006';
const APPT_CANCELLED = '00000000-0000-4000-8000-000000110007';
const APPT_OTHER_PRACTITIONER = '00000000-0000-4000-8000-000000110008';
const APPT_MIDNIGHT_START = '00000000-0000-4000-8000-000000110009';
const APPT_MIDNIGHT_END = '00000000-0000-4000-8000-000000110010';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');

  await seedUser(client, {
    id: CALLER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Caller',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, CALLER_PRACTITIONER, CALLER_USER);
  await seedUser(client, {
    id: OTHER_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Other Practitioner',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, OTHER_PRACTITIONER, OTHER_PRACTITIONER_USER);

  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');

  await seedClient(client, IDS.tenantA, CLIENT_ADULT, IDS.ownerA, 'Adult');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_ADULT,
  ]);
  await seedLocation(client, IDS.tenantA, IDS.locationA, CLIENT_ADULT, IDS.ownerA);

  await seedClient(client, IDS.tenantA, CLIENT_MINOR, IDS.ownerA, 'Minor');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '2015-01-01',
    CLIENT_MINOR,
  ]);

  await seedClient(client, IDS.tenantA, CLIENT_NULL_DOB, IDS.ownerA, 'NullDob');

  await seedClient(client, IDS.tenantA, CLIENT_MARKETING_ONLY, IDS.ownerA, 'MarketingOnly');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_MARKETING_ONLY,
  ]);

  await seedClient(client, IDS.tenantA, CLIENT_NO_APPOINTMENT, IDS.ownerA, 'NoAppointment');
  await seedClient(client, IDS.tenantA, CLIENT_YESTERDAY, IDS.ownerA, 'Yesterday');
  await seedClient(client, IDS.tenantA, CLIENT_CANCELLED, IDS.ownerA, 'Cancelled');
  await seedClient(client, IDS.tenantA, CLIENT_OTHER_PRACTITIONER, IDS.ownerA, 'OtherPractitioner');
  await seedClient(client, IDS.tenantA, CLIENT_MIDNIGHT_START, IDS.ownerA, 'MidnightStart');
  await seedClient(client, IDS.tenantA, CLIENT_MIDNIGHT_END, IDS.ownerA, 'MidnightEnd');
  await seedClient(client, IDS.tenantA, CLIENT_BY_MRN, IDS.ownerA, 'ByMrn');

  await seedClient(client, IDS.tenantB, CLIENT_FOREIGN, IDS.ownerB, 'Foreign');

  // The database's own idea of "today" and "yesterday" in Asia/Dubai, read
  // once here rather than assumed from this process's clock: app.checkin_context
  // compares against the same now() this query reads, so the fixtures below
  // can never land a calendar day off from what the function will see.
  const dates = await client.query<{ today: string; yesterday: string; tomorrow: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today, " +
      "((now() at time zone 'Asia/Dubai')::date - 1)::text as yesterday, " +
      "((now() at time zone 'Asia/Dubai')::date + 1)::text as tomorrow",
  );
  const today = dates.rows[0]!.today;
  const yesterday = dates.rows[0]!.yesterday;
  const tomorrow = dates.rows[0]!.tomorrow;
  // An explicit +04:00 offset (Asia/Dubai has no daylight saving), so each
  // appointment's window_start is unambiguous regardless of the test
  // runner's own local time zone. Spaced an hour apart — the exclusion
  // constraint's busy window is 45 minutes plus a 15-minute default travel
  // buffer, exactly one hour — so the caller's own same-day appointments
  // never collide with one another.
  const at = (day: string, hour: string) => `${day}T${hour}:00:00+04:00`;

  await seedAppointment(client, {
    id: APPT_ADULT,
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '08'),
  });
  await seedAppointment(client, {
    id: APPT_MINOR,
    tenantId: IDS.tenantA,
    clientId: CLIENT_MINOR,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '09'),
  });
  await seedAppointment(client, {
    id: APPT_NULL_DOB,
    tenantId: IDS.tenantA,
    clientId: CLIENT_NULL_DOB,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '10'),
  });
  await seedAppointment(client, {
    id: APPT_MARKETING,
    tenantId: IDS.tenantA,
    clientId: CLIENT_MARKETING_ONLY,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '11'),
  });
  await seedAppointment(client, {
    id: APPT_BY_MRN,
    tenantId: IDS.tenantA,
    clientId: CLIENT_BY_MRN,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '12'),
  });
  // A real appointment with the caller, just not today: proves found does
  // not merely check "an appointment exists somewhere".
  await seedAppointment(client, {
    id: APPT_YESTERDAY,
    tenantId: IDS.tenantA,
    clientId: CLIENT_YESTERDAY,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(yesterday, '08'),
  });
  // Cancelled, today, the caller's own: still refused. The exclusion
  // constraint's own filter (status not in the four "not live" values)
  // means this can share APPT_ADULT's exact hour without colliding.
  await seedAppointment(client, {
    id: APPT_CANCELLED,
    tenantId: IDS.tenantA,
    clientId: CLIENT_CANCELLED,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '08'),
    status: 'cancelled',
  });
  // Today, live, but booked for the other practitioner: the caller has no
  // claim on it, and role never substitutes for the caller's own row.
  await seedAppointment(client, {
    id: APPT_OTHER_PRACTITIONER,
    tenantId: IDS.tenantA,
    clientId: CLIENT_OTHER_PRACTITIONER,
    practitionerId: OTHER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '08'),
  });
  // The inclusive lower edge: window_start exactly at today's own Dubai
  // midnight (00:00:00+04:00) is still today, so this is found.
  await seedAppointment(client, {
    id: APPT_MIDNIGHT_START,
    tenantId: IDS.tenantA,
    clientId: CLIENT_MIDNIGHT_START,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(today, '00'),
  });
  // The exclusive upper edge: window_start exactly at tomorrow's own
  // Dubai midnight is tomorrow's day, not today's, so this is not found —
  // even though it is the very next instant after APPT_MIDNIGHT_START's
  // own busy window ends.
  await seedAppointment(client, {
    id: APPT_MIDNIGHT_END,
    tenantId: IDS.tenantA,
    clientId: CLIENT_MIDNIGHT_END,
    practitionerId: CALLER_PRACTITIONER,
    serviceTypeId: MORE_IDS.serviceTypeA,
    locationId: IDS.locationA,
    windowStart: at(tomorrow, '00'),
  });

  await seedConsentDocument(client, IDS.tenantA, DOCUMENT);

  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) values ($1, $2, $3, $4, true)',
    [CONTACT_ADULT, IDS.tenantA, CLIENT_ADULT, 'mother'],
  );
  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) values ($1, $2, $3, $4, true)',
    [CONTACT_MARKETING, IDS.tenantA, CLIENT_MARKETING_ONLY, 'mother'],
  );

  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104001',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'participation',
    textDocumentId: DOCUMENT,
  });
  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104002',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'home_visit',
    textDocumentId: DOCUMENT,
  });
  // Withdrawn: must never surface, proving the "active, as of now" filter
  // survived the move from the route's own query into this function.
  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104003',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'minor_participation',
    textDocumentId: DOCUMENT,
    status: 'withdrawn',
  });

  // A real, active consent whose purpose sits outside canCheckIn's three:
  // proves the function's own filter narrows this, not merely the route's
  // isConsentPurpose type guard downstream.
  await client.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, status, method) values ($1, $2, $3, $4, 'marketing', 1, $5, 'active', 'app_signature')",
    [
      '00000000-0000-4000-8000-000000104004',
      IDS.tenantA,
      CLIENT_MARKETING_ONLY,
      CONTACT_MARKETING,
      DOCUMENT,
    ],
  );

  // asApiRole (tests/db/helpers.ts) runs each case inside a savepoint, which
  // only exists inside a transaction block — opened here, after the fixture
  // rows above are in place, and rolled back in afterAll.
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

/** Runs `fn` as the caller's own practitioner user, inside asApiRole's savepoint. */
async function asCaller<T>(fn: () => Promise<T>): Promise<T> {
  return asApiRole(
    client,
    IDS.tenantA,
    async () => {
      await client.query("select set_config('app.actor_id', $1, true)", [CALLER_USER]);
      return fn();
    },
    'practitioner',
  );
}

describe('app.checkin_context', () => {
  it('finds a client booked with the caller today and reports its context', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_ADULT,
        null,
      ]);
      const row = rows[0];
      expect(row).toMatchObject({
        found: true,
        client_id: CLIENT_ADULT,
        has_date_of_birth: true,
        is_minor: false,
      });
      expect([...row.active_consent_purposes].sort()).toEqual(['home_visit', 'participation']);
    });
  });

  it('resolves by record number when no id is given, riding the resolved client_id back out', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        null,
        `MW-${CLIENT_BY_MRN.slice(-6)}`,
      ]);
      expect(rows[0]).toMatchObject({ found: true, client_id: CLIENT_BY_MRN });
    });
  });

  it('reports is_minor for a client under 18, judged in the practice zone', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_MINOR,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: true, has_date_of_birth: true, is_minor: true });
    });
  });

  it('reports has_date_of_birth false, and is_minor false, for a client with none on file', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_NULL_DOB,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: true, has_date_of_birth: false, is_minor: false });
    });
  });

  it("never surfaces a consent purpose outside canCheckIn's three", async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_MARKETING_ONLY,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: true, active_consent_purposes: [] });
    });
  });

  it('answers found = false when the client has no appointment at all', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_NO_APPOINTMENT,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });

  it("answers found = false for yesterday's appointment", async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_YESTERDAY,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });

  it('answers found = false for a cancelled appointment', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_CANCELLED,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });

  it("answers found = false for another practitioner's appointment", async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_OTHER_PRACTITIONER,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });

  it("finds an appointment booked exactly at today's own Dubai midnight (the inclusive lower edge)", async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_MIDNIGHT_START,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: true, client_id: CLIENT_MIDNIGHT_START });
    });
  });

  it("answers found = false for an appointment booked exactly at tomorrow's own Dubai midnight (the exclusive upper edge)", async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_MIDNIGHT_END,
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });

  it('answers found = false for another tenant, and never returns a name', async () => {
    await asCaller(async () => {
      const result = await client.query('select * from app.checkin_context($1, $2)', [
        CLIENT_FOREIGN,
        null,
      ]);
      expect(result.rows).toEqual([
        {
          found: false,
          client_id: null,
          has_date_of_birth: false,
          is_minor: false,
          active_consent_purposes: [],
        },
      ]);
      // Not just this row's values withheld: the column itself does not
      // exist to withhold. A name or contact detail could never ride along
      // even by accident.
      expect(result.fields.map((f) => f.name).sort()).toEqual(
        ['active_consent_purposes', 'client_id', 'found', 'has_date_of_birth', 'is_minor'].sort(),
      );
    });
  });

  it('answers found = false for a client id that does not exist at all', async () => {
    await asCaller(async () => {
      const { rows } = await client.query('select * from app.checkin_context($1, $2)', [
        '00000000-0000-4000-8000-000000000000',
        null,
      ]);
      expect(rows[0]).toMatchObject({ found: false, client_id: null });
    });
  });
});
