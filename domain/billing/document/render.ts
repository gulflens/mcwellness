/**
 * The look of a money document: the console's quiet ledger, on paper.
 *
 * Hairline rules and generous rows, no boxes, no zebra, no colour — the same
 * vocabulary `app/shell/components/Table.tsx` uses on screen
 * (docs/DESIGN-BRIEF.md section 6.2), and the same type. The only ink is black
 * and two greys: one for a secondary line, one for a rule.
 *
 * **Bilingual, side by side.** Every label is set twice on the same line:
 * English against the left margin, Arabic against the right. The value sits
 * between them, once, in Latin figures — which is what a reader of either
 * language reaches for, and what stops a figure being typeset twice and having
 * two chances to be wrong. Column headings carry their Arabic beneath, in the
 * small grey the screens use for a second name.
 *
 * **The registration decides the page.** An invoice from an unregistered
 * practice is headed "Invoice", carries no VAT number, no rate, no VAT column
 * and no VAT line in the totals, and shows one AED figure. All of that comes
 * from the document's own snapshot (`model.ts`), never from the practice's live
 * row.
 *
 * **Everything is measured before it is drawn**, which was the design review's
 * finding and is the difference between a layout and a set of guesses. The first
 * version placed text at fixed coordinates and never asked how wide it was, so
 * the label "Corporate tax registration number" — 137 points of type in a
 * 132-point gutter — was overprinted by its own value on every document, a long
 * service name ran through the quantity column, and a long address ran off the
 * paper. Now every string is measured against the room it actually has: it wraps
 * onto further lines, the description is clamped to its column, and nothing is
 * drawn past the right margin. When a document runs out of page it gets another
 * one, with a running header, and the totals stay with the last of it.
 *
 * Pure: laying out a page is arithmetic, so this is testable without a font
 * file, a database or a clock — and `tests/billing/geometry.test.ts` tests it as
 * geometry, by measuring the ops this produces rather than by reading the text
 * back out of a stream.
 */

