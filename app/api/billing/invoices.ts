import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { logReads } from '../_middleware/audit';
import type { Db } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayReadInvoices } from './access';
import {
  InvoiceSearchInput,
  InvoiceSearchResponse,
  InvoicesResponse,
  type InvoiceKind,
  type InvoiceRow,
} from './ledger-schema';
import { containsPattern } from './search';

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
 *
 * `documentId` is the rendered PDF where one exists, so the screen can tell
 * "open it" from "make it" without a request per row.
 *
 * `waivedAt` is the day a call-out fee was forgiven, and null on every row
 * that stands. A waived charge keeps its number and its figures — the invoice
 * is append-only — and only stops counting in `app.billing_ledger`, so a book
 * that did not carry this would show a family's balance and a list of charges
 * that do not add up to it (migration 408).
 */

const PAGE_SIZE = 50;

const COLUMNS =
  'select i.id, i.reference, i.number, i.kind, i.issued_on, i.client_id, i.net_fils, ' +
  'i.vat_fils, i.gross_fils, bd.document_id, c.mrn as client_mrn, ' +
  // What was taken off the list figures across this invoice's lines. Summed
  // here rather than kept on the invoice: the line is where a discount is
  // given, and a second copy of the same figure is a second thing to keep
  // right (migration 409).
  '(select coalesce(sum(l.discount_fils), 0) from invoice_line l ' +
  '  where l.tenant_id = i.tenant_id and l.invoice_id = i.id)::int as discount_fils, ' +
  // The day a call-out fee was forgiven, in the practice's own time zone. The
  // row keeps its number and its figures, and `app.billing_ledger` stops
  // counting it (migration 408), so the book has to say which of its rows a
  // family still owes.
  "to_char(i.waived_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as waived_on, " +
  "c.given_name || ' ' || c.family_name as client_name " +
  'from invoice i join client c on c.id = i.client_id ' +
  // The rendered PDF, when one has been filed. It hangs off billing_document
  // rather than invoice.document_id, because an invoice grants no update and
  // that column can never be filled in (407_billing_rendered_document.sql).
  'left join billing_document bd on bd.invoice_id = i.id ';

const SQL =
  COLUMNS +
  'where i.tenant_id = app.current_tenant_id() ' +
  'and ($1::uuid is null or i.client_id = $1) ' +
  // One row past the page, so the route can say "there are more" without a
  // second count-only query.
  'order by i.number desc limit $2';

// The search reads exactly the rows the book above reads, through the same
// joins and the same practice fence, and narrows them. An erased household is
// treated as the book treats it: its invoices stay, because tax law keeps
// them, under whatever the erasure left in the name and record number — so it
// is found by its reference and no longer by the name it had.
const SEARCH_SQL =
  COLUMNS +
  'where i.tenant_id = app.current_tenant_id() ' +
  // The name as the book shows it, given and family together, so a search
  // typed across the space between them still finds it (the client list's
  // lesson, docs/CHANGE-REQUESTS/qa-01.md item 4).
  "and ($1::text is null or i.reference ilike $1 escape '\\' " +
  "or c.mrn ilike $1 escape '\\' " +
  "or (c.given_name || ' ' || c.family_name) ilike $1 escape '\\') " +
  'and ($2::text[] is null or i.kind::text = any($2)) ' +
  // Invoice numbers are gapless and never reused within a practice, so the
  // last number shown is the whole of where the next page begins.
  'and ($3::int is null or i.number < $3) ' +
  'order by i.number desc limit $4';

type InvoiceDbRow = {
  id: string;
  reference: string;
  number: number;
  kind: InvoiceKind;
  issued_on: string;
  client_id: string;
  client_mrn: string;
  client_name: string;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  discount_fils: number;
  waived_on: string | null;
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
    if (clientId !== null && !isUuid(clientId)) {
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
        practiceVatRegistered: await practiceVatRegistered(db),
        invoices: page.map(toInvoiceRow),
        ...(rows.length > PAGE_SIZE ? { truncated: true } : {}),
      }),
    );
  });

  /**
   * `POST /api/billing/invoices/search` — the same book, searched, filtered
   * by kind and paged past its first fifty rows.
   *
   * A POST with the words in the body, because what a person types here is
   * usually a family's name, and a query string is written into the access
   * log of every proxy it passes (.claude/rules/ui.md). It changes nothing,
   * so it asks for no reason, exactly as the GET does not.
   *
   * Everything else is the GET's: the same audience, the same fence, and one
   * `list` audit row for each invoice shown — never one for an invoice that
   * matched and sat beyond the page.
   */
  api.post('/api/billing/invoices/search', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = InvoiceSearchInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const { search, kinds, before } = body.data;

    const db = c.get('db');
    const { rows } = await db.query<InvoiceDbRow>(SEARCH_SQL, [
      search === undefined ? null : containsPattern(search),
      kinds ?? null,
      before ?? null,
      PAGE_SIZE + 1,
    ]);
    const page = rows.slice(0, PAGE_SIZE);

    await logReads(
      db,
      'invoice',
      page.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    const last = page[page.length - 1];
    return c.json(
      InvoiceSearchResponse.parse({
        practiceVatRegistered: await practiceVatRegistered(db),
        invoices: page.map(toInvoiceRow),
        nextBefore: rows.length > PAGE_SIZE && last ? last.number : null,
      }),
    );
  });
}

/**
 * Whether the practice charges VAT at all, so the screen can say so in a
 * sentence rather than leaving a reader to notice a column of zeroes. Read
 * live, because it describes the practice now — the invoices in the book each
 * carry their own snapshot of what was true when they were issued.
 */
async function practiceVatRegistered(db: Db): Promise<boolean> {
  const registered = await db.query<{ registered: boolean }>(
    'select app.tenant_charges_vat(app.current_tenant_id()) as registered',
  );
  return registered.rows[0]?.registered === true;
}

function toInvoiceRow(row: InvoiceDbRow): InvoiceRow {
  return {
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
    discountFils: row.discount_fils,
    waivedAt: row.waived_on,
    documentId: row.document_id,
  };
}
