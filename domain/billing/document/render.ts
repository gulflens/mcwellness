/**
 * The look of a money document: the practice's own design, on paper.
 *
 * **Two pages live here and next door.** The invoice is the operator's design
 * of 24 September 2026 (docs/superpowers/specs/2026-09-24-invoice-redesign-
 * design.md), laid out block by block in `invoice.ts`. The receipt is still
 * the page of 8 September (`docs/SPEC/billing.md` section 5.6) — the mark
 * centred, the title in both languages in violet, the supplier as two facing
 * blocks, the document's own facts, the amount in a bordered box and a
 * footer band — whose blocks are the ones below; round 65 dresses it like the
 * invoice next. Both are drawn on the `Sheet` in `sheet.ts`.
 *
 * **Bilingual, side by side.** English against the left margin and Arabic
 * against the right, which is how a bilingual document is read in the Gulf.
 * Figures are set once, in Latin digits, because they are the same figures
 * read by both readers — and because a number typeset twice has two chances
 * to be wrong.
 *
 * **Everything is measured before it is drawn.** Every string is measured
 * against the room it actually has: it wraps onto further lines and nothing
 * is drawn past the right margin. When a document runs out of page it gets
 * another one, with a running header.
 *
 * Pure: laying out a page is arithmetic, so this is testable without a font
 * file, a database or a clock — and `tests/billing/geometry.test.ts` tests it
 * as geometry, by measuring the ops and the blocks this produces rather than
 * by reading the text back out of a stream. The practice's mark arrives as
 * bytes, exactly as the fonts do; nothing here opens anything.
 */

import {
  chargesVat,
  type InvoiceDocument,
  type MoneyDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from './model';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type DocumentImage,
  type FontSet,
  type Page,
} from '../../shared/document';
import {
  arabicDocumentDate,
  formatDocumentDate,
  money,
  receiptBasis,
  WORDMARK,
  WORDS,
  type Phrase,
} from './strings';
import { INVOICE_GEOMETRY, invoiceLayout } from './invoice';
import { receiptLayout } from './receipt';
import type { Block } from './page';
import {
  BAND,
  BOTTOM,
  FOLIO,
  GUTTER,
  INK,
  LEFT,
  LINE,
  MARGIN,
  MUTED,
  RIGHT,
  SIZE,
  SMALL_LINE,
  Sheet,
  TOP,
  VIOLET,
  type TextOptions,
} from './sheet';

export { CARD, clampForDocument, EDGE, PILL, Sheet, VIOLET } from './sheet';
export type { Block, BlockName } from './page';

/** How wide the receipt sets the practice's mark, centred, whatever the shape of the file. */
const RECEIPT_LOGO_WIDTH = 150;
/** The receipt's amount box against the right margin, and the air inside it. */
const TOTALS_WIDTH = 200;
const TOTALS_PAD = 10;
const TOTALS_ROW = 15;
/** From the top rule of the totals box to the first row's baseline. */
const TOTALS_TOP_AIR = 14;

/**
 * The invoice page's own measurements, exported so the geometry tests assert
 * against the same numbers the layout uses rather than against copies of them.
 */
export const GEOMETRY = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  LEFT,
  RIGHT,
  TOP,
  BOTTOM,
  FOLIO,
  BAND,
  GUTTER,
  LINE,
  SMALL_LINE,
  SIZE,
  VIOLET,
  ...INVOICE_GEOMETRY,
} as const;

// --------------------------------------------------------------------------
// The blocks of the page
// --------------------------------------------------------------------------

/**
 * The mark and the title.
 *
 * The logo is centred and set 150 points wide, its height taken from the
 * bitmap's own proportions so the practice's mark is never stretched. A
 * practice with no logo — or with one this writer cannot draw — gets the
 * wordmark set in type against the left margin, which is a deliberate page and
 * not a gap where a picture failed.
 */
