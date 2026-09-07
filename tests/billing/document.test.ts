import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  discountLine,
  extractAll,
  extractText,
  NOT_REGISTERED_BASIS,
  renderDocument,
  toVisualOrder,
  waivedNotice,
  WORDS,
  type InvoiceDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';

/**
 * What a rendered invoice says, read back off the page.
 *
 * The text is extracted through the same `/ToUnicode` map a PDF viewer uses to
 * let a person select and copy it (`domain/shared/document/extract.ts`), so
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

/**
 * The same string as a person copying it off the page gets it: the letters
 * themselves, in the order the glyphs are drawn, which for a right-to-left run
 * is the reverse of the order it is read in. Not the presentation forms the
 * page draws — the writer's `/ToUnicode` map hands a reader the letters
 * (`domain/shared/document/pdf.test.ts`).
 */
const asCopied = (arabic: string): string =>
  String.fromCodePoint(...toVisualOrder([...arabic].map((c) => c.codePointAt(0) ?? 0)));

const UNREGISTERED: SupplierSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
  corporateTaxNumber: '000000000000000',
  vatRegistered: false,
  vatNumber: null,
  contactPhone: '+971 50 000 0011',
  contactEmail: 'studio@example.com',
  website: 'https://example.com',
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
    waivedOn: null,
    lines: [
      {
        description: 'Neurofeedback session',
        descriptionAr: 'جلسة نيوروفيدباك',
        quantity: 1,
        unitNetFils: 70_000,
        discountFils: 0,
        discountBasisPoints: null,
        netFils: 70_000,
        vatRateBasisPoints: rate,
        vatFils: vat,
        grossFils: 70_000 + vat,
      },
    ],
    discountFils: 0,
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
    expect(page).toContain(asCopied(WORDS.invoice.ar));
    expect(page).not.toContain(asCopied(WORDS.taxInvoice.ar));
  });

  it('carries no VAT registration number, no rate and no VAT line', () => {
    expect(page).not.toContain('VAT registration number');
    expect(page).not.toContain('100000000000003');
    expect(page).not.toContain('5%');
    expect(page).not.toContain('VAT rate');
    // Neither of the two columns a registration adds. The English heading is
    // the bare word "VAT", which the basis sentence beneath the table uses
    // too, so it is the Arabic heading — `الضريبة`, and no other string on
    // this page — that proves the column itself absent.
    expect(page).not.toContain(asCopied(WORDS.vatColumn.ar));
    // The totals box holds one row, so neither of the two a registration adds
    // is on the page at all.
    expect(page).not.toContain('Net');
    expect(page).not.toContain(asCopied(WORDS.net.ar));
  });

  it('shows one amount, and it is the net price to the fils', () => {
    expect(page).toContain('Total');
    // The currency is in the cell now, following the operator's design
    // (docs/SPEC/billing.md section 5.6), so a reader outside the practice
    // never has to look at a column heading to know what a figure is in.
    expect(page).toContain('AED 700.00');
  });

  it('states plainly why there is no VAT on it, in both languages', () => {
    expect(page).toContain('The practice is not registered for VAT');
    expect(page).toContain(asCopied('المنشأة غير مسجلة في ضريبة القيمة المضافة'));
  });

  it('names the corporate-tax registration at length, never as a tax registration number', () => {
    // "Tax registration number" is the exact phrase the Federal Tax Authority
    // uses for a VAT TRN, so the corporate-tax number under that label claims a
    // registration the practice does not hold — the misstatement tenant.trn and
    // invoice.supplier_trn carry column comments to prevent.
    expect(page).toContain('Corporate tax registration number');
    expect(page).toContain('000000000000000');
    expect(page).not.toContain('VAT registration number');
  });
});

