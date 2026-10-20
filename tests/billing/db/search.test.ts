import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvoiceSearchResponse,
  InvoicesResponse,
  type InvoiceSearchInput,
} from '../../../app/api/billing/ledger-schema';
import {
  PaymentSearchResponse,
  ReceiptsResponse,
  type PaymentSearchInput,
} from '../../../app/api/billing/document-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * Searching the invoice and receipt books, and paging past their first fifty.
 *
 * Both searches are POSTs with the words in the body, because what a person
 * types into them is usually somebody's name and a query string is logged by
 * every proxy on the way (.claude/rules/ui.md). Everything else is the GET's:
 * the same audience, the same practice fence, one `list` audit row per row
 * shown and none for a row that matched but was not shown.
 *
 * The rows are written straight onto the tables as the practice's owner,
 * because fifty-odd sales through the routes would prove the sale route fifty
 * times and this file nothing more. A statement is the one invoice kind that
 * names no session and no purchase, so it is the one a fixture can write
 * without inventing either.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000f6';

const LEAD_PRACTITIONER_ID = '00000000-0000-4000-8000-0000000000e5';
const LEAD_PRACTITIONER_AUTH = '00000000-0000-4000-8000-0000000000e6';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000b0';
const OTHER_CLIENT = '00000000-0000-4000-8000-0000000000b3';

/** Fifty-two invoices for one client: a full page and two over. */
const PAGED_INVOICES = 52;
/** Fifty-three receipts a minute apart, and one more sharing a moment with one of them. */
const PAGED_RECEIPTS = 53;
const TIED_AT = 49;

let h: Harness;
let requestSeq = 0;

/** The owner's session stamped as a practice's owner, for writing fixtures. */
async function asPractice(tenantId: string): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance,lead_practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [tenantId, user?.id ?? null, REQUEST_ID],
  );
}

type Written = { id: string; number: number; reference: string };

/** A statement for a client, numbered from the practice's own gapless series. */
async function statement(tenantId: string, clientId: string): Promise<Written> {
  await asPractice(tenantId);
  const { rows } = await h.owner.query<Written>(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, 10000, 0, 10000) " +
      'returning id, number, reference',
    [tenantId, clientId, SEED_TODAY],
  );
  const row = rows[0];
  if (!row) throw new Error('The statement was not written.');
  return row;
}

let sessionSeq = 0;

/** A visit delivered, which writes a session invoice (404). */
async function deliverVisit(clientId: string): Promise<Written> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000d${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractice(h.data.tenant.id);
  await h.owner.query("select set_config('app.actor_roles', 'practitioner', false)");
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId('nf-session')],
  );
  const { rows } = await h.owner.query<Written>(
    'select id, number, reference from invoice where session_id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('That visit was not invoiced.');
  return row;
}

type Paid = { id: string; receipt_reference: string };

async function payment(
  tenantId: string,
  clientId: string,
  method: 'cash' | 'transfer' | 'link',
  receivedAt: string,
  invoiceId: string | null = null,
): Promise<Paid> {
  await asPractice(tenantId);
  const { rows } = await h.owner.query<Paid>(
    'insert into payment (tenant_id, client_id, method, amount_fils, received_at, invoice_id) ' +
      'values ($1, $2, $3, 5000, $4, $5) returning id, receipt_reference',
    [tenantId, clientId, method, receivedAt, invoiceId],
  );
  const row = rows[0];
  if (!row) throw new Error('The payment was not written.');
  return row;
}

/** A moment `minutes` before a fixed one, kept to the microsecond. */
function minutesBefore(minutes: number): string {
  const at = new Date(Date.UTC(2026, 8, 1, 10, 0, 0, 123) - minutes * 60_000);
  return `${at.toISOString().slice(0, 23)}456Z`;
}

/** A search, with a request id of its own so its audit rows can be counted. */
async function search(
  path: '/api/billing/invoices/search' | '/api/billing/payments/search',
  body: unknown,
  as: number | string = SEEDED.owner,
): Promise<{ res: Response; requestId: string }> {
  requestSeq += 1;
  const requestId = `00000000-0000-4000-8000-0000000007${String(requestSeq).padStart(2, '0')}`;
  const extra = { 'x-request-id': requestId };
  const res =
    typeof as === 'number'
      ? await h.call('POST', path, as, body, extra)
      : await h.callAs('POST', path, as, body, extra);
  return { res, requestId };
}