function masthead(sheet: Sheet, title: Phrase, logo: DocumentImage | null): void {
  if (logo && logo.width > 0) {
    const height = (RECEIPT_LOGO_WIDTH * logo.height) / logo.width;
    sheet.image(
      (PAGE_WIDTH - RECEIPT_LOGO_WIDTH) / 2,
      sheet.baseline - height,
      RECEIPT_LOGO_WIDTH,
      height,
    );
    sheet.down(height + 22);
  } else {
    sheet.text(LEFT, WORDMARK, SIZE.wordmark, { bold: true });
    sheet.down(26);
  }

  sheet.text(LEFT, title.en, SIZE.title, { bold: true, rgb: VIOLET });
  sheet.text(RIGHT, title.ar, SIZE.title, { bold: true, rgb: VIOLET, align: 'end', rtl: true });
  sheet.down(26);
}

/** One line of a facing block: English against the left margin, Arabic against the right. */
type FacingRow = { en: string; ar: string | null; bold?: boolean; grey?: number };

function facing(sheet: Sheet, rows: readonly FacingRow[]): void {
  // Half the measure each, with a gutter between, so a long authority name on
  // one side can never print through the other.
  const half = (RIGHT - LEFT - GUTTER * 2) / 2;
  for (const row of rows) {
    const options: TextOptions = { bold: row.bold === true };
    // A row with no Arabic counterpart takes the whole measure rather than
    // half of it. The address is the one such row — `location` holds no
    // `display_address_ar` for it to face — and set in half the width it left
    // a hole down the right of every page and wrapped where it need not.
    // Nothing is beside it, so nothing can be printed through.
    const measureWidth = row.ar ? half : RIGHT - LEFT;
    const english = sheet.wrap(row.en, measureWidth, SIZE.body, options);
    const arabic = row.ar
      ? sheet.wrap(row.ar, half, SIZE.body, { ...options, rtl: true, align: 'end' })
      : [];
    const lines = Math.max(english.length, arabic.length);
    sheet.room(lines * LINE);

    const y = sheet.baseline;
    const grey = row.grey ?? INK;
    english.forEach((line, index) => {
      sheet.line(y - index * LINE, LEFT, line, SIZE.body, { ...options, grey });
    });
    arabic.forEach((line, index) => {
      sheet.line(y - index * LINE, RIGHT, line, SIZE.body, {
        ...options,
        grey,
        align: 'end',
        rtl: true,
      });
    });
    sheet.down(lines * LINE);
  }
}

type SupplierBlockOptions = {
  /** False on a receipt, which claims nothing about tax. Absent means true. */
  corporateTaxRegistration?: boolean;
};

/**
 * The practice, from the snapshot and nowhere else.
 *
 * Each registration keeps its label on both sides, which is the point of the
 * block rather than a decoration: the fifteen-digit number the practice holds
 * today is a **corporate-tax** registration, and printing it under the phrase
 * the Federal Tax Authority uses for a VAT one would state a registration the
 * practice does not have (`strings.ts`, `WORDS.corporateTaxNumber`; the column
 * comments on `tenant.trn` and `invoice.supplier_trn`).
 *
 * **A receipt leaves the corporate-tax registration off**, as the operator's
 * design does. An invoice is a tax document and names the registrations the
 * practice holds; a receipt acknowledges that money arrived and makes no tax
 * claim in either direction, so the number has no work to do on it
 * (`docs/SPEC/billing.md` section 5.6). Everything else in the block is the
 * same on both pages.
 */
