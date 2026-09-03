import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
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
 * The two security-definer doors the running screen reads through
 * (db/migrations/304_session_reads.sql), and the one the close writes
 * through (302_session_close.sql), exercised directly at the database.
 *
 * A definer function is the one place a stream may hand a practitioner a
 * fact row security would otherwise hide, so each of them is a hole in the
 * wall by construction and every one of them is tested for what it refuses
 * rather than only for what it answers. All three were widened further than
 * they needed to be, and the security and compliance reviews of this pull
 * request named the four ways in:
 *
 *  * **a closed visit.** A door that serves a visit nobody is standing in
 *    front of any more is a door into a finished record.
 *  * **an inactive practitioner.** An account the practice has stopped keeps
 *    no reach, and `practitioner.status` is where the practice says so.
 *  * **another practitioner's visit**, and **another practice's visit**.
 *  * **a minor's photo consent given by somebody with no standing to give
 *    it.** `contact.can_consent` is the practice's own record of who may
 *    agree on a child's behalf; a photograph agreed to by anybody else is
 *    not consent.
 *
 * Everything here is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f2';
const DOCUMENT_A = '00000000-0000-4000-8000-000000203001';
const DOCUMENT_B = '00000000-0000-4000-8000-000000203002';

// Tenant A: the caller, a practitioner the practice has stopped, and one
// other active practitioner whose visits are not the caller's to read.
const CALLER_USER = '00000000-0000-4000-8000-000000201001';
const CALLER = '00000000-0000-4000-8000-000000201002';
const INACTIVE_USER = '00000000-0000-4000-8000-000000201003';
const INACTIVE = '00000000-0000-4000-8000-000000201004';
const OTHER_USER = '00000000-0000-4000-8000-000000201005';
const OTHER = '00000000-0000-4000-8000-000000201006';

// Tenant B: a practitioner of another practice entirely.
const FOREIGN_USER = '00000000-0000-4000-8000-000000201007';
const FOREIGN = '00000000-0000-4000-8000-000000201008';

// Two more in tenant A, one standing in each minor's room, because a
// practitioner may hold exactly one open visit at a time.
const GUARDIAN_VISIT_USER = '00000000-0000-4000-8000-000000201009';
const GUARDIAN_VISIT = '00000000-0000-4000-8000-000000201010';
const IMPROPER_VISIT_USER = '00000000-0000-4000-8000-000000201011';
const IMPROPER_VISIT = '00000000-0000-4000-8000-000000201012';

const ADULT = '00000000-0000-4000-8000-000000202001';
const MINOR_PROPER_CONSENT = '00000000-0000-4000-8000-000000202002';
const MINOR_IMPROPER_CONSENT = '00000000-0000-4000-8000-000000202003';
const FOREIGN_CLIENT = '00000000-0000-4000-8000-000000202004';

const CONTACT_ADULT = '00000000-0000-4000-8000-000000204001';
const CONTACT_GUARDIAN = '00000000-0000-4000-8000-000000204002';
/** On file, reachable, and not somebody the practice records as able to consent. */
const CONTACT_NOT_A_CONSENTER = '00000000-0000-4000-8000-000000204003';
const CONTACT_FOREIGN = '00000000-0000-4000-8000-000000204004';

const LOCATION_A = '00000000-0000-4000-8000-000000205001';
const LOCATION_B = '00000000-0000-4000-8000-000000205002';

// One open visit per practitioner: 300's session_one_open_per_practitioner
// allows exactly one at a time, which is the point of that index.
const OPEN_ADULT = '00000000-0000-4000-8000-000000206001';
const OPEN_OTHER = '00000000-0000-4000-8000-000000206002';
const OPEN_INACTIVE = '00000000-0000-4000-8000-000000206003';
const OPEN_FOREIGN = '00000000-0000-4000-8000-000000206004';
const OPEN_MINOR_PROPER = '00000000-0000-4000-8000-000000206006';
const OPEN_MINOR_IMPROPER = '00000000-0000-4000-8000-000000206007';

/**
 * Three visits that are finished, one per practitioner. The caller's own is
 * what makes "a closed visit is refused" mean the closing and nothing else:
 * a closed visit belonging to somebody else would have been refused for the
 * wrong reason and the test would have proved nothing.
 */
