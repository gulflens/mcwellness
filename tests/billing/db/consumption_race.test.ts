import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../db/runner/apply';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * One credit, two visits, at the same moment.
 *
 * `app.oldest_available_entitlement` used to be a plain select. Two sessions
 * for the same client and service completing together both read the same
 * credit id; the second update blocked on the first, re-evaluated `id = that
 * id` under read committed, still matched, and overwrote
 * `consumed_by_session_id`. One row, so `entitlement_one_per_session` never
 * fired. The result was two visits delivered, one credit spent, and the
 * second visit invoiced to nobody — no charge, no exception, nothing in the
 * queue to notice.
 *
 * The read now locks the row it returns and steps over one another
 * transaction holds, and the update names the status it expects. This file
 * arranges the collision two ways: deliberately, by holding the first
 * transaction open, and by simply letting both go at once.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const CONTEXT =
  "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
  "set_config('app.actor_roles', 'practitioner', true), " +
  "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c1', true), " +
  "set_config('app.reason', '', true)";

let h: Harness;

let sessionSeq = 0;
// Two visits genuinely at once means two practitioners: one person cannot
// have two visits open (session_one_open_per_practitioner).
async function openSession(clientIndex: number, practitionerIndex: number): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000b${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[practitionerIndex];
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'in_progress', now())",
    [
      id,
      h.data.tenant.id,
      h.clientId(clientIndex),
      practitioner?.id,
      h.serviceTypeId('nf-session'),
    ],
  );
  return id;
}

/** One credit, given rather than sold: enough to be raced over. */
async function giveOneCredit(clientIndex: number): Promise<void> {
  await h.owner.query(
    'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version) ' +
      "values ($1, $2, $3, 'complimentary', 0, 500, 1)",
    [h.data.tenant.id, h.clientId(clientIndex), h.serviceTypeId('nf-session')],
  );
}

/**
 * `given` counts the credits the client actually held that were spent. A
 * single-visit charge writes its own credit, consumed on the spot (one
 * mechanism, not two — 404_billing_consumption.sql), so counting every
 * consumed row would count the charge as if it were a credit the family had
 * bought.
 */
async function counts(clientIndex: number): Promise<{ given: number; invoices: number }> {
  const consumed = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from entitlement where client_id = $1 ' +
      "and status = 'consumed' and source_type = 'complimentary'",
    [h.clientId(clientIndex)],
  );
  const invoices = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from invoice where kind = 'session' and client_id = $1",
    [h.clientId(clientIndex)],
  );
  return { given: Number(consumed.rows[0]?.n), invoices: Number(invoices.rows[0]?.n) };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c0', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
});

afterAll(async () => {
  await h.close();
});

describe('the credit finder, under two transactions at once', () => {
  it('hands two callers two different credits, never the same one twice', async () => {
    const client = 3;
    await giveOneCredit(client);
    await giveOneCredit(client);

    const url = requireDatabaseUrl();
    const a = new pg.Client({ connectionString: url });
    const b = new pg.Client({ connectionString: url });
    await a.connect();
    await b.connect();
    try {
      const practitioner = h.data.users[SEEDED.practitioner];
      const ask = async (client_: pg.Client) => {
        await client_.query('begin');
        await client_.query(CONTEXT, [h.data.tenant.id, practitioner?.id ?? null]);
        const { rows } = await client_.query<{ id: string | null }>(
          'select app.oldest_available_entitlement($1, $2, current_date) as id',
          [h.clientId(client), h.serviceTypeId('nf-session')],
        );
        return rows[0]?.id ?? null;
      };
      const first = await ask(a);
      const second = await ask(b);
      // The whole fix, in one assertion. A plain select handed both callers
      // the same row; the second update then overwrote the first, and one
      // credit paid for two visits.
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first).not.toBe(second);
      await a.query('rollback');
      await b.query('rollback');
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('hands the second caller nothing when there is only one credit to hand out', async () => {
    const client = 4;
    await giveOneCredit(client);

    const url = requireDatabaseUrl();
    const a = new pg.Client({ connectionString: url });
    const b = new pg.Client({ connectionString: url });
    await a.connect();
    await b.connect();
    try {
      const practitioner = h.data.users[SEEDED.practitioner];
      const ask = async (client_: pg.Client) => {
        await client_.query('begin');
        await client_.query(CONTEXT, [h.data.tenant.id, practitioner?.id ?? null]);
        const { rows } = await client_.query<{ id: string | null }>(
          'select app.oldest_available_entitlement($1, $2, current_date) as id',
          [h.clientId(client), h.serviceTypeId('nf-session')],
        );
        return rows[0]?.id ?? null;
      };
      expect(await ask(a)).not.toBeNull();
      // Not the same credit, and not a wait either: the second visit is told
      // there is nothing, and goes on to charge for itself properly.
      expect(await ask(b)).toBeNull();
      await a.query('rollback');
      await b.query('rollback');
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe('two visits closing at once over one credit', () => {
  it('spends the credit once and charges the other visit', async () => {
    const client = 5;
    await giveOneCredit(client);
    const first = await openSession(client, 0);
    const second = await openSession(client, 1);

    const url = requireDatabaseUrl();
    const a = new pg.Client({ connectionString: url });
    const b = new pg.Client({ connectionString: url });
    await a.connect();
    await b.connect();
    try {
      const practitioner = h.data.users[SEEDED.practitioner];
      const close = async (client_: pg.Client, sessionId: string) => {
        await client_.query('begin');
        await client_.query(CONTEXT, [h.data.tenant.id, practitioner?.id ?? null]);
        await client_.query("update session set status = 'completed' where id = $1", [sessionId]);
        await client_.query('commit');
      };
      await Promise.all([close(a, first), close(b, second)]);
    } finally {
      await a.end();
      await b.end();
    }

    const after = await counts(client);
    // The one credit the family held was spent once, not twice.
    expect(after.given).toBe(1);
    // And the visit that found no credit is invoiced, not forgotten.
    expect(after.invoices).toBe(1);

    // And the credit belongs to exactly one of the two visits, not both.
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(distinct consumed_by_session_id)::text as n from entitlement ' +
        "where client_id = $1 and source_type = 'complimentary' " +
        'and consumed_by_session_id is not null',
      [h.clientId(client)],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('leaves both visits accounted for: every completed session has a credit or an invoice', async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      "select s.id from session s where s.status = 'completed' " +
        'and not exists (select 1 from entitlement e where e.consumed_by_session_id = s.id) ' +
        'and not exists (select 1 from invoice i where i.session_id = s.id) ' +
        'and not exists (select 1 from billing_exception x where x.session_id = s.id)',
    );
    // The fault this file exists for produced exactly this: a delivered visit
    // that nothing paid for and nothing flagged.
    expect(rows).toEqual([]);
  });
});
