import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  GEOMETRY,
  groupIban,
  layout,
  layoutWithBlocks,
  measure,
  type Block,
  type BlockName,
  type InvoiceDocument,
  type InvoiceLine,
  type Op,
  type Page,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';

/**
 * The invoice in the operator's design of 24 September 2026, as geometry
 * rather than as a stream of words.
 *
 * `tests/billing/document.test.ts` reads the text back through the PDF's own
 * `/ToUnicode` map, which proves what the document *says*. It cannot prove
 * where any of it is — and the design review of 8 September found that out
 * the hard way: on a page where a reader saw the totals overprinted by the
 * practice's address, every one of those assertions still passed.
 *
 * So this reads two things `layout` produces. The **blocks** the page is made
 * of — the masthead, the supplier block and the number card, the billed-to
 * card and the payment method, the table's violet header and its rows, the
 * payment and summary cards, the tax card and the footer — as the boxes the
 * layout drew them in (`layoutWithBlocks`), for one to forty lines, both
 * registrations, a discount typed as a percentage, as a sum or none, with and
 * without a bank account and with and without a waiver: none crosses a
 * margin, none overlaps another, the header is at the top of every page the
 * table touches, the two cards and the tax card stay together, the footer is
 * pinned. And the **type** itself, measured with the fonts the renderer sets
 * it in: every piece of it inside the block it belongs to, none of it outside
 * the margins, and no two pieces printed on top of each other.
 */

const fonts = documentFonts();

/** How far apart two baselines must be to count as different lines. */
const BAND = 4;
/** Rounding: two boxes touching to within a third of a point are not overlapping. */
const TOLERANCE = 0.34;

type Box = { left: number; right: number; y: number; text: string };

/** Where a text op actually sits, measured as the writer will set it. */
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

/** A tiny synthetic PNG's worth of image, so a page can be laid out with a mark on it. */
const LOGO = {
  width: 1024,
  height: 500,
  colours: 'rgb' as const,
  data: new Uint8Array([0x78, 0x9c]),
};

const SUPPLIER: SupplierSnapshot = {
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
  ...SUPPLIER,
  vatRegistered: true,
  vatNumber: '100000000000003',
};

/** Everything a practice could plausibly make long, made long. */
const LONG_SUPPLIER: SupplierSnapshot = {
  ...REGISTERED,
  legalName: 'Synthetic Wellness Studio for Neurological Performance and Training',
  legalNameAr: 'استوديو العافية التجريبي للأداء العصبي والتدريب',
  address:
    'Unit 1204, Synthetic Tower Two, Al Fictional Boulevard, Business Quarter, PO Box 000000, Dubai, United Arab Emirates',
  licensingAuthority:
    'Synthetic Department of Economy and Tourism, Commercial Licensing Sector, Northern Division',
};

/** Invented throughout: no bank, holder or account here is a real one. */
const BANK: NonNullable<InvoiceDocument['bank']> = {
  accountHolder: 'Example Practice L.L.C-FZ',
  iban: 'AE360000000000000000001',
  bic: 'TESTAEXX',
  bankAddress: '1 Example Street, Abu Dhabi',
};

/**
 * The practice's bank account at the longest the columns allow (migration
 * 924: a holder of 120 characters, a bank address of 200). Invented throughout.
 */
const LONG_BANK: NonNullable<InvoiceDocument['bank']> = {
  accountHolder: 'Example Practice L.L.C-FZ, Trading as the Example Wellness Studio '
    .repeat(2)
    .slice(0, 120),
  iban: 'AE360000000000000000001',
  bic: 'TESTAEXX',
  bankAddress: 'Unit 1, 1 Example Street, Example Business Quarter, Example District, Abu Dhabi '
    .repeat(3)
    .slice(0, 200),
};

type Discount = 'percentage' | 'sum' | 'none';

type Shape = {
  count: number;
  registered: boolean;
  discount: Discount;
  bank: boolean;
  waived: boolean;
};