const CLOSED_CALLER = '00000000-0000-4000-8000-000000206011';
const CLOSED_OTHER = '00000000-0000-4000-8000-000000206012';
const CLOSED_INACTIVE = '00000000-0000-4000-8000-000000206013';

/**
 * An appointment behind every visit the close's own door is asked about, so
 * a refusal is the guard refusing rather than the function finding nothing
 * to settle. An hour apiece, because the table refuses a double-booking of
 * either the practitioner or the household, and two fixtures at the same
 * time would be a real one.
 */
const APPT_OPEN_ADULT = '00000000-0000-4000-8000-000000209001';
const APPT_CLOSED_CALLER = '00000000-0000-4000-8000-000000209002';
const APPT_CLOSED_OTHER = '00000000-0000-4000-8000-000000209003';
const APPT_CLOSED_INACTIVE = '00000000-0000-4000-8000-000000209004';
// Two more, behind the open visits app.mark_appointment_checked_in
// (305_appointment_checked_in.sql) must refuse: without one apiece, a false
// answer from that door would only mean "no appointment to mark" and would
// prove nothing about the guard under test.
const APPT_OPEN_INACTIVE = '00000000-0000-4000-8000-000000209005';
const APPT_OPEN_OTHER = '00000000-0000-4000-8000-000000209006';

let client: pg.Client;

/** A session row written as the owner, so the fixture is not itself a test of the route. */
async function seedSession(session: {
  id: string;
  tenantId: string;
  clientId: string;
  practitionerId: string;
  locationId: string;
  appointmentId?: string;
  closed?: boolean;
}): Promise<void> {
  await client.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'delivery_mode, location_id, appointment_id, checked_in_at, status, closed_at, ' +
      'closed_by, created_by) ' +
      "values ($1, $2, $3, $4, $5, 'home', $6, $7, now(), $8, $9, $10, $11)",
    [
      session.id,
      session.tenantId,
      session.clientId,
      session.practitionerId,
      SERVICE_TYPE,
      session.locationId,
      session.appointmentId ?? null,
      session.closed ? 'completed' : 'in_progress',
      session.closed ? new Date().toISOString() : null,
      session.closed ? CALLER_USER : null,
      CALLER_USER,
    ],
  );
}

