import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BalanceResponse,
  PackagesResponse,
  WaiveEntitlementResponse,
} from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The two status changes that cost a family something: a visit delivered, and
 * a visit called off inside the notice period.
 *
 * Both are written here as the session-capture and scheduling streams write
 * them — a plain status update on their own table, with no billing statement
 * anywhere near it. That is the contract
 * (404_billing_consumption.sql): closing a visit is one transaction that
 * touches no billing row, and the ledger keeps up by itself.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000ee';

let h: Harness;
let silverId: string;

/**
 * Stamps the same transaction settings the request-context middleware would,
 * as the seeded practitioner: this is a practitioner closing their own visit,
 * holding no billing role at all.
 */
async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

let sessionSeq = 0;
/** A visit at the door, exactly as the check-in route writes one. */
async function openSession(clientId: string, serviceCode: string): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000f${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'in_progress', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId(serviceCode)],
  );
  return id;
}

/** Closing it: the one statement the session-capture stream runs. */
async function completeSession(sessionId: string): Promise<void> {
  await h.owner.query("update session set status = 'completed' where id = $1", [sessionId]);
}

let appointmentSeq = 0;
async function bookAppointment(clientId: string, serviceCode: string): Promise<string> {
  appointmentSeq += 1;
  const id = `00000000-0000-4000-8000-00000000e${String(appointmentSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  const client = h.data.clients.find((c) => c.id === clientId);
  // Each visit an hour after the last, so the no-overlap constraints hold.
  const start = new Date(Date.UTC(2026, 8, 10, 6 + appointmentSeq, 0, 0)).toISOString();
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, $6, ' +
      "'home', $7::timestamptz, $7::timestamptz + interval '45 minutes', 'confirmed')",
    [
      id,
      h.data.tenant.id,
      clientId,
      practitioner?.id,
      h.serviceTypeId(serviceCode),
      client?.primaryLocationId,
      start,
    ],
  );
  return id;
}

async function creditsFor(clientId: string, serviceCode: string) {
  const { rows } = await h.owner.query<{
    status: string;
    consumption_kind: string | null;
    n: string;
  }>(
    'select e.status, e.consumption_kind, count(*)::text as n from entitlement e ' +
      'where e.client_id = $1 and e.service_type_id = $2 group by 1, 2 order by 1, 2',
    [clientId, h.serviceTypeId(serviceCode)],
  );
  return rows.map((row) => ({ ...row, n: Number(row.n) }));
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
  silverId = silver.id;

  const sale = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silverId,
    clientId: h.clientId(0),
    purchasedOn: SEED_TODAY,
  });
  if (sale.status !== 201) throw new Error('Silver could not be sold.');

  await asPractitioner();
});

afterAll(async () => {
  await h.close();
});

describe('a delivered visit consumes a credit', () => {
  let sessionId: string;

  it('takes exactly one, and records what took it', async () => {
    sessionId = await openSession(h.clientId(0), 'nf-session');
    await completeSession(sessionId);

    expect(await creditsFor(h.clientId(0), 'nf-session')).toEqual([
      { status: 'available', consumption_kind: null, n: 14 },
      { status: 'consumed', consumption_kind: 'session', n: 1 },
    ]);

    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement where consumed_by_session_id = $1',
      [sessionId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('takes the credit closest to running out, so none is lost to expiry', async () => {
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement ' +
        'where consumed_by_session_id = $1 and expires_on = $2',
      [sessionId, '2027-09-02'],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('takes nothing more when the same completion is written again', async () => {
    await completeSession(sessionId);
    await completeSession(sessionId);
    expect(await creditsFor(h.clientId(0), 'nf-session')).toEqual([
      { status: 'available', consumption_kind: null, n: 14 },
      { status: 'consumed', consumption_kind: 'session', n: 1 },
    ]);
  });

  it('takes nothing more when a visit is reopened and closed again', async () => {
    await h.owner.query("update session set status = 'in_progress' where id = $1", [sessionId]);
    await completeSession(sessionId);
    expect(await creditsFor(h.clientId(0), 'nf-session')).toEqual([
      { status: 'available', consumption_kind: null, n: 14 },
      { status: 'consumed', consumption_kind: 'session', n: 1 },
    ]);
  });

  it('writes no invoice at all: the family already paid for the package', async () => {
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from invoice where kind = 'session'",
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('shows the family thirteen sessions to come once a second is delivered', async () => {
    const second = await openSession(h.clientId(0), 'nf-session');
    await completeSession(second);

    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    const body = (await res.json()) as BalanceResponse;
    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.delivered).toBe(2);
    expect(sessions?.remaining).toBe(13);
    // The next visit is the third of fifteen.
    expect((sessions?.delivered ?? 0) + 1).toBe(3);
  });
});

describe('a delivered visit with no credit left', () => {
  it("charges it at today's price and leaves the ledger the same shape", async () => {
    const clientId = h.clientId(1);
    const sessionId = await openSession(clientId, 'nf-session');
    await completeSession(sessionId);

    const { rows: invoices } = await h.owner.query<{
      kind: string;
      reference: string;
      net_fils: number;
      vat_fils: number;
      gross_fils: number;
    }>(
      'select kind, reference, net_fils, vat_fils, gross_fils from invoice where session_id = $1',
      [sessionId],
    );
    expect(invoices).toEqual([
      {
        kind: 'session',
        reference: 'INV-000002',
        net_fils: 70_000,
        vat_fils: 3_500,
        gross_fils: 73_500,
      },
    ]);

    // The charge creates the credit it consumes, so a single visit and a
    // package visit leave the same rows behind (billing.md section 1).
    const { rows: credits } = await h.owner.query<{
      source_type: string;
      status: string;
      allocated_net_fils: number;
    }>(
      'select source_type, status, allocated_net_fils from entitlement where consumed_by_session_id = $1',
      [sessionId],
    );
    expect(credits).toEqual([
      { source_type: 'single', status: 'consumed', allocated_net_fils: 70_000 },
    ]);
  });

  it('names the supplier on the invoice the trigger wrote, with nobody to remember to', async () => {
    // This invoice was written by app.charge_single_visit, inside a trigger,
    // with no route above it. The supplier stamp is a before-insert trigger
    // for exactly that reason: there are two callers, and forgetting in one of
    // them would not show until somebody rendered a PDF.
    const { rows } = await h.owner.query<{ name: string | null; trn: string | null }>(
      "select supplier_legal_name as name, supplier_trn as trn from invoice where kind = 'session' " +
        'order by number desc limit 1',
    );
    expect(rows[0]?.name).toBe(h.data.tenant.legalName);
    expect(rows[0]?.trn).toBe(h.data.tenant.trn);
  });

  it('charges once, however many times the completion is written', async () => {
    const clientId = h.clientId(2);
    const sessionId = await openSession(clientId, 'nf-session');
    await completeSession(sessionId);
    await completeSession(sessionId);
    await completeSession(sessionId);

    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from invoice where session_id = $1',
      [sessionId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('leaves the family owing what the visit cost', async () => {
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(1)}/balance`, SEEDED.owner);
    const body = (await res.json()) as BalanceResponse;
    expect(body.chargedFils).toBe(73_500);
    expect(body.paidFils).toBe(0);
    expect(body.outstandingFils).toBe(73_500);
  });
});

