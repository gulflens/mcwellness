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
  toVisualOrder,
  waivedNotice,
  WORDS,
  type InvoiceDocument,
  type InvoiceLine,
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
    discountBasisPoints: null,
    netFils: 70_000,
    vatFils: vat,
    grossFils: 70_000 + vat,
    bank: null,
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

  it('states the address once, in the footer, and not again under the practice name', () => {
    // The operator's instruction of 8 September 2026: the supplier block at the
    // top of the page no longer repeats what the band at the foot already says.
    // Once, though — never nought, because a UAE invoice must state it.
    const address = 'Unit 1, Synthetic Tower, Dubai';
    expect(page.split(address).length - 1).toBe(1);
    // And it is the band's line that carries it: the practice's name sits
    // immediately before it there, which is not how the supplier block set them.
    expect(page).toContain(`Synthetic Wellness Studio  ${address}`);
  });

  it('wraps the footer line rather than cutting an address that will not fit', () => {
    // `fit` would put an ellipsis through it, and the address is the one thing
    // on that line a reader may actually need.
    const long =
      'Unit 1, Synthetic Tower, Synthetic Boulevard, Synthetic Business Bay, ' +
      'Synthetic District, Dubai, United Arab Emirates';
    const wide = extractAll(renderDocument(invoiceFor({ ...UNREGISTERED, address: long }), fonts));
    expect(wide).not.toContain('…');
    for (const piece of ['Synthetic Boulevard', 'Synthetic Business Bay', 'United Arab Emirates']) {
      expect(wide).toContain(piece);
    }
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
 * They are rendered with no logo, deliberately: the mark is the practice's own
 * row and not a file in this repository, so a golden that embedded one would
 * be a golden about a picture rather than about the writer.
 */
const GOLDEN_UNREGISTERED_INVOICE =
  '0b17f43d3c024d3b61a80cb959f5d5f10a9eca6d12ac39bc952060be402545b1';

describe('the bytes of a rendered document', () => {
  const sha256 = (bytes: Uint8Array): string =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');

  const GOLDEN: ReadonlyArray<readonly [string, () => Uint8Array, string]> = [
    [
      'an invoice from an unregistered practice',
      () => renderDocument(invoiceFor(UNREGISTERED), fonts),
      GOLDEN_UNREGISTERED_INVOICE,
    ],
    [
      'an invoice from a registered practice',
      () => renderDocument(invoiceFor(REGISTERED), fonts),
      'a877c57c1e596fd266509e7381086e831d6e381e414739940a3846d75caab745',
    ],
    [
      'a receipt',
      () => renderDocument(receiptFor(UNREGISTERED), fonts),
      '2410236d814da3c1564193de03d120b9439cc8b8dc006196c4402693198b988f',
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
    discountBasisPoints: 1500,
  };
}

describe('an invoice with a discount on it', () => {
  const page = extractAll(renderDocument(discountedInvoice(UNREGISTERED), fonts));

  it('prints the discount beneath a discounted line and in the totals, in both languages', () => {
    // The design's own phrasing: the price that was quoted and what came off
    // it — and, since the owner's ask of 23 September 2026, the share it was
    // typed as. This pinned `List AED 700.00 · less AED 105.00` with nothing
    // after it until then; the line now ends in the percentage, deliberately.
    expect(page).toContain('List AED 700.00 · less AED 105.00 (15%)');
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

describe('the discount total label', () => {
  // `discountLine` — the sub-line beneath a discounted description — was
  // deleted in round 65 (the new page has no sub-line; the text it printed
  // now lives inlined at its one remaining call site in render.ts, for the
  // old page alone, until Task 3 replaces that page). Its own tests went
  // with it; this one is `discountTotalLabel`'s, which stays.
  it('names the percentage in the totals label only when it is given one', () => {
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
 * docs/SPEC/billing.md section 2.4, "with the percentage when there was one").
 * Each line says its own; the totals say one only when every discounted line
 * agrees on it, because two different shares added together have none.
 */
describe('the discount’s percentage', () => {
  it('prints the percentage beside a discounted line and in the totals when every line shares it', () => {
    const page = extractAll(renderDocument(discountedInvoice(UNREGISTERED), fonts));
    expect(page).toContain('List AED 700.00 · less AED 105.00 (15%)');
    expect(page).toContain('Discount 15%');
    expect(page).toContain(asCopied('الخصم'));
  });

  it('prints no percentage for a discount typed as a sum', () => {
    const page = extractAll(renderDocument(invoiceOf([discountedLine(null, 10_500)]), fonts));
    expect(page).toContain('List AED 700.00 · less AED 105.00');
    expect(page).toContain('Discount');
    // An unregistered practice's page carries no rate either, so no "%"
    // anywhere on it is the proof that none was invented.
    expect(page).not.toContain('%');
  });

  it("prints each line's own percentage and none in the totals when they differ", () => {
    const page = extractAll(
      renderDocument(invoiceOf([discountedLine(1000, 7_000), discountedLine(2000, 14_000)]), fonts),
    );
    expect(page).toContain('List AED 700.00 · less AED 70.00 (10%)');
    expect(page).toContain('List AED 700.00 · less AED 140.00 (20%)');
    expect(page).toContain('Discount');
    expect(page).not.toMatch(/Discount \d/);
  });

  it('prints 25% in the totals when one discounted line sits beside an undiscounted one', () => {
    const lines = [discountedLine(2500, 17_500), discountedLine(null, 0)];
    expect(sharedDiscountBasisPoints(lines)).toBe(2500);
    const page = extractAll(renderDocument(invoiceOf(lines), fonts));
    expect(page).toContain('List AED 700.00 · less AED 175.00 (25%)');
    expect(page).toContain('Discount 25%');
  });

  it('shares no percentage when a discounted line was typed as a sum beside one typed as a share', () => {
    expect(
      sharedDiscountBasisPoints([discountedLine(2500, 17_500), discountedLine(null, 500)]),
    ).toBe(null);
    expect(sharedDiscountBasisPoints([discountedLine(null, 0)])).toBe(null);
    expect(sharedDiscountBasisPoints([])).toBe(null);
  });
});

/** Invented throughout: no bank, holder or account here is a real one. */
const BANK: NonNullable<InvoiceDocument['bank']> = {
  accountHolder: 'Example Practice L.L.C-FZ',
  iban: 'AE360000000000000000001',
  bic: 'TESTAEXX',
  bankAddress: '1 Example Street, Abu Dhabi',
};

describe('how to pay, on the invoice', () => {
  it('prints "Pay by bank transfer" with the account, the IBAN grouped in fours, the BIC and the bank address', () => {
    const page = extractAll(renderDocument({ ...invoiceFor(UNREGISTERED), bank: BANK }, fonts));
    expect(page).toContain('Pay by bank transfer');
    expect(page).toContain(asCopied(WORDS.payByTransfer.ar));
    expect(page).toContain('Account holder');
    expect(page).toContain('Example Practice L.L.C-FZ');
    expect(page).toContain('IBAN');
    expect(page).toContain('AE36 0000 0000 0000 0000 001');
    expect(page).toContain('BIC');
    expect(page).toContain('TESTAEXX');
    expect(page).toContain('Bank address');
    expect(page).toContain('1 Example Street, Abu Dhabi');
  });

  it('leaves out the BIC and the bank address when the practice recorded neither', () => {
    const page = extractAll(
      renderDocument(
        { ...invoiceFor(UNREGISTERED), bank: { ...BANK, bic: null, bankAddress: null } },
        fonts,
      ),
    );
    expect(page).toContain('AE36 0000 0000 0000 0000 001');
    expect(page).not.toContain('BIC');
    expect(page).not.toContain('Bank address');
  });

  it('prints no bank block when the practice has recorded none, and the bytes are unchanged', () => {
    const bytes = renderDocument(invoiceFor(UNREGISTERED), fonts);
    const page = extractAll(bytes);
    expect(page).not.toContain('Pay by bank transfer');
    expect(page).not.toContain('IBAN');
    // The golden below, pinned before the block existed: a practice with no
    // bank details gets exactly the document it always had.
    expect(createHash('sha256').update(Buffer.from(bytes)).digest('hex')).toBe(
      GOLDEN_UNREGISTERED_INVOICE,
    );
  });

  it('prints no bank block on a receipt', () => {
    // A receipt says money arrived; it asks for none. `ReceiptDocument` has no
    // `bank` to carry, so this is the page proving the type.
    const page = extractAll(renderDocument(receiptFor(UNREGISTERED), fonts));
    expect(page).not.toContain('Pay by bank transfer');
    expect(page).not.toContain('IBAN');
  });
});