describe('an invoice from a practice that is registered', () => {
  const page = extractAll(renderDocument(invoiceFor(REGISTERED), fonts));

  it('is headed "Tax Invoice", in both languages', () => {
    expect(page).toContain('Tax Invoice');
    expect(page).toContain(asCopied(WORDS.taxInvoice.ar));
  });

  it('carries the VAT registration number, the rate and the VAT line', () => {
    expect(page).toContain('VAT registration number');
    expect(page).toContain('100000000000003');
    expect(page).toContain('5%');
    expect(page).toContain('VAT rate');
    expect(page).toContain('Net');
  });

  it('adds VAT on top of the net price, to the fils', () => {
    expect(page).toContain('AED 700.00'); // net
    expect(page).toContain('AED 35.00'); // VAT at five per cent
    expect(page).toContain('AED 735.00'); // total
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
    expect(page).toContain(asCopied('استوديو العافية التجريبي'));
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
    expect(page).toContain(asCopied('جلسة نيوروفيدباك'));
    expect(page).toContain('Quantity');
    // The headings lost their "(AED)" when every figure gained its own.
    expect(page).toContain('Unit price');
    expect(page).not.toContain('Unit price (AED)');
  });

  it('names who it is for, and how to reach the practice', () => {
    // The design's own two blocks: "Billed to" against the right margin above
    // the household's name, and the practice's contact details in the band at
    // the foot of the page.
    expect(page).toContain('Billed to');
    expect(page).toContain('P: +971 50 000 0011');
    expect(page).toContain('E: studio@example.com');
    expect(page).toContain('W: https://example.com');
  });

  it('leaves the footer band a line shorter when the practice has recorded nothing', () => {
    const bare = extractAll(
      renderDocument(
        invoiceFor({
          ...UNREGISTERED,
          contactPhone: null,
          contactEmail: null,
          website: null,
        }),
        fonts,
      ),
    );
    // The legal name still sits under the hairline at the foot of the page; the
    // second line is simply not there rather than being a row of empty labels.
    expect(bare).toContain('Synthetic Wellness Studio');
    expect(bare).not.toContain('P: ');
    expect(bare).not.toContain('E: ');
    expect(bare).not.toContain('W: ');
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
    expect(same).toContain('Issued 2 September 2026');
    expect(same).not.toContain('Date of supply');

    const differs = extractAll(
      renderDocument({ ...invoiceFor(UNREGISTERED), suppliedOn: '2026-08-28' }, fonts),
    );
    expect(differs).toContain('Date of supply');
    expect(differs).toContain('28 August 2026');
  });
});

describe('a call-out fee the practice forgave', () => {
  it('says so on the page, in both languages, and says nothing is owed', () => {
    // The invoice is append-only: a waived fee keeps its number, its line and
    // its figures, and `app.billing_ledger` simply stops counting it
    // (migration 408). So the document has to say what the ledger knows, or a
    // family reading it is being billed for money it does not owe (compliance
    // review of this pull request).
    const waived = extractAll(
      renderDocument({ ...invoiceFor(UNREGISTERED), waivedOn: '2026-09-06' }, fonts),
    );
    const words = waivedNotice('2026-09-06');
    expect(words.en).toBe('Waived on 6 September 2026. Nothing is owed.');
    expect(waived).toContain(words.en);
    // The Arabic in two fragments rather than one sentence, the way the
    // registration basis is asserted above: the shaper sets a space either
    // side of a Western-digit run, so the whole sentence is not a substring of
    // the page even when every word of it is on it.
    expect(waived).toContain(asCopied('أُعفي هذا المبلغ بتاريخ'));
    expect(waived).toContain(asCopied('لا يوجد مبلغ مستحق'));
    expect(words.ar).toContain('6 سبتمبر 2026');
    // And the basis the page already carried is still on it: forgiving a
    // charge says nothing about the practice's registration.
    expect(waived).toContain(NOT_REGISTERED_BASIS.en);
  });

  it('is silent on an invoice that stands', () => {
    const standing = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(standing).not.toContain('Waived');
    expect(standing).not.toContain('Nothing is owed');
  });
});

function receiptFor(supplier: SupplierSnapshot): ReceiptDocument {
  return {
    kind: 'receipt',
    supplier,
    recipient: RECIPIENT,
    reference: 'RCP-000004',
    receivedOn: '2026-09-02',
    method: 'transfer',
    amountFils: 70_000,
    paymentReference: 'SYN 0001',
    settles: { reference: 'INV-000001', issuedOn: '2026-09-02' },
  };
}