/** A line of AED 700.00, discounted as `discount` says, with VAT when registered. */
function lineOf(index: number, registered: boolean, discount: Discount): InvoiceLine {
  const off = discount === 'none' ? 0 : 17_500;
  const net = 70_000 - off;
  const vat = registered ? Math.round(net * 0.05) : 0;
  return {
    description: `Neurofeedback training session ${index + 1}`,
    descriptionAr: 'جلسة نيوروفيدباك',
    quantity: 1,
    unitNetFils: 70_000,
    discountFils: off,
    discountBasisPoints: discount === 'percentage' ? 2_500 : null,
    netFils: net,
    vatRateBasisPoints: registered ? 500 : 0,
    vatFils: vat,
    grossFils: net + vat,
  };
}

function invoiceOf(
  lines: readonly InvoiceLine[],
  over: Partial<InvoiceDocument> = {},
): InvoiceDocument {
  const sum = (pick: (line: InvoiceLine) => number): number =>
    lines.reduce((total, line) => total + pick(line), 0);
  const shares = new Set(lines.map((line) => line.discountBasisPoints));
  const first = lines[0];
  return {
    kind: 'invoice',
    supplier: SUPPLIER,
    recipient: { name: 'Hazel Dune', recordNumber: 'MW-000099' },
    reference: 'INV-000099',
    issuedOn: '2026-09-24',
    suppliedOn: null,
    waivedOn: null,
    lines,
    netFils: sum((line) => line.netFils),
    vatFils: sum((line) => line.vatFils),
    grossFils: sum((line) => line.grossFils),
    discountFils: sum((line) => line.discountFils),
    discountBasisPoints:
      shares.size === 1 && first && first.discountFils > 0 ? first.discountBasisPoints : null,
    bank: null,
    ...over,
  };
}

function invoiceShaped(shape: Shape): InvoiceDocument {
  const lines = Array.from({ length: shape.count }, (_, index) =>
    lineOf(index, shape.registered, shape.discount),
  );
  return invoiceOf(lines, {
    supplier: shape.registered ? REGISTERED : SUPPLIER,
    bank: shape.bank ? BANK : null,
    waivedOn: shape.waived ? '2026-09-25' : null,
  });
}

const nameOf = (shape: Shape): string =>
  `${shape.count} lines, ${shape.registered ? 'registered' : 'unregistered'}, ` +
  `discount ${shape.discount}, ${shape.bank ? 'bank' : 'no bank'}, ` +
  `${shape.waived ? 'waived' : 'standing'}`;

/** Every shape of the matrix: 1 to 40 lines by every flag. */
const SHAPES: Shape[] = [];
for (let count = 1; count <= 40; count += 1) {
  for (const registered of [false, true]) {
    for (const discount of ['percentage', 'sum', 'none'] as const) {
      for (const bank of [false, true]) {
        for (const waived of [false, true]) {
          SHAPES.push({ count, registered, discount, bank, waived });
        }
      }
    }
  }
}

type Laid = { name: string; pages: Page[]; blocks: Block[][] };

const MATRIX: Laid[] = SHAPES.map((shape) => ({
  name: nameOf(shape),
  ...layoutWithBlocks(invoiceShaped(shape), fonts),
}));

/** A few of the matrix's line counts, for the checks that measure every piece of type. */
const SAMPLED = MATRIX.filter((laid) => /^(1|2|9|17|40) lines/.test(laid.name));

