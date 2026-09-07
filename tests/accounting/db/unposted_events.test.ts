import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TENANT_ID } from '../../../db/seed/generate';
import { asApiRole, rejectsWith, rolledBack, setAuditContext } from '../../db/helpers';
import { startHarness, type Harness } from './support';

/**
 * Migration 454: the money events not yet in the books, read through a
 * security-definer function that names nobody (docs/SPEC/accounting.md section
 * 4.3). The erased household's payment is in the answer on purpose: books that
 * depended on who ran the poster would not be books.
 */
const NOW = () => new Date('2026-09-07T08:00:00.000Z');

type EventRow = {
  source_table: string;
  source_id: string;
  source_event: string;
  occurred_on: string;
  invoice_kind: string | null;
  net_fils: string | null;
  amount_fils: string | null;
  method: string | null;
  service_code: string | null;
  has_replacement: boolean | null;
};

let h: Harness;
let payments: string[];
let entitlementId: string;

beforeAll(async () => {
  h = await startHarness(NOW);
  const actor = h.data.users[0]!.id;
  await setAuditContext(h.owner, actor, 'a fixture for the books');
  const vat = await h.owner.query<{ version: number; rate: number }>(
    'select version, rate_basis_points as rate from vat_setting where tenant_id = $1 ' +
      'order by version desc limit 1',
    [SEED_TENANT_ID],
  );
  const { version, rate } = vat.rows[0]!;
  payments = [];
  for (const index of [0, 1]) {
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into payment (tenant_id, client_id, method, amount_fils, received_at, created_by) ' +
        "values ($1, $2, 'transfer', 105000, '2026-04-14T09:00:00+04:00', $3) returning id",
      [SEED_TENANT_ID, h.clientId(index), actor],
    );
    payments.push(rows[0]!.id);
  }
  // A credit that was used and then forgiven: two events from one row, and
  // neither needs an appointment (403's constraint asks a waived credit only
  // for its consumption kind, its moment and its reason). The seed has no
  // appointments, so a consumed-and-still-consumed credit waits for Task 11's
  // fixture, which builds real activity through billing's own routes.
  const created = await h.owner.query<{ id: string }>(
    'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version, status, created_by) ' +
      "values ($1, $2, $3, 'complimentary', 90000, $4, $5, 'available', $6) returning id",
    [SEED_TENANT_ID, h.clientId(0), h.serviceTypeId('nf-session'), rate, version, actor],
  );
  entitlementId = created.rows[0]!.id;
  await h.owner.query(
    "update entitlement set status = 'waived', consumption_kind = 'session', " +
      "consumed_at = '2026-04-20T10:00:00+04:00', waived_at = '2026-04-21T10:00:00+04:00', " +
      "waiver_reason = 'a synthetic waiver', waived_by = $2 where id = $1",
    [entitlementId, actor],
  );
  await h.owner.query("update client set status = 'erased' where id = $1", [h.clientId(1)]);
});

afterAll(async () => {
  await h.close();
});

function readEvents(roles: string): Promise<EventRow[]> {
  return rolledBack(h.owner, () =>
    asApiRole(
      h.owner,
      SEED_TENANT_ID,
      async () => {
        const { rows } = await h.owner.query<EventRow>(
          'select source_table, source_id, source_event, occurred_on::text as occurred_on, ' +
            'invoice_kind, net_fils::text as net_fils, amount_fils::text as amount_fils, ' +
            'method, service_code, has_replacement from app.unposted_money_events() order by 1, 3, 2',
        );
        return rows;
      },
      roles,
    ),
  );
}

describe('app.unposted_money_events', () => {
  it('answers the owner and finance identically, and holds every payment', async () => {
    const asOwner = await readEvents('owner');
    const asFinance = await readEvents('finance');
    expect(JSON.stringify(asFinance)).toBe(JSON.stringify(asOwner));
    expect(asOwner.length).toBeGreaterThanOrEqual(3);
    const paymentIds = asOwner
      .filter((row) => row.source_event === 'payment.received')
      .map((row) => row.source_id);
    expect(paymentIds).toEqual(expect.arrayContaining(payments));
  });

  it('names nobody: no client id, no household word, no receipt', async () => {
    const rows = await readEvents('owner');
    const text = JSON.stringify(rows);
    for (const index of [0, 1]) {
      expect(text).not.toContain(h.clientId(index));
    }
    expect(text).not.toContain('clientId');
    expect(text).not.toContain('client_id');
    expect(text.toLowerCase()).not.toContain('receipt');
    expect(text).not.toContain('INV-');
    expect(text).not.toContain('RCP-');
  });

  it('carries the amounts, the methods and the days each event needs', async () => {
    const rows = await readEvents('owner');
    const payment = rows.find((row) => row.source_id === payments[0]);
    expect(payment).toMatchObject({
      source_table: 'payment',
      source_event: 'payment.received',
      occurred_on: '2026-04-14',
      method: 'transfer',
      amount_fils: '105000',
    });
    const consumed = rows.find(
      (row) => row.source_id === entitlementId && row.source_event === 'credit.consumed',
    );
    expect(consumed).toMatchObject({
      source_table: 'entitlement',
      occurred_on: '2026-04-20',
      net_fils: '90000',
      service_code: 'nf-session',
    });
    const waived = rows.find(
      (row) => row.source_id === entitlementId && row.source_event === 'credit.waived',
    );
    expect(waived).toMatchObject({ occurred_on: '2026-04-21', has_replacement: false });
  });

  it('is not the books of anybody outside them', async () => {
    for (const roles of ['admin', 'practitioner', 'lead_practitioner']) {
      await rolledBack(h.owner, () =>
        asApiRole(
          h.owner,
          SEED_TENANT_ID,
          async () => {
            await rejectsWith(h.owner, '42501', 'select * from app.unposted_money_events()');
          },
          roles,
        ),
      );
    }
  });

  it('stops offering an event once the journal holds it', async () => {
    await rolledBack(h.owner, async () => {
      const actor = h.data.users[0]!.id;
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
        [SEED_TENANT_ID],
      );
      await setAuditContext(h.owner, actor, 'posting one payment by hand');
      const year = await h.owner.query<{ id: string }>(
        "select app.fiscal_year_for('2026-04-14') as id",
      );
      const entry = await h.owner.query<{ id: string }>(
        'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo, ' +
          'source_table, source_id, source_event, created_by) ' +
          "values ($1, '2026-04-14', $2, 'automatic', 'Payment received', 'payment', $3, " +
          "'payment.received', $4) returning id",
        [SEED_TENANT_ID, year.rows[0]!.id, payments[0], actor],
      );
      const accounts = await h.owner.query<{ code: string; id: string }>(
        "select code, id from account where tenant_id = $1 and code in ('1010', '1200')",
        [SEED_TENANT_ID],
      );
      const idOf = (code: string) => accounts.rows.find((r) => r.code === code)!.id;
      await h.owner.query(
        'insert into journal_line (tenant_id, entry_id, line_no, account_id, debit_fils, credit_fils, created_by) ' +
          'values ($1, $2, 1, $3, 105000, 0, $5), ($1, $2, 2, $4, 0, 105000, $5)',
        [SEED_TENANT_ID, entry.rows[0]!.id, idOf('1010'), idOf('1200'), actor],
      );
      await h.owner.query('set constraints all immediate');
      const { rows } = await h.owner.query<{ source_id: string }>(
        "select source_id from app.unposted_money_events() where source_event = 'payment.received'",
      );
      expect(rows.map((r) => r.source_id)).not.toContain(payments[0]);
      expect(rows.map((r) => r.source_id)).toContain(payments[1]);
    });
  });
});
