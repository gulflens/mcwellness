import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  GEOMETRY,
  layout,
  measure,
  type InvoiceDocument,
  type Op,
  type Page,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';

/**
 * The page as geometry, rather than as a stream of words.
 *
 * `tests/billing/document.test.ts` reads the text back through the PDF's own
 * `/ToUnicode` map, which proves what the document *says*. It cannot prove
 * where any of it is — and the design review found that out the hard way: on a
 * document where a reader saw the totals overprinted by the practice's address
 * and a service name running through the figures, every one of those assertions
 * still passed, because every string was in the stream.
 *
 * So this measures the ops `layout` produces, with the same fonts the renderer
 * sets them in, and asserts the three things a reader would check first:
 * nothing outside the margins, nothing off the bottom of the sheet, and no two
 * pieces of type printed on top of each other.
 */

const fonts = documentFonts();

/** How far apart two baselines must be to count as different lines. */
const BAND = 4;
/** Rounding: two boxes touching to within a third of a point are not overlapping. */
const TOLERANCE = 0.34;

type Box = { left: number; right: number; y: number; text: string };

/** Where an op actually sits, measured as the writer will set it. */
function boxOf(op: Op): Box | null {
  if (op.kind !== 'text') return null;
  const width = measure(op.text, op.style, fonts, op.rtl === true);
  const align = op.align ?? (op.rtl === true ? 'end' : 'start');
  const left = align === 'end' ? op.x - width : align === 'centre' ? op.x - width / 2 : op.x;
  return { left, right: left + width, y: op.y, text: op.text };
}

function boxesOf(page: Page): Box[] {
  return page.ops.map(boxOf).filter((box): box is Box => box !== null);
}

const SUPPLIER: SupplierSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
  corporateTaxNumber: '000000000000000',
  vatRegistered: true,
  vatNumber: '100000000000003',
};

/** Everything a household could plausibly make long, made long. */
const LONG_SUPPLIER: SupplierSnapshot = {
  ...SUPPLIER,
  legalName: 'Synthetic Wellness Studio for Neurological Performance and Training',
  legalNameAr: 'استوديو العافية التجريبي للأداء العصبي والتدريب',
  address:
    'Unit 1204, Synthetic Tower Two, Al Fictional Boulevard, Business Quarter, PO Box 000000, Dubai, United Arab Emirates',
  licensingAuthority:
    'Synthetic Department of Economy and Tourism, Commercial Licensing Sector, Northern Division',
};

function invoice(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    kind: 'invoice',
    supplier: SUPPLIER,
    recipient: { name: 'Robin Fairweather', recordNumber: 'MW-000007' },
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
        netFils: 70_000,
        vatRateBasisPoints: 500,
        vatFils: 3_500,
        grossFils: 73_500,
      },
    ],
    netFils: 70_000,
    vatFils: 3_500,
    grossFils: 73_500,
    ...over,
  };
}

function manyLines(count: number): InvoiceDocument['lines'] {
  return Array.from({ length: count }, (_, index) => ({
    description: `Neurofeedback training session ${index + 1}`,
    descriptionAr: 'جلسة نيوروفيدباك',
    quantity: 1,
    unitNetFils: 70_000,
    netFils: 70_000,
    vatRateBasisPoints: 500,
    vatFils: 3_500,
    grossFils: 73_500,
  }));
}

const RECEIPT: ReceiptDocument = {
  kind: 'receipt',
  supplier: LONG_SUPPLIER,
  recipient: { name: 'Robin Alexandrina Fairweather-Montgomery', recordNumber: 'MW-000007' },
  reference: 'RCP-000004',
  receivedOn: '2026-09-02',
  method: 'transfer',
  amountFils: 1_032_500,
  paymentReference: 'SYN 0001',
  settles: { reference: 'INV-000001', issuedOn: '2026-09-02' },
};

/** Every case a page is laid out for, so each assertion runs against all of them. */
const CASES: [string, Page[]][] = [
  ['an ordinary invoice', layout(invoice(), fonts)],
  [
    'an unregistered practice’s invoice',
    layout(invoice({ supplier: { ...SUPPLIER, vatRegistered: false, vatNumber: null } }), fonts),
  ],
  [
    'an invoice with every field long',
    layout(
      invoice({
        supplier: LONG_SUPPLIER,
        recipient: {
          name: 'Robin Alexandrina Fairweather-Montgomery',
          recordNumber: 'MW-000007',
        },
        suppliedOn: '2026-08-28',
        lines: [
          {
            description:
              'Neurofeedback training session with a full protocol review and a written progress summary',
            descriptionAr: 'جلسة نيوروفيدباك مع مراجعة كاملة للبروتوكول وملخص مكتوب للتقدم',
            quantity: 1,
            unitNetFils: 70_000,
            netFils: 70_000,
            vatRateBasisPoints: 500,
            vatFils: 3_500,
            grossFils: 73_500,
          },
        ],
      }),
      fonts,
    ),
  ],
  [
    'a thirty-line invoice',
    layout(
      invoice({ lines: manyLines(30), netFils: 2_100_000, vatFils: 105_000, grossFils: 2_205_000 }),
      fonts,
    ),
  ],
  ['a receipt', layout(RECEIPT, fonts)],
];