async function invoices(body: InvoiceSearchInput | Record<string, unknown>) {
  const { res, requestId } = await search('/api/billing/invoices/search', body);
  expect(res.status).toBe(200);
  return { book: InvoiceSearchResponse.parse(await res.json()), requestId };
}

async function receipts(body: PaymentSearchInput | Record<string, unknown>) {
  const { res, requestId } = await search('/api/billing/payments/search', body);
  expect(res.status).toBe(200);
  return { book: PaymentSearchResponse.parse(await res.json()), requestId };
}

async function auditedIds(requestId: string, entityType: string): Promise<string[]> {
  const { rows } = await h.owner.query<{ entity_id: string }>(
    "select entity_id from audit_log where request_id = $1 and action = 'list' " +
      'and entity_type = $2 order by entity_id',
    [requestId, entityType],
  );
  return rows.map((row) => row.entity_id);
}

const seeded = {
  /** One statement, and a namesake in another practice. */
  named: 0,
  /** The fifty-two statements the invoice book pages through. */
  paged: 1,
  /** A session invoice, a statement, and a transfer against the session invoice. */
  kinds: 2,
  /** The fifty-four receipts the receipt book pages through. */
  pagedReceipts: 3,
  /** A payment link. */
  link: 4,
  /** A household that asked to be erased, and its statement. */
  erased: 5,
};