function supplierBlock(
  sheet: Sheet,
  supplier: SupplierSnapshot,
  options: SupplierBlockOptions = {},
): void {
  const labelled = (label: Phrase, value: string): FacingRow => ({
    en: `${label.en} ${value}`,
    ar: `${label.ar} ${value}`,
    grey: MUTED,
  });

  const rows: FacingRow[] = [{ en: supplier.legalName, ar: supplier.legalNameAr, bold: true }];
  // The address is deliberately not here. It is on the footer band, once, at
  // the operator's instruction of 8 September 2026: a document that prints the
  // practice's address twice on the same page spends its most valuable space
  // saying the same thing again. The band is what carries it, and `band()`
  // wraps that line rather than cutting it for exactly this reason — the
  // address is a thing a UAE invoice must state, and it now has one home.
  if (supplier.licenceNumber) rows.push(labelled(WORDS.licenceNumber, supplier.licenceNumber));
  if (supplier.licensingAuthority) {
    rows.push(labelled(WORDS.licensingAuthority, supplier.licensingAuthority));
  }
  if (supplier.corporateTaxNumber && options.corporateTaxRegistration !== false) {
    rows.push(labelled(WORDS.corporateTaxNumber, supplier.corporateTaxNumber));
  }
  // The VAT number appears only on a document whose own snapshot says the
  // practice held one. There is no other branch that can print it.
  if (chargesVat(supplier) && supplier.vatNumber) {
    rows.push({
      ...labelled(WORDS.vatRegistrationNumber, supplier.vatNumber),
      bold: true,
      grey: INK,
    });
  }
  facing(sheet, rows);
}

/**
 * The document's own facts: its reference and dates on the left, who it is for
 * on the right.
 *
 * The recipient block is short on purpose. A household is a private individual
 * and not a registered person, so what the practice issues is a simplified tax
 * invoice, which need not carry the recipient's address — and the platform
 * does not snapshot one (`docs/SPEC/billing.md` section 5.4). The record number
 * stands in its place, because it is what a family can quote back.
 */
function facts(
  sheet: Sheet,
  reference: string,
  beneath: readonly string[],
  recipient: { label: Phrase; name: string; recordNumber: string },
): void {
  const height = Math.max(LINE + 2 + beneath.length * SMALL_LINE, LINE + SMALL_LINE * 2 + 6);
  sheet.room(height);
  const y = sheet.baseline;
  const half = (RIGHT - LEFT - GUTTER * 2) / 2;

  sheet.line(y, LEFT, reference, SIZE.reference, { bold: true, rgb: VIOLET });
  beneath.forEach((each, index) => {
    sheet.line(y - LINE - 2 - index * SMALL_LINE, LEFT, each, SIZE.small, { grey: MUTED });
  });

  // The two languages of the label sit against the right margin as one group:
  // the Arabic outermost, the English inside it, exactly as the supplier block
  // above pairs them.
  const arabicWidth = sheet.width(recipient.label.ar, SIZE.small, { rtl: true });
  sheet.line(y, RIGHT, recipient.label.ar, SIZE.small, { grey: MUTED, align: 'end', rtl: true });
  sheet.line(y, RIGHT - arabicWidth - GUTTER, recipient.label.en, SIZE.small, {
    grey: MUTED,
    align: 'end',
  });
  sheet.paragraph(
    y - LINE,
    RIGHT,
    recipient.name,
    half,
    SIZE.body,
    { bold: true, align: 'end' },
    LINE,
  );
  sheet.line(
    y - LINE - SMALL_LINE - 4,
    RIGHT,
    `${WORDS.recordNumber.en} ${recipient.recordNumber}`,
    SIZE.small,
    { grey: MUTED, align: 'end' },
  );
  sheet.down(height);
}

/** A row of the totals box: its two labels on the left of the box, its figure on the right. */
type TotalRow = { label: Phrase; value: string; bold?: boolean };

/**
 * The totals, in a bordered box against the right margin.
 *
 * Drawn as four rules that meet at the corners rather than as a filled
 * rectangle: the writer strokes lines and fills nothing, which is all this
 * needs and one operator fewer to own.
 *
 * **The rows sit in the middle of it**: `TOTALS_TOP_AIR` above the first
 * baseline and the same below the last, which is the whole of the height. The
 * box is exactly as tall as it was; the first version put twelve points above
 * and sixteen below and read bottom-heavy on every page it was set on.
 *
 * **The Arabic label is measured against the figure, not assumed clear of it.**
 * The English label, the Arabic beside it and the figure were placed by fixed
 * arithmetic from the two edges, which holds for the figures a practice
 * usually writes and stops holding as the money grows: at `AED 1,215,000.00`
 * the widest row has two points left between them, and past that they collide.
 * So the gap is worked out and the Arabic label is left off the row when it
 * would come within the page's own gutter of the figure. The English label and
 * the figure are always set, in both languages' reading of the row: what a
 * reader loses is a translation of a word, never a number.
 */
