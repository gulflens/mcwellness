import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse } from '../../../app/api/billing/ledger-schema';
import type { RecordPastSessionResponse } from '../../../app/api/sessions/schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { FAMILY_NAMES, GIVEN_NAMES } from '../../../db/seed/names';
import {
  SEEDED,
  SILVER_CODE,
  setPracticePrices,
  silverInput,
  startHarness,
  type Harness,
} from '../../billing/db/support';
import { asApiRole, seedUser } from '../../db/helpers';

/**
 * Voiding a visit logged from the records (migrations 969 and 970; trunk round
 * 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md): the
 * wrong row stays, stamped with when, by whom and why; its appointment stops
 * holding the window; the credit it took comes back the way a waiver gives one
 * back; and the close guard admits that one transition and nothing else.
 *
 * The visits are logged through the API the server builds, on the synthetic
 * practice; the void is `app.void_recorded_session` called as the API role
 * with the request's stamps, which is what the route will do. Every person is
 * the seed's or named from db/seed/names.ts, and every id is synthetic.
 */

const NOW = () => new Date(`${SEED_TODAY}T08:00:00.000Z`);
const REASON = { 'x-reason': 'From the paper diary, before the app' };
const VOID_REASON = 'Logged against the wrong household';

/** A member of staff who keeps the books and nothing else; the seed has none. */
const FINANCE_ONLY = '000000e9-0000-4000-8000-000000000001';
const FINANCE_AUTH = '000000e9-0000-4000-8000-0000000000f1';
/** Another practice entirely, and its owner, who may void nothing of this one. */
const OTHER_PRACTICE = '000000e9-0000-4000-8000-0000000000b0';
const OTHER_OWNER = '000000e9-0000-4000-8000-0000000000b1';
const OTHER_OWNER_AUTH = '000000e9-0000-4000-8000-0000000000b2';
/** A visit closed on the phone, and a records row that never completed. */
const DEVICE_SESSION = '000000e9-0000-4000-8000-000000000002';
const UNFINISHED_SESSION = '000000e9-0000-4000-8000-000000000003';
const REQUEST_ID = '000000e9-0000-4000-8000-0000000000ee';

const WITH_PACKAGE = 4;
const WITHOUT_PACKAGE = 5;

let h: Harness;
let practitionerId: string;
let nfSession: string;
let tenantId: string;
/** The wrong visit, logged first and voided by the first case. */
let wrong: { sessionId: string; appointmentId: string };
/** The credit the wrong visit took. */
let wrongCredit: { id: string; package_purchase_id: string };
/** The visits the API refused, read back by the case after. */
let refused: { target: string; named: string };

function userId(index: number): string {
  const user = h.data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.id;
}

function visit(clientIndex: number, overrides: Record<string, unknown> = {}) {
  const client = h.data.clients[clientIndex];
  if (!client) throw new Error(`No seeded client ${clientIndex}.`);
  return {
    clientId: client.id,
    practitionerId,
    serviceTypeId: nfSession,
    locationId: client.primaryLocationId,
    deliveryMode: 'home',
    on: '2026-03-04',
    startTime: '15:30',
    billing: 'credit',
    ...overrides,
  };
}

async function logVisit(
  clientIndex: number,
  overrides: Record<string, unknown> = {},
): Promise<{ sessionId: string; appointmentId: string }> {
  const res = await h.call(
    'POST',
    '/api/sessions/from-records',
    SEEDED.owner,
    visit(clientIndex, overrides),
    REASON,
  );
  if (res.status !== 201) throw new Error(`The visit was not logged: ${res.status}`);
  const body = (await res.json()) as RecordPastSessionResponse;
  if (body.status !== 'recorded') throw new Error('not recorded');
  return { sessionId: body.sessionId, appointmentId: body.appointmentId };
}

type Outcome =
  | { ok: true; result: { sessionId: string; appointmentId: string; creditRestored: boolean } }
  | { ok: false; code: string | undefined; message: string | undefined };

/**
 * The void as the route will make it: the API role, the practice, the actor
 * and their roles stamped transaction-local, then the function. Committed when
 * it succeeds, so the next request sees it; rolled back when it refuses.
 */