/** The long cases: every field a practice or a household could make long, made long. */
const LONG: Laid[] = [
  {
    name: 'every field long, with a long bank account',
    ...layoutWithBlocks(
      invoiceOf(
        [
          {
            ...lineOf(0, true, 'percentage'),
            description:
              'Neurofeedback training session with a full protocol review and a written progress summary',
            descriptionAr: 'جلسة نيوروفيدباك مع مراجعة كاملة للبروتوكول وملخص مكتوب للتقدم',
          },
        ],
        {
          supplier: LONG_SUPPLIER,
          recipient: {
            name: 'Hazel Juniper Saffron Dune-Harbour-Lagoon',
            recordNumber: 'MW-000099',
          },
          suppliedOn: '2026-09-20',
          bank: LONG_BANK,
          waivedOn: '2026-09-25',
        },
      ),
      fonts,
    ),
  },
  {
    name: 'a 34-character IBAN',
    ...layoutWithBlocks(
      invoiceOf([lineOf(0, false, 'sum')], {
        bank: { ...LONG_BANK, iban: `AB12${'0'.repeat(30)}` },
      }),
      fonts,
    ),
  },
  {
    name: 'a figure in the millions, registered, discounted',
    ...layoutWithBlocks(
      invoiceOf(
        Array.from({ length: 2 }, () => ({
          description: 'Neurofeedback programme, ten sessions',
          descriptionAr: 'جلسة نيوروفيدباك',
          quantity: 10,
          unitNetFils: 69_000_000,
          discountFils: 69_000_000,
          discountBasisPoints: 1_000,
          netFils: 621_000_000,
          vatRateBasisPoints: 500,
          vatFils: 31_050_000,
          grossFils: 652_050_000,
        })),
        { supplier: REGISTERED, bank: LONG_BANK },
      ),
      fonts,
    ),
  },
  // A footer five lines deep rises into the page, and the flow above it
  // has to stop short of wherever its hairline lands, on every length of table.
  ...Array.from({ length: 40 }, (_, index) => ({
    name: `${index + 1} lines above a footer five lines deep`,
    ...layoutWithBlocks(
      invoiceOf(
        Array.from({ length: index + 1 }, (__, line) => lineOf(line, true, 'percentage')),
        {
          supplier: {
            ...LONG_SUPPLIER,
            address: `${LONG_SUPPLIER.address ?? ''}, `.repeat(5).slice(0, 560),
          },
          bank: BANK,
        },
      ),
      fonts,
    ),
  })),
  {
    name: 'an invoice carrying the practice’s mark',
    ...layoutWithBlocks(invoiceShaped({ ...SHAPES[0]!, bank: true }), fonts, LOGO),
  },
];

const blocksNamed = (blocks: readonly Block[], name: BlockName): Block[] =>
  blocks.filter((block) => block.name === name);

const where = (laid: Laid, page: number, block?: Block): string =>
  `${laid.name}, page ${page + 1}${block ? `, ${block.name}` : ''}`;