function totalsBox(sheet: Sheet, rows: readonly TotalRow[]): void {
  const height = TOTALS_TOP_AIR * 2 + (rows.length - 1) * TOTALS_ROW;
  sheet.room(height + LINE);

  const top = sheet.baseline;
  const bottom = top - height;
  const left = RIGHT - TOTALS_WIDTH;

  rows.forEach((row, index) => {
    const bold = row.bold === true;
    const y = top - TOTALS_TOP_AIR - index * TOTALS_ROW;
    const size = bold ? SIZE.body + 1 : SIZE.body;
    sheet.line(y, left + TOTALS_PAD, row.label.en, size, {
      bold,
      grey: bold ? INK : MUTED,
    });
    const labelWidth = sheet.width(row.label.en, size, { bold });
    const arabicAt = left + TOTALS_PAD + labelWidth + 6;
    const arabicWidth = sheet.width(row.label.ar, SIZE.small, { rtl: true });
    const figureAt = RIGHT - TOTALS_PAD - sheet.width(row.value, size, { bold });
    if (arabicAt + arabicWidth + GUTTER <= figureAt) {
      sheet.line(y, arabicAt, row.label.ar, SIZE.small, {
        grey: MUTED,
        rtl: true,
        align: 'start',
      });
    }
    sheet.line(y, RIGHT - TOTALS_PAD, row.value, size, {
      bold,
      align: 'end',
    });
  });

  sheet.ruleAt(top, left, TOTALS_WIDTH);
  sheet.ruleAt(bottom, left, TOTALS_WIDTH);
  sheet.ruleAt(bottom, left, 0, height);
  sheet.ruleAt(bottom, RIGHT, 0, height);
  sheet.down(height + LINE);
}

/** A sentence at the foot of the page, in both languages, above the band. */
function footer(sheet: Sheet, basis: Phrase, grey = MUTED): void {
  const english = sheet.wrap(basis.en, RIGHT - LEFT, SIZE.small, {}).length;
  const arabic = sheet.wrap(basis.ar, RIGHT - LEFT, SIZE.small, { rtl: true }).length;
  sheet.room(LINE + 6 + (english + arabic) * SMALL_LINE);
  sheet.down(6);
  sheet.rule();
  sheet.down(LINE);
  sheet.paragraph(sheet.baseline, LEFT, basis.en, RIGHT - LEFT, SIZE.small, { grey }, SMALL_LINE);
  sheet.down(english * SMALL_LINE + 1);
  sheet.paragraph(
    sheet.baseline,
    RIGHT,
    basis.ar,
    RIGHT - LEFT,
    SIZE.small,
    { grey, align: 'end', rtl: true },
    SMALL_LINE,
  );
  sheet.down(arabic * SMALL_LINE);
}

/**
 * The band at the very bottom of the last sheet: who issued this and how to
 * reach them.
 *
 * Pinned to the paper rather than carried in the flow, so it sits in the same
 * place on a one-line receipt and on a thirty-line invoice. Every part of the
 * second line is omitted when the practice has not recorded it, and the whole
 * line when it has recorded none — a footer of empty labels would say less
 * than no footer at all.
 */
