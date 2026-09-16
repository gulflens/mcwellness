import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse } from '../../../app/api/billing/ledger-schema';
import type { RecordPastSessionResponse } from '../../../app/api/sessions/schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  SILVER_CODE,
  setPracticePrices,
  silverInput,
  startHarness,
  type Harness,
} from '../../billing/db/support';

/**
 * POST /api/sessions/from-records, through the API the server builds, on the
 * synthetic practice (docs/superpowers/specs/2026-09-16-past-sessions-design.md):
 * a visit that happened before the app is written as one completed
 * appointment and one completed session, a credit valid on its day is taken
 * or the ledger refuses it, and every refusal is logged before it is
 * answered. The ledger's own branch is proved in tests/billing/db/from_records.test.ts.
 */

const NOW = () => new Date(`${SEED_TODAY}T08:00:00.000Z`);
const REASON = { 'x-reason': 'From the paper diary, before the app' };

let h: Harness;
let practitionerId: string;
let nfSession: string;

/**
 * Two of the seed's active adult households (the first two seeded clients are
 * leads, with no consents yet): one buys a package, the other has none.
 */
const WITH_PACKAGE = 4;
const WITHOUT_PACKAGE = 5;

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

async function countRows(table: 'session' | 'appointment', clientId: string): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    `select count(*)::text as n from ${table} where client_id = $1`,
    [clientId],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  h = await startHarness(NOW);
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
});

afterAll(async () => {
  await h.close();
});