describe.each([
  ['the matrix of 1 to 40 lines by every variant', MATRIX],
  ['the long cases', LONG],
])('%s', (_title, cases) => {
  it('draws no block across a margin', () => {
    for (const laid of cases) {
      laid.blocks.forEach((blocks, page) => {
        for (const block of blocks) {
          const at = where(laid, page, block);
          expect(block.left, at).toBeGreaterThanOrEqual(GEOMETRY.LEFT - TOLERANCE);
          expect(block.right, at).toBeLessThanOrEqual(GEOMETRY.RIGHT + TOLERANCE);
          expect(block.top, at).toBeLessThanOrEqual(GEOMETRY.TOP + TOLERANCE);
          expect(block.bottom, at).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
          expect(block.top, at).toBeGreaterThan(block.bottom);
        }
      });
    }
  });

  it('never draws two blocks over each other', () => {
    for (const laid of cases) {
      laid.blocks.forEach((blocks, page) => {
        for (let a = 0; a < blocks.length; a += 1) {
          for (let b = a + 1; b < blocks.length; b += 1) {
            const first = blocks[a] as Block;
            const second = blocks[b] as Block;
            const across = Math.min(first.right, second.right) - Math.max(first.left, second.left);
            const down = Math.min(first.top, second.top) - Math.max(first.bottom, second.bottom);
            expect(
              across > TOLERANCE && down > TOLERANCE,
              `${where(laid, page)}: ${first.name} and ${second.name} overlap`,
            ).toBe(false);
          }
        }
      });
    }
  });

  it('sets the masthead, the supplier and number card, and the billed-to card at the top of the first page, in that order', () => {
    for (const laid of cases) {
      const first = laid.blocks[0] ?? [];
      const [masthead] = blocksNamed(first, 'masthead');
      const [supplier] = blocksNamed(first, 'supplier');
      const [numberCard] = blocksNamed(first, 'numberCard');
      const [billedTo] = blocksNamed(first, 'billedTo');
      if (!masthead || !supplier || !numberCard || !billedTo) {
        throw new Error(`${laid.name}: a block of the head of the page is missing`);
      }
      expect(masthead.top, laid.name).toBeCloseTo(GEOMETRY.TOP, 5);
      expect(supplier.top, laid.name).toBeLessThan(masthead.bottom);
      expect(numberCard.top, laid.name).toBeCloseTo(supplier.top, 5);
      expect(supplier.right, laid.name).toBeLessThan(numberCard.left);
      expect(billedTo.top, laid.name).toBeLessThan(Math.min(supplier.bottom, numberCard.bottom));
      // None of these on a later page.
      for (const later of laid.blocks.slice(1)) {
        for (const name of ['masthead', 'supplier', 'numberCard', 'billedTo'] as const) {
          expect(blocksNamed(later, name), `${laid.name}: ${name}`).toHaveLength(0);
        }
      }
    }
  });

  it('sets the payment method beside the billed-to card exactly when there is a bank account', () => {
    for (const laid of cases) {
      const first = laid.blocks[0] ?? [];
      const method = blocksNamed(first, 'paymentMethod');
      const hasBank = laid.blocks.flat().some((block) => block.name === 'paymentCard');
      expect(method, laid.name).toHaveLength(hasBank ? 1 : 0);
      const [billedTo] = blocksNamed(first, 'billedTo');
      if (method[0] && billedTo) {
        expect(method[0].top, laid.name).toBeCloseTo(billedTo.top, 5);
        expect(method[0].left, laid.name).toBeGreaterThan(billedTo.right);
      }
    }
  });

  it('puts the violet header at the top of every page the table touches', () => {
    for (const laid of cases) {
      const touched = laid.blocks
        .map((blocks, page) => ({ blocks, page }))
        .filter(({ blocks }) => blocksNamed(blocks, 'tableRows').length > 0);
      expect(touched.length, laid.name).toBeGreaterThan(0);
      touched.forEach(({ blocks, page }, index) => {
        const headers = blocksNamed(blocks, 'tableHeader');
        const rows = blocksNamed(blocks, 'tableRows');
        expect(headers, where(laid, page)).toHaveLength(1);
        expect(rows, where(laid, page)).toHaveLength(1);
        const header = headers[0] as Block;
        const body = rows[0] as Block;
        // The rows hang straight from the header, across the same width.
        expect(body.top, where(laid, page)).toBeCloseTo(header.bottom, 5);
        expect(body.left, where(laid, page)).toBeCloseTo(header.left, 5);
        expect(body.right, where(laid, page)).toBeCloseTo(header.right, 5);
        if (index > 0) {
          // A page taken mid-table: nothing above the header but the running
          // header the sheet itself draws.
          for (const block of blocks) {
            expect(block.top, where(laid, page, block)).toBeLessThanOrEqual(header.top + TOLERANCE);
          }
        }
      });
      // And the pages it touches are consecutive, from the first.
      touched.forEach(({ page }, index) => {
        expect(page, laid.name).toBe((touched[0]?.page ?? 0) + index);
      });
      expect(touched[0]?.page, laid.name).toBe(0);
    }
  });

  it('keeps the payment and summary cards on one page, side by side, with the tax card after them', () => {
    for (const laid of cases) {
      const holding = laid.blocks
        .map((blocks, page) => ({ blocks, page }))
        .filter(({ blocks }) => blocksNamed(blocks, 'summaryCard').length > 0);
      expect(holding, laid.name).toHaveLength(1);
      const { blocks, page } = holding[0] as { blocks: Block[]; page: number };
      const summary = blocksNamed(blocks, 'summaryCard')[0] as Block;
      const payment = blocksNamed(blocks, 'paymentCard')[0];
      const tax = blocksNamed(blocks, 'taxCard');
      expect(tax, where(laid, page)).toHaveLength(1);
      // The summary keeps its place on the right whether or not the payment
      // card is beside it.
      expect(summary.right, where(laid, page)).toBeCloseTo(GEOMETRY.RIGHT, 5);
      if (payment) {
        expect(payment.top, where(laid, page)).toBeCloseTo(summary.top, 5);
        expect(payment.left, where(laid, page)).toBeCloseTo(GEOMETRY.LEFT, 5);
        expect(payment.right, where(laid, page)).toBeLessThan(summary.left);
      }
      const cardsBottom = Math.min(summary.bottom, payment?.bottom ?? Infinity);
      expect((tax[0] as Block).top, where(laid, page)).toBeLessThan(cardsBottom);
      expect((tax[0] as Block).left, where(laid, page)).toBeCloseTo(GEOMETRY.LEFT, 5);
      expect((tax[0] as Block).right, where(laid, page)).toBeCloseTo(GEOMETRY.RIGHT, 5);
      // After the table, never before it.
      const lastRows = laid.blocks
        .map((each, index) => ({ each, index }))
        .filter(({ each }) => blocksNamed(each, 'tableRows').length > 0)
        .pop();
      if (!lastRows) throw new Error(`${laid.name}: no table`);
      expect(page, laid.name).toBeGreaterThanOrEqual(lastRows.index);
      if (page === lastRows.index) {
        const rows = blocksNamed(lastRows.each, 'tableRows')[0] as Block;
        expect(summary.top, laid.name).toBeLessThan(rows.bottom);
      }
      // No payment card anywhere else, and one exactly when there is a bank account.
      expect(
        laid.blocks.flat().filter((block) => block.name === 'paymentCard').length,
        laid.name,
      ).toBe(payment ? 1 : 0);
    }
  });

  it('pins the footer to the foot of the last page, below everything else on it', () => {
    for (const laid of cases) {
      const last = laid.blocks.length - 1;
      laid.blocks.forEach((blocks, page) => {
        expect(blocksNamed(blocks, 'footer'), where(laid, page)).toHaveLength(
          page === last ? 1 : 0,
        );
      });
      const blocks = laid.blocks[last] ?? [];
      const footer = blocksNamed(blocks, 'footer')[0] as Block;
      expect(footer.bottom, laid.name).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
      for (const block of blocks) {
        if (block === footer) continue;
        expect(block.bottom, where(laid, last, block)).toBeGreaterThan(footer.top);
      }
    }
  });
});

