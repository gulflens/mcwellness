import type { Context, Hono } from 'hono';
import { ageing, openItems, type LedgerEntry } from '../../../domain/billing';
import { amountCell, isoDateIn, toCsv } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { csvResponse } from '../accounting/csv-response';
import { mayReadInvoices } from './access';
import { ledgerEntry, type LedgerDbRow } from './ledger-entries';
import { DebtorsQuery, DebtorsResponse, type DebtorRow } from './ledger-schema';

/**
 * `GET /api/billing/debtors` and `.csv` — who owes the practice what, and for
 * how long (docs/superpowers/specs/2026-10-23-debtors-design.md).
 *
 * One read of `app.billing_ledger` up to the as-at day, with the invoice each
 * payment and credit note names; the allocation and the ageing are
 * domain/billing/ageing.ts's, and this route only reads, maps and sorts.
 *
 * Households that are erased are left out for everybody, so the list does not
 * differ by role (row security shows them only to the owner and lead
 * practitioner). Each row shown names a client, so listing it is an access:
 * one `list` audit row per row, the list capped at fifty for that reason, and
 * the file — which has every row — logs one per row and one `export`.
 */

const PAGE_SIZE = 50;
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const HEADINGS = [
  'Client',
  'Record number',
  'Owed AED',
  '0-30 days AED',
  '31-60 days AED',
  '61-90 days AED',
  'Over 90 days AED',
  'In credit AED',
  'Oldest open invoice',
] as const;

const SQL =
  'select l.client_id, l.entry_kind, l.source_id, l.reference, ' +
  "to_char(l.occurred_on, 'YYYY-MM-DD') as occurred_on, l.amount_fils, " +
  'coalesce(p.invoice_id, n.invoice_id) as invoice_id, ' +
  "c.given_name || ' ' || c.family_name as client_name, c.mrn as client_mrn " +
  'from app.billing_ledger l ' +
  'join client c on c.tenant_id = l.tenant_id and c.id = l.client_id ' +
  "left join payment p on p.tenant_id = l.tenant_id and l.entry_kind = 'payment' " +
  '  and p.id = l.source_id ' +
  "left join credit_note n on n.tenant_id = l.tenant_id and l.entry_kind = 'credit' " +
  '  and n.id = l.source_id ' +
  "where l.tenant_id = app.current_tenant_id() and c.status <> 'erased' " +
  'and l.occurred_on <= $1::date';

type DebtorDbRow = LedgerDbRow & {
  client_id: string;
  client_name: string;
  client_mrn: string;
};

/** Every household with a balance, largest debt first, then largest credit. */
function debtorRows(rows: readonly DebtorDbRow[], asOf: string): DebtorRow[] {
  const households = new Map<string, { name: string; mrn: string; entries: LedgerEntry[] }>();
  for (const row of rows) {
    let household = households.get(row.client_id);
    if (!household) {
      household = { name: row.client_name, mrn: row.client_mrn, entries: [] };
      households.set(row.client_id, household);
    }
    const entry = ledgerEntry(row);
    if (entry) household.entries.push(entry);
  }

  const result: DebtorRow[] = [];
  for (const [clientId, household] of households) {
    const open = openItems(household.entries, asOf);
    const aged = ageing(open, asOf);
    if (aged.owedFils === 0 && open.creditFils === 0) continue;
    result.push({
      clientId,
      name: household.name,
      mrn: household.mrn,
      owedFils: aged.owedFils,
      b0to30Fils: aged.b0to30Fils,
      b31to60Fils: aged.b31to60Fils,
      b61to90Fils: aged.b61to90Fils,
      over90Fils: aged.over90Fils,
      inCreditFils: open.creditFils,
      oldestOpenOn: aged.oldestOpenOn,
    });
  }
  return result.sort(
    (a, b) =>
      b.owedFils - a.owedFils ||
      b.inCreditFils - a.inCreditFils ||
      (a.clientId < b.clientId ? -1 : 1),
  );
}

export function mountDebtors(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  async function load(c: Context<ApiEnv>) {
    const parsed = DebtorsQuery.safeParse({ asOf: c.req.query('asOf') });
    if (!parsed.success) return null;
    const asOf = parsed.data.asOf ?? isoDateIn(now(), PRACTICE_TIME_ZONE);
    const { rows } = await c.get('db').query<DebtorDbRow>(SQL, [asOf]);
    return { asOf, all: debtorRows(rows, asOf) };
  }

  api.get('/api/billing/debtors', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadInvoices(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const loaded = await load(c);
    if (!loaded) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const { asOf, all } = loaded;
    const shown = all.slice(0, PAGE_SIZE);

    await logReads(
      c.get('db'),
      'billing_ledger',
      shown.map((row) => ({ id: row.clientId, clientId: row.clientId })),
      'list',
    );

    const sum = (pick: (row: DebtorRow) => number) =>
      all.reduce((total, row) => total + pick(row), 0);
    return c.json(
      DebtorsResponse.parse({
        asOf,
        totals: {
          owedFils: sum((r) => r.owedFils),
          b0to30Fils: sum((r) => r.b0to30Fils),
          b31to60Fils: sum((r) => r.b31to60Fils),
          b61to90Fils: sum((r) => r.b61to90Fils),
          over90Fils: sum((r) => r.over90Fils),
          inCreditFils: sum((r) => r.inCreditFils),
          households: all.length,
        },
        rows: shown,
        truncated: all.length > PAGE_SIZE,
      }),
    );
  });

  api.get('/api/billing/debtors.csv', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadInvoices(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const loaded = await load(c);
    if (!loaded) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const { asOf, all } = loaded;
    const db = c.get('db');

    await logReads(
      db,
      'billing_ledger',
      all.map((row) => ({ id: row.clientId, clientId: row.clientId })),
      'list',
    );
    await logAction(
      db,
      'export',
      { type: 'debtors_export', id: requestId, clientId: null },
      { list: 'debtors', asOf, rows: String(all.length) },
    );

    const table = [
      [...HEADINGS],
      ...all.map((row) => [
        row.name,
        row.mrn,
        amountCell(row.owedFils),
        amountCell(row.b0to30Fils),
        amountCell(row.b31to60Fils),
        amountCell(row.b61to90Fils),
        amountCell(row.over90Fils),
        amountCell(row.inCreditFils),
        row.oldestOpenOn ?? '',
      ]),
    ];
    return csvResponse(c, `debtors-${asOf}.csv`, toCsv(table));
  });
}