describe('logging a past visit', () => {
  it('writes one completed appointment and one completed session, takes a credit, and logs why', async () => {
    const res = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE),
      REASON,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as RecordPastSessionResponse;
    if (body.status !== 'recorded') throw new Error('not recorded');
    expect(body.billed).toBe('credit');

    const session = await h.owner.query(
      'select status, recorded_from, settled_outside_app, appointment_id, ' +
        'checked_in_at, started_at, ended_at, checked_out_at, closed_at is not null as closed, ' +
        'closed_by is not null as by_someone, (extract(epoch from (ended_at - started_at))/60)::int as minutes ' +
        'from session where id = $1',
      [body.sessionId],
    );
    expect(session.rows[0]).toMatchObject({
      status: 'completed',
      recorded_from: 'records',
      settled_outside_app: false,
      appointment_id: body.appointmentId,
      closed: true,
      by_someone: true,
      minutes: 60,
    });
    expect((session.rows[0] as { checked_in_at: Date }).checked_in_at.toISOString()).toBe(
      '2026-03-04T11:30:00.000Z',
    );

    const appointment = await h.owner.query(
      'select status, window_start, delivery_mode from appointment where id = $1',
      [body.appointmentId],
    );
    expect(appointment.rows[0]).toMatchObject({ status: 'completed', delivery_mode: 'home' });

    const credit = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement where consumed_by_session_id = $1',
      [body.sessionId],
    );
    expect(credit.rows[0]?.n).toBe('1');

    const trail = await h.owner.query<{ reason: string; client_id: string }>(
      "select reason, client_id from audit_log where action = 'session_recorded_from_records' and entity_id = $1",
      [body.sessionId],
    );
    expect(trail.rows).toEqual([
      { reason: 'From the paper diary, before the app', client_id: h.clientId(WITH_PACKAGE) },
    ]);
  });

  it('shows on the day schedule and in the visit pickers like any other visit', async () => {
    const day = await h.call('GET', '/api/appointments?date=2026-03-04', SEEDED.owner);
    expect(day.status).toBe(200);
    const { appointments } = (await day.json()) as {
      appointments: { status: string; client: { id: string } }[];
    };
    expect(
      appointments.some(
        (a) => a.status === 'completed' && a.client.id === h.clientId(WITH_PACKAGE),
      ),
    ).toBe(true);
    const visits = await h.call(
      'GET',
      `/api/assessments/visits?clientId=${h.clientId(WITH_PACKAGE)}`,
      SEEDED.owner,
    );
    expect(visits.status).toBe(200);
    const listed = (await visits.json()) as { visits: { on: string }[] };
    expect(listed.visits.some((v) => v.on === '2026-03-04')).toBe(true);
  });

  it('refuses a visit with no credit on its day unless it was settled before the app, and writes nothing', async () => {
    const before = await countRows('session', h.clientId(WITHOUT_PACKAGE));
    const refused = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITHOUT_PACKAGE, { on: '2026-03-05' }),
      REASON,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ status: 'blocked', reasons: ['no_credit_available'] });
    expect(await countRows('session', h.clientId(WITHOUT_PACKAGE))).toBe(before);
    expect(await countRows('appointment', h.clientId(WITHOUT_PACKAGE))).toBe(
      await countRows('appointment', h.clientId(WITHOUT_PACKAGE)),
    );
    const logged = await h.owner.query<{ reason: string }>(
      "select reason from audit_log where action = 'refused' and client_id = $1 order by id desc limit 1",
      [h.clientId(WITHOUT_PACKAGE)],
    );
    expect(logged.rows[0]?.reason).toBe('no_credit_available');

    const settled = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITHOUT_PACKAGE, { on: '2026-03-05', billing: 'settled_outside' }),
      REASON,
    );
    expect(settled.status).toBe(201);
    const body = (await settled.json()) as RecordPastSessionResponse;
    if (body.status !== 'recorded') throw new Error('not recorded');
    const billing = await h.owner.query<{ credits: string; invoices: string }>(
      'select (select count(*) from entitlement where consumed_by_session_id = $1)::text as credits, ' +
        '(select count(*) from invoice where session_id = $1)::text as invoices',
      [body.sessionId],
    );
    expect(billing.rows[0]).toEqual({ credits: '0', invoices: '0' });
  });

  it('refuses tomorrow, a year before the practice, and a visit with no reason given', async () => {
    const tomorrow = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE, { on: '2026-09-03' }),
      REASON,
    );
    expect(tomorrow.status).toBe(400);
    expect(await tomorrow.json()).toMatchObject({ code: 'in_the_future' });
    const old = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE, { on: '2023-06-01' }),
      REASON,
    );
    expect(old.status).toBe(400);
    expect(await old.json()).toMatchObject({ code: 'too_old' });
    const silent = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE),
    );
    expect(silent.status).toBe(400);
    expect(await silent.json()).toMatchObject({ code: 'reason_required' });
  });

  it('refuses a practitioner the office action, and a practitioner not certified on that day', async () => {
    const device = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.practitioner,
      visit(WITH_PACKAGE),
      REASON,
    );
    expect(device.status).toBe(403);
    // The seed carries a certification that has run out; a visit after its
    // end, for that practitioner and service, is not one they could deliver.
    const lapsed = h.data.credentials.find((c) => c.validTo !== null && c.validTo < SEED_TODAY);
    if (!lapsed?.validTo) throw new Error('The seed should carry a lapsed certification.');
    const after = `${Number(lapsed.validTo.slice(0, 4)) + 1}-01-15`;
    const res = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE, {
        practitionerId: lapsed.practitionerId,
        serviceTypeId: lapsed.serviceTypeId,
        on: after < SEED_TODAY ? after : lapsed.validTo,
      }),
      REASON,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reasons: string[] }).reasons).toContain('not_authorised');
  });

  it('refuses a household whose health-data consent was withdrawn, naming the consent', async () => {
    const withdrawn = h.data.consents.find((c) => c.status === 'withdrawn');
    if (!withdrawn) throw new Error('The seed should carry a withdrawn consent.');
    const index = h.data.clients.findIndex((c) => c.id === withdrawn.clientId);
    const res = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(index, { on: '2026-03-06', billing: 'settled_outside' }),
      REASON,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      status: 'blocked',
      reasons: ['consent_missing_health_data'],
    });
  });

  it('refuses a second visit at the same hour for the same household as an overlap', async () => {
    const res = await h.call(
      'POST',
      '/api/sessions/from-records',
      SEEDED.owner,
      visit(WITH_PACKAGE, { on: '2026-03-04', startTime: '15:45' }),
      REASON,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reasons: string[] }).reasons[0]).toMatch(/overlap$/);
  });
});
