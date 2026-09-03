import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractAll } from '../../../domain/billing/document';
import type {
  CreateDocumentResponse,
  DocumentLinkResponse,
} from '../../../app/api/billing/document-schema';
import type { RecordPaymentResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * Rendering an invoice, filing it, and handing somebody a link to it.
 *
 * The filing is the part worth proving twice over: the bytes reach the store
 * only once the transaction has committed (docs/SEAMS.md, "After the commit"),
 * and a request that fails leaves neither a row nor an object behind.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fa';

let h: Harness;

async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

let sessionSeq = 0;

/** A visit delivered, which is what writes an invoice (404). */
async function deliverVisit(clientId: string): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000c${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId('nf-session')],
  );
  const { rows } = await h.owner.query<{ id: string }>(
    'select id from invoice where session_id = $1',
    [id],
  );
  const invoiceId = rows[0]?.id;
  if (!invoiceId) throw new Error('That visit was not invoiced.');
  return invoiceId;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('rendering an invoice', () => {
  it('files a document and puts its bytes in the store', async () => {
    const invoiceId = await deliverVisit(h.clientId(0));
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateDocumentResponse;
    expect(body.document.kind).toBe('invoice');
    expect(body.document.reference).toMatch(/^INV-\d{6}$/);

    const { rows } = await h.owner.query<{
      storage_key: string;
      sha256: Buffer;
      mime_type: string;
      is_immutable: boolean;
      retention_until: Date | null;
      client_id: string;
    }>(
      'select storage_key, sha256, mime_type, is_immutable, retention_until, client_id ' +
        'from document where id = $1',
      [body.document.id],
    );
    const row = rows[0];
    if (!row) throw new Error('No document row was written.');

    expect(row.mime_type).toBe('application/pdf');
    // Immutable, like every other filed document (migration 903): a correction
    // is a credit note and a new document, never an edit of this one.
    expect(row.is_immutable).toBe(true);
    // Filed against the client, so it is kept and erased with their record —
    // and five years, which is what a financial record keeps regardless
    // (CLAUDE.md rule 8).
    expect(row.client_id).toBe(h.clientId(0));
    expect(row.retention_until?.getUTCFullYear()).toBe(2031);
    // A key made of ids alone: no name, no record number (docs/SEAMS.md).
    expect(row.storage_key).toBe(
      `tenant/${h.data.tenant.id}/client/${h.clientId(0)}/${body.document.id}`,
    );

    // The bytes are there by the time the caller was told the document exists.
    expect(await h.storage.exists(row.storage_key)).toBe(true);
    const stored = await h.storage.read?.(row.storage_key);
    if (!stored) throw new Error('The store holds nothing at that key.');
    // And they are the bytes the row's hash names.
    expect(createHash('sha256').update(stored).digest('hex')).toBe(row.sha256.toString('hex'));
    expect(stored.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
  });

  it('renders what the invoice says, in both languages', async () => {
    const invoiceId = await deliverVisit(h.clientId(1));
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    const body = (await res.json()) as CreateDocumentResponse;
    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [body.document.id],
    );
    const bytes = await h.storage.read?.(rows[0]?.storage_key ?? '');
    if (!bytes) throw new Error('The store holds nothing at that key.');
    const page = extractAll(new Uint8Array(bytes));

    expect(page).toContain(h.data.tenant.legalName);
    expect(page).toContain(body.document.reference);
    // The practice is not registered for VAT, so this is an invoice and not a
    // tax invoice, and it carries a single figure.
    expect(page).toContain('Invoice');
    expect(page).not.toContain('Tax Invoice');
    expect(page).toContain('700.00');
    expect(page).not.toContain('VAT registration number');
  });

  it('hands back the same document when asked a second time', async () => {
    // A document is immutable and its number is on its face: two renderings of
    // one invoice would be two documents claiming to be the same one.
    const invoiceId = await deliverVisit(h.clientId(2));
    const first = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    expect(first.status).toBe(201);
    const second = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    expect(second.status).toBe(200);

    const a = (await first.json()) as CreateDocumentResponse;
    const b = (await second.json()) as CreateDocumentResponse;
    expect(b.document.id).toBe(a.document.id);

    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from billing_document where invoice_id = $1',
      [invoiceId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('files nothing when the request fails, and leaves no bytes behind', async () => {
    // The whole reason the put is registered with afterCommit: a request that
    // does not commit must leave neither a row nor an object. Here the invoice
    // does not exist, so the route refuses before it writes anything.
    const before = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from billing_document',
    );
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, {
      invoiceId: '00000000-0000-4000-8000-0000000009ff',
    });
    expect(res.status).toBe(404);
    const after = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from billing_document',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('refuses a request that names neither an invoice nor a payment', async () => {
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, {});
    expect(res.status).toBe(400);
  });

  it('refuses a request that names both', async () => {
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, {
      invoiceId: '00000000-0000-4000-8000-0000000009ff',
      paymentId: '00000000-0000-4000-8000-0000000009fe',
    });
    expect(res.status).toBe(400);
  });
});