let named: Written;
const pagedInvoices: Written[] = [];
let sessionInvoice: Written;
let kindsStatement: Written;
let otherPracticeInvoice: Written;
let erasedInvoice: Written;
let erasedPayment: Paid;
let transfer: Paid;
let linkPayment: Paid;
let namedPayment: Paid;
let otherPracticePayment: Paid;
const pagedPayments: Paid[] = [];

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  const tenant = h.data.tenant.id;

  named = await statement(tenant, h.clientId(seeded.named));
  for (let i = 0; i < PAGED_INVOICES; i += 1) {
    pagedInvoices.push(await statement(tenant, h.clientId(seeded.paged)));
  }
  sessionInvoice = await deliverVisit(h.clientId(seeded.kinds));
  kindsStatement = await statement(tenant, h.clientId(seeded.kinds));
  erasedInvoice = await statement(tenant, h.clientId(seeded.erased));
  // The erased household's payment is the book's oldest, out of the way of
  // every page the tests below count.
  erasedPayment = await payment(tenant, h.clientId(seeded.erased), 'cash', minutesBefore(600));

  transfer = await payment(
    tenant,
    h.clientId(seeded.kinds),
    'transfer',
    minutesBefore(-10),
    sessionInvoice.id,
  );
  linkPayment = await payment(tenant, h.clientId(seeded.link), 'link', minutesBefore(-20));
  namedPayment = await payment(tenant, h.clientId(seeded.named), 'cash', minutesBefore(-30));
  for (let i = 0; i < PAGED_RECEIPTS; i += 1) {
    pagedPayments.push(
      await payment(tenant, h.clientId(seeded.pagedReceipts), 'cash', minutesBefore(i)),
    );
  }
  // Two payments at the very same moment, landing on either side of the page
  // break: the order has to settle them by id, or the second page could repeat
  // one and lose the other.
  pagedPayments.push(
    await payment(tenant, h.clientId(seeded.pagedReceipts), 'cash', minutesBefore(TIED_AT)),
  );

  // A second practice, holding a household with the same name and the same
  // record number as one of this practice's, so a search that leaked across
  // the fence would have something to find.
  const namesake = h.data.clients[seeded.named];
  if (!namesake) throw new Error('No seeded client to copy.');
  await h.owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio B')", [
    OTHER_TENANT,
  ]);
  await asPractice(OTHER_TENANT);
  await h.owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name) values ($1, $2, $3, $4, $5)',
    [OTHER_CLIENT, OTHER_TENANT, namesake.mrn, namesake.givenName, namesake.familyName],
  );
  otherPracticeInvoice = await statement(OTHER_TENANT, OTHER_CLIENT);
  otherPracticePayment = await payment(OTHER_TENANT, OTHER_CLIENT, 'cash', minutesBefore(-40));

  // A lead practitioner and nothing else: the seed carries nobody who is only
  // that, and the invoice book is theirs to read (tests/billing/access.test.ts).
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ' +
      "($1, $2, $3, 'Synthetic Lead Practitioner')",
    [LEAD_PRACTITIONER_ID, tenant, LEAD_PRACTITIONER_AUTH],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'lead_practitioner')",
    [tenant, LEAD_PRACTITIONER_ID],
  );
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('searching the invoice book', () => {
  it('finds an invoice by its reference', async () => {
    const { book } = await invoices({ search: named.reference });
    expect(book.invoices.map((row) => row.id)).toEqual([named.id]);
    expect(book.nextBefore).toBeNull();
  });

  it("finds a client's invoices by their record number", async () => {
    const client = h.data.clients[seeded.kinds];
    const { book } = await invoices({ search: client?.mrn.toLowerCase() });
    expect(book.invoices.map((row) => row.id).sort()).toEqual(
      [sessionInvoice.id, kindsStatement.id].sort(),
    );
  });

  it('finds a client by part of their name as the book shows it, in any case', async () => {
    const client = h.data.clients[seeded.named];
    if (!client) throw new Error('No seeded client.');
    // Across the space between the two names, so it can only match the
    // name as written out whole, and in the wrong case on purpose.
    const typed = `${client.givenName.slice(1)} ${client.familyName.slice(0, 3)}`.toUpperCase();
    const { book } = await invoices({ search: typed });
    expect(book.invoices.map((row) => row.id)).toContain(named.id);
    for (const row of book.invoices) {
      expect(row.clientName.toUpperCase()).toContain(typed);
    }
  });

  it('never returns another practice’s invoice, even for its namesake', async () => {
    const client = h.data.clients[seeded.named];
    for (const text of [client?.mrn, client?.familyName, otherPracticeInvoice.reference]) {
      const { book } = await invoices({ search: text });
      expect(book.invoices.map((row) => row.id)).not.toContain(otherPracticeInvoice.id);
      expect(book.invoices.every((row) => row.clientId !== OTHER_CLIENT)).toBe(true);
    }
  });

  it('filters by kind', async () => {
    const { book } = await invoices({ kinds: ['session'] });
    expect(book.invoices.map((row) => row.id)).toEqual([sessionInvoice.id]);

    const both = await invoices({
      search: h.data.clients[seeded.kinds]?.mrn,
      kinds: ['session', 'statement'],
    });
    expect(both.book.invoices).toHaveLength(2);

    const none = await invoices({ kinds: ['package', 'call_out_fee'] });
    expect(none.book.invoices).toEqual([]);
  });

  it('treats a wildcard typed into the box as the character it is', async () => {
    for (const text of ['%', '_', 'INV_000001', 'MW%000001', '\\']) {
      const { book } = await invoices({ search: text });
      expect(book.invoices).toEqual([]);
      expect(book.nextBefore).toBeNull();
    }
  });

  it('pages past fifty, newest first, and says where to resume', async () => {
    const mrn = h.data.clients[seeded.paged]?.mrn;
    const first = await invoices({ search: mrn });
    expect(first.book.invoices).toHaveLength(50);
    const last = first.book.invoices[49];
    expect(first.book.nextBefore).toBe(last?.number);

    const second = await invoices({ search: mrn, before: first.book.nextBefore });
    expect(second.book.invoices).toHaveLength(PAGED_INVOICES - 50);
    expect(second.book.nextBefore).toBeNull();

    const numbers = [...first.book.invoices, ...second.book.invoices].map((row) => row.number);
    expect(numbers).toEqual([...pagedInvoices.map((row) => row.number)].sort((a, b) => b - a));
  });

  it('answers the first page of everything when the body is empty, as the GET does', async () => {
    const { book } = await invoices({});
    const get = await h.call('GET', '/api/billing/invoices', SEEDED.owner);
    const listed = InvoicesResponse.parse(await get.json());
    expect(book.invoices).toEqual(listed.invoices);
    expect(book.practiceVatRegistered).toBe(listed.practiceVatRegistered);
    expect(listed.truncated).toBe(true);
    expect(book.nextBefore).toBe(listed.invoices[49]?.number);
    expect(book).not.toHaveProperty('truncated');
  });

  it('records one list read for each invoice shown, and none for one that only matched', async () => {
    const mrn = h.data.clients[seeded.paged]?.mrn;
    const { book, requestId } = await invoices({ search: mrn });
    expect(await auditedIds(requestId, 'invoice')).toEqual(
      book.invoices.map((row) => row.id).sort(),
    );
    const { book: nothing, requestId: emptyRequest } = await invoices({ search: '%' });
    expect(nothing.invoices).toEqual([]);
    expect(await auditedIds(emptyRequest, 'invoice')).toEqual([]);
  });
});