/** A contact on a client's file, and whether the practice records them as able to consent. */
async function seedContact(contact: {
  id: string;
  tenantId: string;
  clientId: string;
  canConsent: boolean;
}): Promise<void> {
  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
      "values ($1, $2, $3, 'mother', $4)",
    [contact.id, contact.tenantId, contact.clientId, contact.canConsent],
  );
}

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(client, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedConsentDocument(client, IDS.tenantA, DOCUMENT_A);
  await seedConsentDocument(client, IDS.tenantB, DOCUMENT_B);

  for (const [userId, practitionerId, tenantId, roles] of [
    [CALLER_USER, CALLER, IDS.tenantA, ['practitioner']],
    [INACTIVE_USER, INACTIVE, IDS.tenantA, ['practitioner']],
    [OTHER_USER, OTHER, IDS.tenantA, ['practitioner']],
    [FOREIGN_USER, FOREIGN, IDS.tenantB, ['practitioner']],
    [GUARDIAN_VISIT_USER, GUARDIAN_VISIT, IDS.tenantA, ['practitioner']],
    [IMPROPER_VISIT_USER, IMPROPER_VISIT, IDS.tenantA, ['practitioner']],
  ] as const) {
    await seedUser(client, {
      id: userId,
      tenantId,
      authId: userId,
      displayName: 'Synthetic Practitioner',
      roles: [...roles],
    });
    await seedPractitioner(client, tenantId, practitionerId, userId);
  }
  // The practice has stopped this one. Nothing about the account changes but
  // this column, which is exactly the point: every door must read it.
  await client.query("update practitioner set status = 'inactive' where id = $1", [INACTIVE]);

  await seedClient(client, IDS.tenantA, ADULT, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantA, MINOR_PROPER_CONSENT, IDS.ownerA, 'Lagoon');
  await seedClient(client, IDS.tenantA, MINOR_IMPROPER_CONSENT, IDS.ownerA, 'Meadow');
  await seedClient(client, IDS.tenantB, FOREIGN_CLIENT, IDS.ownerB, 'Orchard');
  await client.query("update client set date_of_birth = '1990-01-01' where id = any($1)", [
    [ADULT, FOREIGN_CLIENT],
  ]);
  await client.query(
    "update client set date_of_birth = (now() at time zone 'Asia/Dubai')::date " +
      "- interval '9 years' where id = any($1)",
    [[MINOR_PROPER_CONSENT, MINOR_IMPROPER_CONSENT]],
  );

  await seedContact({
    id: CONTACT_ADULT,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    canConsent: true,
  });
  await seedContact({
    id: CONTACT_GUARDIAN,
    tenantId: IDS.tenantA,
    clientId: MINOR_PROPER_CONSENT,
    canConsent: true,
  });
  await seedContact({
    id: CONTACT_NOT_A_CONSENTER,
    tenantId: IDS.tenantA,
    clientId: MINOR_IMPROPER_CONSENT,
    canConsent: false,
  });
  await seedContact({
    id: CONTACT_FOREIGN,
    tenantId: IDS.tenantB,
    clientId: FOREIGN_CLIENT,
    canConsent: true,
  });

  // The same purpose, the same status, the same wording: the only difference
  // between the last two is who agreed.
  for (const [index, [clientId, contactId, tenantId, documentId]] of [
    [ADULT, CONTACT_ADULT, IDS.tenantA, DOCUMENT_A],
    [MINOR_PROPER_CONSENT, CONTACT_GUARDIAN, IDS.tenantA, DOCUMENT_A],
    [MINOR_IMPROPER_CONSENT, CONTACT_NOT_A_CONSENTER, IDS.tenantA, DOCUMENT_A],
    [FOREIGN_CLIENT, CONTACT_FOREIGN, IDS.tenantB, DOCUMENT_B],
  ].entries()) {
    await seedConsent(client, {
      id: `00000000-0000-4000-8000-00000020700${index}`,
      tenantId: tenantId!,
      clientId: clientId!,
      givenByContactId: contactId!,
      purpose: 'photo_video' as 'participation',
      textDocumentId: documentId!,
    });
  }

  await seedLocation(client, IDS.tenantA, LOCATION_A, ADULT, IDS.ownerA);
  await seedLocation(client, IDS.tenantB, LOCATION_B, FOREIGN_CLIENT, IDS.ownerB);

  const today = (
    await client.query<{ today: string }>(
      "select (now() at time zone 'Asia/Dubai')::date::text as today",
    )
  ).rows[0]!.today;
  for (const [appointmentId, practitionerId, hour] of [
    [APPT_OPEN_ADULT, CALLER, '08'],
    [APPT_CLOSED_CALLER, CALLER, '10'],
    [APPT_CLOSED_OTHER, OTHER, '12'],
    [APPT_CLOSED_INACTIVE, INACTIVE, '14'],
    [APPT_OPEN_INACTIVE, INACTIVE, '16'],
    [APPT_OPEN_OTHER, OTHER, '18'],
  ] as const) {
    await seedAppointment(client, {
      id: appointmentId,
      tenantId: IDS.tenantA,
      clientId: ADULT,
      practitionerId,
      serviceTypeId: SERVICE_TYPE,
      locationId: LOCATION_A,
      windowStart: `${today}T${hour}:00:00+04:00`,
      status: 'confirmed',
    });
  }

  await seedSession({
    id: OPEN_ADULT,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: CALLER,
    locationId: LOCATION_A,
    appointmentId: APPT_OPEN_ADULT,
  });
  await seedSession({
    id: CLOSED_CALLER,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: CALLER,
    locationId: LOCATION_A,
    appointmentId: APPT_CLOSED_CALLER,
    closed: true,
  });
  await seedSession({
    id: CLOSED_OTHER,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: OTHER,
    locationId: LOCATION_A,
    appointmentId: APPT_CLOSED_OTHER,
    closed: true,
  });
  await seedSession({
    id: CLOSED_INACTIVE,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: INACTIVE,
    locationId: LOCATION_A,
    appointmentId: APPT_CLOSED_INACTIVE,
    closed: true,
  });
  await seedSession({
    id: OPEN_OTHER,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: OTHER,
    locationId: LOCATION_A,
    appointmentId: APPT_OPEN_OTHER,
  });
  await seedSession({
    id: OPEN_INACTIVE,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    practitionerId: INACTIVE,
    locationId: LOCATION_A,
    appointmentId: APPT_OPEN_INACTIVE,
  });
  await seedSession({
    id: OPEN_FOREIGN,
    tenantId: IDS.tenantB,
    clientId: FOREIGN_CLIENT,
    practitionerId: FOREIGN,
    locationId: LOCATION_B,
  });

  // Each minor's visit gets a practitioner of its own: 300's
  // session_one_open_per_practitioner allows one open visit each, which is
  // the point of that index rather than something to work around.
  await seedSession({
    id: OPEN_MINOR_PROPER,
    tenantId: IDS.tenantA,
    clientId: MINOR_PROPER_CONSENT,
    practitionerId: GUARDIAN_VISIT,
    locationId: LOCATION_A,
  });
  await seedSession({
    id: OPEN_MINOR_IMPROPER,
    tenantId: IDS.tenantA,
    clientId: MINOR_IMPROPER_CONSENT,
    practitionerId: IMPROPER_VISIT,
    locationId: LOCATION_A,
  });

  // asApiRole runs each case inside a savepoint, which only exists inside a
  // transaction block: opened here, rolled back in afterAll.
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

/** Runs `fn` as the given user's own practitioner, in the given practice. */
async function asActor<T>(userId: string, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return asApiRole(
    client,
    tenantId,
    async () => {
      await client.query("select set_config('app.actor_id', $1, true)", [userId]);
      return fn();
    },
    'practitioner',
  );
}

async function consentActive(
  userId: string,
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  return asActor(userId, tenantId, async () => {
    const { rows } = await client.query<{ answer: boolean }>(
      'select app.session_consent_active($1, $2) as answer',
      [sessionId, 'photo_video'],
    );
    return rows[0]!.answer;
  });
}

async function historyRows(userId: string, tenantId: string, sessionId: string): Promise<number> {
  return asActor(userId, tenantId, async () => {
    const { rows } = await client.query<{ n: string }>(
      'select count(*)::text as n from app.session_history_for($1)',
      [sessionId],
    );
    return Number(rows[0]!.n);
  });
}

/**
 * app.mark_appointment_checked_in for the session named, on whatever
 * connection state the caller has already set up. Separate from the
 * `asActor` wrapper below because the first test calls it twice inside one
 * savepoint — the flip and its own replay have to see each other, and
 * `asApiRole` rolls back at the end of every block it wraps.
 */
async function callMark(sessionId: string): Promise<boolean> {
  const { rows } = await client.query<{ answer: boolean }>(
    'select app.mark_appointment_checked_in($1) as answer',
    [sessionId],
  );
  return rows[0]!.answer;
}

async function markCheckedIn(
  userId: string,
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  return asActor(userId, tenantId, async () => callMark(sessionId));
}

/**
 * The appointment's status as whichever role is current: the owner outside an
 * `asActor` block, the practitioner inside one (their own rows are readable
 * under db/policies/scheduling/appointment_access.sql, and only their own).
 */
async function appointmentStatus(appointmentId: string): Promise<string> {
  const { rows } = await client.query<{ status: string }>(
    'select status::text as status from appointment where id = $1',
    [appointmentId],
  );
  return rows[0]!.status;
}

async function completeAppointment(
  userId: string,
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  return asActor(userId, tenantId, async () => {
    const { rows } = await client.query<{ answer: boolean }>(
      'select app.complete_appointment_for_session($1) as answer',
      [sessionId],
    );
    return rows[0]!.answer;
  });
}

describe('app.session_consent_active', () => {
  it("answers for the caller's own open visit", async () => {
    expect(await consentActive(CALLER_USER, IDS.tenantA, OPEN_ADULT)).toBe(true);
  });

  it('refuses a minor a photograph agreed to by somebody who may not agree', async () => {
    // The consent row is active, unexpired and of the right purpose. What it
    // is not is consent: contact.can_consent is false, and a child's
    // photograph agreed to by a contact with no standing to agree is not
    // something this practice took.
    expect(await consentActive(CALLER_USER, IDS.tenantA, OPEN_MINOR_IMPROPER)).toBe(false);

    // The identical row for the other child, given by a contact who may:
    // same purpose, same status, same wording, and the only difference
    // between the two is who agreed.
    expect(await consentActive(GUARDIAN_VISIT_USER, IDS.tenantA, OPEN_MINOR_PROPER)).toBe(true);

    // And the improper one is refused to the practitioner standing in that
    // child's own room too, not merely to a practitioner who is not.
    expect(await consentActive(IMPROPER_VISIT_USER, IDS.tenantA, OPEN_MINOR_IMPROPER)).toBe(false);
  });

  it("refuses the caller's own visit once it is closed", async () => {
    // Their own, so the closing is the only thing standing in the way.
    expect(await consentActive(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(false);
  });

  it('refuses a practitioner the practice has made inactive', async () => {
    expect(await consentActive(INACTIVE_USER, IDS.tenantA, OPEN_INACTIVE)).toBe(false);
  });

  it("refuses another practitioner's visit, and another practice's", async () => {
    expect(await consentActive(CALLER_USER, IDS.tenantA, OPEN_OTHER)).toBe(false);
    expect(await consentActive(FOREIGN_USER, IDS.tenantB, OPEN_ADULT)).toBe(false);
    expect(await consentActive(CALLER_USER, IDS.tenantA, OPEN_FOREIGN)).toBe(false);
  });
});

describe('app.session_history_for', () => {
  it("answers for the caller's own open visit", async () => {
    expect(await historyRows(CALLER_USER, IDS.tenantA, OPEN_ADULT)).toBeGreaterThan(0);
  });

  it("answers nothing once the caller's own visit is closed", async () => {
    expect(await historyRows(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(0);
  });

  it('answers nothing to a practitioner the practice has made inactive', async () => {
    expect(await historyRows(INACTIVE_USER, IDS.tenantA, OPEN_INACTIVE)).toBe(0);
  });

  it("answers nothing about another practitioner's visit, or another practice's", async () => {
    expect(await historyRows(CALLER_USER, IDS.tenantA, OPEN_OTHER)).toBe(0);
    expect(await historyRows(FOREIGN_USER, IDS.tenantB, OPEN_ADULT)).toBe(0);
    expect(await historyRows(CALLER_USER, IDS.tenantA, OPEN_FOREIGN)).toBe(0);
  });
});

describe('app.mark_appointment_checked_in', () => {
  // The defect this door closes (db/migrations/305_appointment_checked_in.sql):
  // nothing used to write appointment.status = 'checked_in' at all, so every
  // guard phrased as "a checked-in visit cannot be moved or cancelled" was
  // written against a status no row ever reached. Each case below runs inside
  // asApiRole's own savepoint, so the one that flips does not leave the
  // appointment marked for the next.
  it("marks the appointment behind the caller's own open visit, exactly once", async () => {
    const seen = await asActor(CALLER_USER, IDS.tenantA, async () => {
      const first = await callMark(OPEN_ADULT);
      const afterFirst = await appointmentStatus(APPT_OPEN_ADULT);
      // The device's outbox flushing the same check-in again, or a second
      // device attempting it: the row is already marked, so this changes
      // nothing rather than marking it twice.
      const replay = await callMark(OPEN_ADULT);
      const afterReplay = await appointmentStatus(APPT_OPEN_ADULT);
      return { first, afterFirst, replay, afterReplay };
    });
    expect(seen).toEqual({
      first: true,
      afterFirst: 'checked_in',
      replay: false,
      afterReplay: 'checked_in',
    });
  });

  it('refuses a visit the practice has called off, leaving it called off', async () => {
    // The one that costs money: a late cancellation consumes the credit, and
    // a check-in that could write over it would put the visit back in front
    // of the session's own completion to consume a second.
    await client.query('savepoint cancelled');
    await client.query("update appointment set status = 'cancelled_late' where id = $1", [
      APPT_OPEN_ADULT,
    ]);
    expect(await markCheckedIn(CALLER_USER, IDS.tenantA, OPEN_ADULT)).toBe(false);
    expect(await appointmentStatus(APPT_OPEN_ADULT)).toBe('cancelled_late');
    await client.query('rollback to savepoint cancelled');
  });

  it('refuses a visit that is already closed', async () => {
    // Their own visit, their own confirmed appointment: the closing is the
    // only thing standing in the way. A stale outbox flush arriving after the
    // close must not mark an attendance nobody attended.
    expect(await markCheckedIn(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(false);
    expect(await appointmentStatus(APPT_CLOSED_CALLER)).toBe('confirmed');
  });

  it('refuses a practitioner the practice has made inactive', async () => {
    expect(await markCheckedIn(INACTIVE_USER, IDS.tenantA, OPEN_INACTIVE)).toBe(false);
    expect(await appointmentStatus(APPT_OPEN_INACTIVE)).toBe('confirmed');
  });

  it("refuses another practitioner's visit, and another practice's", async () => {
    expect(await markCheckedIn(CALLER_USER, IDS.tenantA, OPEN_OTHER)).toBe(false);
    expect(await appointmentStatus(APPT_OPEN_OTHER)).toBe('confirmed');
    // The other direction of the same wall: a practitioner of another
    // practice cannot mark this practice's confirmed appointment, even
    // naming its session id exactly.
    expect(await markCheckedIn(FOREIGN_USER, IDS.tenantB, OPEN_ADULT)).toBe(false);
    expect(await markCheckedIn(CALLER_USER, IDS.tenantA, OPEN_FOREIGN)).toBe(false);
    expect(await appointmentStatus(APPT_OPEN_ADULT)).toBe('confirmed');
  });

  it('leaves a proposed appointment where the coordinator put it', async () => {
    // The same narrow reading as app.complete_appointment_for_session, and
    // for the same reason (docs/CHANGE-REQUESTS/session-capture-02.md section
    // 3b): while the two doors disagree about whether a proposed appointment
    // counts, this one marks 'confirmed' and nothing else. The check-in
    // itself still goes ahead — app.checkin_context admits a proposed visit —
    // and the coordinator settles the row from the calendar as before.
    await client.query('savepoint proposed_checkin');
    await client.query("update appointment set status = 'proposed' where id = $1", [
      APPT_OPEN_ADULT,
    ]);
    expect(await markCheckedIn(CALLER_USER, IDS.tenantA, OPEN_ADULT)).toBe(false);
    expect(await appointmentStatus(APPT_OPEN_ADULT)).toBe('proposed');
    await client.query('rollback to savepoint proposed_checkin');
  });
});

describe('app.complete_appointment_for_session', () => {
  // Every visit below has a confirmed appointment behind it, so a false
  // answer is the guard refusing rather than the function finding nothing to
  // settle. Each case runs inside asApiRole's own savepoint, so the one that
  // succeeds does not leave the appointment completed for the next.
  it("settles the appointment behind the caller's own closed visit", async () => {
    expect(await completeAppointment(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(true);
  });

  it('settles a visit that was marked as checked in at the door', async () => {
    // The other half of 305: once check-in marks the appointment, the close
    // must still be able to complete it. 302's own door already admits
    // 'checked_in' alongside 'confirmed'; this is that clause held to,
    // because a status nothing could complete would strand every visit the
    // new door marks.
    await client.query('savepoint checked_in_close');
    await client.query("update appointment set status = 'checked_in' where id = $1", [
      APPT_CLOSED_CALLER,
    ]);
    expect(await completeAppointment(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(true);
    await client.query('rollback to savepoint checked_in_close');
  });

  it('refuses a visit that is still open: a visit settles nothing until it is closed', async () => {
    expect(await completeAppointment(CALLER_USER, IDS.tenantA, OPEN_ADULT)).toBe(false);
  });

  it('refuses a practitioner the practice has made inactive', async () => {
    expect(await completeAppointment(INACTIVE_USER, IDS.tenantA, CLOSED_INACTIVE)).toBe(false);
  });

  it("refuses another practitioner's closed visit, and another practice's", async () => {
    expect(await completeAppointment(CALLER_USER, IDS.tenantA, CLOSED_OTHER)).toBe(false);
    expect(await completeAppointment(FOREIGN_USER, IDS.tenantB, CLOSED_CALLER)).toBe(false);
  });

  it('refuses an appointment that is only proposed, while the two doors disagree', async () => {
    // docs/CHANGE-REQUESTS/session-capture-02.md section 3b: app.checkin_context
    // admits a proposed appointment and app.client_visible_to_practitioner
    // does not. Narrow is the safe side of a disagreement this stream does
    // not own — a proposed visit nobody confirmed is not one this door
    // completes, and the coordinator can still settle it from the calendar.
    await client.query('savepoint proposed');
    await client.query("update appointment set status = 'proposed' where id = $1", [
      APPT_CLOSED_CALLER,
    ]);
    expect(await completeAppointment(CALLER_USER, IDS.tenantA, CLOSED_CALLER)).toBe(false);
    await client.query('rollback to savepoint proposed');
  });
});