describe('the head of the page', () => {
  const pick = (registered: boolean): Laid =>
    MATRIX.find((each) =>
      each.name.startsWith(`1 lines, ${registered ? 'registered' : 'unregistered'}`),
    ) as Laid;

  it.each([false, true])(
    'sets each supplier row on one line, the Arabic level with the English (registered: %s)',
    (registered) => {
      const page = pick(registered).pages[0] as Page;
      const texts = page.ops.filter((op) => op.kind === 'text');
      // The rows whose length is fixed by what they carry. A licensing
      // authority is a name, and one as long as this fixture's sets its Arabic
      // on the line beneath rather than through the English (the long cases).
      const labels = ['Licence number', 'Corporate tax registration number'];
      if (registered) labels.push('VAT registration number');
      for (const label of labels) {
        const english = texts.filter((op) => op.kind === 'text' && op.text.startsWith(label));
        expect(english, label).toHaveLength(1);
        const [row] = english;
        if (!row || row.kind !== 'text') throw new Error(label);
        // The Arabic half of the same row: right-to-left, on the same baseline.
        const arabic = texts.filter(
          (op) => op.kind === 'text' && op.rtl === true && Math.abs(op.y - row.y) < 0.01,
        );
        expect(arabic, label).toHaveLength(1);
      }
    },
  );

  it('draws a violet bar down the number card’s left edge', () => {
    const laid = pick(false);
    const card = blocksNamed(laid.blocks[0] ?? [], 'numberCard')[0] as Block;
    const bar = (laid.pages[0] as Page).ops.find(
      (op) =>
        op.kind === 'rect' &&
        Math.abs(op.x - card.left) < 0.01 &&
        Math.abs(op.width - GEOMETRY.BAR_WIDTH) < 0.01,
    );
    if (!bar || bar.kind !== 'rect') throw new Error('No bar was drawn.');
    expect(bar.fill).toEqual({ rgb: GEOMETRY.VIOLET });
    expect(bar.y).toBeCloseTo(card.bottom, 5);
    expect(bar.y + bar.height).toBeCloseTo(card.top, 5);
  });

  it('draws a hairline across the page between the supplier row and the billed-to card', () => {
    const laid = pick(false);
    const blocks = laid.blocks[0] ?? [];
    const above = Math.min(
      ...['supplier', 'numberCard'].map(
        (name) => (blocksNamed(blocks, name as BlockName)[0] as Block).bottom,
      ),
    );
    const below = (blocksNamed(blocks, 'billedTo')[0] as Block).top;
    const rules = (laid.pages[0] as Page).ops.filter(
      (op) =>
        op.kind === 'rule' &&
        op.x === GEOMETRY.LEFT &&
        Math.abs(op.width - (GEOMETRY.RIGHT - GEOMETRY.LEFT)) < 0.01 &&
        op.y < above &&
        op.y > below,
    );
    expect(rules).toHaveLength(1);
  });
});