describe('a delivered visit with no credit and no price', () => {
  it('queues it rather than quietly billing nothing', async () => {
    const clientId = h.clientId(3);
    const sessionId = await openSession(clientId, 'compassionate-inquiry');
    await completeSession(sessionId);

    const { rows } = await h.owner.query<{
      kind: string;
      detail: string;
      resolved_at: string | null;
    }>('select kind, detail, resolved_at from billing_exception where session_id = $1', [
      sessionId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('unpriced_session');
    expect(rows[0]?.resolved_at).toBeNull();

    const { rows: invoices } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from invoice where session_id = $1',
      [sessionId],
    );
    expect(Number(invoices[0]?.n)).toBe(0);
  });

  it('queues it once, not once per replay', async () => {
    const { rows: before } = await h.owner.query<{ id: string }>(
      "select id from session where service_type_id = $1 and status = 'completed'",
      [h.serviceTypeId('compassionate-inquiry')],
    );
    const sessionId = before[0]?.id;
    await completeSession(String(sessionId));
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from billing_exception where session_id = $1',
      [sessionId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('a visit called off inside the notice period', () => {
  let appointmentId: string;
  let waivedId: string;

  it('takes a credit, and says a cancellation took it', async () => {
    appointmentId = await bookAppointment(h.clientId(0), 'nf-session');
    await h.owner.query("update appointment set status = 'cancelled_late' where id = $1", [
      appointmentId,
    ]);

    const { rows } = await h.owner.query<{ id: string; status: string; consumption_kind: string }>(
      'select id, status, consumption_kind from entitlement where consumed_by_appointment_id = $1',
      [appointmentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('consumed');
    expect(rows[0]?.consumption_kind).toBe('late_cancellation');
    waivedId = String(rows[0]?.id);
  });

  it('counts it as forfeited, never as a session the family had', async () => {
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    const body = (await res.json()) as BalanceResponse;
    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.delivered).toBe(2);
    expect(sessions?.forfeited).toBe(1);
    expect(sessions?.remaining).toBe(12);
  });

  it('takes nothing more when the same cancellation is written again', async () => {
    await h.owner.query("update appointment set status = 'cancelled_late' where id = $1", [
      appointmentId,
    ]);
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement where consumed_by_appointment_id = $1',
      [appointmentId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('gives the credit back when the coordinator waives it, without rewriting what happened', async () => {
    const res = await h.call('POST', `/api/billing/entitlements/${waivedId}/waiver`, SEEDED.owner, {
      reason: 'The family had an emergency; the practice let it go.',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as WaiveEntitlementResponse;
    expect(body.waivedEntitlementId).toBe(waivedId);

    const { rows } = await h.owner.query<{
      status: string;
      waiver_reason: string | null;
      replaces_entitlement_id: string | null;
      allocated_net_fils: number;
    }>(
      'select status, waiver_reason, replaces_entitlement_id, allocated_net_fils from entitlement ' +
        'where id = any($1::uuid[]) order by replaces_entitlement_id nulls first',
      [[body.waivedEntitlementId, body.replacementEntitlementId]],
    );
    // The late cancellation is still on the record; the replacement carries
    // the same value, so the sale's credits still total what was paid.
    expect(rows[0]?.status).toBe('waived');
    expect(rows[0]?.waiver_reason).toBe('The family had an emergency; the practice let it go.');
    expect(rows[1]?.replaces_entitlement_id).toBe(waivedId);
    expect(rows[1]?.allocated_net_fils).toBe(rows[0]?.allocated_net_fils);
  });

  it('puts the family back where they were', async () => {
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    const body = (await res.json()) as BalanceResponse;
    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.forfeited).toBe(0);
    expect(sessions?.remaining).toBe(13);
    expect(sessions?.purchased).toBe(15);

    const { rows } = await h.owner.query<{ total: string }>(
      'select sum(allocated_net_fils)::text as total from entitlement ' +
        "where package_purchase_id is not null and status <> 'waived'",
    );
    expect(Number(rows[0]?.total)).toBe(1_032_500);
  });

  it('refuses to waive a session the family actually had', async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      "select id from entitlement where consumption_kind = 'session' limit 1",
    );
    const res = await h.call(
      'POST',
      `/api/billing/entitlements/${rows[0]?.id}/waiver`,
      SEEDED.owner,
      { reason: 'Trying to unwind a delivered visit.' },
    );
    expect(res.status).toBe(409);
  });

  it('refuses a practitioner the waiver', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/entitlements/${waivedId}/waiver`,
      SEEDED.practitioner,
      { reason: 'Not mine to give.' },
    );
    expect(res.status).toBe(403);
  });

  it('queues a no-show by a family holding no credit rather than inventing a charge', async () => {
    const clientId = h.clientId(4);
    const appointment = await bookAppointment(clientId, 'nf-session');
    await h.owner.query("update appointment set status = 'no_show' where id = $1", [appointment]);

    const { rows } = await h.owner.query<{ kind: string }>(
      'select kind from billing_exception where appointment_id = $1',
      [appointment],
    );
    expect(rows).toEqual([{ kind: 'uncovered_late_cancellation' }]);

    const { rows: invoices } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from invoice where client_id = $1 and kind = 'session'",
      [clientId],
    );
    expect(Number(invoices[0]?.n)).toBe(0);
  });
});
