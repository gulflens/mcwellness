import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { logReads } from '../_middleware/audit';
import { mayReadInvoices } from './access';
import { ReceiptsResponse } from './document-schema';

/**
 * `GET /api/billing/payments` — the receipt book, newest first.
 *
 * The counterpart to the invoice book. A payment has had its own number since
 * 405_billing_receipt.sql — RCP, not INV, because a payment settles a tax
 * invoice and is not one — and this is the list a coordinator looks down when a
 * family rings to ask what was received against what.
 *
 * Each row names its client, so listing it is an access to those records: one
 * `list` audit row per payment shown, in one statement, exactly as the invoice
 * book does.
 */

const PAGE_SIZE = 50;

const SQL =
  'select p.id, p.receipt_reference, p.method, p.amount_fils, p.reference, ' +
  "to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as received_on, " +
  'p.client_id, i.reference as invoice_reference, bd.document_id, ' +
  "c.mrn as client_mrn, c.given_name || ' ' || c.family_name as client_name " +
  'from payment p join client c on c.id = p.client_id ' +
  'left join invoice i on i.id = p.invoice_id ' +
  'left join billing_document bd on bd.payment_id = p.id ' +
  'where p.tenant_id = app.current_tenant_id() ' +
  'order by p.received_at desc, p.id limit $1';

type ReceiptDbRow = {
  id: string;
  receipt_reference: string | null;
  method: 'cash' | 'transfer' | 'link';
  amount_fils: number;
  reference: string | null;
  received_on: string;
  client_id: string;
  client_mrn: string;
  client_name: string;
  invoice_reference: string | null;
  document_id: string | null;
};

export function mountReceipts(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/payments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const { rows } = await db.query<ReceiptDbRow>(SQL, [PAGE_SIZE + 1]);
    const page = rows.slice(0, PAGE_SIZE);

    await logReads(
      db,
      'payment',
      page.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      ReceiptsResponse.parse({
        receipts: page.map((row) => ({
          id: row.id,
          receiptReference: row.receipt_reference,
          method: row.method,
          amountFils: row.amount_fils,
          reference: row.reference,
          receivedOn: row.received_on,
          clientId: row.client_id,
          clientMrn: row.client_mrn,
          clientName: row.client_name,
          invoiceReference: row.invoice_reference,
          documentId: row.document_id,
        })),
        ...(rows.length > PAGE_SIZE ? { truncated: true } : {}),
      }),
    );
  });
}