describe('the summary card', () => {
  it('sets its title on a tinted band across the top of the card', () => {
    // The band is part of the summary card's own block, not a block of its own.
    for (const laid of [MATRIX[0], MATRIX[MATRIX.length - 1]] as Laid[]) {
      const index = laid.blocks.findIndex((each) => blocksNamed(each, 'summaryCard').length > 0);
      const card = blocksNamed(laid.blocks[index] ?? [], 'summaryCard')[0] as Block;
      const band = (laid.pages[index] as Page).ops.find(
        (op) =>
          op.kind === 'rect' &&
          Math.abs(op.x - card.left) < 0.01 &&
          Math.abs(op.y + op.height - card.top) < 0.01 &&
          Math.abs(op.width - (card.right - card.left)) < 0.01 &&
          op.stroke === undefined,
      );
      if (!band || band.kind !== 'rect') throw new Error(`${laid.name}: no title band`);
      expect(band.height).toBeCloseTo(GEOMETRY.TITLE_BAND, 5);
      const text = boxesOf(laid.pages[index] as Page).filter(
        (box) => box.y < card.top && box.y > card.top - GEOMETRY.TITLE_BAND,
      );
      expect(text.map((box) => box.text)).toContain('Invoice summary');
    }
  });
});

describe('a page number', () => {
  it('is on no page of any invoice, however many sheets it takes', () => {
    for (const laid of MATRIX) {
      for (const page of laid.pages) {
        expect(
          boxesOf(page).some((box) => box.text.startsWith('Page ')),
          laid.name,
        ).toBe(false);
      }
    }
  });
});

describe('the footer’s place', () => {
  it('is the same on every invoice of the same practice, however many lines it has', () => {
    const bottoms = new Set(
      MATRIX.map((laid) => {
        const blocks = laid.blocks[laid.blocks.length - 1] ?? [];
        return blocksNamed(blocks, 'footer')[0]?.bottom.toFixed(3);
      }),
    );
    expect([...bottoms]).toHaveLength(1);
  });
});

