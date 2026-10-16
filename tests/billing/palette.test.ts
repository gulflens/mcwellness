import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  layout,
  type InvoiceDocument,
  type InvoiceLine,
  type Op,
  type Page,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../../domain/shared/document';
import {
  INK,
  LAVENDER,
  LAVENDER_EDGE,
  MUTED,
  RULE,
  VIOLET,
  WASH_FROM,
  WASH_TO,
  WHITE,
} from '../../domain/billing/document/sheet';

/**
 * The colours the two money documents may use, and nothing else.
 *
 * The softer dress of 7 October 2026 (docs/superpowers/specs/2026-10-07-soft-
 * documents-design.md) keeps the round-65 rule — "respect my colors" — and
 * names its colours: the practice's violet as the ink and the accent, white
 * card grounds, `LAVENDER` for bands and blocks, `LAVENDER_EDGE` for card
 * borders, and the page's wash from `WASH_FROM` to `WASH_TO`, with type
 * otherwise in the ink and the greys the documents already use. This walks
 * every op of every page of both documents, over the variants that change
 * what a page draws, and holds each to that:
 *
 * - every `rgb`, on type or on a shape, is one of those six;
 * - every `grey` is `INK`, `MUTED` or `RULE`;
 * - type is set only in the ink, a grey or the violet — never white, never
 *   a lavender — and every type colour reads at WCAG AA (4.5:1) against
 *   every ground the page has, the darkest lavender included;
 * - every page is first painted with the wash, and the wash's two colours
 *   appear nowhere else.
 *
 * A second hue, a new grey, or type too faint for its ground fails here
 * before anyone has to see it on paper.
 */

const fonts = documentFonts();

/** Two colours are the same colour to within floating-point arithmetic. */
const SAME = 1e-9;

type Rgb = readonly [number, number, number];

const PALETTE: ReadonlyArray<readonly [string, Rgb]> = [
  ['VIOLET', VIOLET],
  ['WHITE', WHITE],
  ['LAVENDER', LAVENDER],
  ['LAVENDER_EDGE', LAVENDER_EDGE],
  ['WASH_FROM', WASH_FROM],
  ['WASH_TO', WASH_TO],
];
/** Every colour type may sit on: the cards, the bands and blocks, both ends of the wash. */
const GROUNDS: readonly Rgb[] = [WHITE, LAVENDER, WASH_FROM, WASH_TO];
const GREYS = [INK, MUTED, RULE];

const sameRgb = (a: Rgb, b: Rgb): boolean =>
  a.every((channel, i) => Math.abs(channel - (b[i] as number)) < SAME);
const inPalette = (rgb: Rgb): boolean => PALETTE.some(([, colour]) => sameRgb(rgb, colour));
const isGrey = (grey: number): boolean => GREYS.some((allowed) => Math.abs(grey - allowed) < SAME);

/** Every colour an op carries, as the writer will paint it. */
function coloursOf(op: Op): { rgb: Rgb[]; grey: number[] } {
  switch (op.kind) {
    case 'text':
      return {
        rgb: op.style.rgb ? [op.style.rgb] : [],
        grey: op.style.grey === undefined ? [] : [op.style.grey],
      };
    case 'rule':
      // As a rect's stroke: a rule that names neither is stroked at the
      // writer's own default grey.
      return { rgb: op.rgb ? [op.rgb] : [], grey: op.rgb ? [] : [op.grey ?? 0.8] };
    case 'rect': {
      const rgb: Rgb[] = [];
      const grey: number[] = [];
      if (op.fill) {
        if ('rgb' in op.fill) rgb.push(op.fill.rgb);
        else grey.push(op.fill.grey);
      }
      if (op.stroke) {
        if (op.stroke.rgb) rgb.push(op.stroke.rgb);
        // A stroke that names neither is the writer's own default grey, which
        // is not one of the page's.
        else grey.push(op.stroke.grey ?? 0.8);
      }
      return { rgb, grey };
    }
    case 'image':
      return { rgb: [], grey: [] };
    case 'shade':
      return { rgb: [op.from.rgb, op.to.rgb], grey: [] };
    case 'path': {
      // The money documents draw no path; if one ever does, its paint is
      // held to the same palette. A paint that names neither is ink.
      const rgb: Rgb[] = [];
      const grey: number[] = [];
      for (const paint of [op.fill, op.stroke]) {
        if (!paint) continue;
        if (paint.rgb) rgb.push(paint.rgb);
        else grey.push(paint.grey ?? 0);
      }
      return { rgb, grey };
    }
  }
}

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

/** Invented throughout: no bank, holder or account here is a real one. */
const BANK: NonNullable<InvoiceDocument['bank']> = {
  accountHolder: 'Example Practice L.L.C-FZ',
  iban: 'AE360000000000000000001',
  bic: 'TESTAEXX',
  bankAddress: '1 Example Street, Abu Dhabi',
};

function invoice(
  registered: boolean,
  discounted: boolean,
  bank: boolean,
  count: number,
): InvoiceDocument {
  const off = discounted ? 17_500 : 0;
  const net = 70_000 - off;
  const vat = registered ? Math.round(net * 0.05) : 0;
  const line: InvoiceLine = {
    description: 'Neurofeedback session',
    descriptionAr: 'جلسة نيوروفيدباك',
    quantity: 1,
    unitNetFils: 70_000,
    discountFils: off,
    discountBasisPoints: discounted ? 2_500 : null,
    netFils: net,
    vatRateBasisPoints: registered ? 500 : 0,
    vatFils: vat,
    grossFils: net + vat,
  };
  return {
    kind: 'invoice',
    supplier: registered ? REGISTERED : SUPPLIER,
    recipient: { name: 'Hazel Dune', recordNumber: 'MW-000099' },
    reference: 'INV-000099',
    issuedOn: '2026-09-24',
    suppliedOn: null,
    waivedOn: null,
    lines: Array.from({ length: count }, () => line),
    netFils: net * count,
    vatFils: vat * count,
    grossFils: (net + vat) * count,
    discountFils: off * count,
    discountBasisPoints: discounted ? 2_500 : null,
    bank: bank ? BANK : null,
  };
}

