import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { logReads } from '../_middleware/audit';
import { mayReadInvoices } from './access';
import { InvoicesResponse } from './ledger-schema';

/**
 * `GET /api/billing/invoices` — the practice's own invoice book, newest
 * first.
 *
 * Each row names its client, so listing it is an access to those records:
 * one `list` audit row per invoice shown, written in one statement, the same
 * distinction `app/api/clients/list.ts` draws between seeing a record in a
 * list and opening it.
 *
 * A page is capped, and for the same reason that route's is — one audit row
 * per row shown, never one per row that matched.
 */

const PAGE_SIZE = 50;

const SQL =
  'select i.id, i.reference, i.number, i.kind, i.issued_on, i.client_id, i.net_fils, ' +
  'i.vat_fils, i.gross_fils, i.document_id, c.mrn as client_mrn, ' +
  "c.given_name || ' ' || c.family_name as client_name " +
  'from invoice i join client c on c.id = i.client_id ' +
  'where i.tenant_id = app.current_tenant_id() ' +
  'and ($1::uuid is null or i.client_id = $1) ' +
  // One row past the page, so the route can say "there are more" without a
  // second count-only query.
  'order by i.number desc limit $2';

type InvoiceDbRow = {
  id: string;
  reference: string;
  number: number;
  kind: 'session' | 'package' | 'statement';
  issued_on: string;
  client_id: string;
  client_mrn: string;
  client_name: string;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  document_id: string | null;
};

export function mountInvoices(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/invoices', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // An opaque id, never a name, in the query string (.claude/rules/ui.md).
    const clientId = c.req.query('clientId') ?? null;
    if (clientId !== null && !/^[0-9a-f-]{36}$/i.test(clientId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }

    const db = c.get('db');
    const { rows } = await db.query<InvoiceDbRow>(SQL, [clientId, PAGE_SIZE + 1]);
    const page = rows.slice(0, PAGE_SIZE);

    await logReads(
      db,
      'invoice',
      page.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      InvoicesResponse.parse({
        invoices: page.map((row) => ({
          id: row.id,
          reference: row.reference,
          number: row.number,
          kind: row.kind,
          issuedOn: row.issued_on,
          clientId: row.client_id,
          clientMrn: row.client_mrn,
          clientName: row.client_name,
          netFils: row.net_fils,
          vatFils: row.vat_fils,
          grossFils: row.gross_fils,
          documentId: row.document_id,
        })),
        ...(rows.length > PAGE_SIZE ? { truncated: true } : {}),
      }),
    );
  });
}
