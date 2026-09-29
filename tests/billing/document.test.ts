import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  discountTotalLabel,
  extractAll,
  extractText,
  NOT_REGISTERED_BASIS,
  renderDocument,
  sharedDiscountBasisPoints,
  SIMPLIFIED_BASIS,
  toVisualOrder,
  waivedNotice,
  WORDS,
  type InvoiceDocument,
  type InvoiceLine,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';

/**
 * What a rendered money document says, read back off the page.
 *
 * The text is extracted through the same `/ToUnicode` map a PDF viewer uses to
 * let a person select and copy it (`domain/shared/document/extract.ts`), so
 * these are assertions about the document a family actually receives, not about
 * the object that produced it.
 *
 * The invoice is the operator's design of 24 September 2026
 * (docs/superpowers/specs/2026-09-24-invoice-redesign-design.md): every caption
 * and word that spec names is asserted present, block by block, and the words
 * of the page it replaced — the "List … · less …" sub-line, "Pay by bank
 * transfer", the Arabic beside the bank rows — asserted absent.
 *
 * The absences matter as much as the presences. An unregistered practice's
 * invoice must not carry the words "Tax Invoice", a VAT registration number, a
 * rate or a VAT line, and each of those is asserted as *not* on the page rather
 * than left to a positive test that happens not to look for it.
 *
 * Every figure is synthetic and every person is from `db/seed/names.ts`
 * (.claude/rules/testing.md); the bank account is invented.
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

/** How many times `needle` is on the page. */
const count = (page: string, needle: string): number => page.split(needle).length - 1;

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

/** The receipt's household: a seed name and a record number in the practice's own form. */
const RECIPIENT = { name: 'Robin Fairweather', recordNumber: 'MW-000099' };

/** The invoice's household: a seed name and a record number in the practice's own form. */
const HOUSEHOLD = { name: 'Hazel Dune', recordNumber: 'MW-000099' };

/** Invented throughout: no bank, holder or account here is a real one. */
const BANK: NonNullable<InvoiceDocument['bank']> = {
  accountHolder: 'Example Practice L.L.C-FZ',
  iban: 'AE360000000000000000001',
  bic: 'TESTAEXX',
  bankAddress: '1 Example Street, Abu Dhabi',
};

/** One undiscounted session at AED 700.00, with VAT on top when the practice is registered. */
function invoiceFor(supplier: SupplierSnapshot): InvoiceDocument {
  const registered = supplier.vatRegistered === true;
  const rate = registered ? 500 : 0;
  const vat = registered ? 3_500 : 0;
  return {
    kind: 'invoice',
    supplier,
    recipient: HOUSEHOLD,
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
    discountBasisPoints: null,
    netFils: 70_000,
    vatFils: vat,
    grossFils: 70_000 + vat,
    bank: null,
  };
}

/**
 * The operator's own example, figure for figure: a programme listed at
 * AED 7,950.00 with 25% off it — AED 1,987.50 — for AED 5,962.50, and on a
 * registered practice's page five per cent on that net. `basisPoints` null is
 * the same discount typed as a sum.
 */
function programmeInvoice(
  supplier: SupplierSnapshot,
  over: Partial<InvoiceDocument> = {},
  basisPoints: number | null = 2_500,
): InvoiceDocument {
  const registered = supplier.vatRegistered === true;
  const list = 795_000;
  const discount = 198_750;
  const net = list - discount;
  const vat = registered ? 29_813 : 0;
  return {
    kind: 'invoice',
    supplier,
    recipient: HOUSEHOLD,
    reference: 'INV-000099',
    issuedOn: '2026-09-24',
    suppliedOn: null,
    waivedOn: null,
    lines: [
      {
        description: 'Neurofeedback programme',
        descriptionAr: 'برنامج نيوروفيدباك',
        quantity: 1,
        unitNetFils: list,
        discountFils: discount,
        discountBasisPoints: basisPoints,
        netFils: net,
        vatRateBasisPoints: registered ? 500 : 0,
        vatFils: vat,
        grossFils: net + vat,
      },
    ],
    netFils: net,
    vatFils: vat,
    grossFils: net + vat,
    discountFils: discount,
    discountBasisPoints: basisPoints,
    bank: BANK,
    ...over,
  };
}

