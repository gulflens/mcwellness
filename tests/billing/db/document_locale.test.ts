import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractAll } from '../../../domain/billing/document';
import { SEED_TODAY } from '../../../db/seed/generate';
import type { CreateDocumentResponse } from '../../../app/api/billing/document-schema';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * Migration 413: an invoice and a payment each carry the one language their
 * document is set in, fixed when they are written (the operator's decision of
 * 15 October 2026; docs/CHANGE-REQUESTS/docfix-03.md).
 *
 * New rows take the client's preferred language whoever writes them — here,
 * the visit trigger that invoices a delivered session (404) — and keep it;
 * a row written before the migration has none, and its document is drawn in
 * both languages, as it was filed.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fb';
let h: Harness;
let sessionSeq = 0;

async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

/** A visit delivered, which writes an invoice (404). */
async function deliverVisit(clientId: string): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000d${String(sessionSeq).padStart(3, '0')}`;
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, h.data.practitioners[0]?.id, h.serviceTypeId('nf-session')],
  );
  const { rows } = await h.owner.query<{ id: string }>(
    'select id from invoice where session_id = $1',
    [id],
  );
  const invoiceId = rows[0]?.id;
  if (!invoiceId) throw new Error('That visit was not invoiced.');
  return invoiceId;
}

async function localeOf(invoiceId: string): Promise<string | null> {
  const { rows } = await h.owner.query<{ locale: string | null }>(
    'select locale::text as locale from invoice where id = $1',
    [invoiceId],
  );
  return rows[0]?.locale ?? null;
}

async function preferring(clientIndex: number, locale: 'en' | 'ar'): Promise<void> {
  await h.owner.query('update client set preferred_locale = $2::locale where id = $1', [
    h.clientId(clientIndex),
    locale,
  ]);
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('the language an invoice is issued in', () => {
  it('is the client’s preferred language, set as the row is written', async () => {
    await preferring(3, 'ar');
    try {
      expect(await localeOf(await deliverVisit(h.clientId(3)))).toBe('ar');
    } finally {
      await preferring(3, 'en');
    }
    expect(await localeOf(await deliverVisit(h.clientId(3)))).toBe('en');
  });

  it('does not move when the client changes their language later', async () => {
    await preferring(4, 'ar');
    const invoiceId = await deliverVisit(h.clientId(4));
    await preferring(4, 'en');
    expect(await localeOf(invoiceId)).toBe('ar');
  });

  it('cannot be changed once the invoice exists', async () => {
    const invoiceId = await deliverVisit(h.clientId(5));
    await expect(
      h.owner.query("update invoice set locale = 'ar' where id = $1", [invoiceId]),
    ).rejects.toThrow(/fixed when it is issued/);
  });

  it('cannot be given to an invoice written before the migration, which has none', async () => {
    const invoiceId = await deliverVisit(h.clientId(5));
    // A row from before 413 is null; standing one in for it means writing the
    // null past the insert trigger, as the old rows simply have it.
    await h.owner.query('alter table invoice disable trigger guard_document_locale');
    await h.owner.query('update invoice set locale = null where id = $1', [invoiceId]);
    await h.owner.query('alter table invoice enable trigger guard_document_locale');
    await expect(
      h.owner.query("update invoice set locale = 'en' where id = $1", [invoiceId]),
    ).rejects.toThrow(/fixed when it is issued/);
  });
});

describe('the filed document', () => {
  it('is in Arabic alone for an invoice issued in Arabic', async () => {
    await preferring(6, 'ar');
    let invoiceId: string;
    try {
      invoiceId = await deliverVisit(h.clientId(6));
    } finally {
      await preferring(6, 'en');
    }
    const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, { invoiceId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateDocumentResponse;
    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [body.document.id],
    );
    const bytes = await h.storage.get?.(rows[0]?.storage_key ?? '');
    const page = extractAll(new Uint8Array(bytes ?? []));
    expect(page).not.toContain('Licence number');
    expect(page).not.toContain('TOTAL DUE');
    expect(page).toContain('INV-');
  });
});

/** Migration 980: an invoice copies the practice's own Arabic as it is written. */
describe('the practice’s Arabic on an invoice', () => {
  /** The practice's own details are an owner's to change; this is the test's maintenance, under no role. */
  const asNobody = () => h.owner.query("select set_config('app.actor_roles', '', false)");

  it('is copied from the practice when the invoice is written, and kept when the practice changes it', async () => {
    await asNobody();
    await h.owner.query(
      'update tenant set address_ar = $2, licensing_authority_ar = $3 where id = $1',
      [h.data.tenant.id, 'الوحدة 1، البرج التجريبي، دبي', 'دائرة الاقتصاد والسياحة التجريبية'],
    );
    const invoiceId = await deliverVisit(h.clientId(7));
    await asNobody();
    await h.owner.query(
      'update tenant set address_ar = null, licensing_authority_ar = null where id = $1',
      [h.data.tenant.id],
    );
    const { rows } = await h.owner.query<{
      supplier_address_ar: string | null;
      supplier_licensing_authority_ar: string | null;
    }>('select supplier_address_ar, supplier_licensing_authority_ar from invoice where id = $1', [
      invoiceId,
    ]);
    expect(rows[0]).toEqual({
      supplier_address_ar: 'الوحدة 1، البرج التجريبي، دبي',
      supplier_licensing_authority_ar: 'دائرة الاقتصاد والسياحة التجريبية',
    });
  });

  it('is empty on an invoice written while the practice had none', async () => {
    const invoiceId = await deliverVisit(h.clientId(7));
    const { rows } = await h.owner.query<{ supplier_address_ar: string | null }>(
      'select supplier_address_ar from invoice where id = $1',
      [invoiceId],
    );
    expect(rows[0]?.supplier_address_ar).toBeNull();
  });
});