describe('searching the receipt book', () => {
  it('finds a payment by its receipt number', async () => {
    const { book } = await receipts({ search: transfer.receipt_reference });
    expect(book.receipts.map((row) => row.id)).toEqual([transfer.id]);
    expect(book.nextBefore).toBeNull();
  });

  it('finds a payment by the invoice it settles', async () => {
    const { book } = await receipts({ search: sessionInvoice.reference.toLowerCase() });
    expect(book.receipts.map((row) => row.id)).toEqual([transfer.id]);
  });

  it("finds a client's payments by record number, and by part of their name", async () => {
    const client = h.data.clients[seeded.named];
    if (!client) throw new Error('No seeded client.');
    const byMrn = await receipts({ search: client.mrn });
    expect(byMrn.book.receipts.map((row) => row.id)).toEqual([namedPayment.id]);

    const typed = `${client.givenName.slice(1)} ${client.familyName.slice(0, 3)}`.toLowerCase();
    const byName = await receipts({ search: typed });
    expect(byName.book.receipts.map((row) => row.id)).toContain(namedPayment.id);
    for (const row of byName.book.receipts) {
      expect(row.clientName.toLowerCase()).toContain(typed);
    }
  });

  it('never returns another practice’s payment, even for its namesake', async () => {
    const client = h.data.clients[seeded.named];
    for (const text of [client?.mrn, client?.familyName, otherPracticePayment.receipt_reference]) {
      const { book } = await receipts({ search: text });
      expect(book.receipts.map((row) => row.id)).not.toContain(otherPracticePayment.id);
    }
  });

  it('filters by method', async () => {
    const link = await receipts({ methods: ['link'] });
    expect(link.book.receipts.map((row) => row.id)).toEqual([linkPayment.id]);
    const both = await receipts({ methods: ['link', 'transfer'] });
    expect(both.book.receipts.map((row) => row.id).sort()).toEqual(
      [linkPayment.id, transfer.id].sort(),
    );
  });

  it('treats a wildcard typed into the box as the character it is', async () => {
    for (const text of ['%', '_', 'RCP_000001', '\\']) {
      const { book } = await receipts({ search: text });
      expect(book.receipts).toEqual([]);
    }
  });

  it('pages past fifty in the order the GET uses, without repeating or losing a tied payment', async () => {
    const mrn = h.data.clients[seeded.pagedReceipts]?.mrn;
    const first = await receipts({ search: mrn });
    expect(first.book.receipts).toHaveLength(50);
    expect(first.book.nextBefore).not.toBeNull();

    const second = await receipts({ search: mrn, before: first.book.nextBefore });
    expect(second.book.receipts).toHaveLength(pagedPayments.length - 50);
    expect(second.book.nextBefore).toBeNull();

    const ids = [...first.book.receipts, ...second.book.receipts].map((row) => row.id);
    expect(new Set(ids).size).toBe(pagedPayments.length);
    expect([...ids].sort()).toEqual(pagedPayments.map((row) => row.id).sort());

    // The same order the database gives the GET: newest first, then by id.
    const { rows } = await h.owner.query<{ id: string }>(
      'select id from payment where client_id = $1 order by received_at desc, id',
      [h.clientId(seeded.pagedReceipts)],
    );
    expect(ids).toEqual(rows.map((row) => row.id));
  });

  it('answers the first page of everything when the body is empty, as the GET does', async () => {
    const { book } = await receipts({});
    const get = await h.call('GET', '/api/billing/payments', SEEDED.owner);
    const listed = ReceiptsResponse.parse(await get.json());
    expect(book.receipts).toEqual(listed.receipts);
    expect(listed.truncated).toBe(true);
    expect(book.nextBefore).not.toBeNull();
    expect(book).not.toHaveProperty('truncated');
  });

  it('records one list read for each payment shown', async () => {
    const mrn = h.data.clients[seeded.pagedReceipts]?.mrn;
    const first = await receipts({ search: mrn });
    expect(await auditedIds(first.requestId, 'payment')).toEqual(
      first.book.receipts.map((row) => row.id).sort(),
    );
    const second = await receipts({ search: mrn, before: first.book.nextBefore });
    expect(await auditedIds(second.requestId, 'payment')).toEqual(
      second.book.receipts.map((row) => row.id).sort(),
    );
  });
});

