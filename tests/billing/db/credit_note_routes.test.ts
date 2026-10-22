import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreditQuoteResponse,
  InvoicesResponse,
  type BalanceResponse,
  type PackagesResponse,
} from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The credit-note routes: the quote and the issue, over HTTP, as the
 * request-context middleware runs them (one transaction, `app_role`, the
 * actor's roles stamped). The rules themselves are tested in
 * credit_note_issue.test.ts and domain/billing/creditNote.test.ts; this file is
 * about the doors: who may knock, what each answers, and that the quote and
 * the note agree.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const REASON = 'Invoiced to the wrong household by mistake.';

let h: Harness;
let keySeq = 0;

function nextKey(): string {
  keySeq += 1;
  return `0000000d-0000-4000-8000-${String(keySeq).padStart(12, '0')}`;
}

type Note = { creditNote: { id: string; reference: string; grossFils: number; issuedOn: string } };

function issue(invoiceId: string, body: Record<string, unknown>, user: number = SEEDED.owner) {
  return h.call('POST', `/api/billing/invoices/${invoiceId}/credit-note`, user, body);
}

async function sellSession(clientIndex: number): Promise<string> {
  const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
    clientId: h.clientId(clientIndex),
    serviceTypeId: h.serviceTypeId('nf-session'),
    purchasedOn: SEED_TODAY,
  });
  if (res.status !== 201) throw new Error(`The session could not be sold: ${res.status}`);
  return ((await res.json()) as { invoiceId: string }).invoiceId;
}

async function sellPackage(clientIndex: number): Promise<string> {
  const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const found = ((await list.json()) as PackagesResponse).packages.find(
    (p) => p.code === SILVER_CODE,
  );
  const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: found?.id,
    clientId: h.clientId(clientIndex),
    purchasedOn: SEED_TODAY,
  });
  if (sold.status !== 201) throw new Error(`The package could not be sold: ${sold.status}`);
  return String(((await sold.json()) as { purchase: { invoiceId: string } }).purchase.invoiceId);
}

async function statementInvoice(clientIndex: number): Promise<string> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c9', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, 10000, 0, 10000) " +
      'returning id',
    [h.data.tenant.id, h.clientId(clientIndex), SEED_TODAY],
  );
  return String(rows[0]?.id);
}

async function seriesNext(): Promise<number> {
  const { rows } = await h.owner.query<{ n: number }>(
    'select coalesce(max(number), 0)::int as n from credit_note where tenant_id = $1',
    [h.data.tenant.id],
  );
  return Number(rows[0]?.n);
}

async function outstanding(clientIndex: number): Promise<BalanceResponse> {
  const res = await h.call(
    'GET',
    `/api/billing/clients/${h.clientId(clientIndex)}/balance`,
    SEEDED.owner,
  );
  return (await res.json()) as BalanceResponse;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  const silver = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
  );
  if (silver.status !== 201) throw new Error('Silver could not be created.');
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('POST /api/billing/invoices/:id/credit-note', () => {
  it('issues a note for the owner and answers 201 with a CN reference', async () => {
    const invoiceId = await sellSession(0);
    const res = await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Note;
    expect(body.creditNote.reference).toMatch(/^CN-\d{6}$/);
    expect(body.creditNote.grossFils).toBeGreaterThan(0);
    expect(body.creditNote.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('answers a retry of the same key with the same note, and the series moves by one', async () => {
    const invoiceId = await sellSession(1);
    const key = nextKey();
    const before = await seriesNext();
    const first = (await (
      await issue(invoiceId, { reason: REASON, idempotencyKey: key })
    ).json()) as Note;
    const retry = await issue(invoiceId, { reason: REASON, idempotencyKey: key });
    expect(retry.status).toBe(201);
    const again = (await retry.json()) as Note;
    expect(again.creditNote).toEqual(first.creditNote);
    expect(await seriesNext()).toBe(before + 1);
  });

  it('refuses a key already used for another invoice with a 400', async () => {
    const a = await sellSession(2);
    const b = await sellSession(3);
    const key = nextKey();
    expect((await issue(a, { reason: REASON, idempotencyKey: key })).status).toBe(201);
    expect((await issue(b, { reason: REASON, idempotencyKey: key })).status).toBe(400);
  });

  it('refuses a reason of seven characters with a 400', async () => {
    const invoiceId = await sellSession(4);
    const res = await issue(invoiceId, { reason: 'Too sho', idempotencyKey: nextKey() });
    expect(res.status).toBe(400);
  });

  it('refuses a practitioner with a 403', async () => {
    const invoiceId = await sellSession(5);
    const res = await issue(
      invoiceId,
      { reason: REASON, idempotencyKey: nextKey() },
      SEEDED.practitioner,
    );
    expect(res.status).toBe(403);
  });

  it('answers a statement invoice with a 409 naming the refusal, and leaves the request usable', async () => {
    const invoiceId = await statementInvoice(6);
    const res = await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; refusal: string };
    expect(body.error).toBe('credit_note_refused');
    expect(body.refusal).toBe('statement');
  });

  it('answers a second note on the same invoice with a 409 already_credited', async () => {
    const invoiceId = await sellSession(7);
    expect((await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() })).status).toBe(
      201,
    );
    const res = await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refusal: string }).refusal).toBe('already_credited');
  });

  it('answers an unknown invoice with a 404 and a malformed id with a 400', async () => {
    const unknown = '0000000e-0000-4000-8000-000000000001';
    expect((await issue(unknown, { reason: REASON, idempotencyKey: nextKey() })).status).toBe(404);
    expect((await issue('not-a-uuid', { reason: REASON, idempotencyKey: nextKey() })).status).toBe(
      400,
    );
  });
});