describe.each(CASES)('%s', (_name, pages) => {
  it('draws nothing outside the left and right margins', () => {
    for (const page of pages) {
      for (const box of boxesOf(page)) {
        expect(box.left, box.text).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
        expect(box.right, box.text).toBeLessThanOrEqual(
          GEOMETRY.PAGE_WIDTH - GEOMETRY.MARGIN + TOLERANCE,
        );
      }
    }
  });

  it('draws nothing above the top or below the bottom of the sheet', () => {
    for (const page of pages) {
      for (const box of boxesOf(page)) {
        expect(box.y, box.text).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
        expect(box.y, box.text).toBeLessThanOrEqual(GEOMETRY.TOP + TOLERANCE);
      }
      for (const op of page.ops) {
        if (op.kind === 'rule') {
          expect(op.y).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
          expect(op.x + op.width).toBeLessThanOrEqual(
            GEOMETRY.PAGE_WIDTH - GEOMETRY.MARGIN + TOLERANCE,
          );
        }
      }
    }
  });

  it('never prints two pieces of type on top of each other', () => {
    // The fault this exists to catch: a 137-point label in a 132-point gutter,
    // overprinted by its own value on every document ever rendered.
    for (const page of pages) {
      const boxes = boxesOf(page);
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const first = boxes[a];
          const second = boxes[b];
          if (!first || !second) continue;
          if (Math.abs(first.y - second.y) >= BAND) continue;
          const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          expect(
            overlap,
            `"${first.text}" and "${second.text}" overlap by ${overlap.toFixed(1)}pt`,
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    }
  });
});

describe('a document that outgrows its page', () => {
  const pages = layout(
    invoice({ lines: manyLines(30), netFils: 2_100_000, vatFils: 105_000, grossFils: 2_205_000 }),
    fonts,
  );

  it('takes another page rather than running off the first', () => {
    expect(pages.length).toBeGreaterThan(1);
  });

  it('says which sheet is which, on every one of them', () => {
    // A page torn off a stack has to be able to say what it is part of.
    for (const [index, page] of pages.entries()) {
      const folios = boxesOf(page).filter((box) => box.text.startsWith('Page '));
      expect(folios.map((box) => box.text)).toEqual([`Page ${index + 1} of ${pages.length}`]);
    }
  });

  it('carries the practice and the invoice number onto the later sheets', () => {
    const later = pages.slice(1);
    for (const page of later) {
      const text = boxesOf(page).map((box) => box.text);
      expect(text).toContain('Synthetic Wellness Studio');
      expect(text).toContain('INV-000001');
    }
  });

  it('repeats the column headings after a break, so the figures are still labelled', () => {
    const second = pages[1];
    if (!second) throw new Error('There is no second page.');
    expect(boxesOf(second).map((box) => box.text)).toContain('Unit price (AED)');
  });

  it('keeps the totals and the footer on the last page', () => {
    const last = pages[pages.length - 1];
    if (!last) throw new Error('There is no last page.');
    const text = boxesOf(last).map((box) => box.text);
    expect(text).toContain('Total (AED)');
    expect(text).toContain('21,000.00');
    expect(text.some((line) => line.startsWith('A simplified tax invoice'))).toBe(true);
  });
});

describe('a single value long enough to fill the page on its own', () => {
  it('is cut rather than allowed to wrap for ever', () => {
    // A description is a string somebody typed, and rendering is on the path
    // that produces a client's financial record.
    const pages = layout(
      invoice({
        lines: [
          {
            description: 'A'.repeat(5_000),
            descriptionAr: null,
            quantity: 1,
            unitNetFils: 70_000,
            netFils: 70_000,
            vatRateBasisPoints: 500,
            vatFils: 3_500,
            grossFils: 73_500,
          },
        ],
      }),
      fonts,
    );
    expect(pages.length).toBeLessThanOrEqual(4);
    for (const page of pages) {
      for (const box of boxesOf(page)) {
        expect(box.right).toBeLessThanOrEqual(GEOMETRY.PAGE_WIDTH - GEOMETRY.MARGIN + TOLERANCE);
      }
    }
  });
});
