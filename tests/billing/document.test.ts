import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  extractAll,
  extractText,
  forDrawing,
  renderDocument,
  WORDS,
  type InvoiceDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';

/**
 * What a rendered invoice says, read back off the page.
 *
 * The text is extracted through the same `/ToUnicode` map a PDF viewer uses to
 * let a person select and copy it (`domain/billing/document/extract.ts`), so
 * these are assertions about the document a family actually receives, not about
 * the object that produced it.
 *
 * The absences matter as much as the presences. An unregistered practice's
 * invoice must not carry the words "Tax Invoice", a VAT registration number, a
 * rate or a VAT line, and each of those is asserted as *not* on the page rather
 * than left to a positive test that happens not to look for it.
 *
 * Every figure is synthetic and every person is from `db/seed/names.ts`
 * (.claude/rules/testing.md).
 */

const fonts = documentFonts();

/** The same string the page draws it as: shaped, and in right-to-left order. */
const asDrawn = (arabic: string): string => String.fromCodePoint(...forDrawing(arabic));

const UNREGISTERED: SupplierSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
  corporateTaxNumber: '000000000000000',
  vatRegistered: false,
  vatNumber: null,
};

const REGISTERED: SupplierSnapshot = {
  ...UNREGISTERED,
  vatRegistered: true,
  vatNumber: '100000000000003',
};

const RECIPIENT = { name: 'Robin Fairweather', recordNumber: 'MRN-0007' };

function invoiceFor(supplier: SupplierSnapshot): InvoiceDocument {
  const registered = supplier.vatRegistered === true;
  const rate = registered ? 500 : 0;
  const vat = registered ? 3_500 : 0;
  return {
    kind: 'invoice',
    supplier,
    recipient: RECIPIENT,
    reference: 'INV-000001',
    issuedOn: '2026-09-02',
    suppliedOn: null,
    lines: [
      {
        description: 'Neurofeedback session',
        descriptionAr: 'جلسة نيوروفيدباك',
        quantity: 1,
        unitNetFils: 70_000,
        netFils: 70_000,
        vatRateBasisPoints: rate,
        vatFils: vat,
        grossFils: 70_000 + vat,
      },
    ],
    netFils: 70_000,
    vatFils: vat,
    grossFils: 70_000 + vat,
  };
}

describe('an invoice from a practice that is not registered for VAT', () => {
  const page = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));

  it('is headed "Invoice", and never "Tax Invoice"', () => {
    expect(page).toContain('Invoice');
    expect(page).not.toContain('Tax Invoice');
    expect(page).toContain(asDrawn(WORDS.invoice.ar));
    expect(page).not.toContain(asDrawn(WORDS.taxInvoice.ar));
  });

  it('carries no VAT registration number, no rate and no VAT line', () => {
    expect(page).not.toContain('VAT registration number');
    expect(page).not.toContain('100000000000003');
    expect(page).not.toContain('5%');
    expect(page).not.toContain('VAT (AED)');
    expect(page).not.toContain('Net (AED)');
  });

  it('shows one amount, and it is the net price to the fils', () => {
    expect(page).toContain('Total (AED)');
    expect(page).toContain('700.00');
  });

  it('states plainly why there is no VAT on it, in both languages', () => {
    expect(page).toContain('The practice is not registered for VAT');
    expect(page).toContain(asDrawn('المنشأة غير مسجلة في ضريبة القيمة المضافة'));
  });

  it('names the corporate-tax registration as what it is', () => {
    // Never as a VAT number: tenant.trn and invoice.supplier_trn both carry a
    // column comment saying so, and printing it wrongly is the misstatement the
    // two columns exist to prevent.
    expect(page).toContain('Tax registration number');
    expect(page).toContain('000000000000000');
  });
});