describe('GET /api/billing/invoices/:id/credit-quote', () => {
  it('quotes exactly what the note then writes', async () => {
    const invoiceId = await sellPackage(8);
    const quoted = await h.call(
      'GET',
      `/api/billing/invoices/${invoiceId}/credit-quote`,
      SEEDED.owner,
    );
    expect(quoted.status).toBe(200);
    const quote = CreditQuoteResponse.parse(await quoted.json());
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.plan.unusedCredits).toBeGreaterThan(0);
    expect(quote.plan.usedCredits).toBe(0);

    const res = await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() });
    expect(res.status).toBe(201);
    const { creditNote } = (await res.json()) as Note;
    expect(creditNote.grossFils).toBe(quote.plan.grossFils);
    const row = await h.owner.query<{
      net_fils: number;
      vat_fils: number;
      released_net_fils: number;
    }>('select net_fils, vat_fils, released_net_fils from credit_note where id = $1', [
      creditNote.id,
    ]);
    expect(row.rows[0]).toEqual({
      net_fils: quote.plan.netFils,
      vat_fils: quote.plan.vatFils,
      released_net_fils: quote.plan.releasedNetFils,
    });
  });

  it('says why when nothing may be credited', async () => {
    const invoiceId = await statementInvoice(9);
    const res = await h.call(
      'GET',
      `/api/billing/invoices/${invoiceId}/credit-quote`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, refusal: 'statement' });
  });

  it('is refused to a practitioner', async () => {
    const invoiceId = await sellSession(10);
    const res = await h.call(
      'GET',
      `/api/billing/invoices/${invoiceId}/credit-quote`,
      SEEDED.practitioner,
    );
    expect(res.status).toBe(403);
  });

  it('writes a read row to the audit trail', async () => {
    const invoiceId = await sellSession(11);
    await h.call('GET', `/api/billing/invoices/${invoiceId}/credit-quote`, SEEDED.owner);
    const { rows } = await h.owner.query(
      "select 1 from audit_log where action = 'read' and entity_type = 'invoice' and entity_id = $1",
      [invoiceId],
    );
    expect(rows.length).toBe(1);
  });
});

describe('what a note changes elsewhere', () => {
  it('shows the note on the invoice search', async () => {
    const invoiceId = await sellSession(12);
    const { creditNote } = (await (
      await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() })
    ).json()) as Note;
    const res = await h.call('POST', '/api/billing/invoices/search', SEEDED.owner, {});
    const book = InvoicesResponse.parse(await res.json());
    const row = book.invoices.find((invoice) => invoice.id === invoiceId);
    expect(row?.creditNoteReference).toBe(creditNote.reference);
    const other = book.invoices.find((invoice) => invoice.creditNoteReference === null);
    expect(other).toBeDefined();
  });

  it('lowers what is owed and lists the credit on the balance route', async () => {
    const invoiceId = await sellSession(13);
    const before = await outstanding(13);
    const { creditNote } = (await (
      await issue(invoiceId, { reason: REASON, idempotencyKey: nextKey() })
    ).json()) as Note;
    const after = await outstanding(13);
    expect(after.creditedFils).toBe(creditNote.grossFils);
    expect(after.chargedFils).toBe(before.chargedFils);
    expect(after.outstandingFils).toBe(before.outstandingFils - creditNote.grossFils);

    const stop = await h.call(
      'GET',
      `/api/billing/clients/${h.clientId(13)}/stop-balance`,
      SEEDED.owner,
    );
    expect(((await stop.json()) as { outstandingFils: number }).outstandingFils).toBe(
      after.outstandingFils,
    );
  });
});