async function voidAs(actor: string, sessionId: string, reason = VOID_REASON): Promise<Outcome> {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true), " +
        "set_config('app.reason', $4, true)",
      [tenantId, actor, REQUEST_ID, reason],
    );
    const { rows } = await h.owner.query<{ result: Outcome & { ok: true } }>(
      'select app.void_recorded_session($1, $2) as result',
      [sessionId, reason],
    );
    await h.owner.query('commit');
    return {
      ok: true,
      result: rows[0]!.result as unknown as Extract<Outcome, { ok: true }>['result'],
    };
  } catch (error) {
    await h.owner.query('rollback');
    const e = error as { code?: string; message?: string };
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Expects the void to be refused with restrict_violation and exactly this code. */
async function refusedWith(code: string, actor: string, sessionId: string): Promise<void> {
  const outcome = await voidAs(actor, sessionId);
  expect(outcome).toEqual({ ok: false, code: '23001', message: code });
}

/** The void over the API, as the screens will post it. */
function voidOverApi(
  sessionId: string,
  as: { seeded: number } | { authId: string } = { seeded: SEEDED.owner },
  headers: Record<string, string> = { 'x-reason': VOID_REASON },
): Promise<Response> {
  // No body to speak of, but a POST is JSON or the door answers 415.
  const path = `/api/sessions/${sessionId}/void`;
  return 'seeded' in as
    ? h.call('POST', path, as.seeded, {}, headers)
    : h.callAs('POST', path, as.authId, {}, headers);
}

/** The refusals the trail holds for one visit, oldest first. */
async function refusalsFor(sessionId: string): Promise<string[]> {
  const { rows } = await h.owner.query<{ reason: string }>(
    "select reason from audit_log where action = 'refused' and entity_type = 'session' " +
      'and entity_id = $1 order by id',
    [sessionId],
  );
  return rows.map((r) => r.reason);
}

/** Runs `sql` as the owner with the request's stamps and returns the SQLSTATE it failed with. */
async function failureOf(sql: string, params: unknown[] = []): Promise<string | undefined> {
  await h.owner.query('begin');
  try {
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.request_id', $3, true)",
      [tenantId, userId(SEEDED.owner), REQUEST_ID],
    );
    await h.owner.query(sql, params);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await h.owner.query('rollback');
  }
}

/**
 * Runs `sql` as the API role, with this practice's owner stamped, and returns
 * the SQLSTATE and message it failed with, or null when it went through.
 * Always rolled back.
 */
async function apiRoleFailure(
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string | undefined; message: string | undefined } | null> {
  let seen: { code: string | undefined; message: string | undefined } | null = null;
  await h.owner.query('begin');
  try {
    await asApiRole(h.owner, tenantId, async () => {
      await h.owner.query(
        "select set_config('app.actor_id', $1, true), set_config('app.request_id', $2, true)",
        [userId(SEEDED.owner), REQUEST_ID],
      );
      try {
        await h.owner.query(sql, params);
      } catch (error) {
        const e = error as { code?: string; message?: string };
        seen = { code: e.code, message: e.message };
      }
    });
  } finally {
    await h.owner.query('rollback');
  }
  return seen;
}

/** Writes rows as the owner with the request's stamps, committed. */
async function writeAsOwner(sql: string, params: unknown[] = []): Promise<void> {
  await h.owner.query('begin');
  try {
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.request_id', $3, true)",
      [tenantId, userId(SEEDED.owner), REQUEST_ID],
    );
    await h.owner.query(sql, params);
    await h.owner.query('commit');
  } catch (error) {
    await h.owner.query('rollback');
    throw error;
  }
}