describe('a receipt makes no tax statement, whoever issued it', () => {
  it('never calls itself a tax invoice, even from a registered practice', () => {
    // It carried the simplified-tax-invoice basis until the compliance review
    // caught it, which had a registered practice's receipt describing itself as
    // a document it is not, two hundred points under a heading saying "Receipt".
    const page = extractAll(renderDocument(receiptFor(REGISTERED), fonts));
    expect(page).not.toContain('simplified tax invoice');
    expect(page).not.toContain('Tax Invoice');
    expect(page).toContain('Receipt');
  });

  it('says what the money was: the method, the day and what it settles', () => {
    const page = extractAll(renderDocument(receiptFor(REGISTERED), fonts));
    expect(page).toContain(
      'Received by bank transfer on 2 September 2026, against invoice INV-000001.',
    );
    expect(page).toContain('This is a receipt for money received, not a tax invoice.');
  });

  it('says it was taken on account when it settles no invoice', () => {
    const page = extractAll(renderDocument({ ...receiptFor(UNREGISTERED), settles: null }, fonts));
    expect(page).toContain('Received by bank transfer on 2 September 2026, on account.');
  });

  it('makes no claim about VAT in either direction', () => {
    // A receipt acknowledges money that arrived. What tax was charged is a fact
    // about the invoice it settles, not about the act of paying.
    const registered = extractAll(renderDocument(receiptFor(REGISTERED), fonts));
    const unregistered = extractAll(renderDocument(receiptFor(UNREGISTERED), fonts));
    for (const page of [registered, unregistered]) {
      expect(page).not.toContain('not registered for VAT');
      expect(page).not.toContain('VAT rate');
      expect(page).not.toContain('Net');
    }
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
    expect(page).toContain(asCopied(WORDS.receipt.ar));
  });

  it('carries its own number, from its own book', () => {
    // RCP, not INV: a payment settles a tax invoice, it is not one, and the
    // Federal Tax Authority sequence stays a sequence of invoices
    // (405_billing_receipt.sql). The design sets it large and in violet with
    // no label, where an invoice sets its own.
    expect(page).toContain('RCP-000004');
    expect(page).toContain('Date received 2 September 2026');
  });

  it('says who the money came from, and not who it is billed to', () => {
    expect(page).toContain('Received from');
    expect(page).not.toContain('Billed to');
    expect(page).toContain('Robin Fairweather');
  });

  it('says how the money arrived and which invoice it settles', () => {
    expect(page).toContain('Bank transfer');
    expect(page).toContain('Settles invoice');
    expect(page).toContain('INV-000001');
  });

  it('shows the amount received, to the fils', () => {
    expect(page).toContain('Received');
    expect(page).toContain('AED 700.00');
  });
});

/**
 * The rendered bytes themselves, pinned.
 *
 * The test above proves the writer is deterministic — the same row rendered
 * twice is the same file — but determinism says nothing about *which* file, so
 * a refactor that quietly moved a byte would pass it. These three hashes are
 * the missing half: they say that the invoice, the registered invoice and the
 * receipt are the documents they were when this was written, so any change to
 * the writer has to declare itself here.
 *
 * **When one of these fails.** It is a fact to explain, not a number to
 * refresh. If the change was deliberate, move the golden in the same commit
 * that made it and say in the message what moved and why. If it was not, the
 * writer changed a document nobody meant to change.
 *
 * These depend on the version of the font package the faces are read from
 * (`app/api/billing/fonts.ts` embeds the programs verbatim), so upgrading it
 * moves all three at once — which is itself worth seeing rather than not.
 *
 * **All three moved on 8 September 2026**, when the practice's own design
 * replaced the layout these documents had carried since round 20
 * (docs/SPEC/billing.md section 5.6). That is the largest change any of them
 * has had and it is exactly the sort this pinning exists to make somebody
 * declare.
 *
 * They are rendered with no logo, deliberately: the mark is the practice's own
 * row and not a file in this repository, so a golden that embedded one would
 * be a golden about a picture rather than about the writer.
 */
