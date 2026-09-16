import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  SILVER_CODE,
  setPracticePrices,
  silverInput,
  startHarness,
  type Harness,
} from './support';

/**
 * What the ledger does with a visit logged from the practice's records
 * (db/migrations/966_session_from_records.sql): a credit valid on the visit's
 * own day if one exists, nothing if the visit was settled before the app, and
 * a refusal — never an invoice at today's price — when neither holds. Written
 * as the route writes it: one insert of a completed row.
 */

/** The seed's own day, like every ledger test: a price set today is the one the door reads. */
const NOW = () => new Date(`${SEED_TODAY}T08:00:00.000Z`);
const REQUEST_ID = '00000000-0000-4000-8000-0000000000ee';
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';

let h: Harness;

async function asOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', 'from the paper diary', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

let seq = 0;
/** A visit typed up from the records: completed, on a day that has passed. */
async function logPastVisit(
  clientId: string,
  serviceCode: string,
  on: string,
  settledOutside: boolean,
  recordedFrom: 'records' | 'device' = 'records',
): Promise<string> {
  seq += 1;
  const id = `00000000-0000-4000-8000-00000000a${String(seq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'delivery_mode, status, checked_in_at, started_at, ended_at, checked_out_at, closed_at, ' +
      'recorded_from, settled_outside_app) values ' +
      "($1, $2, $3, $4, $5, 'home', 'completed', $6::timestamptz, $6::timestamptz, " +
      "$6::timestamptz + interval '60 minutes', $6::timestamptz + interval '60 minutes', now(), $7, $8)",
    [
      id,
      h.data.tenant.id,
      clientId,
      practitioner?.id,
      h.serviceTypeId(serviceCode),
      `${on}T11:00:00+04:00`,
      recordedFrom,
      settledOutside,
    ],
  );
  return id;
}

async function billingFor(sessionId: string) {
  const credits = await h.owner.query<{ status: string; source_type: string }>(
    'select status, source_type from entitlement where consumed_by_session_id = $1',
    [sessionId],
  );
  const invoices = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from invoice where session_id = $1',
    [sessionId],
  );
  const exceptions = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from billing_exception where session_id = $1',
    [sessionId],
  );
  return {
    credits: credits.rows,
    invoices: Number(invoices.rows[0]?.n),
    exceptions: Number(exceptions.rows[0]?.n),
  };
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
  // Sold on the seed's day: the visits below happened before it, which is
  // exactly how a package bought to cover past visits is recorded.
  const sale = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silver.id,
    clientId: h.clientId(0),
    purchasedOn: SEED_TODAY,
  });
  if (sale.status !== 201) throw new Error('Silver could not be sold.');
  await asOwner();
});

afterAll(async () => {
  await h.close();
});

describe('a visit logged from the records', () => {
  it("takes a credit valid on the visit's own day, and invents no invoice", async () => {
    const sessionId = await logPastVisit(h.clientId(0), 'nf-session', '2026-03-04', false);
    expect(await billingFor(sessionId)).toEqual({
      credits: [{ status: 'consumed', source_type: 'package' }],
      invoices: 0,
      exceptions: 0,
    });
  });

  it('charges nothing, and writes nothing, when the visit was settled before the app', async () => {
    const sessionId = await logPastVisit(h.clientId(1), 'nf-session', '2026-03-05', true);
    expect(await billingFor(sessionId)).toEqual({ credits: [], invoices: 0, exceptions: 0 });
  });

  it('is refused, with nothing written, when no credit covers it and it was not settled', async () => {
    await h.owner.query('begin');
    let code: string | undefined;
    try {
      await logPastVisit(h.clientId(1), 'nf-session', '2026-03-06', false);
    } catch (error) {
      code = (error as { code?: string }).code;
    } finally {
      await h.owner.query('rollback');
    }
    expect(code).toBe(RESTRICT_VIOLATION);
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from session where recorded_from = 'records' and client_id = $1",
      [h.clientId(1)],
    );
    // Only the settled one above.
    expect(rows[0]?.n).toBe('1');
    const invoices = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from invoice where kind = 'session' and client_id = $1",
      [h.clientId(1)],
    );
    expect(invoices.rows[0]?.n).toBe('0');
  });

  it('never lets a visit from the door be marked settled outside the app', async () => {
    await h.owner.query('begin');
    let code: string | undefined;
    try {
      await logPastVisit(h.clientId(1), 'nf-session', '2026-03-07', true, 'device');
    } catch (error) {
      code = (error as { code?: string }).code;
    } finally {
      await h.owner.query('rollback');
    }
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('leaves a visit from the door exactly as it was: no credit, so a charge at today’s price', async () => {
    const sessionId = await logPastVisit(h.clientId(1), 'nf-session', SEED_TODAY, false, 'device');
    const billing = await billingFor(sessionId);
    expect(billing.credits).toEqual([{ status: 'consumed', source_type: 'single' }]);
    expect(billing.invoices).toBe(1);
  });
});