beforeAll(async () => {
  h = await startHarness(NOW);
  tenantId = h.data.tenant.id;
  await setPracticePrices(h, SEED_TODAY);
  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
  );
  if (created.status !== 201) throw new Error('Silver could not be created.');
  const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const silver = ((await list.json()) as PackagesResponse).packages.find(
    (p) => p.code === SILVER_CODE,
  );
  if (!silver) throw new Error('Silver is missing.');
  const sale = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silver.id,
    clientId: h.clientId(WITH_PACKAGE),
    purchasedOn: SEED_TODAY,
  });
  if (sale.status !== 201) throw new Error('Silver could not be sold.');
  practitionerId = h.data.practitioners[0]!.id;
  nfSession = h.serviceTypeId('nf-session');

  await seedUser(h.owner, {
    id: FINANCE_ONLY,
    tenantId,
    authId: FINANCE_AUTH,
    displayName: `${GIVEN_NAMES[3]!.en} ${FAMILY_NAMES[2]!.en}`,
    roles: ['finance'],
  });
  await h.owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio B')", [
    OTHER_PRACTICE,
  ]);
  await seedUser(h.owner, {
    id: OTHER_OWNER,
    tenantId: OTHER_PRACTICE,
    authId: OTHER_OWNER_AUTH,
    displayName: `${GIVEN_NAMES[4]!.en} ${FAMILY_NAMES[3]!.en}`,
    roles: ['owner'],
  });

  wrong = await logVisit(WITH_PACKAGE);
  const credit = await h.owner.query<{ id: string; package_purchase_id: string }>(
    "select id, package_purchase_id from entitlement where consumed_by_session_id = $1 and status = 'consumed'",
    [wrong.sessionId],
  );
  if (!credit.rows[0]) throw new Error('The wrong visit took no credit.');
  wrongCredit = credit.rows[0];
});

afterAll(async () => {
  await h.close();
});