describe.each([
  ['a sample of the matrix', SAMPLED],
  ['the long cases', LONG],
])('the type on %s', (_title, cases) => {
  it('sets every piece of type inside the block it belongs to', () => {
    for (const laid of cases) {
      laid.pages.forEach((page, index) => {
        const blocks = laid.blocks[index] ?? [];
        for (const box of boxesOf(page)) {
          // The sheet's own running header, outside any block.
          if (index > 0 && box.y >= GEOMETRY.TOP - TOLERANCE) continue;
          const home = blocks.find(
            (block) =>
              box.y <= block.top + TOLERANCE &&
              box.y >= block.bottom - TOLERANCE &&
              box.left >= block.left - TOLERANCE &&
              box.right <= block.right + TOLERANCE,
          );
          expect(home, `${where(laid, index)}: "${box.text}" is in no block`).toBeDefined();
        }
      });
    }
  });

  it('draws no type outside the margins', () => {
    for (const laid of cases) {
      laid.pages.forEach((page, index) => {
        for (const box of boxesOf(page)) {
          const at = `${where(laid, index)}: ${box.text}`;
          expect(box.left, at).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
          expect(box.right, at).toBeLessThanOrEqual(GEOMETRY.RIGHT + TOLERANCE);
          expect(box.y, at).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
          expect(box.y, at).toBeLessThanOrEqual(GEOMETRY.TOP + TOLERANCE);
        }
      });
    }
  });

  it('never prints two pieces of type on top of each other', () => {
    for (const laid of cases) {
      laid.pages.forEach((page, index) => {
        const boxes = boxesOf(page);
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const first = boxes[a] as Box;
            const second = boxes[b] as Box;
            if (Math.abs(first.y - second.y) >= BAND) continue;
            const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left);
            expect(
              overlap,
              `${where(laid, index)}: "${first.text}" and "${second.text}" overlap by ${overlap.toFixed(1)}pt`,
            ).toBeLessThanOrEqual(TOLERANCE);
          }
        }
      });
    }
  });
});

describe('the payment card', () => {
  /** The text of the page whose box sits inside the payment card's rows. */
  function inCard(laid: Laid): { card: Block; boxes: Box[] } {
    const index = laid.blocks.findIndex((blocks) => blocksNamed(blocks, 'paymentCard').length > 0);
    const card = blocksNamed(laid.blocks[index] ?? [], 'paymentCard')[0];
    const page = laid.pages[index];
    if (!card || !page) throw new Error(`${laid.name}: no payment card`);
    const boxes = boxesOf(page).filter(
      (box) =>
        box.y < card.top && box.y > card.bottom && box.left < card.right && box.right > card.left,
    );
    return { card, boxes };
  }

  it('holds a long holder and a long bank address inside its walls, wrapped and never cut', () => {
    const laid = LONG.find((each) => each.name.startsWith('every field long')) as Laid;
    const { card, boxes } = inCard(laid);
    for (const box of boxes) {
      expect(box.left, box.text).toBeGreaterThanOrEqual(card.left + GEOMETRY.PAD - TOLERANCE);
      expect(box.right, box.text).toBeLessThanOrEqual(card.right - GEOMETRY.PAD + TOLERANCE);
    }
    const text = boxes.map((box) => box.text).join(' ');
    expect(text).not.toContain('…');
    expect(text.replace(/\s+/g, ' ')).toContain(LONG_BANK.bankAddress?.trim().split(' ').pop());
    // The holder and the address each took more than one line.
    const holderLines = boxes.filter((box) => LONG_BANK.accountHolder.includes(box.text.trim()));
    expect(holderLines.length).toBeGreaterThan(1);
  });

  it('wraps a 34-character IBAN at a group boundary, inside its walls', () => {
    // The longest IBAN migration 924 allows: two letters, two digits, up to
    // thirty more — 34 characters, invented for geometry only. Grouped in
    // fours that is nine groups, and `sheet.wrap` breaks only on the spaces
    // `groupIban` put in, never inside a group.
    const laid = LONG.find((each) => each.name === 'a 34-character IBAN') as Laid;
    const grouped = groupIban(`AB12${'0'.repeat(30)}`);
    const tokens = grouped.split(' ');
    const { card, boxes } = inCard(laid);
    const iban = boxes.filter((box) => box.text.split(' ').every((part) => tokens.includes(part)));
    expect(
      iban
        .slice()
        .sort((a, b) => b.y - a.y)
        .map((box) => box.text)
        .join(' '),
    ).toBe(grouped);
    expect(iban.length).toBeGreaterThan(1);
    for (const box of iban) {
      expect(box.left, box.text).toBeGreaterThanOrEqual(card.left + GEOMETRY.PAD - TOLERANCE);
      expect(box.right, box.text).toBeLessThanOrEqual(card.right - GEOMETRY.PAD + TOLERANCE);
    }
  });
});

