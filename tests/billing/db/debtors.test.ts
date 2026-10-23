import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DebtorsResponse, type BalanceResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TENANT_ID, SEED_TODAY } from '../../../db/seed/generate';
import { seedUser } from '../../db/helpers';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * Who owes the practice what, as at a day (docs/superpowers/specs/
 * 2026-10-23-debtors-design.md). The allocation rules are tested in
 * domain/billing/ageing.test.ts; this file is about the door: who may knock,
 * what is audited, that the list agrees with the balances and the books, and
 * that a file cannot be turned into a formula.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const FINANCE_ONLY = {
  userId: '0000000d-0000-4000-8000-0000000000e1',
  authId: '0000000d-0000-4000-8000-0000000000e2',
} as const;
const REASON = 'Invoiced to the wrong household by mistake.';

let h: Harness;
let keySeq = 0;

function daysBefore(days: number): string {
  const d = new Date(`${SEED_TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function actAsOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000d9', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
}

/** A statement invoice on a given day, straight into the book. */
async function invoice(clientId: string, issuedOn: string, grossFils: number): Promise<string> {
  await actAsOwner();
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, $4, 0, $4) " +
      'returning id',
    [h.data.tenant.id, clientId, issuedOn, grossFils],
  );
  return String(rows[0]?.id);
}

async function payment(
  clientId: string,
  onDay: string,
  amountFils: number,
  invoiceId: string | null = null,
): Promise<void> {
  await actAsOwner();
  await h.owner.query(
    'insert into payment (tenant_id, client_id, method, amount_fils, received_at, invoice_id) ' +
      "values ($1, $2, 'transfer', $3, ($4::date + time '12:00') at time zone 'Asia/Dubai', $5)",
    [h.data.tenant.id, clientId, amountFils, onDay, invoiceId],
  );
}

async function creditNote(invoiceId: string): Promise<void> {
  keySeq += 1;
  const res = await h.call('POST', `/api/billing/invoices/${invoiceId}/credit-note`, SEEDED.owner, {
    reason: REASON,
    idempotencyKey: `0000000d-0000-4000-8000-${String(keySeq).padStart(12, '0')}`,
  });
  if (res.status !== 201) throw new Error(`The credit note could not be issued: ${res.status}`);
}

async function debtors(query = '', user: number = SEEDED.owner): Promise<DebtorsResponse> {
  const res = await h.call('GET', `/api/billing/debtors${query}`, user);
  expect(res.status).toBe(200);
  return DebtorsResponse.parse(await res.json());
}

async function names(clientId: string, given: string, family: string): Promise<void> {
  await actAsOwner();
  await h.owner.query('update client set given_name = $2, family_name = $3 where id = $1', [
    clientId,
    given,
    family,
  ]);
}

async function auditCount(action: string, requestId?: string): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from audit_log where action = $1 and entity_type = $2 and ($3::text is null or request_id::text = $3)',
    [action, action === 'export' ? 'debtors_export' : 'billing_ledger', requestId ?? null],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  await seedUser(h.owner, {
    id: FINANCE_ONLY.userId,
    tenantId: SEED_TENANT_ID,
    authId: FINANCE_ONLY.authId,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('GET /api/billing/debtors', () => {
  it('puts a current, an ageing and an in-credit household in the right bucket and order', async () => {
    const current = h.clientId(0);
    const ageing = h.clientId(1);
    const credit = h.clientId(2);
    await invoice(current, daysBefore(5), 10_000);
    await invoice(ageing, daysBefore(45), 25_000);
    const paid = await invoice(credit, daysBefore(10), 5_000);
    await payment(credit, daysBefore(2), 8_000, paid);

    const body = await debtors();
    expect(body.asOf).toBe(SEED_TODAY);
    const rows = body.rows.filter((r) => [current, ageing, credit].includes(r.clientId));
    expect(rows.map((r) => r.clientId)).toEqual([ageing, current, credit]);

    expect(rows[0]).toMatchObject({
      owedFils: 25_000,
      b0to30Fils: 0,
      b31to60Fils: 25_000,
      inCreditFils: 0,
      oldestOpenOn: daysBefore(45),
    });
    expect(rows[1]).toMatchObject({ owedFils: 10_000, b0to30Fils: 10_000, inCreditFils: 0 });
    expect(rows[2]).toMatchObject({ owedFils: 0, inCreditFils: 3_000, oldestOpenOn: null });
    expect(rows[0]?.mrn).toMatch(/^MW-/);
    expect(rows[0]?.name).toContain(' ');
  });

  it("every household's owed or credit equals its balance in Billing > Balances", async () => {
    const body = await debtors();
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      const res = await h.call('GET', `/api/billing/clients/${row.clientId}/balance`, SEEDED.owner);
      const balance = (await res.json()) as BalanceResponse;
      expect(row.owedFils - row.inCreditFils).toBe(balance.outstandingFils);
    }
  });

  it('the practice total matches the receivable identity', async () => {
    const { rows } = await h.owner.query<{ receivable: string }>(
      `select (
         (select coalesce(sum(i.gross_fils), 0) from invoice i join client c on c.id = i.client_id
           where c.status <> 'erased')
       - (select coalesce(sum(p.amount_fils), 0) from payment p join client c on c.id = p.client_id
           where c.status <> 'erased')
       - (select coalesce(sum(i.gross_fils), 0) from invoice i join client c on c.id = i.client_id
           where c.status <> 'erased' and i.waived_at is not null)
       - (select coalesce(sum(n.gross_fils), 0) from credit_note n join client c on c.id = n.client_id
           where c.status <> 'erased')
       )::text as receivable`,
    );
    const body = await debtors();
    expect(body.totals.owedFils - body.totals.inCreditFils).toBe(Number(rows[0]?.receivable));
    expect(body.totals.households).toBe(body.rows.length);
  });

  it('as at a past day ignores later invoices, payments and credit notes', async () => {
    const client = h.clientId(3);
    await invoice(client, daysBefore(40), 20_000);
    const sold = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
      clientId: client,
      serviceTypeId: h.serviceTypeId('nf-session'),
      purchasedOn: SEED_TODAY,
    });
    expect(sold.status).toBe(201);
    const later = ((await sold.json()) as { invoiceId: string }).invoiceId;
    await payment(client, daysBefore(2), 4_000);
    await creditNote(later);

    const then = await debtors(`?asOf=${daysBefore(20)}`);
    const row = then.rows.find((r) => r.clientId === client);
    expect(row).toMatchObject({ owedFils: 20_000, b0to30Fils: 20_000, b31to60Fils: 0 });
    expect(then.asOf).toBe(daysBefore(20));

    // A credit note is dated by the database's own clock, not the test's.
    const { rows: issued } = await h.owner.query<{ on: string }>(
      "select to_char(issued_on, 'YYYY-MM-DD') as on from credit_note where invoice_id = $1",
      [later],
    );
    const now = await debtors(`?asOf=${issued[0]?.on}`);
    const today = now.rows.find((r) => r.clientId === client);
    // The sale and its credit note cancel; the payment pays the old invoice down.
    expect(today?.owedFils).toBe(16_000);
  });

  it('refuses a bad asOf with a 400', async () => {
    const res = await h.call('GET', '/api/billing/debtors?asOf=2026-13-45', SEEDED.owner);
    expect(res.status).toBe(400);
  });

  it('refuses a practitioner with a 403, and lets finance, admin and the lead practitioner in', async () => {
    expect((await h.call('GET', '/api/billing/debtors', SEEDED.practitioner)).status).toBe(403);
    expect((await h.call('GET', '/api/billing/debtors.csv', SEEDED.practitioner)).status).toBe(403);
    expect((await h.call('GET', '/api/billing/debtors', SEEDED.admin)).status).toBe(200);
    expect((await h.call('GET', '/api/billing/debtors', SEEDED.owner)).status).toBe(200);
    expect((await h.callAs('GET', '/api/billing/debtors', FINANCE_ONLY.authId)).status).toBe(200);
  });

  it('writes one list audit row for each row shown', async () => {
    const before = await auditCount('list');
    const body = await debtors();
    expect(body.rows.length).toBeGreaterThan(0);
    expect((await auditCount('list')) - before).toBe(body.rows.length);
  });

  it('an erased household is absent', async () => {
    const client = h.clientId(4);
    await invoice(client, daysBefore(50), 9_000);
    expect((await debtors()).rows.some((r) => r.clientId === client)).toBe(true);

    const user = h.data.users[SEEDED.owner];
    const { rows: requested } = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, created_by) ' +
        "values ($1, $2, 'The household asked.', $3) returning id",
      [h.data.tenant.id, client, user?.id],
    );
    await h.owner.query(
      "select set_config('app.actor_id', $1, false), set_config('app.actor_roles', 'owner', false), " +
        "set_config('app.reason', 'The household asked.', false)",
      [user?.id],
    );
    await h.owner.query('select app.erase_client($1, $2)', [client, requested[0]?.id]);

    const after = await debtors();
    expect(after.rows.some((r) => r.clientId === client)).toBe(false);
    const { rows: still } = await h.owner.query<{ status: string }>(
      'select status::text from client where id = $1',
      [client],
    );
    expect(still[0]?.status).toBe('erased');
  });
});

describe('GET /api/billing/debtors.csv', () => {
  it('has the headings, one row per household, and a file name carrying the day', async () => {
    const res = await h.call('GET', `/api/billing/debtors.csv?asOf=${SEED_TODAY}`, SEEDED.owner);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain(`debtors-${SEED_TODAY}.csv`);
    const lines = (await res.text()).split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe(
      'Client,Record number,Owed AED,0-30 days AED,31-60 days AED,61-90 days AED,Over 90 days AED,In credit AED,Oldest open invoice',
    );
    expect(lines.length - 1).toBe((await debtors()).totals.households);
  });

  it('writes one list audit row per row plus one export row', async () => {
    const listBefore = await auditCount('list');
    const exportBefore = await auditCount('export');
    const res = await h.call('GET', '/api/billing/debtors.csv', SEEDED.owner);
    const rows = (await res.text()).split('\r\n').filter((l) => l !== '').length - 1;
    expect(rows).toBeGreaterThan(0);
    expect((await auditCount('list')) - listBefore).toBe(rows);
    expect((await auditCount('export')) - exportBefore).toBe(1);
  });

  it('a name starting with = is escaped in the CSV', async () => {
    const client = h.clientId(5);
    await names(client, '=HYPERLINK("x")', 'Synthetic');
    await invoice(client, daysBefore(1), 1_000);
    const res = await h.call('GET', '/api/billing/debtors.csv', SEEDED.owner);
    const text = await res.text();
    expect(text).toContain(`"'=HYPERLINK(""x"") Synthetic"`);
    expect(text).not.toMatch(/(^|\r\n)=/);
  });
});

describe('a long list', () => {
  it('shows 50 rows and says there are more, while the totals cover every household', async () => {
    const before = await debtors();
    const have = before.totals.households;
    const extra = 55 - have + 1;
    await actAsOwner();
    const ids: string[] = [];
    for (let i = 0; i < extra; i += 1) {
      const { rows } = await h.owner.query<{ id: string }>(
        'insert into client (tenant_id, mrn, given_name, family_name, status) ' +
          "values ($1, $2, 'Synthetic', $3, 'active') returning id",
        [h.data.tenant.id, `MW-9${String(i).padStart(5, '0')}`, `Debtor${i}`],
      );
      ids.push(String(rows[0]?.id));
    }
    for (const id of ids) await invoice(id, daysBefore(1), 100);

    const body = await debtors();
    expect(body.totals.households).toBeGreaterThan(50);
    expect(body.rows).toHaveLength(50);
    expect(body.truncated).toBe(true);
    expect(body.totals.owedFils).toBe(before.totals.owedFils + extra * 100);

    const csv = await h.call('GET', '/api/billing/debtors.csv', SEEDED.owner);
    const lines = (await csv.text()).split('\r\n').filter((l) => l !== '');
    expect(lines.length - 1).toBe(body.totals.households);
  });
});