import { formatFils } from '../money';
import {
  chargesVat,
  type InvoiceDocument,
  type MoneyDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from './model';
import {
  measure,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type FontSet,
  type Op,
  type Page,
} from '../../shared/document';
import {
  arabicDocumentDate,
  formatDocumentDate,
  formatRate,
  NOT_REGISTERED_BASIS,
  receiptBasis,
  SIMPLIFIED_BASIS,
  waivedNotice,
  WORDMARK,
  WORDS,
  type Phrase,
} from './strings';

const MARGIN = 48;
const LEFT = MARGIN;
const RIGHT = PAGE_WIDTH - MARGIN;
/** The first baseline, and the floor the last one may not go below. */
const TOP = PAGE_HEIGHT - MARGIN;
const BOTTOM = MARGIN + 26;
/** Where a page number sits: below the content floor, above the paper's edge. */
const FOLIO = MARGIN + 8;
/** Where a value sits: far enough from the label to read as its own column. */
const VALUE = LEFT + 150;
/** The smallest gap two pieces of type may have between them. */
const GUTTER = 10;

const INK = 0;
const MUTED = 0.42;
const RULE = 0.78;

const SIZE = { wordmark: 15, heading: 12, body: 9, small: 7.5 };
const LINE = 13;
const SMALL_LINE = 9.5;

/**
 * The page's own measurements, exported so the geometry tests assert against
 * the same numbers the layout uses rather than against copies of them.
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
  VALUE,
  GUTTER,
  LINE,
  SMALL_LINE,
  SIZE,
} as const;

type TextOptions = {
  bold?: boolean;
  grey?: number;
  align?: 'start' | 'end' | 'centre';
  rtl?: boolean;
};

/**
 * The longest string this will set at all.
 *
 * Not a layout rule but a floor under one: a description or an address is a
 * string somebody typed, and rendering is on the path that produces a client's
 * financial record. Wrapping an unbounded string is unbounded work, so it is cut
 * — visibly, with an ellipsis, because a document that quietly drops half a line
 * is worse than one that shows it was too long.
 */
const MAX_DRAWN = 400;

export function clampForDocument(text: string): string {
  const characters = [...text];
  return characters.length <= MAX_DRAWN ? text : `${characters.slice(0, MAX_DRAWN - 1).join('')}…`;
}

/** A document being drawn top-down, across as many pages as it needs. */
class Sheet {
  private readonly pages: Op[][] = [[]];
  private y = TOP;
  /** Redrawn at the top of every page after the first: column headings, mostly. */
  private continuation: (() => void) | null = null;

  private readonly fonts: FontSet;
  private readonly running: { practice: string; reference: string };

  constructor(fonts: FontSet, running: { practice: string; reference: string }) {
    this.fonts = fonts;
    this.running = running;
  }

  private get ops(): Op[] {
    const page = this.pages[this.pages.length - 1];
    if (!page) throw new Error('A sheet always has a page.');
    return page;
  }

  get baseline(): number {
    return this.y;
  }

  down(by: number): void {
    this.y -= by;
  }

  /** How wide a string is, set as it will be set. */
  width(text: string, size: number, options: TextOptions = {}): number {
    if (text.length === 0) return 0;
    return measure(
      text,
      { font: options.bold ? 'bold' : 'regular', size },
      this.fonts,
      options.rtl === true,
    );
  }

  /** Makes room for `space` points of content, taking another page if there is none. */
  room(space: number): void {
    if (this.y - space >= BOTTOM) return;
    this.newPage();
  }

  /** What to redraw at the top of a page taken mid-way through something. */
  setContinuation(draw: (() => void) | null): void {
    this.continuation = draw;
  }

  private newPage(): void {
    this.pages.push([]);
    this.y = TOP;
    // A running header, so a loose second sheet still says which document it
    // belongs to and whose practice issued it.
    this.text(LEFT, this.running.practice, SIZE.small, { grey: MUTED });
    this.text(RIGHT, this.running.reference, SIZE.small, { grey: MUTED, align: 'end' });
    this.down(SMALL_LINE);
    this.rule();
    this.down(LINE);
    this.continuation?.();
  }

  /**
   * One line, on the baseline it is given. Nothing here moves the cursor.
   *
   * That is the whole discipline: a first version had the drawing helpers
   * advance the cursor themselves and the callers correct it afterwards with
   * arithmetic, and every block on the page printed on top of the last. A
   * primitive draws where it is told; the caller advances once, by an amount it
   * worked out before it drew anything.
   */
  line(y: number, x: number, text: string, size: number, options: TextOptions = {}): void {
    if (text.length === 0) return;
    this.ops.push({
      kind: 'text',
      x,
      y,
      text,
      style: { font: options.bold ? 'bold' : 'regular', size, grey: options.grey ?? INK },
      ...(options.align ? { align: options.align } : {}),
      ...(options.rtl ? { rtl: true } : {}),
    });
  }

  /** The same, on the current baseline. */
  text(x: number, text: string, size: number, options: TextOptions = {}): void {
    this.line(this.y, x, text, size, options);
  }

  /**
   * Breaks a string into the lines that fit `maxWidth`.
   *
   * On spaces where it can, and inside a word where it cannot — a forty-point
   * column and a fifty-point word have no polite answer, and running off the
   * page is not one.
   */
  wrap(text: string, maxWidth: number, size: number, options: TextOptions = {}): string[] {
    const clamped = clampForDocument(text);
    if (maxWidth <= 0) return [clamped];
    if (this.width(clamped, size, options) <= maxWidth) return [clamped];

    const lines: string[] = [];
    let line = '';
    const flush = (): void => {
      if (line.length > 0) lines.push(line);
      line = '';
    };
    for (const word of clamped.split(' ')) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (this.width(candidate, size, options) <= maxWidth) {
        line = candidate;
        continue;
      }
      flush();
      if (this.width(word, size, options) <= maxWidth) {
        line = word;
        continue;
      }
      // A single word wider than the column: broken by character, which is what
      // a long reference or an unspaced name needs.
      let piece = '';
      for (const character of word) {
        if (this.width(piece + character, size, options) > maxWidth && piece.length > 0) {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      line = piece;
    }
    flush();
    return lines.length > 0 ? lines : [''];
  }

  /**
   * A wrapped block starting on baseline `y`, drawn downward. Answers how many
   * lines it took; the cursor is the caller's to move.
   */
  paragraph(
    y: number,
    x: number,
    text: string,
    maxWidth: number,
    size: number,
    options: TextOptions = {},
    step = LINE,
  ): number {
    const lines = this.wrap(text, maxWidth, size, options);
    lines.forEach((each, index) => {
      this.line(y - index * step, x, each, size, options);
    });
    return lines.length;
  }

  rule(grey = RULE, thickness = 0.5): void {
    this.ops.push({ kind: 'rule', x: LEFT, y: this.y, width: RIGHT - LEFT, thickness, grey });
  }

  /**
   * The finished pages. A document that took more than one says so on every
   * sheet: a page torn off a stack has to be able to say what it is part of.
   */
  finish(): Page[] {
    if (this.pages.length > 1) {
      this.pages.forEach((ops, index) => {
        ops.push({
          kind: 'text',
          x: RIGHT,
          y: FOLIO,
          text: `Page ${index + 1} of ${this.pages.length}`,
          style: { font: 'regular', size: SIZE.small, grey: MUTED },
          align: 'end',
        });
      });
    }
    return this.pages.map((ops) => ({ ops }));
  }
}

/**
 * A label in both languages on one line, with its value between them — each
 * wrapped to the room it actually has.
 *
 * The Arabic is measured first because it is what decides how much room the
 * value has: it is set against the right margin, and a long authority name or a
 * long client name would otherwise be printed straight through it.
 */
function labelled(sheet: Sheet, label: Phrase, value: string): void {
  const arabicWidth = sheet.width(label.ar, SIZE.body, { rtl: true });
  const labelWidth = VALUE - LEFT - GUTTER;
  const valueWidth = RIGHT - VALUE - (arabicWidth > 0 ? arabicWidth + GUTTER : 0);

  const rows = Math.max(
    sheet.wrap(label.en, labelWidth, SIZE.body, {}).length,
    sheet.wrap(value, valueWidth, SIZE.body, {}).length,
  );
  sheet.room(rows * LINE);

  const y = sheet.baseline;
  sheet.paragraph(y, LEFT, label.en, labelWidth, SIZE.body, { grey: MUTED });
  sheet.paragraph(y, VALUE, value, valueWidth, SIZE.body, {});
  // The Arabic sits on the row's first baseline, beside the label it translates.
  sheet.line(y, RIGHT, label.ar, SIZE.body, { grey: MUTED, align: 'end', rtl: true });
  sheet.down(rows * LINE);
}

/** A column heading: English on the line, Arabic in small grey beneath it. */
function heading(sheet: Sheet, x: number, label: Phrase, align: 'start' | 'end'): void {
  const y = sheet.baseline;
  sheet.line(y, x, label.en, SIZE.body, { bold: true, align });
  sheet.line(y - SMALL_LINE, x, label.ar, SIZE.small, { grey: MUTED, align, rtl: true });
}

/** The practice, from the snapshot and nowhere else. */
function supplierBlock(sheet: Sheet, supplier: SupplierSnapshot): void {
  const arabicWidth = supplier.legalNameAr
    ? sheet.width(supplier.legalNameAr, SIZE.body, { rtl: true })
    : 0;
  const nameWidth = RIGHT - LEFT - (arabicWidth > 0 ? arabicWidth + GUTTER : 0);
  const rows = sheet.wrap(supplier.legalName, nameWidth, SIZE.body, { bold: true }).length;
  sheet.room(rows * LINE);

  const nameTop = sheet.baseline;
  sheet.paragraph(nameTop, LEFT, supplier.legalName, nameWidth, SIZE.body, { bold: true });
  if (supplier.legalNameAr) {
    sheet.line(nameTop, RIGHT, supplier.legalNameAr, SIZE.body, { align: 'end', rtl: true });
  }
  sheet.down(rows * LINE);

  if (supplier.address) {
    // Nothing beside it, so the whole measure — and wrapped, because an address
    // is a line somebody typed and the paper is 499 points wide.
    const lines = sheet.wrap(supplier.address, RIGHT - LEFT, SIZE.body, {}).length;
    sheet.room(lines * LINE);
    sheet.paragraph(sheet.baseline, LEFT, supplier.address, RIGHT - LEFT, SIZE.body, {
      grey: MUTED,
    });
    sheet.down(lines * LINE);
  }

  if (supplier.licenceNumber) {
    labelled(sheet, WORDS.licenceNumber, supplier.licenceNumber);
  }
  if (supplier.licensingAuthority) {
    labelled(sheet, WORDS.licensingAuthority, supplier.licensingAuthority);
  }
  if (supplier.corporateTaxNumber) {
    // Labelled as what it is. This is the corporate-tax registration and it is
    // never printed as a VAT number (migration 905's column comments).
    labelled(sheet, WORDS.corporateTaxNumber, supplier.corporateTaxNumber);
  }
  // The VAT number appears only on a document whose own snapshot says the
  // practice held one. There is no other branch that can print it.
  if (chargesVat(supplier) && supplier.vatNumber) {
    labelled(sheet, WORDS.vatRegistrationNumber, supplier.vatNumber);
  }
}

function documentHeading(sheet: Sheet, title: Phrase): void {
  sheet.text(LEFT, WORDMARK, SIZE.wordmark, { bold: true });
  sheet.text(RIGHT, title.ar, SIZE.heading, { align: 'end', rtl: true });
  sheet.down(LINE + 4);
  sheet.text(LEFT, title.en, SIZE.heading, { bold: true });
  sheet.down(LINE);
  sheet.rule(0.45, 0.8);
  sheet.down(LINE + 2);
}

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

/** A total: its two labels and its figure, right-aligned against the margin. */
function totalRow(sheet: Sheet, label: Phrase, value: string, bold = false): void {
  sheet.room(LINE + SMALL_LINE);
  const y = sheet.baseline;
  sheet.line(y, TOTAL_LABEL, label.en, SIZE.body, {
    bold,
    grey: bold ? INK : MUTED,
    align: 'end',
  });
  sheet.line(y, RIGHT, value, SIZE.body, { bold, align: 'end' });
  // Beneath the English, not beside it: the figure holds the right margin, so
  // there is nowhere on the line for a right-aligned Arabic label that does not
  // land on the number — which is exactly what it did on the first render.
  sheet.line(y - SMALL_LINE, TOTAL_LABEL, label.ar, SIZE.small, {
    grey: MUTED,
    align: 'end',
    rtl: true,
  });
  sheet.down(LINE + SMALL_LINE - 2);
}

/** Where a totals label ends. Left of the figures, clear of the description. */
const TOTAL_LABEL = RIGHT - 92;

function invoicePage(document_: InvoiceDocument, fonts: FontSet): Page[] {
  const registered = chargesVat(document_.supplier);
  const sheet = new Sheet(fonts, {
    practice: document_.supplier.legalName,
    reference: document_.reference,
  });
  const columns = registered ? COLUMN : COLUMN_PLAIN;

  documentHeading(sheet, registered ? WORDS.taxInvoice : WORDS.invoice);
  supplierBlock(sheet, document_.supplier);

  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);

  labelled(sheet, WORDS.invoiceNumber, document_.reference);
  labelled(sheet, WORDS.dateOfIssue, formatDocumentDate(document_.issuedOn));
  // Only when it differs: a null here means the supply and the issue were the
  // same day, which is what the column's own constraint guarantees.
  if (document_.suppliedOn) {
    labelled(sheet, WORDS.dateOfSupply, formatDocumentDate(document_.suppliedOn));
  }
  labelled(sheet, WORDS.client, document_.recipient.name);
  labelled(sheet, WORDS.recordNumber, document_.recipient.recordNumber);

  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);

  /** The column headings, drawn again at the top of a page taken mid-table. */
  const headings = (): void => {
    heading(sheet, columns.description, WORDS.description, 'start');
    heading(sheet, columns.quantity, WORDS.quantity, 'end');
    heading(sheet, columns.unitPrice, WORDS.unitPrice, 'end');
    if (registered) {
      heading(sheet, COLUMN.vatRate, WORDS.vatRate, 'end');
      heading(sheet, COLUMN.vatAmount, WORDS.vatColumn, 'end');
    }
    heading(sheet, columns.amount, WORDS.amount, 'end');
    sheet.down(SMALL_LINE + LINE - 4);
    sheet.rule();
    sheet.down(LINE + 2);
  };
  headings();
  sheet.setContinuation(headings);

  // The description stops short of the quantity column: a seventy-eight
  // character service name ran straight through the figures before this.
  const descriptionWidth = columns.quantity - columns.description - GUTTER * 4;

  for (const line of document_.lines) {
    const englishRows = sheet.wrap(line.description, descriptionWidth, SIZE.body, {}).length;
    const arabicRows = line.descriptionAr
      ? sheet.wrap(line.descriptionAr, descriptionWidth, SIZE.small, { rtl: true }).length
      : 0;
    // The whole row's height, worked out before anything is drawn, so the break
    // happens between rows and never through one.
    const height = (englishRows - 1) * LINE + arabicRows * SMALL_LINE + LINE;
    sheet.room(height);

    const y = sheet.baseline;
    sheet.line(y, columns.quantity, String(line.quantity), SIZE.body, { align: 'end' });
    sheet.line(y, columns.unitPrice, formatFils(line.unitNetFils), SIZE.body, { align: 'end' });
    if (registered) {
      sheet.line(y, COLUMN.vatRate, formatRate(line.vatRateBasisPoints), SIZE.body, {
        align: 'end',
      });
      sheet.line(y, COLUMN.vatAmount, formatFils(line.vatFils), SIZE.body, { align: 'end' });
    }
    sheet.line(
      y,
      columns.amount,
      formatFils(registered ? line.grossFils : line.netFils),
      SIZE.body,
      { align: 'end' },
    );
    sheet.paragraph(y, columns.description, line.description, descriptionWidth, SIZE.body, {});
    if (line.descriptionAr) {
      // The service's own Arabic name, beneath its English, in the small grey
      // the price list uses for exactly the same pair.
      sheet.paragraph(
        y - (englishRows - 1) * LINE - SMALL_LINE,
        columns.description,
        line.descriptionAr,
        descriptionWidth,
        SIZE.small,
        // Right-to-left text, but in a column that is aligned from the left:
        // without saying so it defaults to ending at `x`, which put every
        // Arabic service name off the left edge of the paper.
        { grey: MUTED, rtl: true, align: 'start' },
        SMALL_LINE,
      );
    }
    sheet.down(height);
  }
  sheet.setContinuation(null);

  sheet.room(LINE * 2);
  sheet.rule();
  sheet.down(LINE + 2);

  if (registered) {
    totalRow(sheet, WORDS.net, formatFils(document_.netFils));
    totalRow(sheet, WORDS.vatAmount, formatFils(document_.vatFils));
    totalRow(sheet, WORDS.total, formatFils(document_.grossFils), true);
  } else {
    // One figure, and only one. A net-and-VAT-and-gross breakdown on a document
    // that charges no VAT invites the reader to look for a rate that is not
    // there (round 20, request 1c).
    totalRow(sheet, WORDS.total, formatFils(document_.grossFils), true);
  }

  // A charge the practice has forgiven, said on the document rather than left
  // to the ledger. The invoice keeps its number and its figures — it is
  // append-only, and what happened is never rewritten — so a page that said
  // nothing would go on billing a family for money it does not owe (migration
  // 408, and the compliance review of this pull request). In ink rather than
  // in the footer's grey: it is the first thing a reader of this page needs.
  if (document_.waivedOn) {
    footer(sheet, waivedNotice(document_.waivedOn), INK);
  }

  footer(sheet, registered ? SIMPLIFIED_BASIS : NOT_REGISTERED_BASIS);
  return sheet.finish();
}

