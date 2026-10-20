import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { logReads } from '../_middleware/audit';
import { mayReadInvoices } from './access';
import {
  PaymentSearchInput,
  PaymentSearchResponse,
  ReceiptsResponse,
  type ReceiptRow,
} from './document-schema';
import { containsPattern, decodeReceiptCursor, encodeReceiptCursor } from './search';

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

const COLUMNS =
  'select p.id, p.receipt_reference, p.method, p.amount_fils, p.reference, ' +
  "to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as received_on, " +
  // The moment to the microsecond, in UTC, as text: what the search's cursor
  // is made of. A JavaScript Date would round it to the millisecond, and two
  // payments that close together would then compare as one.
  'to_char(p.received_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') as received_key, ' +
  'p.client_id, i.reference as invoice_reference, bd.document_id, ' +
  "c.mrn as client_mrn, c.given_name || ' ' || c.family_name as client_name " +
  'from payment p join client c on c.id = p.client_id ' +
  'left join invoice i on i.id = p.invoice_id ' +
  'left join billing_document bd on bd.payment_id = p.id ';

const SQL =
  COLUMNS +
  'where p.tenant_id = app.current_tenant_id() ' +
  'order by p.received_at desc, p.id limit $1';

// The same rows as the book above, through the same joins and the same fence,
// narrowed. The order is the GET's to the letter — newest first, then by id —
// and the cursor resumes after the last row shown in that order. The two keys
// run in opposite directions, so the condition is written out rather than as
// one row comparison.
const SEARCH_SQL =
  COLUMNS +
  'where p.tenant_id = app.current_tenant_id() ' +
  "and ($1::text is null or p.receipt_reference ilike $1 escape '\\' " +
  "or i.reference ilike $1 escape '\\' " +
  "or c.mrn ilike $1 escape '\\' " +
  "or (c.given_name || ' ' || c.family_name) ilike $1 escape '\\') " +
  'and ($2::text[] is null or p.method::text = any($2)) ' +
  'and ($3::timestamptz is null or p.received_at < $3 ' +
  'or (p.received_at = $3 and p.id > $4::uuid)) ' +
  'order by p.received_at desc, p.id limit $5';

type ReceiptDbRow = {
  id: string;
  receipt_reference: string | null;
  method: 'cash' | 'transfer' | 'link';
  amount_fils: number;
  reference: string | null;
  received_on: string;
  received_key: string;
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
        receipts: page.map(toReceiptRow),
        ...(rows.length > PAGE_SIZE ? { truncated: true } : {}),
      }),
    );
  });

  /**
   * `POST /api/billing/payments/search` — the same book, searched, filtered
   * by method and paged past its first fifty rows.
   *
   * A POST with the words in the body for the invoice search's reason: what a
   * person types here is usually a family's name, and a query string is
   * written into every proxy's access log (.claude/rules/ui.md). It changes
   * nothing, so it asks for no reason, as the GET does not. The same audience,
   * the same fence, and one `list` audit row for each payment shown.
   */
  api.post('/api/billing/payments/search', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = PaymentSearchInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const { search, methods, before } = body.data;
    // The schema has already refused a cursor this file did not make, so this
    // reads it rather than judging it a second time.
    const cursor = before === undefined ? null : decodeReceiptCursor(before);

    const db = c.get('db');
    const { rows } = await db.query<ReceiptDbRow>(SEARCH_SQL, [
      search === undefined ? null : containsPattern(search),
      methods ?? null,
      cursor?.receivedAt ?? null,
      cursor?.id ?? null,
      PAGE_SIZE + 1,
    ]);
    const page = rows.slice(0, PAGE_SIZE);

    await logReads(
      db,
      'payment',
      page.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    const last = page[page.length - 1];
    return c.json(
      PaymentSearchResponse.parse({
        receipts: page.map(toReceiptRow),
        nextBefore:
          rows.length > PAGE_SIZE && last
            ? encodeReceiptCursor({ receivedAt: last.received_key, id: last.id })
            : null,
      }),
    );
  });
}

function toReceiptRow(row: ReceiptDbRow): ReceiptRow {
  return {
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
  };
}