function receipt(method: ReceiptDocument['method'], settles: boolean): ReceiptDocument {
  return {
    kind: 'receipt',
    supplier: SUPPLIER,
    recipient: { name: 'Hazel Dune', recordNumber: 'MW-000099' },
    reference: 'RCP-000099',
    receivedOn: '2026-09-24',
    method,
    amountFils: 596_250,
    paymentReference: 'SYN 0001',
    settles: settles ? { reference: 'INV-000099', issuedOn: '2026-09-24' } : null,
  };
}

const CASES: { name: string; pages: Page[] }[] = [];
for (const registered of [false, true]) {
  for (const discounted of [false, true]) {
    for (const bank of [false, true]) {
      // One line, and enough to take a second sheet with its running header
      // and the table's violet band drawn again.
      for (const count of [1, 30]) {
        CASES.push({
          name: `invoice, ${registered ? 'registered' : 'unregistered'}, ${discounted ? 'discounted' : 'full price'}, ${bank ? 'bank' : 'no bank'}, ${count} lines`,
          pages: layout(invoice(registered, discounted, bank, count), fonts),
        });
      }
    }
  }
}
// The two sentences and the pair only some invoices carry: a waived fee's
// notice in the tax card, and the date of supply on the number card.
CASES.push({
  name: 'invoice, unregistered, waived',
  pages: layout({ ...invoice(false, false, true, 1), waivedOn: '2026-09-25' }, fonts),
});
CASES.push({
  name: 'invoice, registered, with a date of supply',
  pages: layout({ ...invoice(true, true, true, 1), suppliedOn: '2026-09-20' }, fonts),
});
for (const method of ['cash', 'transfer', 'link'] as const) {
  for (const settles of [false, true]) {
    CASES.push({
      name: `receipt by ${method}, ${settles ? 'settling an invoice' : 'on account'}`,
      pages: layout(receipt(method, settles), fonts),
    });
  }
}

describe('the palette both money documents may use', () => {
  it('sets every colour in the six named colours, and every grey in the ink or the two greys', () => {
    for (const { name, pages } of CASES) {
      pages.forEach((page, index) => {
        for (const op of page.ops) {
          const { rgb, grey } = coloursOf(op);
          const at = `${name}, page ${index + 1}, ${op.kind}${op.kind === 'text' ? ` "${op.text}"` : ''}`;
          for (const colour of rgb)
            expect(inPalette(colour), `${at}: rgb ${colour.join(', ')}`).toBe(true);
          for (const each of grey) expect(isGrey(each), `${at}: grey ${each}`).toBe(true);
        }
      });
    }
  });

  it('sets type only in the ink, a grey or the violet', () => {
    for (const { name, pages } of CASES) {
      pages.forEach((page, index) => {
        for (const op of page.ops) {
          if (op.kind !== 'text' || !op.style.rgb) continue;
          expect(sameRgb(op.style.rgb, VIOLET), `${name}, page ${index + 1}: "${op.text}"`).toBe(
            true,
          );
        }
      });
    }
  });

  it('sets every colour of type at 4.5:1 or better against every ground it could sit on', () => {
    const colours = new Map<string, Rgb>();
    for (const { pages } of CASES) {
      for (const page of pages) {
        for (const op of page.ops) {
          if (op.kind !== 'text') continue;
          const grey = op.style.grey ?? 0;
          const rgb: Rgb = op.style.rgb ?? [grey, grey, grey];
          colours.set(rgb.join(','), rgb);
        }
      }
    }
    // Ink, the muted grey and the violet at least.
    expect(colours.size).toBeGreaterThanOrEqual(3);
    for (const [key, colour] of colours) {
      for (const ground of GROUNDS) {
        expect(contrast(colour, ground), `${key} on ${ground.join(',')}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('paints every page first with the wash, corner to corner, and the wash’s colours nowhere else', () => {
    for (const { name, pages } of CASES) {
      pages.forEach((page, index) => {
        const at = `${name}, page ${index + 1}`;
        const [first, ...rest] = page.ops;
        expect(first?.kind, at).toBe('shade');
        if (first?.kind !== 'shade') return;
        expect(first.x, at).toBe(0);
        expect(first.y, at).toBe(0);
        expect(first.width, at).toBeCloseTo(PAGE_WIDTH, 5);
        expect(first.height, at).toBeCloseTo(PAGE_HEIGHT, 5);
        expect(sameRgb(first.from.rgb, WASH_FROM), at).toBe(true);
        expect(sameRgb(first.to.rgb, WASH_TO), at).toBe(true);
        for (const op of rest) {
          expect(op.kind, at).not.toBe('shade');
          for (const colour of coloursOf(op).rgb) {
            expect(sameRgb(colour, WASH_FROM) || sameRgb(colour, WASH_TO), at).toBe(false);
          }
        }
      });
    }
  });
});

/** WCAG relative luminance of an sRGB colour. */
function luminance(rgb: Rgb): number {
  const linear = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
  );
}

/** WCAG contrast ratio between two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