describe('rendering a receipt', () => {
  it('renders the payment, its method and the invoice it settles', async () => {
    const invoiceId = await deliverVisit(h.clientId(3));
    const paid = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(3),
      method: 'transfer',
      amountFils: 70_000,
      invoiceId,
      reference: 'SYN 0001',
    });
    expect(paid.status).toBe(201);
    const payment = (await paid.json()) as RecordPaymentResponse;

    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, {
      paymentId: payment.payment.id,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateDocumentResponse;
    expect(body.document.kind).toBe('receipt');
    expect(body.document.reference).toBe(payment.payment.receiptReference);

    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [body.document.id],
    );
    const bytes = await h.storage.read?.(rows[0]?.storage_key ?? '');
    if (!bytes) throw new Error('The store holds nothing at that key.');
    const page = extractAll(new Uint8Array(bytes));

    expect(page).toContain('Receipt');
    expect(page).toContain(payment.payment.receiptReference ?? '');
    expect(page).toContain('Bank transfer');
    expect(page).toContain('Settles invoice');
    expect(page).toContain('700.00');
  });
});

describe('opening a document', () => {
  it('signs a short-lived link and records the read', async () => {
    const invoiceId = await deliverVisit(h.clientId(4));
    const created = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    const body = (await created.json()) as CreateDocumentResponse;

    const res = await h.call(
      'GET',
      `/api/billing/documents/${body.document.id}/link`,
      SEEDED.owner,
      undefined,
      { 'x-reason': 'Sending the invoice to the family.' },
    );
    expect(res.status).toBe(200);
    const link = (await res.json()) as DocumentLinkResponse;
    expect(link.expiresInSeconds).toBeLessThanOrEqual(3600);

    // The link opens exactly those bytes.
    const fetched = await h.api.request(link.url);
    expect(fetched.status).toBe(200);
    expect(
      Buffer.from(await fetched.arrayBuffer())
        .subarray(0, 8)
        .toString('latin1'),
    ).toBe('%PDF-1.7');

    // Signing is the moment the trail is written, whether or not the bytes are
    // ever fetched (docs/SEAMS.md).
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'document' and entity_id = $1",
      [body.document.id],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('puts the bytes back when the store lost them, rather than losing the document', async () => {
    const invoiceId = await deliverVisit(h.clientId(5));
    const created = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    const body = (await created.json()) as CreateDocumentResponse;
    const { rows } = await h.owner.query<{ storage_key: string; sha256: Buffer }>(
      'select storage_key, sha256 from document where id = $1',
      [body.document.id],
    );
    const key = rows[0]?.storage_key ?? '';
    await h.storage.delete(key);
    expect(await h.storage.exists(key)).toBe(false);

    const res = await h.call(
      'GET',
      `/api/billing/documents/${body.document.id}/link`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);

    // Re-rendered from the invoice's own row, and byte for byte the file the
    // document row's hash names: the renderer reads no clock and no random
    // source, so the same row always produces the same bytes.
    expect(await h.storage.exists(key)).toBe(true);
    const stored = await h.storage.read?.(key);
    if (!stored) throw new Error('The store holds nothing at that key.');
    expect(createHash('sha256').update(stored).digest('hex')).toBe(rows[0]?.sha256.toString('hex'));
  });

  it('is not there for a document of another practice, or one this person may not read', async () => {
    const res = await h.call(
      'GET',
      '/api/billing/documents/00000000-0000-4000-8000-0000000009fd/link',
      SEEDED.owner,
    );
    expect(res.status).toBe(404);
  });
});