describe('who may search', () => {
  const routes = ['/api/billing/invoices/search', '/api/billing/payments/search'] as const;

  for (const path of routes) {
    it(`lets the owner, an admin and a lead practitioner search ${path}`, async () => {
      expect((await search(path, {}, SEEDED.owner)).res.status).toBe(200);
      expect((await search(path, {}, SEEDED.admin)).res.status).toBe(200);
      expect((await search(path, {}, LEAD_PRACTITIONER_AUTH)).res.status).toBe(200);
    });

    it(`refuses a practitioner at ${path}, and records no read`, async () => {
      const { res, requestId } = await search(path, {}, SEEDED.practitioner);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden' });
      const { rows } = await h.owner.query<{ n: number }>(
        'select count(*)::int as n from audit_log where request_id = $1',
        [requestId],
      );
      expect(rows[0]?.n).toBe(0);
    });
  }
});

describe('a body the searches cannot read', () => {
  const invoiceBodies: unknown[] = [
    { search: 5 },
    { search: 'a'.repeat(101) },
    { kinds: [] },
    { kinds: ['session', 'session'] },
    { kinds: ['refund'] },
    { before: 'INV-000001' },
    { before: 0 },
    { clientName: 'anyone' },
    [],
  ];
  const paymentBodies: unknown[] = [
    { methods: [] },
    { methods: ['card'] },
    { before: 'nonsense' },
    { before: 12 },
    { since: SEED_TODAY },
  ];

  it('is refused at the invoice book', async () => {
    for (const body of invoiceBodies) {
      const { res, requestId } = await search('/api/billing/invoices/search', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'bad_request',
        code: 'invalid_request',
        requestId,
      });
    }
  });

  it('is refused at the receipt book', async () => {
    for (const body of paymentBodies) {
      const { res, requestId } = await search('/api/billing/payments/search', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'bad_request',
        code: 'invalid_request',
        requestId,
      });
    }
  });

  it('is refused when it says JSON and carries none', async () => {
    for (const path of ['/api/billing/invoices/search', '/api/billing/payments/search']) {
      const res = await h.call('POST', path, SEEDED.owner, undefined, {
        'content-type': 'application/json',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'bad_request', code: 'invalid_request' });
    }
  });
});

describe('an erased household', () => {
  it('stays in the book as the GET shows it, and is no longer found by its old name', async () => {
    const client = h.data.clients[seeded.erased];
    if (!client) throw new Error('No seeded client.');
    const owner = h.data.users[SEEDED.owner];
    await asPractice(h.data.tenant.id);
    const { rows: requested } = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, created_by) ' +
        "values ($1, $2, 'The household asked.', $3) returning id",
      [h.data.tenant.id, client.id, owner?.id],
    );
    await h.owner.query("select set_config('app.reason', 'The household asked.', false)");
    await h.owner.query('select app.erase_client($1, $2)', [client.id, requested[0]?.id]);

    const byName = await invoices({ search: `${client.givenName} ${client.familyName}` });
    expect(byName.book.invoices.map((row) => row.id)).not.toContain(erasedInvoice.id);

    const byReference = await invoices({ search: erasedInvoice.reference });
    const get = await h.call('GET', '/api/billing/invoices', SEEDED.owner);
    const listed = InvoicesResponse.parse(await get.json());
    expect(byReference.book.invoices).toEqual(
      listed.invoices.filter((row) => row.id === erasedInvoice.id),
    );
    expect(byReference.book.invoices).toHaveLength(1);

    // The receipt book the same way: the payment stays, found by its receipt
    // number, and not by the name the household asked to have removed.
    const paidByName = await receipts({ search: `${client.givenName} ${client.familyName}` });
    expect(paidByName.book.receipts.map((row) => row.id)).not.toContain(erasedPayment.id);
    const paidByReference = await receipts({ search: erasedPayment.receipt_reference });
    expect(paidByReference.book.receipts.map((row) => row.id)).toEqual([erasedPayment.id]);
  });
});