function receiptPage(document_: ReceiptDocument, fonts: FontSet): Page[] {
  const sheet = new Sheet(fonts, {
    practice: document_.supplier.legalName,
    reference: document_.reference,
  });

  documentHeading(sheet, WORDS.receipt);
  supplierBlock(sheet, document_.supplier);

  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);

  labelled(sheet, WORDS.receiptNumber, document_.reference);
  labelled(sheet, WORDS.dateReceived, formatDocumentDate(document_.receivedOn));
  labelled(sheet, WORDS.client, document_.recipient.name);
  labelled(sheet, WORDS.recordNumber, document_.recipient.recordNumber);
  labelled(sheet, WORDS.paymentMethod, WORDS[document_.method].en);
  if (document_.paymentReference) {
    labelled(sheet, WORDS.paymentReference, document_.paymentReference);
  }
  if (document_.settles) {
    // A receipt acknowledges money against an invoice; it is not one, and its
    // number comes from its own book (405_billing_receipt.sql).
    labelled(sheet, WORDS.settlesInvoice, document_.settles.reference);
  }

  sheet.down(4);
  sheet.rule();
  sheet.down(LINE + 2);
  totalRow(sheet, WORDS.amountReceived, formatFils(document_.amountFils), true);

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
  return sheet.finish();
}