describe('the bytes of a rendered document', () => {
  const sha256 = (bytes: Uint8Array): string =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');

  const GOLDEN: ReadonlyArray<readonly [string, () => Uint8Array, string]> = [
    [
      'an invoice from an unregistered practice',
      () => renderDocument(invoiceFor(UNREGISTERED), fonts),
      '0eec4cde068c99d28b3d92108b12e826f8a19c5cd402ab95a85b4996d488951c',
    ],
    [
      'an invoice from a registered practice',
      () => renderDocument(invoiceFor(REGISTERED), fonts),
      '16d6281eec2122ec742c93350bb877da767f0288cfd73c14c3d732911d65ee7e',
    ],
    [
      'a receipt',
      () => renderDocument(receiptFor(UNREGISTERED), fonts),
      'b396c5dfd1a6e149d8adf452ccd8500f04984170122670226c32a5962059c0ea',
    ],
  ];

  it.each(GOLDEN)('%s renders to the bytes it always has', (_name, render, golden) => {
    expect(sha256(render())).toBe(golden);
  });
});

/**
 * A discount on the page (docs/SPEC/billing.md section 2.4). The Federal Tax
 * Authority asks a full tax invoice to state "the amount of any discount
 * offered"; a simplified one need not, and this one does anyway, because a
 * family reading a figure below the list price should be able to see why.
 */
function discountedInvoice(supplier: SupplierSnapshot): InvoiceDocument {
  const registered = supplier.vatRegistered === true;
  const vat = registered ? 2_975 : 0;
  return {
    ...invoiceFor(supplier),
    lines: [
      {
        description: 'Neurofeedback session',
        descriptionAr: 'جلسة نيوروفيدباك',
        quantity: 1,
        unitNetFils: 70_000,
        discountFils: 10_500,
        discountBasisPoints: 1500,
        netFils: 59_500,
        vatRateBasisPoints: registered ? 500 : 0,
        vatFils: vat,
        grossFils: 59_500 + vat,
      },
    ],
    netFils: 59_500,
    vatFils: vat,
    grossFils: 59_500 + vat,
    discountFils: 10_500,
  };
}

describe('an invoice with a discount on it', () => {
  const page = extractAll(renderDocument(discountedInvoice(UNREGISTERED), fonts));

  it('prints the discount beneath a discounted line and in the totals, in both languages', () => {
    // The design's own phrasing: the price that was quoted and what came off
    // it, rather than a percentage a reader has to apply for themselves.
    expect(page).toContain('List AED 700.00 · less AED 105.00');
    // The Arabic word itself, as a reader copies it off the page. The whole
    // note is a mixed run — Arabic label, Western figures — and a bidirectional
    // run is not reversible character for character, so what is pinned here is
    // the word and the figure beside it rather than the visual order of both.
    expect(page).toContain(asCopied('الخصم'));
    expect(page).toContain('Before discount');
    expect(page).toContain('Discount');
    // The list figure, what came off it, and what is charged.
    expect(page).toContain('AED 700.00');
    expect(page).toContain('AED 105.00');
    expect(page).toContain('AED 595.00');
  });

  it('says nothing about a discount when none was given', () => {
    const plain = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(plain).not.toContain('Discount');
    expect(plain).not.toContain('Before discount');
  });
});

describe('a registered practice’s invoice with a discount on it', () => {
  const page = extractAll(renderDocument(discountedInvoice(REGISTERED), fonts));

  it('charges VAT on the net after the discount, and says both figures', () => {
    expect(page).toContain('Before discount');
    expect(page).toContain('Discount');
    expect(page).toContain('Net');
    // Five per cent of 595.00, which is what the row says; the renderer
    // recomputes nothing.
    expect(page).toContain('AED 29.75');
    expect(page).toContain('AED 624.75');
  });
});

describe('the discount line', () => {
  it('names the price that was quoted and what came off it, with the currency in each', () => {
    expect(discountLine(1_215_000, 232_500).en).toBe('List AED 12,150.00 · less AED 2,325.00');
    expect(discountLine(1_215_000, 232_500).ar).toContain('12,150.00');
    expect(discountLine(1_215_000, 232_500).ar).toContain('2,325.00');
  });
});