describe('the invoice in the operator’s design, block by block', () => {
  const bytes = renderDocument(programmeInvoice(UNREGISTERED), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('is headed INVOICE and فاتورة, and never as a tax invoice', () => {
    expect(lines).toContain('INVOICE');
    expect(lines).toContain(asCopied(WORDS.invoice.ar));
    expect(page).not.toContain('TAX INVOICE');
    expect(page).not.toContain('Tax Invoice');
    expect(page).not.toContain(asCopied(WORDS.taxInvoice.ar));
  });

  it('names the practice in both languages with its licence, its authority and its corporate-tax registration', () => {
    expect(page).toContain('Synthetic Wellness Studio');
    expect(page).toContain(asCopied('استوديو العافية التجريبي'));
    // Each row one piece of type, on one line, as his page sets them.
    expect(lines).toContain('Licence number SYN-000000');
    expect(page).toContain('Licensing authority Synthetic Department of Economy and Tourism');
    // The corporate-tax number under its own long name, never under the
    // phrase the Federal Tax Authority uses for a VAT registration.
    expect(lines).toContain('Corporate tax registration number 000000000000000');
    expect(page).not.toContain('VAT registration number');
    for (const label of [WORDS.licenceNumber, WORDS.licensingAuthority, WORDS.corporateTaxNumber]) {
      expect(page, label.en).toContain(asCopied(label.ar));
    }
  });

  it('sets the number card: the invoice number over its reference, the issue date over the date', () => {
    expect(page).toContain('Invoice no.');
    expect(page).toContain(asCopied(WORDS.invoiceNo.ar));
    expect(page).toContain('INV-000099');
    expect(page).toContain('Issue date');
    expect(page).toContain(asCopied(WORDS.issueDate.ar));
    expect(lines).toContain('24 September 2026');
    expect(page).not.toContain('Date of supply');
  });

  it('sets the billed-to card with the household and its client record', () => {
    expect(page).toContain('BILLED TO');
    expect(page).toContain(asCopied(WORDS.billedToCaption.ar));
    expect(lines).toContain('Hazel Dune');
    expect(page).toContain('Client record: MW-000099');
    expect(page).toContain(asCopied(WORDS.clientRecord.ar));
  });

  it('names the payment method, bank transfer, in both languages', () => {
    expect(page).toContain('PAYMENT METHOD');
    expect(page).toContain(asCopied(WORDS.paymentMethodCaption.ar));
    expect(lines).toContain('Bank transfer');
    expect(page).toContain(asCopied(WORDS.transfer.ar));
  });

  it('heads the table in both languages, with a discount column because a line is discounted', () => {
    for (const heading of [
      WORDS.description,
      WORDS.qty,
      WORDS.unitPrice,
      WORDS.discount,
      WORDS.total,
    ]) {
      expect(lines, heading.en).toContain(heading.en);
      expect(page, heading.en).toContain(asCopied(heading.ar));
    }
    // No VAT column on an unregistered practice's page.
    expect(page).not.toContain(asCopied(WORDS.vatColumn.ar));
  });

  it('sets the line: its description in both languages, the list price, the pill once, and the total', () => {
    expect(lines).toContain('Neurofeedback programme');
    expect(page).toContain(asCopied('برنامج نيوروفيدباك'));
    expect(lines).toContain('1');
    expect(page).toContain('AED 7,950.00');
    // The pill: the percentage the line was given, set once on the page as
    // its own piece of type — the summary's "Discount 25%" is another.
    expect(lines.filter((line) => line === '25%')).toHaveLength(1);
    expect(page).toContain('AED 5,962.50');
  });

  it('drops the old page’s sub-line beneath a discounted description', () => {
    // The column says it now (spec, point 4).
    expect(page).not.toContain('List ');
    expect(page).not.toContain('· less');
    expect(page).not.toContain('·');
    expect(page).not.toContain('Before discount');
  });

  it('sets the payment details card with English labels only and the IBAN grouped in fours', () => {
    expect(page).toContain('Payment details');
    expect(page).toContain(asCopied(WORDS.paymentDetails.ar));
    expect(lines).toContain('Account name');
    expect(lines).toContain('Example Practice L.L.C-FZ');
    expect(lines).toContain('IBAN');
    expect(lines).toContain('AE36 0000 0000 0000 0000 001');
    expect(lines).toContain('SWIFT / BIC');
    expect(lines).toContain('TESTAEXX');
    expect(lines).toContain('Bank address');
    expect(lines).toContain('1 Example Street, Abu Dhabi');
    // No Arabic beside the account's rows, and none of the old page's labels.
    // The Arabic the round 61 card set beside its account holder and its BIC,
    // the two labels that card had and this one does not.
    for (const arabic of [WORDS.iban.ar, WORDS.bankAddress.ar, 'اسم صاحب الحساب', 'رمز السويفت']) {
      expect(page, arabic).not.toContain(asCopied(arabic));
    }
    expect(page).not.toContain('Account holder');
    expect(page).not.toContain('Pay by bank transfer');
  });

  it('closes the payment card with the payment reference: the invoice’s own number', () => {
    expect(page).toContain('Payment reference');
    expect(page).toContain(asCopied(WORDS.paymentReference.ar));
    // Once on the number card and once on the strip; the running header of a
    // second sheet is the only other place it could be, and this is one page.
    expect(count(page, 'INV-000099')).toBe(2);
  });

  it('sums up: the subtotal, "Discount 25%" less AED 1,987.50, and TOTAL DUE', () => {
    expect(page).toContain('Invoice summary');
    expect(page).toContain(asCopied(WORDS.invoiceSummary.ar));
    expect(lines).toContain('Subtotal');
    expect(lines).toContain('Discount 25%');
    // The summary's rows are English and figure only, as his page sets them.
    expect(page).not.toContain(asCopied(WORDS.subtotal.ar));
    expect(lines).toContain('- AED 1,987.50');
    expect(lines).toContain('TOTAL DUE');
    expect(page).toContain(asCopied(WORDS.totalDue.ar));
    // The list total twice (unit price and subtotal), the figure due twice
    // (the line and the violet block).
    expect(count(page, 'AED 7,950.00')).toBe(2);
    expect(count(page, 'AED 5,962.50')).toBe(2);
    expect(page).not.toContain('Net');
  });

  it('carries the tax information card with the sentence the registration calls for', () => {
    expect(page).toContain('Tax information');
    expect(page).toContain(asCopied(WORDS.taxInformation.ar));
    expect(page).toContain(NOT_REGISTERED_BASIS.en);
    expect(page).toContain(asCopied('المنشأة غير مسجلة في ضريبة القيمة المضافة'));
  });

  it('ends on the footer: the name and the address spaced by three, then the contact line', () => {
    expect(lines).toContain('Synthetic Wellness Studio   Unit 1   Synthetic Tower   Dubai');
    expect(lines).toContain('P: +971 50 000 0011   E: studio@example.com   W: https://example.com');
    // The address once, on the footer, and never again elsewhere.
    expect(count(page, 'Synthetic Tower')).toBe(1);
  });

  it('is the same bytes every time it is rendered from the same row', () => {
    // Nothing in the renderer reads a clock or a random source, which is what
    // lets the sha256 on the document row stay true and a failed upload be
    // retried with exactly the file that was promised.
    const again = renderDocument(programmeInvoice(UNREGISTERED), fonts);
    expect(Buffer.from(bytes).equals(Buffer.from(again))).toBe(true);
  });

  it('is a PDF a reader will open', () => {
    expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.7');
    expect(Buffer.from(bytes).toString('latin1')).toContain('%%EOF');
  });
});

describe('a registered practice’s invoice', () => {
  const bytes = renderDocument(programmeInvoice(REGISTERED), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('is headed TAX INVOICE and فاتورة ضريبية', () => {
    expect(lines).toContain('TAX INVOICE');
    expect(page).toContain(asCopied(WORDS.taxInvoice.ar));
  });

  it('adds the VAT registration number as a fourth supplier row', () => {
    expect(lines).toContain('VAT registration number 100000000000003');
    expect(page).toContain(asCopied(WORDS.vatRegistrationNumber.ar));
  });

  it('inserts a VAT column before Total, and the Total column holds the gross', () => {
    expect(lines).toContain(WORDS.vatColumn.en);
    expect(page).toContain(asCopied(WORDS.vatColumn.ar));
    const vatHeading = lines.indexOf(WORDS.vatColumn.en);
    const totalHeading = lines.indexOf(WORDS.total.en);
    expect(vatHeading).toBeGreaterThan(-1);
    expect(vatHeading).toBeLessThan(totalHeading);
    expect(lines).toContain('AED 298.13'); // five per cent of 5,962.50, as the row says
    expect(count(page, 'AED 6,260.63')).toBe(2); // the line's gross and the total due
  });

  it('sums up with Net and "VAT 5%" before TOTAL DUE', () => {
    expect(lines).toContain('Subtotal');
    expect(lines).toContain('Discount 25%');
    expect(lines).toContain('Net');
    // No Arabic beside the summary's rows; the Net's Arabic is nowhere else.
    expect(page).not.toContain(asCopied(WORDS.net.ar));
    expect(lines).toContain('VAT 5%');
    expect(lines).toContain('TOTAL DUE');
    const net = lines.indexOf('Net');
    const vat = lines.indexOf('VAT 5%');
    const due = lines.indexOf('TOTAL DUE');
    expect(net).toBeLessThan(vat);
    expect(vat).toBeLessThan(due);
  });

  it('says it is a simplified tax invoice, in the tax information card', () => {
    expect(page).toContain('Tax information');
    expect(page).toContain(SIMPLIFIED_BASIS.en);
    expect(page).not.toContain(NOT_REGISTERED_BASIS.en);
  });
});

describe('an unregistered practice’s invoice', () => {
  const page = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));

  it('carries no VAT registration number, no rate, no VAT column and no Net or VAT rows', () => {
    expect(page).not.toContain('VAT registration number');
    expect(page).not.toContain('100000000000003');
    expect(page).not.toContain('%');
    expect(page).not.toContain(asCopied(WORDS.vatColumn.ar));
    expect(page).not.toContain('Net');
    expect(page).not.toContain(asCopied(WORDS.net.ar));
  });

  it('states plainly why there is no VAT on it, in both languages', () => {
    expect(page).toContain('The practice is not registered for VAT');
    expect(page).toContain(asCopied('المنشأة غير مسجلة في ضريبة القيمة المضافة'));
  });
});