/** Lays out a document, across as many pages as its lines need. */
export function layout(document_: MoneyDocument, fonts: FontSet): Page[] {
  return document_.kind === 'invoice'
    ? invoicePage(document_, fonts)
    : receiptPage(document_, fonts);
}

/** The document's title, which is what a reader's browser tab and file manager show. */
export function titleOf(document_: MoneyDocument): string {
  if (document_.kind === 'receipt') {
    return `${WORDS.receipt.en} ${document_.reference}`;
  }
  const words = chargesVat(document_.supplier) ? WORDS.taxInvoice : WORDS.invoice;
  return `${words.en} ${document_.reference}`;
}

/**
 * Columns of the lines table, by the x each column's text ends at (they are all
 * right-aligned except the description). Spaced so the widest heading in each —
 * "Unit price (AED)" above "سعر الوحدة", "Amount (AED)" above "المبلغ" — clears
 * its neighbour rather than running into it.
 */
const COLUMN = {
  description: LEFT,
  quantity: LEFT + 225,
  unitPrice: LEFT + 307,
  vatRate: LEFT + 357,
  vatAmount: LEFT + 417,
  amount: RIGHT,
};
/** Without VAT there are three columns of figures, not five, so they spread out. */
const COLUMN_PLAIN = {
  description: LEFT,
  quantity: LEFT + 300,
  unitPrice: LEFT + 400,
  amount: RIGHT,
};