describe('the practice’s mark', () => {
  it('is set against the left margin at the top, LOGO_WIDTH wide, in the proportions of the file', () => {
    const laid = LONG.find((each) => each.name.includes('mark')) as Laid;
    const page = laid.pages[0] as Page;
    const drawn = page.ops.filter((op) => op.kind === 'image');
    expect(drawn).toHaveLength(1);
    const mark = drawn[0];
    if (!mark || mark.kind !== 'image') throw new Error('The mark was not drawn.');
    expect(mark.width).toBe(GEOMETRY.LOGO_WIDTH);
    expect(mark.height).toBeCloseTo((GEOMETRY.LOGO_WIDTH * LOGO.height) / LOGO.width, 5);
    expect(mark.x).toBeCloseTo(GEOMETRY.LEFT, 5);
    expect(mark.y + mark.height).toBeCloseTo(GEOMETRY.TOP, 5);
    const masthead = blocksNamed(laid.blocks[0] ?? [], 'masthead')[0] as Block;
    expect(mark.y).toBeGreaterThanOrEqual(masthead.bottom - TOLERANCE);
  });

  it('gives way to the wordmark set in type when the practice has none', () => {
    const page = (MATRIX[0] as Laid).pages[0] as Page;
    expect(page.ops.some((op) => op.kind === 'image')).toBe(false);
    expect(boxesOf(page).map((box) => box.text)).toContain('McWellness');
  });
});

describe('a table that outgrows its page', () => {
  const laid = MATRIX.find((each) => each.name.startsWith('40 lines, registered')) as Laid;

  it('takes another page and carries the practice and the invoice number onto it', () => {
    expect(laid.pages.length).toBeGreaterThan(1);
    for (const page of laid.pages.slice(1)) {
      const text = boxesOf(page).map((box) => box.text);
      expect(text).toContain('Synthetic Wellness Studio');
      expect(text).toContain('INV-000099');
    }
  });

  it('repeats the column headings on the next page, so the figures are still labelled', () => {
    const second = laid.pages[1] as Page;
    expect(boxesOf(second).map((box) => box.text)).toContain('Unit price');
  });
});

describe('a receipt, still on the page it had (round 65 redraws it next)', () => {
  const RECEIPT: ReceiptDocument = {
    kind: 'receipt',
    supplier: LONG_SUPPLIER,
    recipient: { name: 'Hazel Juniper Saffron Dune-Harbour-Lagoon', recordNumber: 'MW-000099' },
    reference: 'RCP-000004',
    receivedOn: '2026-09-02',
    method: 'transfer',
    amountFils: 1_032_500,
    paymentReference: 'SYN 0001',
    settles: { reference: 'INV-000001', issuedOn: '2026-09-02' },
  };
  const pages = layout(RECEIPT, fonts);

  it('draws no type outside the margins and none over other type', () => {
    for (const page of pages) {
      const boxes = boxesOf(page);
      for (const box of boxes) {
        expect(box.left, box.text).toBeGreaterThanOrEqual(GEOMETRY.MARGIN - TOLERANCE);
        expect(box.right, box.text).toBeLessThanOrEqual(GEOMETRY.RIGHT + TOLERANCE);
      }
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const first = boxes[a] as Box;
          const second = boxes[b] as Box;
          if (Math.abs(first.y - second.y) >= BAND) continue;
          const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          expect(overlap, `"${first.text}" and "${second.text}"`).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    }
  });
});