function band(sheet: Sheet, supplier: SupplierSnapshot): void {
  const centre = PAGE_WIDTH / 2;
  const measureWidth = RIGHT - LEFT;

  const who = [supplier.legalName, supplier.address].filter(Boolean).join('  ');
  // **Wrapped, never cut.** Since 8 September the supplier block above no
  // longer repeats the address, so this line is the only place a reader finds
  // it — and a UAE invoice must state the supplier's address. `fit` would put
  // an ellipsis through a long one. The band grows *upward* into the empty
  // page instead, so its last line stays exactly where it was and the page
  // number below it is never crowded.
  const whoLines = sheet.wrap(who, measureWidth, SIZE.small);
  const top = BAND + (whoLines.length - 1) * SMALL_LINE;
  sheet.ruleAt(top, LEFT, measureWidth);
  whoLines.forEach((line, index) => {
    sheet.line(top - 12 - index * SMALL_LINE, centre, line, SIZE.small, {
      grey: MUTED,
      align: 'centre',
    });
  });

  const parts = [
    supplier.contactPhone ? `P: ${supplier.contactPhone}` : null,
    supplier.contactEmail ? `E: ${supplier.contactEmail}` : null,
    supplier.website ? `W: ${supplier.website}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return;
  sheet.line(
    top - 12 - whoLines.length * SMALL_LINE,
    centre,
    sheet.fit(parts.join('     '), measureWidth, SIZE.small),
    SIZE.small,
    { grey: MUTED, align: 'centre' },
  );
}

// --------------------------------------------------------------------------
// The two documents
// --------------------------------------------------------------------------

function receiptPage(
  document_: ReceiptDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): Page[] {
  const sheet = new Sheet(fonts, {
    practice: document_.supplier.legalName,
    reference: document_.reference,
  });

  masthead(sheet, WORDS.receipt, logo);
  supplierBlock(sheet, document_.supplier, { corporateTaxRegistration: false });

  sheet.down(4);
  sheet.rule();
  sheet.down(16);

  const beneath = [
    `${WORDS.dateReceived.en} ${formatDocumentDate(document_.receivedOn)}`,
    WORDS[document_.method].en,
  ];
  if (document_.paymentReference) {
    beneath.push(`${WORDS.paymentReference.en} ${document_.paymentReference}`);
  }
  if (document_.settles) {
    // A receipt acknowledges money against an invoice; it is not one, and its
    // number comes from its own book (405_billing_receipt.sql).
    beneath.push(`${WORDS.settlesInvoice.en} ${document_.settles.reference}`);
  }
  facts(sheet, document_.reference, beneath, {
    label: WORDS.receivedFrom,
    name: document_.recipient.name,
    recordNumber: document_.recipient.recordNumber,
  });

  sheet.down(4);
  sheet.rule();
  sheet.down(16);
  totalsBox(sheet, [
    { label: WORDS.amountReceived, value: money(document_.amountFils), bold: true },
  ]);

  // A receipt's own footer, and never an invoice's: it is not a tax invoice,
  // simplified or otherwise, and it makes no claim about VAT in either
  // direction (strings.ts, receiptBasis).
  footer(
    sheet,
    receiptBasis({
      method: document_.method,
      receivedOn: document_.receivedOn,
      receivedOnAr: arabicDocumentDate(document_.receivedOn),
      settlesReference: document_.settles?.reference ?? null,
    }),
  );
  band(sheet, document_.supplier);
  return sheet.finish();
}

/** Lays out a document, across as many pages as its lines need. */
export function layout(
  document_: MoneyDocument,
  fonts: FontSet,
  logo: DocumentImage | null = null,
): Page[] {
  return layoutWithBlocks(document_, fonts, logo).pages;
}

/**
 * A document laid out, with the boxes its blocks were drawn in, page by page —
 * the masthead, the supplier block, the number card and the rest
 * (`page.ts`, `Block`) — for `tests/billing/geometry.test.ts` to assert the
 * page against as boxes rather than as loose pieces of type.
 */
export function layoutWithBlocks(
  document_: MoneyDocument,
  fonts: FontSet,
  logo: DocumentImage | null = null,
): { pages: Page[]; blocks: Block[][] } {
  return document_.kind === 'invoice'
    ? invoiceLayout(document_, fonts, logo)
    : receiptLayout(document_, fonts, logo);
}

/** The document's title, which is what a reader's browser tab and file manager show. */
export function titleOf(document_: MoneyDocument): string {
  if (document_.kind === 'receipt') {
    return `${WORDS.receipt.en} ${document_.reference}`;
  }
  const words = chargesVat(document_.supplier) ? WORDS.taxInvoice : WORDS.invoice;
  return `${words.en} ${document_.reference}`;
}
