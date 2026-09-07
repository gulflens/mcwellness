import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateDocumentResponse } from '../../../app/api/billing/document-schema';
import type {
  PackagesResponse,
  RecordPaymentResponse,
  SellPackageResponse,
} from '../../../app/api/billing/ledger-schema';
import {
  invoiceDocument,
  practiceLogo,
  receiptDocument,
} from '../../../app/api/billing/document-source';
import { documentFonts } from '../../../app/api/billing/fonts';
import { renderDocument } from '../../../domain/billing/document';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * A THROWAWAY. Deleted before the last commit of this round: it writes files
 * outside the repository and exists only so a person can look at a rendered
 * page beside the operator's design.
 */

const OUT =
  '/private/tmp/claude-501/-Volumes-Storage-McWellness/25a98803-ac1e-426c-a865-7919fa0cbca3/scratchpad/samples-design';
const LOGO =
  '/private/tmp/claude-501/-Volumes-Storage-McWellness/25a98803-ac1e-426c-a865-7919fa0cbca3/scratchpad/design/brand/mcwellness-logo.png';

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  mkdirSync(OUT, { recursive: true });
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('the samples', () => {
  it('writes an invoice and a receipt through the real routes', async () => {
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
        "set_config('app.actor_roles', 'owner', false), " +
        "set_config('app.request_id', '00000000-0000-4000-8000-0000000000ee', false), " +
        "set_config('app.reason', '', false)",
      [h.data.tenant.id, h.data.users[SEEDED.owner]?.id ?? null],
    );
    await h.owner.query(
      'update tenant set contact_phone = $2, contact_email = $3, website = $4 where id = $1',
      [h.data.tenant.id, '+971 50 000 0011', 'studio@example.com', 'https://example.com'],
    );

    const filed = await h.call('POST', '/api/practice/logo', SEEDED.owner, {
      mimeType: 'image/png',
      bytesBase64: readFileSync(LOGO).toString('base64'),
    });
    expect(filed.status).toBe(200);

    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await list.json()) as PackagesResponse).packages.find(
      (each) => each.code === 'silver',
    );
    if (!silver) throw new Error('The seeded Silver programme is missing.');

    const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'percent', basisPoints: 500 },
        reason: 'Agreed with the family at the consultation.',
      },
    });
    expect(sold.status).toBe(201);
    const purchase = (await sold.json()) as SellPackageResponse;

    const paid = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(0),
      method: 'transfer' as const,
      amountFils: 500_000,
      invoiceId: purchase.purchase.invoiceId ?? undefined,
      reference: 'FT26090812345',
    });
    expect(paid.status).toBe(201);
    const payment = (await paid.json()) as RecordPaymentResponse;

    for (const body of [
      { invoiceId: purchase.purchase.invoiceId ?? '' },
      { paymentId: payment.payment.id },
    ]) {
      const res = await h.call('POST', '/api/billing/documents', SEEDED.owner, body);
      expect(res.status).toBe(201);
      const doc = (await res.json()) as CreateDocumentResponse;
      const { rows } = await h.owner.query<{ storage_key: string }>(
        'select storage_key from document where id = $1',
        [doc.document.id],
      );
      const bytes = await h.storage.get(rows[0]?.storage_key ?? '');
      if (!bytes) throw new Error('Nothing was filed.');
      writeFileSync(`${OUT}/${doc.document.kind}.pdf`, Buffer.from(bytes));
    }

    // And the same two under a registration, so both branches can be looked at.
    await h.owner.query('update tenant set vat_registered = true, vat_trn = $2 where id = $1', [
      h.data.tenant.id,
      '100000000000003',
    ]);
    const second = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(1),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'percent', basisPoints: 500 },
        reason: 'Agreed with the family at the consultation.',
      },
    });
    const registered = (await second.json()) as SellPackageResponse;
    const logo = await practiceLogo(h.owner, h.storage);
    const vatDoc = await invoiceDocument(h.owner, registered.purchase.invoiceId ?? '');
    if (vatDoc) {
      writeFileSync(
        `${OUT}/invoice-registered.pdf`,
        Buffer.from(renderDocument(vatDoc.document, documentFonts(), logo)),
      );
    }
    const noLogo = await invoiceDocument(h.owner, purchase.purchase.invoiceId ?? '');
    if (noLogo) {
      writeFileSync(
        `${OUT}/invoice-no-logo.pdf`,
        Buffer.from(renderDocument(noLogo.document, documentFonts(), null)),
      );
    }
    const receipt = await receiptDocument(h.owner, payment.payment.id);
    if (receipt) {
      writeFileSync(
        `${OUT}/receipt-no-logo.pdf`,
        Buffer.from(renderDocument(receipt.document, documentFonts(), null)),
      );
    }
  }, 120_000);
});
