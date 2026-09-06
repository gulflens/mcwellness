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
 * The one status change that takes a family's credit: a visit delivered.
 *
 * It is written here as the session-capture stream writes it — a plain status
 * update on its own table, with no billing statement anywhere near it. That is
 * the contract (404_billing_consumption.sql): closing a visit is one
 * transaction that touches no billing row, and the ledger keeps up by itself.
 *
 * A visit called off used to be the second such change. It is not any more:
 * the founder's decision of 2026-09-04 is one fee and never a session, and
 * what a cancellation costs now is specified in
 * `tests/billing/db/call_out_fee.test.ts`. What is left here is the credit a
 * cancellation took before that, and the waiver that still reaches it.
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

  it('refuses to reopen a closed visit, so nothing can be taken twice that way', async () => {
    // A completed session is immutable from its close (session-capture.md
    // section 4; migration 302's freeze). Replay safety does not need a
    // reopening: the unique index on consumed_by_session_id already makes a
    // repeated completion a no-op (the test above). Applied by the trunk from
    // docs/CHANGE-REQUESTS/session-capture-02.md section 10.
    await expect(
      h.owner.query("update session set status = 'in_progress' where id = $1", [sessionId]),
    ).rejects.toThrow();
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
    // No VAT: the practice is not registered for it, so the charge is the net
    // price and the gross is the same figure (migration 406, and
    // tests/billing/db/vat_registration.test.ts for the rule itself).
    expect(invoices).toEqual([
      {
        kind: 'session',
        reference: 'INV-000002',
        net_fils: 70_000,
        vat_fils: 0,
        gross_fils: 70_000,
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
    expect(body.chargedFils).toBe(70_000);
    expect(body.paidFils).toBe(0);
    expect(body.outstandingFils).toBe(70_000);
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

describe('a credit a cancellation took before the founder changed the rule', () => {
  let appointmentId: string;
  let waivedId: string;

  /**
   * Nothing writes one of these any more. The founder's decision of
   * 2026-09-04 is that a package's sessions are never taken for a
   * cancellation, and migration 408 replaced the consumption with a call-out
   * fee — `tests/billing/db/call_out_fee.test.ts` is where what a cancellation
   * costs now is specified.
   *
   * The rows 404 wrote are still on real ledgers, though, and nothing
   * backfills them: giving a credit back is a decision for a person. So the
   * door that forgives one stays open, and this is one of those rows, written
   * here by hand because the trigger will not write another.
   *
   * The visit is called off as `practice_request`, which carries no fee, so
   * these figures are about the credit and nothing else.
   */
  it('is a row nothing writes any more, and the waiver still reaches it', async () => {
    appointmentId = await bookAppointment(h.clientId(0), 'nf-session');
    await h.owner.query(
      "update appointment set status = 'cancelled_late', " +
        "cancellation_reason = 'practice_request', cancelled_at = now() where id = $1",
      [appointmentId],
    );

    // No credit was taken by the trigger, and no fee charged either.
    const { rows: untouched } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement where consumed_by_appointment_id = $1',
      [appointmentId],
    );
    expect(Number(untouched[0]?.n)).toBe(0);

    const { rows } = await h.owner.query<{ id: string }>(
      "update entitlement set status = 'consumed', consumption_kind = 'late_cancellation', " +
        'consumed_by_appointment_id = $1, consumed_at = now() where id = (' +
        '  select id from entitlement where client_id = $2 and service_type_id = $3 ' +
        "  and status = 'available' order by expires_on, id limit 1) returning id",
      [appointmentId, h.clientId(0), h.serviceTypeId('nf-session')],
    );
    waivedId = String(rows[0]?.id);
    expect(waivedId).toBeTruthy();
  });

  it('counts as forfeited, never as a session the family had', async () => {
    const res = await h.call('GET', `/api/billing/clients/${h.clientId(0)}/balance`, SEEDED.owner);
    const body = (await res.json()) as BalanceResponse;
    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.delivered).toBe(2);
    expect(sessions?.forfeited).toBe(1);
    expect(sessions?.remaining).toBe(12);
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

  it('says why in the audit trail, not only in the column', async () => {
    // A waiver is a decision somebody made about money, and the trail is
    // where a decision lives (docs/SPEC/audit.md section 5). The route stamps
    // the reason itself rather than trusting a header the browser may not
    // have sent.
    const { rows } = await h.owner.query<{ reason: string | null }>(
      "select reason from audit_log where entity_type = 'entitlement' and action = 'update' " +
        'order by occurred_at desc limit 1',
    );
    expect(rows[0]?.reason).toBe('The family had an emergency; the practice let it go.');
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
});