describe('an invoice with no discount on it', () => {
  const bytes = renderDocument(invoiceFor(UNREGISTERED), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('has no discount column, no pill and no discount row', () => {
    expect(page).not.toContain('Discount');
    expect(page).not.toContain(asCopied(WORDS.discount.ar));
    expect(page).not.toContain('- AED');
  });

  it('still sums up: the subtotal and the total due', () => {
    expect(lines).toContain('Subtotal');
    expect(lines).toContain('TOTAL DUE');
    expect(page).toContain('AED 700.00');
  });
});

describe('an invoice from a practice that has recorded no bank account', () => {
  const bytes = renderDocument(programmeInvoice(UNREGISTERED, { bank: null }), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('has no payment details card and no payment method, caption and all', () => {
    expect(page).not.toContain('Payment details');
    expect(page).not.toContain(asCopied(WORDS.paymentDetails.ar));
    expect(page).not.toContain('PAYMENT METHOD');
    expect(page).not.toContain(asCopied(WORDS.paymentMethodCaption.ar));
    expect(page).not.toContain('Bank transfer');
    expect(page).not.toContain('IBAN');
    expect(page).not.toContain('Payment reference');
    expect(count(page, 'INV-000099')).toBe(1);
  });

  it('keeps the summary, the tax card and the footer', () => {
    expect(page).toContain('Invoice summary');
    expect(lines).toContain('TOTAL DUE');
    expect(page).toContain('Tax information');
    expect(lines).toContain('Synthetic Wellness Studio   Unit 1   Synthetic Tower   Dubai');
  });
});

describe('an invoice whose discount was typed as a sum', () => {
  const bytes = renderDocument(programmeInvoice(UNREGISTERED, {}, null), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('sets the amount in the pill and "Discount" alone in the summary', () => {
    // The pill and the summary's row: the one figure, twice, once with its minus.
    expect(lines).toContain('AED 1,987.50');
    expect(lines).toContain('- AED 1,987.50');
    expect(lines).toContain('Discount');
    expect(page).not.toMatch(/Discount \d/);
    // Nothing on an unregistered practice's page is a percentage, so no "%"
    // anywhere is the proof that none was invented.
    expect(page).not.toContain('%');
  });
});

describe('a call-out fee the practice forgave', () => {
  it('says so first in the tax information card, in both languages, and says nothing is owed', () => {
    // The invoice is append-only: a waived fee keeps its number, its line and
    // its figures, and `app.billing_ledger` simply stops counting it
    // (migration 408). So the document has to say what the ledger knows.
    const lines = extractText(
      renderDocument({ ...invoiceFor(UNREGISTERED), waivedOn: '2026-09-06' }, fonts),
    );
    const waived = lines.join(' ');
    const words = waivedNotice('2026-09-06');
    expect(words.en).toBe('Waived on 6 September 2026. Nothing is owed.');
    expect(waived).toContain(words.en);
    // The Arabic in two fragments rather than one sentence: the shaper sets a
    // space either side of a Western-digit run, so the whole sentence is not a
    // substring of the page even when every word of it is on it.
    expect(waived).toContain(asCopied('أُعفي هذا المبلغ بتاريخ'));
    expect(waived).toContain(asCopied('لا يوجد مبلغ مستحق'));
    // First in the card: after its title, before the basis sentence — which
    // is still there, because forgiving a charge says nothing about the
    // practice's registration.
    const title = lines.indexOf('Tax information');
    const notice = lines.indexOf(words.en);
    const basis = lines.findIndex((line) => NOT_REGISTERED_BASIS.en.startsWith(line));
    expect(title).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(title);
    expect(basis).toBeGreaterThan(notice);
  });

  it('is silent on an invoice that stands', () => {
    const standing = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(standing).not.toContain('Waived');
    expect(standing).not.toContain('Nothing is owed');
  });
});

describe('the date of supply', () => {
  it('is a third pair on the number card only when it differs from the issue date', () => {
    const same = extractAll(renderDocument(invoiceFor(UNREGISTERED), fonts));
    expect(same).toContain('2 September 2026');
    expect(same).not.toContain('Date of supply');

    const differs = extractAll(
      renderDocument({ ...invoiceFor(UNREGISTERED), suppliedOn: '2026-08-28' }, fonts),
    );
    expect(differs).toContain('Date of supply');
    expect(differs).toContain(asCopied(WORDS.dateOfSupply.ar));
    expect(differs).toContain('28 August 2026');
  });
});

describe('the footer', () => {
  it('wraps a long address rather than cutting it', () => {
    const long =
      'Unit 1, Synthetic Tower, Synthetic Boulevard, Synthetic Business Bay, ' +
      'Synthetic District, Synthetic Quarter, Synthetic Emirate, Dubai, United Arab Emirates';
    const wide = extractAll(renderDocument(invoiceFor({ ...UNREGISTERED, address: long }), fonts));
    expect(wide).not.toContain('…');
    for (const piece of ['Synthetic Boulevard', 'Synthetic Business Bay', 'United Arab Emirates']) {
      expect(wide).toContain(piece);
    }
  });

  it('leaves the contact line out when the practice has recorded none', () => {
    const bare = extractAll(
      renderDocument(
        invoiceFor({ ...UNREGISTERED, contactPhone: null, contactEmail: null, website: null }),
        fonts,
      ),
    );
    expect(bare).toContain('Synthetic Wellness Studio   Unit 1');
    expect(bare).not.toContain('P: ');
    expect(bare).not.toContain('E: ');
    expect(bare).not.toContain('W: ');
  });
});

describe('a page number', () => {
  it('is on no page, even of an invoice that runs to several', () => {
    const lines = Array.from({ length: 30 }, (_, index) => ({
      ...(invoiceFor(UNREGISTERED).lines[0] as InvoiceLine),
      description: `Neurofeedback session ${index + 1}`,
    }));
    const bytes = renderDocument(
      { ...invoiceFor(UNREGISTERED), lines, netFils: 2_100_000, grossFils: 2_100_000 },
      fonts,
    );
    const text = extractText(bytes);
    // Several sheets, each carrying the running header's reference …
    expect(text.filter((line) => line === 'INV-000001').length).toBeGreaterThan(2);
    // … and none of them numbered.
    expect(text.some((line) => /^Page \d/.test(line))).toBe(false);
  });
});

describe('the bank account’s optional rows', () => {
  it('leaves out SWIFT / BIC and the bank address when the practice recorded neither', () => {
    const page = extractAll(
      renderDocument(
        programmeInvoice(UNREGISTERED, { bank: { ...BANK, bic: null, bankAddress: null } }),
        fonts,
      ),
    );
    expect(page).toContain('AE36 0000 0000 0000 0000 001');
    expect(page).not.toContain('SWIFT / BIC');
    expect(page).not.toContain('Bank address');
  });
});

function receiptFor(
  supplier: SupplierSnapshot,
  over: Partial<ReceiptDocument> = {},
): ReceiptDocument {
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
    ...over,
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

/**
 * The receipt in the same dress as the invoice (the spec's "The receipt"):
 * a receipt that looked like last week's design beside this invoice would
 * look like a different practice's.
 */
describe('the receipt in the operator’s design, block by block', () => {
  const bytes = renderDocument(receiptFor(UNREGISTERED), fonts);
  const page = extractAll(bytes);
  const lines = extractText(bytes);

  it('is headed RECEIPT once and إيصال استلام beneath it, and never as an invoice', () => {
    expect(lines.filter((line) => line === 'RECEIPT')).toHaveLength(1);
    expect(page).toContain(asCopied(WORDS.receipt.ar));
    expect(page).not.toContain('INVOICE');
  });

  it('names the practice in both languages with its licence and its authority, and no tax registration', () => {
    expect(page).toContain('Synthetic Wellness Studio');
    expect(page).toContain(asCopied('استوديو العافية التجريبي'));
    expect(lines).toContain('Licence number SYN-000000');
    expect(page).toContain('Licensing authority Synthetic Department of Economy and Tourism');
    expect(page).not.toContain('Corporate tax');
    expect(page).not.toContain('000000000000000');
  });

  it('sets the number card: the receipt number over its reference, the date received over the date', () => {
    expect(page).toContain('Receipt no.');
    expect(page).toContain(asCopied(WORDS.receiptNo.ar));
    expect(lines).toContain('RCP-000004');
    expect(page).toContain('Date received');
    expect(page).toContain(asCopied(WORDS.dateReceived.ar));
    expect(lines).toContain('2 September 2026');
  });

  it('sets the received-from card with the household and its client record', () => {
    expect(page).toContain('RECEIVED FROM');
    expect(page).toContain(asCopied(WORDS.receivedFromCaption.ar));
    expect(lines).toContain('Robin Fairweather');
    expect(page).toContain('Client record: MW-000099');
    expect(page).toContain(asCopied(WORDS.clientRecord.ar));
  });

  it('names the method the money came by as the payment method, in both languages', () => {
    expect(page).toContain('PAYMENT METHOD');
    expect(page).toContain(asCopied(WORDS.paymentMethodCaption.ar));
    expect(lines).toContain('Bank transfer');
    expect(page).toContain(asCopied(WORDS.transfer.ar));
  });

  it('sets the Payment received card: the method, the reference and the invoice it settles, English labels only', () => {
    expect(page).toContain('Payment received');
    expect(page).toContain(asCopied(WORDS.paymentReceived.ar));
    expect(lines).toContain('Method');
    expect(lines).toContain('Reference');
    expect(lines).toContain('SYN 0001');
    expect(lines).toContain('Settles invoice');
    expect(lines).toContain('INV-000001');
    // The rows' labels carry no Arabic, as the payment details card's do not.
    expect(page).not.toContain(asCopied(WORDS.settlesInvoice.ar));
    // The method twice: once as the payment method, once on its row.
    expect(lines.filter((line) => line === 'Bank transfer')).toHaveLength(2);
  });

  it('sums up with TOTAL PAID over the figure in the violet block, and nothing else', () => {
    expect(page).toContain('Receipt summary');
    expect(page).toContain(asCopied(WORDS.receiptSummary.ar));
    expect(lines).toContain('TOTAL PAID');
    expect(page).toContain(asCopied(WORDS.totalPaid.ar));
    // A receipt has one figure, and prints it once: no Total row above the block.
    expect(lines).not.toContain('Total');
    expect(count(page, 'AED 700.00')).toBe(1);
  });

  it('carries the Note card with the receipt’s own sentence, in both languages', () => {
    expect(lines).toContain('Note');
    expect(page).toContain(asCopied(WORDS.note.ar));
    expect(page).toContain(
      'Received by bank transfer on 2 September 2026, against invoice INV-000001.',
    );
    expect(page).toContain('This is a receipt for money received, not a tax invoice.');
    expect(page).toContain(asCopied('هذا إيصال باستلام مبلغ وليس فاتورة ضريبية'));
  });

  it('ends on the invoice’s footer: the name and the address spaced by three, then the contact line', () => {
    expect(lines).toContain('Synthetic Wellness Studio   Unit 1   Synthetic Tower   Dubai');
    expect(lines).toContain('P: +971 50 000 0011   E: studio@example.com   W: https://example.com');
  });

  it('is the same bytes every time it is rendered from the same row', () => {
    const again = renderDocument(receiptFor(UNREGISTERED), fonts);
    expect(Buffer.from(bytes).equals(Buffer.from(again))).toBe(true);
  });
});

describe('a receipt, by the method the money came by', () => {
  const METHODS = [
    ['cash', WORDS.cash],
    ['transfer', WORDS.transfer],
    ['link', WORDS.link],
  ] as const;

  it.each(METHODS)(
    '%s: names it as the payment method and on the Payment received card, and no other',
    (method, phrase) => {
      const bytes = renderDocument(receiptFor(UNREGISTERED, { method }), fonts);
      const lines = extractText(bytes);
      const page = extractAll(bytes);
      expect(lines.filter((line) => line === phrase.en)).toHaveLength(2);
      expect(page).toContain(asCopied(phrase.ar));
      for (const [other, otherPhrase] of METHODS) {
        if (other === method) continue;
        expect(lines, other).not.toContain(otherPhrase.en);
      }
    },
  );
});

describe('a receipt’s optional rows', () => {
  it('leaves Reference out when no payment reference was recorded', () => {
    const with_ = extractText(renderDocument(receiptFor(UNREGISTERED), fonts));
    expect(with_).toContain('Reference');
    const without = extractText(
      renderDocument(receiptFor(UNREGISTERED, { paymentReference: null }), fonts),
    );
    expect(without).not.toContain('Reference');
    expect(without).not.toContain('SYN 0001');
    expect(without).toContain('Method');
  });

  it('leaves Settles invoice out when it settles no invoice, and says it was taken on account', () => {
    const page = extractAll(renderDocument(receiptFor(UNREGISTERED, { settles: null }), fonts));
    expect(page).not.toContain('Settles invoice');
    expect(page).not.toContain('INV-000001');
    expect(page).toContain('Received by bank transfer on 2 September 2026, on account.');
  });
});

describe('a receipt asks for no money and claims nothing about tax, whoever issued it', () => {
  const registered = renderDocument(receiptFor(REGISTERED), fonts);
  const unregistered = renderDocument(receiptFor(UNREGISTERED), fonts);

  it.each([
    ['registered', registered],
    ['unregistered', unregistered],
  ] as const)('carries no bank account, no invoice words and no tax words (%s)', (_name, bytes) => {
    // A receipt says money arrived; it asks for none. `ReceiptDocument` has no
    // `bank` to carry, so this is the page proving the type.
    const page = extractAll(bytes);
    for (const absent of [
      'IBAN',
      'SWIFT',
      'Payment details',
      'Payment reference',
      'BILLED TO',
      'TOTAL DUE',
      'Corporate tax',
      'TRN',
      'VAT',
    ]) {
      expect(page, absent).not.toContain(absent);
    }
  });

  it('reads the same from a registered practice as from an unregistered one', () => {
    expect(extractText(registered)).toEqual(extractText(unregistered));
  });
});

/**
 * The rendered bytes themselves, pinned.
 *
 * The test above proves the writer is deterministic — the same row rendered
 * twice is the same file — but determinism says nothing about *which* file, so
 * a refactor that quietly moved a byte would pass it. These hashes are
 * the missing half: they say that the invoices and the receipt are the
 * documents they were when this was written, so any change to
 * the writer has to declare itself here.
 *
 * **When one of these fails.** It is a fact to explain, not a number to
 * refresh. If the change was deliberate, move the golden in the same commit
 * that made it and say in the message what moved and why. If it was not, the
 * writer changed a document nobody meant to change.
 *
 * These depend on the version of the font package the faces are read from
 * (`app/api/billing/fonts.ts` embeds the programs verbatim), so upgrading it
 * moves every one of them at once — which is itself worth seeing rather than not.
 *
 * **All three moved on 8 September 2026**, when the practice's own design
 * replaced the layout these documents had carried since round 20
 * (docs/SPEC/billing.md section 5.6). That is the largest change any of them
 * has had and it is exactly the sort this pinning exists to make somebody
 * declare.
 *
 * **And all three moved again on the same day**, in the fix round that
 * followed the design review. Three things moved them: the supplier's address
 * is set across the whole measure now rather than half of it, because nothing
 * faces it; the totals box centres its rows in itself instead of sitting them
 * high; and the receipt no longer carries the corporate-tax registration,
 * which the design leaves off a document that makes no tax claim. Nothing
 * about what any of the three says changed.
 *
 * **And all three moved once more, later on 8 September**, on the operator's
 * instruction that the practice's address be stated once rather than twice.
 * It left the supplier block at the top of the page and stayed on the footer
 * band, where that line now wraps instead of being cut — the address is a
 * thing a UAE invoice must carry, and it no longer has a second place to
 * appear from.
 *
 * **The two invoices moved on 24 September 2026**, when the operator's design
 * of that day replaced the invoice page outright (round 65; docs/superpowers/
 * specs/2026-09-24-invoice-redesign-design.md): the mark left and the title
 * right, the number card, the billed-to card, the table under a violet band,
 * the payment and summary cards, the tax card, the footer spaced by three.
 * They were re-pinned after the rendered page had been read against his own,
 * and once more the same night, when seven points of his page — the lockup's
 * width, the number card's bar, the hairline, one-line supplier rows, the
 * summary's band and English rows, no page number — were matched too.
 *
 * **The receipt moved on the same day**, once, when it was dressed to match
 * (round 65, "The receipt"): the invoice's masthead, supplier block and
 * number card, "RECEIVED FROM", the method as the payment method, "Payment
 * received" beside a summary whose violet block reads "TOTAL PAID", a Note
 * card carrying its own sentence, and the invoice's footer. It was re-pinned
 * after the rendered page had been read against the spec. Its household's
 * record number moved to the practice's own form at the same time. The two invoices did not move: the blocks they now share with the
 * receipt were lifted out of the invoice page byte for byte.
 * It moved once more that night, when its Note sentence took the invoice's
 * spelling of "Bank transfer" (تحويل مصرفي), so the practice spells it one
 * way on both documents; the invoices, which already printed it, did not.
 * And once more before the round closed: its summary lost the Total row, so
 * the one figure a receipt has prints once, in the violet block; its
 * household's record number became MW-000099, a number no real client has
 * carried.
 *
 * **A third invoice was pinned at the end of round 65**: the unregistered
 * invoice with the practice's bank account and a 25% discount, so the
 * payment method, the payment details card with its reference strip, and
 * the discount's pill and row are held here byte for byte — not only by the
 * demo file the operator compared his page with, which lives outside the
 * repository.
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
      'c76a466978cea23f35d7719a91879816ec997df218dda24c6c16ccb2872df647',
    ],
    [
      'an invoice from a registered practice',
      () => renderDocument(invoiceFor(REGISTERED), fonts),
      '94e934d4b4c53e0e8fff0577b4b3213b90c9a55416109f0807276c445436349d',
    ],
    [
      // The case the operator's demo covers: the payment method, the payment
      // details card and its reference strip, and a discount's pill and row.
      'an unregistered invoice with a bank account and a 25% discount',
      () => renderDocument(programmeInvoice(UNREGISTERED), fonts),
      'b1327bc962370153551e6f30a8ad1452d024407c9c81f800a43acaf9c81f4ddf',
    ],
    [
      'a receipt',
      () => renderDocument(receiptFor(UNREGISTERED), fonts),
      'bde17737f2bc560a8351f8377d39f068a55ec53bc9eb3494b3ed0adb800c6207',
    ],
  ];

  it.each(GOLDEN)('%s renders to the bytes it always has', (_name, render, golden) => {
    expect(sha256(render())).toBe(golden);
  });
});

describe('the discount total label', () => {
  it('names the percentage in the summary’s label only when it is given one', () => {
    expect(discountTotalLabel(2500)).toEqual({ en: 'Discount 25%', ar: 'الخصم 25%' });
    expect(discountTotalLabel(null)).toEqual(WORDS.discount);
  });
});

/** A line discounted by `basisPoints` of a 700.00 list price, unregistered. */
function discountedLine(basisPoints: number | null, discountFils: number): InvoiceLine {
  return {
    description: 'Neurofeedback session',
    descriptionAr: 'جلسة نيوروفيدباك',
    quantity: 1,
    unitNetFils: 70_000,
    discountFils,
    discountBasisPoints: basisPoints,
    netFils: 70_000 - discountFils,
    vatRateBasisPoints: 0,
    vatFils: 0,
    grossFils: 70_000 - discountFils,
  };
}

/** An unregistered practice's invoice of these lines, its totals summed from them. */
function invoiceOf(lines: InvoiceLine[]): InvoiceDocument {
  const net = lines.reduce((total, line) => total + line.netFils, 0);
  return {
    ...invoiceFor(UNREGISTERED),
    lines,
    netFils: net,
    vatFils: 0,
    grossFils: net,
    discountFils: lines.reduce((total, line) => total + line.discountFils, 0),
    discountBasisPoints: sharedDiscountBasisPoints(lines),
  };
}

/**
 * The percentage on the page (the owner's ask of 23 September 2026;
 * docs/SPEC/billing.md section 2.4). Each line's pill says its own; the
 * summary says one only when every discounted line agrees on it, because two
 * different shares added together have none.
 */
describe('the discount’s percentage', () => {
  it("sets each line's own percentage in its pill and none in the summary when they differ", () => {
    const lines = extractText(
      renderDocument(invoiceOf([discountedLine(1000, 7_000), discountedLine(2000, 14_000)]), fonts),
    );
    expect(lines.filter((line) => line === '10%')).toHaveLength(1);
    expect(lines.filter((line) => line === '20%')).toHaveLength(1);
    expect(lines).toContain('Discount');
    expect(lines.join(' ')).not.toMatch(/Discount \d/);
    expect(lines).toContain('- AED 210.00');
  });

  it('leaves an undiscounted line’s cell empty and names the shared 25% in the summary', () => {
    const lines = [discountedLine(2500, 17_500), discountedLine(null, 0)];
    expect(sharedDiscountBasisPoints(lines)).toBe(2500);
    const text = extractText(renderDocument(invoiceOf(lines), fonts));
    // One pill for the one discounted line, nothing in the other's cell.
    expect(text.filter((line) => line === '25%')).toHaveLength(1);
    expect(text.filter((line) => line.startsWith('AED 0'))).toHaveLength(0);
    expect(text).toContain('Discount 25%');
  });

  it('shares no percentage when a discounted line was typed as a sum beside one typed as a share', () => {
    expect(
      sharedDiscountBasisPoints([discountedLine(2500, 17_500), discountedLine(null, 500)]),
    ).toBe(null);
    expect(sharedDiscountBasisPoints([discountedLine(null, 0)])).toBe(null);
    expect(sharedDiscountBasisPoints([])).toBe(null);
  });
});