describe('voiding a visit logged from the records', () => {
  it('stamps the session and the appointment voided with when, who and why', async () => {
    const before = await h.owner.query(
      'select checked_in_at, started_at, ended_at, closed_at, service_type_id, practitioner_id ' +
        'from session where id = $1',
      [wrong.sessionId],
    );

    const outcome = await voidAs(userId(SEEDED.owner), wrong.sessionId);
    expect(outcome).toEqual({
      ok: true,
      result: {
        sessionId: wrong.sessionId,
        appointmentId: wrong.appointmentId,
        creditRestored: true,
      },
    });

    const session = await h.owner.query(
      'select status::text, voided_at is not null as stamped, voided_by, void_reason ' +
        'from session where id = $1',
      [wrong.sessionId],
    );
    expect(session.rows[0]).toEqual({
      status: 'voided',
      stamped: true,
      voided_by: userId(SEEDED.owner),
      void_reason: VOID_REASON,
    });
    // The row keeps everything it was logged with: a void is a stamp, not an edit.
    const after = await h.owner.query(
      'select checked_in_at, started_at, ended_at, closed_at, service_type_id, practitioner_id ' +
        'from session where id = $1',
      [wrong.sessionId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    const appointment = await h.owner.query(
      'select status::text, voided_at is not null as stamped, voided_by, void_reason ' +
        'from appointment where id = $1',
      [wrong.appointmentId],
    );
    expect(appointment.rows[0]).toEqual({
      status: 'voided',
      stamped: true,
      voided_by: userId(SEEDED.owner),
      void_reason: VOID_REASON,
    });

    // The trail names the person who voided it, under the reason.
    const trail = await h.owner.query<{ actor_id: string; reason: string }>(
      "select actor_id, reason from audit_log where entity_type = 'session' and entity_id = $1 " +
        "and action = 'update'",
      [wrong.sessionId],
    );
    expect(trail.rows).toEqual([{ actor_id: userId(SEEDED.owner), reason: VOID_REASON }]);
  });

  it('frees the window: the right visit can then be logged at the same hour', async () => {
    const res = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE),
      REASON,
    );
    expect(res.status).toBe(201);
  });

  it('gives the credit back as a replacement and the books see a credit restored', async () => {
    const waived = await h.owner.query(
      'select status::text, waiver_reason, waived_at is not null as stamped, waived_by, ' +
        'consumed_by_session_id from entitlement where id = $1',
      [wrongCredit.id],
    );
    expect(waived.rows[0]).toEqual({
      status: 'waived',
      waiver_reason: VOID_REASON,
      stamped: true,
      waived_by: userId(SEEDED.owner),
      consumed_by_session_id: wrong.sessionId,
    });

    const same =
      'client_id, service_type_id, source_type, package_purchase_id, invoice_id, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on';
    const original = await h.owner.query(`select ${same} from entitlement where id = $1`, [
      wrongCredit.id,
    ]);
    const replacement = await h.owner.query(
      `select ${same}, created_by from entitlement where replaces_entitlement_id = $1`,
      [wrongCredit.id],
    );
    expect(replacement.rows).toEqual([{ ...original.rows[0], created_by: userId(SEEDED.owner) }]);

    // The purchase's credits still total what was paid: the waived row out,
    // its replacement counted in its place (403's deferred check).
    const sums = await h.owner.query<{ paid: number; allocated: string }>(
      'select pp.net_fils as paid, (select sum(e.allocated_net_fils) from entitlement e ' +
        "where e.package_purchase_id = pp.id and e.status <> 'waived')::text as allocated " +
        'from package_purchase pp where pp.id = $1',
      [wrongCredit.package_purchase_id],
    );
    expect(Number(sums.rows[0]?.allocated)).toBe(Number(sums.rows[0]?.paid));

    // The books read it as the waiver event, with a replacement: a credit restored.
    await h.owner.query('begin');
    try {
      await h.owner.query('set local role app_role');
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.actor_roles', 'owner', true)",
        [tenantId, userId(SEEDED.owner)],
      );
      const events = await h.owner.query(
        'select source_event, has_replacement from app.unposted_money_events() ' +
          "where source_table = 'entitlement' and source_id = $1 order by source_event",
        [wrongCredit.id],
      );
      expect(events.rows).toEqual([
        { source_event: 'credit.consumed', has_replacement: null },
        { source_event: 'credit.waived', has_replacement: true },
      ]);
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('restores nothing for a visit settled before the app', async () => {
    const settled = await logVisit(WITHOUT_PACKAGE, {
      on: '2026-03-05',
      billing: 'settled_outside',
    });
    const count = async () =>
      Number(
        (
          await h.owner.query<{ n: string }>(
            'select count(*)::text as n from entitlement where client_id = $1',
            [h.clientId(WITHOUT_PACKAGE)],
          )
        ).rows[0]?.n,
      );
    const before = await count();
    const outcome = await voidAs(userId(SEEDED.owner), settled.sessionId);
    expect(outcome).toEqual({
      ok: true,
      result: {
        sessionId: settled.sessionId,
        appointmentId: settled.appointmentId,
        creditRestored: false,
      },
    });
    expect(await count()).toBe(before);
  });

  it('refuses a visit closed on the phone', async () => {
    await writeAsOwner(
      'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
        'checked_in_at, started_at, ended_at, status, recorded_from) values ($1, $2, $3, $4, $5, ' +
        "'2026-03-10T10:00:00Z', '2026-03-10T10:05:00Z', '2026-03-10T11:00:00Z', 'completed', 'device')",
      [DEVICE_SESSION, tenantId, h.clientId(WITH_PACKAGE), practitionerId, nfSession],
    );
    await refusedWith('not_a_records_row', userId(SEEDED.owner), DEVICE_SESSION);
  });

  it('refuses a visit that is not completed', async () => {
    await writeAsOwner(
      'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
        'checked_in_at, status, recorded_from) values ($1, $2, $3, $4, $5, ' +
        "'2026-03-11T10:00:00Z', 'scheduled', 'records')",
      [UNFINISHED_SESSION, tenantId, h.clientId(WITH_PACKAGE), practitionerId, nfSession],
    );
    await refusedWith('not_completed', userId(SEEDED.owner), UNFINISHED_SESSION);
  });

  it('refuses a visit already voided', async () => {
    await refusedWith('already_voided', userId(SEEDED.owner), wrong.sessionId);
  });

  it('refuses a visit an assessment still names', async () => {
    const named = await logVisit(WITH_PACKAGE, { on: '2026-03-12' });
    await writeAsOwner(
      'insert into assessment (tenant_id, client_id, performed_at, performed_by_practitioner_id, ' +
        'instrument, instrument_version, derived, session_id, created_by) values ($1, $2, ' +
        "'2026-03-12T12:00:00Z', $3, 'questionnaire', '1', '{}', $4, $5)",
      [tenantId, h.clientId(WITH_PACKAGE), practitionerId, named.sessionId, userId(SEEDED.owner)],
    );
    await refusedWith('session_in_use', userId(SEEDED.owner), named.sessionId);
    const still = await h.owner.query<{ status: string }>(
      'select status::text from session where id = $1',
      [named.sessionId],
    );
    expect(still.rows[0]?.status).toBe('completed');
  });

  it('refuses a finance actor and a practitioner', async () => {
    const target = await logVisit(WITH_PACKAGE, { on: '2026-03-13' });
    await refusedWith('wrong_role', FINANCE_ONLY, target.sessionId);
    await refusedWith('wrong_role', userId(SEEDED.practitioner), target.sessionId);
    // And a reason that is only whitespace is no reason, whoever gives it.
    expect(await voidAs(userId(SEEDED.owner), target.sessionId, '   ')).toEqual({
      ok: false,
      code: '23001',
      message: 'reason_required',
    });
    // The coordinator may: admin is one of the three.
    const byAdmin = await voidAs(userId(SEEDED.admin), target.sessionId);
    expect(byAdmin.ok).toBe(true);
  });

  it('still refuses every other change to a closed row, and any change to a voided row', async () => {
    const standing = await logVisit(WITH_PACKAGE, { on: '2026-03-16' });
    // An ordinary edit of a completed records row.
    expect(
      await failureOf(
        "update session set ended_at = ended_at + interval '15 minutes' where id = $1",
        [standing.sessionId],
      ),
    ).toBe('23001');
    // The void transition with anything else riding in on it.
    expect(
      await failureOf(
        "update session set status = 'voided', voided_at = now(), voided_by = $2, " +
          "void_reason = 'wrong', ended_at = ended_at + interval '15 minutes' where id = $1",
        [standing.sessionId, userId(SEEDED.owner)],
      ),
    ).toBe('23001');
    // The void transition on a visit closed on the phone.
    expect(
      await failureOf(
        "update session set status = 'voided', voided_at = now(), voided_by = $2, " +
          "void_reason = 'wrong' where id = $1",
        [DEVICE_SESSION, userId(SEEDED.owner)],
      ),
    ).toBe('23001');
    // A voided row: its reason, and its way back to completed.
    expect(
      await failureOf("update session set void_reason = 'a better reason' where id = $1", [
        wrong.sessionId,
      ]),
    ).toBe('23001');
    expect(
      await failureOf(
        "update session set status = 'completed', voided_at = null, voided_by = null, " +
          'void_reason = null where id = $1',
        [wrong.sessionId],
      ),
    ).toBe('23001');
    // A void stamp on a row that is not voided is refused by the table itself.
    expect(
      await failureOf(
        "update appointment set voided_at = now(), voided_by = $2, void_reason = 'x' where id = $1",
        [standing.appointmentId, userId(SEEDED.owner)],
      ),
    ).toBe('23514');
  });

  it('refuses the void transition written by the API role outside the function', async () => {
    const target = await logVisit(WITH_PACKAGE, { on: '2026-03-17' });
    // The very update the function makes, by a caller the function never saw:
    // no role read from user_role, no in-use check, no credit given back.
    let seen: string | undefined;
    await h.owner.query('begin');
    try {
      await asApiRole(h.owner, tenantId, async () => {
        await h.owner.query(
          "select set_config('app.actor_id', $1, true), set_config('app.request_id', $2, true)",
          [userId(SEEDED.owner), REQUEST_ID],
        );
        try {
          await h.owner.query(
            "update session set status = 'voided', voided_at = now(), voided_by = $2, " +
              "void_reason = 'by hand' where id = $1",
            [target.sessionId, userId(SEEDED.owner)],
          );
        } catch (error) {
          seen = (error as { code?: string }).code;
        }
      });
    } finally {
      await h.owner.query('rollback');
    }
    expect(seen).toBe('23001');
    const still = await h.owner.query<{ status: string }>(
      'select status::text from session where id = $1',
      [target.sessionId],
    );
    expect(still.rows[0]?.status).toBe('completed');
  });

  it('refuses the voided status written outside the function, open row, insert or appointment', async () => {
    // (a) An open session moved straight to voided by the API role: the close
    // guard stands aside for an open row, so this is the insert-or-update
    // guard's alone (970, the final reviews of round 60).
    expect(
      await apiRoleFailure(
        "update session set status = 'voided', voided_at = now(), voided_by = $2, " +
          "void_reason = 'by hand' where id = $1",
        [UNFINISHED_SESSION, userId(SEEDED.owner)],
      ),
    ).toEqual({ code: '23001', message: 'void_needs_the_function' });
    // (b) A session inserted already voided.
    expect(
      await apiRoleFailure(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'checked_in_at, started_at, ended_at, closed_at, status, recorded_from, ' +
          'voided_at, voided_by, void_reason) values (gen_random_uuid(), app.current_tenant_id(), ' +
          '$1, $2, $3, ' +
          "'2026-03-24T10:00:00Z', '2026-03-24T10:05:00Z', '2026-03-24T11:00:00Z', " +
          "'2026-03-24T11:00:00Z', 'voided', 'records', now(), $4, 'by hand')",
        [h.clientId(WITH_PACKAGE), practitionerId, nfSession, userId(SEEDED.owner)],
      ),
    ).toEqual({ code: '23001', message: 'void_needs_the_function' });
    // (c) An appointment voided directly, which would free its window with
    // the session behind it still completed. Even the table's owner.
    const standing = await logVisit(WITH_PACKAGE, { on: '2026-03-25' });
    expect(
      await failureOf(
        "update appointment set status = 'voided', voided_at = now(), voided_by = $2, " +
          "void_reason = 'by hand' where id = $1",
        [standing.appointmentId, userId(SEEDED.owner)],
      ),
    ).toBe('23001');
    const still = await h.owner.query<{ status: string }>(
      'select status::text from appointment where id = $1',
      [standing.appointmentId],
    );
    expect(still.rows[0]?.status).toBe('completed');
  });

  it("keeps the void marker out of the API role's reach", async () => {
    // (e) Neither read nor written by anything but the definer function.
    expect((await apiRoleFailure('select count(*) from app.void_active'))?.code).toBe('42501');
    expect(
      (
        await apiRoleFailure(
          'insert into app.void_active (txid, session_id) values (txid_current(), $1)',
          [UNFINISHED_SESSION],
        )
      )?.code,
    ).toBe('42501');
  });

  it('answers not_found at the function for a visit of another practice', async () => {
    // This practice's visit, asked about by the other practice's owner under
    // that practice's stamp: the function names its tenant on every read, so
    // the visit does not exist for them, and nothing is written.
    const mine = await logVisit(WITH_PACKAGE, { on: '2026-03-26' });
    await h.owner.query('begin');
    try {
      await h.owner.query('set local role app_role');
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true)",
        [OTHER_PRACTICE, OTHER_OWNER, REQUEST_ID],
      );
      await expect(
        h.owner.query('select app.void_recorded_session($1, $2)', [mine.sessionId, VOID_REASON]),
      ).rejects.toMatchObject({ code: '23001', message: 'not_found' });
    } finally {
      await h.owner.query('rollback');
    }
    const still = await h.owner.query<{ status: string }>(
      'select status::text from session where id = $1',
      [mine.sessionId],
    );
    expect(still.rows[0]?.status).toBe('completed');
  });

  it('leaves no void marker behind once the function returns', async () => {
    const target = await logVisit(WITH_PACKAGE, { on: '2026-03-18' });
    await h.owner.query('begin');
    try {
      await h.owner.query('set local role app_role');
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true)",
        [tenantId, userId(SEEDED.owner), REQUEST_ID],
      );
      const voided = await h.owner.query<{ result: { sessionId: string } }>(
        'select app.void_recorded_session($1, $2) as result',
        [target.sessionId, VOID_REASON],
      );
      expect(voided.rows[0]?.result.sessionId).toBe(target.sessionId);
      await h.owner.query('reset role');
      const marker = await h.owner.query<{ n: string }>(
        'select count(*)::text as n from app.void_active where txid = txid_current()',
      );
      expect(marker.rows[0]?.n).toBe('0');
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('voids over the API with a reason, logs session_voided, and answers what came back', async () => {
    const target = await logVisit(WITH_PACKAGE, { on: '2026-03-19' });
    const res = await voidOverApi(target.sessionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: target.sessionId,
      appointmentId: target.appointmentId,
      creditRestored: true,
    });
    const session = await h.owner.query<{ status: string }>(
      'select status::text from session where id = $1',
      [target.sessionId],
    );
    expect(session.rows[0]?.status).toBe('voided');
    const trail = await h.owner.query(
      'select actor_id, client_id, reason from audit_log ' +
        "where action = 'session_voided' and entity_type = 'session' and entity_id = $1",
      [target.sessionId],
    );
    expect(trail.rows).toEqual([
      { actor_id: userId(SEEDED.owner), client_id: h.clientId(WITH_PACKAGE), reason: VOID_REASON },
    ]);
  });

  it("answers 400 without a reason, 403 for finance, 404 for another practice's visit, 409 with the code for each refusal", async () => {
    const target = await logVisit(WITH_PACKAGE, { on: '2026-03-20' });

    const silent = await voidOverApi(target.sessionId, { seeded: SEEDED.owner }, {});
    expect(silent.status).toBe(400);
    expect(await silent.json()).toMatchObject({ code: 'reason_required' });
    const blank = await voidOverApi(
      target.sessionId,
      { seeded: SEEDED.owner },
      { 'x-reason': '  ' },
    );
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ code: 'reason_required' });

    const notAnId = await voidOverApi('not-a-session');
    expect(notAnId.status).toBe(400);
    expect(await notAnId.json()).toMatchObject({ code: 'invalid_request' });

    const finance = await voidOverApi(target.sessionId, { authId: FINANCE_AUTH });
    expect(finance.status).toBe(403);
    expect(await finance.json()).toMatchObject({ code: 'wrong_role' });
    const practitioner = await voidOverApi(target.sessionId, { seeded: SEEDED.practitioner });
    expect(practitioner.status).toBe(403);

    // Another practice's owner learns nothing: not a 403 that says the visit exists.
    const foreign = await voidOverApi(target.sessionId, { authId: OTHER_OWNER_AUTH });
    expect(foreign.status).toBe(404);
    const unknown = await voidOverApi('000000e9-0000-4000-8000-0000000000dd');
    expect(unknown.status).toBe(404);

    const named = await logVisit(WITH_PACKAGE, { on: '2026-03-23' });
    await writeAsOwner(
      'insert into assessment (tenant_id, client_id, performed_at, performed_by_practitioner_id, ' +
        'instrument, instrument_version, derived, session_id, created_by) values ($1, $2, ' +
        "'2026-03-23T12:00:00Z', $3, 'questionnaire', '1', '{}', $4, $5)",
      [tenantId, h.clientId(WITH_PACKAGE), practitionerId, named.sessionId, userId(SEEDED.owner)],
    );
    for (const [sessionId, code] of [
      [DEVICE_SESSION, 'not_a_records_row'],
      [UNFINISHED_SESSION, 'not_completed'],
      [wrong.sessionId, 'already_voided'],
      [named.sessionId, 'session_in_use'],
    ] as const) {
      const res = await voidOverApi(sessionId);
      expect(res.status, code).toBe(409);
      expect(await res.json(), code).toMatchObject({ error: 'conflict', code });
    }

    // Nothing was voided by any of it.
    const still = await h.owner.query<{ status: string }>(
      'select status::text from session where id = any($1::uuid[]) order by id',
      [[target.sessionId, named.sessionId]],
    );
    expect(still.rows).toEqual([{ status: 'completed' }, { status: 'completed' }]);

    refused = { target: target.sessionId, named: named.sessionId };
  });

  it('logs every refusal before answering', async () => {
    // The two with no reason, finance, the practitioner, then the other
    // practice's owner, each against the visit it asked about.
    expect(await refusalsFor(refused.target)).toEqual([
      'reason_required',
      'reason_required',
      'wrong_role',
      'wrong_role',
      'not_found',
    ]);
    expect(await refusalsFor(DEVICE_SESSION)).toContain('not_a_records_row');
    expect(await refusalsFor(UNFINISHED_SESSION)).toContain('not_completed');
    expect(await refusalsFor(wrong.sessionId)).toContain('already_voided');
    expect(await refusalsFor(refused.named)).toEqual(['session_in_use']);
    // The refusal a practice's own staff met names the household; the other
    // practice's names nobody, and is kept in that practice's own trail.
    const foreign = await h.owner.query<{ tenant_id: string; client_id: string | null }>(
      "select tenant_id, client_id from audit_log where action = 'refused' and entity_id = $1 " +
        "and reason = 'not_found'",
      [refused.target],
    );
    expect(foreign.rows).toEqual([{ tenant_id: OTHER_PRACTICE, client_id: null }]);
  });

  it("refuses a correction that names another household's visit as its first version", async () => {
    // 971: a version 2 belongs to the household its version 1 was logged for.
    let seen: { code?: string; constraint?: string } = {};
    await h.owner.query('begin');
    try {
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.request_id', $3, true)",
        [tenantId, userId(SEEDED.owner), REQUEST_ID],
      );
      await h.owner.query(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'checked_in_at, status, recorded_from, version, supersedes_id, amendment_reason) ' +
          "values (gen_random_uuid(), $1, $2, $3, $4, '2026-03-27T10:00:00Z', 'scheduled', " +
          "'records', 2, $5, 'Corrected')",
        [tenantId, h.clientId(WITHOUT_PACKAGE), practitionerId, nfSession, wrong.sessionId],
      );
    } catch (error) {
      seen = error as { code?: string; constraint?: string };
    } finally {
      await h.owner.query('rollback');
    }
    expect({ code: seen.code, constraint: seen.constraint }).toEqual({
      code: '23503',
      constraint: 'session_supersedes_same_client_fk',
    });
  });

  it('erases the reason a visit was voided with the household, and keeps the waiver whole', async () => {
    // 971: the household whose wrong visit the first case voided asks to be
    // forgotten. Why it was voided is free text about them and goes; why its
    // credit was given back is the financial record and stays.
    await writeAsOwner(
      'insert into erasure_request (tenant_id, client_id, reason) values ($1, $2, $3)',
      [tenantId, h.clientId(WITH_PACKAGE), 'Household asked to be forgotten'],
    );
    const request = await h.owner.query<{ id: string }>(
      'select id from erasure_request where client_id = $1',
      [h.clientId(WITH_PACKAGE)],
    );
    await h.owner.query('begin');
    try {
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true), " +
          "set_config('app.reason', 'Household asked to be forgotten', true)",
        [tenantId, userId(SEEDED.owner), REQUEST_ID],
      );
      await h.owner.query('select app.erase_client($1, $2)', [
        h.clientId(WITH_PACKAGE),
        request.rows[0]!.id,
      ]);
      await h.owner.query('commit');
    } catch (error) {
      await h.owner.query('rollback');
      throw error;
    }
    const session = await h.owner.query(
      'select status::text, void_reason from session where id = $1',
      [wrong.sessionId],
    );
    expect(session.rows[0]).toEqual({ status: 'voided', void_reason: 'Erased with the record' });
    const appointment = await h.owner.query(
      'select status::text, void_reason from appointment where id = $1',
      [wrong.appointmentId],
    );
    expect(appointment.rows[0]).toEqual({
      status: 'voided',
      void_reason: 'Erased with the record',
    });
    // No voided row of that household still carries a reason of its own.
    const left = await h.owner.query<{ n: string }>(
      "select (select count(*) from session where client_id = $1 and void_reason <> 'Erased with the record') + " +
        "(select count(*) from appointment where client_id = $1 and void_reason <> 'Erased with the record') as n",
      [h.clientId(WITH_PACKAGE)],
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
    const credit = await h.owner.query<{ waiver_reason: string }>(
      'select waiver_reason from entitlement where id = $1',
      [wrongCredit.id],
    );
    expect(credit.rows[0]?.waiver_reason).toBe(VOID_REASON);
    const { rows } = await h.owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(rows[0]?.broken).toBeNull();
  });

  it('leaves the audit chain intact', async () => {
    const { rows } = await h.owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(rows[0]?.broken).toBeNull();
  });
});