describe('an invoice from a practice that is registered', () => {
  const page = extractAll(renderDocument(invoiceFor(REGISTERED), fonts));

  it('is headed "Tax Invoice", in both languages', () => {
    expect(page).toContain('Tax Invoice');
    expect(page).toContain(asDrawn(WORDS.taxInvoice.ar));
  });

  it('carries the VAT registration number, the rate and the VAT line', () => {
    expect(page).toContain('VAT registration number');
    expect(page).toContain('100000000000003');
    expect(page).toContain('5%');
    expect(page).toContain('Net (AED)');
    expect(page).toContain('VAT (AED)');
  });

  it('adds VAT on top of the net price, to the fils', () => {
    expect(page).toContain('700.00'); // net
    expect(page).toContain('35.00'); // VAT at five per cent
    expect(page).toContain('735.00'); // total
  });

  it('says on what basis it is issued to a household', () => {
    // A household is a private individual and not a registered person, so a
    // simplified tax invoice is what is due — which is also why no recipient
    // address is snapshotted (docs/CHANGE-REQUESTS/billing-04.md).
    expect(page).toContain('A simplified tax invoice');
  });
});

describe('every invoice, whatever the registration', () => {
  const page = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));

  it('carries the practice, its licence and its address', () => {
    expect(page).toContain('Synthetic Wellness Studio');
    expect(page).toContain(asDrawn('استوديو العافية التجريبي'));
    expect(page).toContain('Unit 1, Synthetic Tower, Dubai');
    expect(page).toContain('SYN-000000');
    expect(page).toContain('Synthetic Department of Economy and Tourism');
  });

  it('carries its sequential number, its date, and who it is for', () => {
    expect(page).toContain('INV-000001');
    expect(page).toContain('2 September 2026');
    expect(page).toContain('Robin Fairweather');
    expect(page).toContain('MRN-0007');
  });

  it("carries each line's description in both languages, with its quantity and unit price", () => {
    expect(page).toContain('Neurofeedback session');
    expect(page).toContain(asDrawn('جلسة نيوروفيدباك'));
    expect(page).toContain('Quantity');
    expect(page).toContain('Unit price (AED)');
  });

  it('sets both languages on the same page, side by side', () => {
    const lines = extractText(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(lines.some((line) => /[A-Za-z]/.test(line))).toBe(true);
    expect(lines.some((line) => /[\u0600-\u06FF\uFB50-\uFEFC]/.test(line))).toBe(true);
  });

  it('is the same bytes every time it is rendered from the same row', () => {
    // Nothing in the renderer reads a clock or a random source, which is what
    // lets the sha256 on the document row stay true and a failed upload be
    // retried with exactly the file that was promised.
    const first = renderDocument(invoiceFor(UNREGISTERED), fonts);
    const second = renderDocument(invoiceFor(UNREGISTERED), fonts);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('is a PDF a reader will open', () => {
    const bytes = renderDocument(invoiceFor(UNREGISTERED), fonts);
    expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.7');
    expect(Buffer.from(bytes).toString('latin1')).toContain('%%EOF');
  });
});

describe('the date of supply', () => {
  it('is shown only when it differs from the date of issue', () => {
    const same = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(same).not.toContain('Date of supply');

    const differs = extractAll(
      renderDocument({ ...invoiceFor(UNREGISTERED), suppliedOn: '2026-08-28' }, fonts),
    );
    expect(differs).toContain('Date of supply');
    expect(differs).toContain('28 August 2026');
  });
});

describe('a receipt', () => {
  const receipt: ReceiptDocument = {
    kind: 'receipt',
    supplier: UNREGISTERED,
    recipient: RECIPIENT,
    reference: 'RCP-000004',
    receivedOn: '2026-09-02',
    method: 'transfer',
    amountFils: 70_000,
    paymentReference: 'Bank transfer',
    settles: { reference: 'INV-000001', issuedOn: '2026-09-02' },
  };
  const page = extractAll(renderDocument(receipt, fonts));

  it('is headed "Receipt" and never "Invoice"', () => {
    expect(page).toContain('Receipt');
    expect(page).not.toContain('Tax Invoice');
    expect(page).toContain(asDrawn(WORDS.receipt.ar));
  });

  it('carries its own number, from its own book', () => {
    // RCP, not INV: a payment settles a tax invoice, it is not one, and the
    // Federal Tax Authority sequence stays a sequence of invoices
    // (405_billing_receipt.sql).
    expect(page).toContain('RCP-000004');
    expect(page).toContain('Receipt number');
  });

  it('says how the money arrived and which invoice it settles', () => {
    expect(page).toContain('Bank transfer');
    expect(page).toContain('Settles invoice');
    expect(page).toContain('INV-000001');
  });

  it('shows the amount received, to the fils', () => {
    expect(page).toContain('Amount received (AED)');
    expect(page).toContain('700.00');
  });
});
