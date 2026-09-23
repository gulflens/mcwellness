import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  layout,
  measure,
  type InvoiceDocument,
  type InvoiceLine,
  type Op,
  type Page,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';
import {
  CARD,
  EDGE,
  INK,
  MUTED,
  PILL,
  RULE,
  VIOLET,
  WHITE,
} from '../../domain/billing/document/sheet';

/**
 * The colours the two money documents may use, and nothing else.
 *
 * The operator's first instruction for the design of 24 September 2026 was
 * "respect my colors" (docs/superpowers/specs/2026-09-24-invoice-redesign-
 * design.md): the practice's violet, white on violet, and the three tints of
 * that violet for cards, with type otherwise in the ink and the greys the
 * documents already use. This walks every op of every page of both documents,
 * over the variants that change what a page draws, and holds each to that:
 *
 * - every `rgb`, on type or on a shape, is `VIOLET`, `CARD`, `EDGE`, `PILL`
 *   or `WHITE`;
 * - every `grey` is `INK`, `MUTED` or `RULE`;
 * - every piece of type set in `WHITE` lies inside a rectangle filled
 *   `VIOLET` on the same page — white is his colour only on his violet.
 *
 * A second hue, a new grey, or white type that has slipped off its band fails
 * here before anyone has to see it on paper.
 */

const fonts = documentFonts();

/** Two colours are the same colour to within floating-point arithmetic. */
const SAME = 1e-9;
/** A piece of type touching its band's edge to within a third of a point is inside it. */
const TOLERANCE = 0.34;

type Rgb = readonly [number, number, number];

const PALETTE: ReadonlyArray<readonly [string, Rgb]> = [
  ['VIOLET', VIOLET],
  ['CARD', CARD],
  ['EDGE', EDGE],
  ['PILL', PILL],
  ['WHITE', WHITE],
];
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
for (const method of ['cash', 'transfer', 'link'] as const) {
  for (const settles of [false, true]) {
    CASES.push({
      name: `receipt by ${method}, ${settles ? 'settling an invoice' : 'on account'}`,
      pages: layout(receipt(method, settles), fonts),
    });
  }
}

describe('the palette both money documents may use', () => {
  it('sets every colour in the violet, its three tints or white, and every grey in the ink or the two greys', () => {
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

  it('sets white type only inside a band filled violet', () => {
    let white = 0;
    for (const { name, pages } of CASES) {
      pages.forEach((page, index) => {
        const bands = page.ops.filter(
          (op): op is Extract<Op, { kind: 'rect' }> =>
            op.kind === 'rect' &&
            op.fill !== undefined &&
            'rgb' in op.fill &&
            sameRgb(op.fill.rgb, VIOLET),
        );
        for (const op of page.ops) {
          if (op.kind !== 'text' || !op.style.rgb || !sameRgb(op.style.rgb, WHITE)) continue;
          white += 1;
          const width = measure(op.text, op.style, fonts, op.rtl === true);
          const align = op.align ?? (op.rtl === true ? 'end' : 'start');
          const left =
            align === 'end' ? op.x - width : align === 'centre' ? op.x - width / 2 : op.x;
          const right = left + width;
          const inside = bands.some(
            (band) =>
              left >= band.x - TOLERANCE &&
              right <= band.x + band.width + TOLERANCE &&
              op.y >= band.y - TOLERANCE &&
              // The capital's rise, and not only the baseline, inside the band.
              op.y + op.style.size * 0.75 <= band.y + band.height + TOLERANCE,
          );
          expect(inside, `${name}, page ${index + 1}: "${op.text}" is white off the violet`).toBe(
            true,
          );
        }
      });
    }
    // The table's headings and both violet blocks: the check read something.
    expect(white).toBeGreaterThan(0);
  });
});
