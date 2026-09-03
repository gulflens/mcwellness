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
 * Pure: laying out a page is arithmetic, so this is testable without a font
 * file, a database or a clock.
 */

import { formatFils } from '../money';
import {
  chargesVat,
  type InvoiceDocument,
  type MoneyDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from './model';
import { measure, PAGE_HEIGHT, PAGE_WIDTH, type FontSet, type Op, type Page } from './pdf';
import {
  formatDocumentDate,
  formatRate,
  NOT_REGISTERED_BASIS,
  SIMPLIFIED_BASIS,
  WORDMARK,
  WORDS,
  type Phrase,
} from './strings';

/** The page's own measurements, in points. */
const MARGIN = 48;
const LEFT = MARGIN;
const RIGHT = PAGE_WIDTH - MARGIN;
/** Where a value sits: far enough from the label to read as its own column. */
const VALUE = LEFT + 132;

const INK = 0;
const MUTED = 0.42;
const RULE = 0.78;

const SIZE = { wordmark: 15, heading: 12, body: 9, small: 7.5 };
const LINE = 13;
const SMALL_LINE = 9.5;

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
/** Where a totals label ends. Left of the figures, clear of the description. */
const TOTAL_LABEL = RIGHT - 92;

/** A page being drawn top-down, which is the opposite of how PDF counts. */
class Sheet {
  readonly ops: Op[] = [];
  private y = PAGE_HEIGHT - MARGIN;

  /** The baseline currently being written on. */
  get baseline(): number {
    return this.y;
  }

  down(by: number): void {
    this.y -= by;
  }

  text(x: number, text: string, size: number, options: Partial<Op & { bold: boolean }> = {}): void {
    if (text.length === 0) return;
    const o = options as {
      bold?: boolean;
      grey?: number;
      align?: Op['kind'] extends never ? never : 'start' | 'end' | 'centre';
      rtl?: boolean;
    };
    this.ops.push({
      kind: 'text',
      x,
      y: this.y,
      text,
      style: { font: o.bold ? 'bold' : 'regular', size, grey: o.grey ?? INK },
      ...(o.align ? { align: o.align } : {}),
      ...(o.rtl ? { rtl: true } : {}),
    });
  }

  /** Arabic: right to left, set against the right margin. */
  arabic(x: number, text: string, size: number, grey = INK): void {
    if (text.length === 0) return;
    this.ops.push({
      kind: 'text',
      x,
      y: this.y,
      text,
      style: { font: 'regular', size, grey },
      align: 'end',
      rtl: true,
    });
  }

  rule(grey = RULE, thickness = 0.5): void {
    this.ops.push({ kind: 'rule', x: LEFT, y: this.y, width: RIGHT - LEFT, thickness, grey });
  }
}

/** A label in both languages on one line, with its value between them. */
function labelled(sheet: Sheet, label: Phrase, value: string): void {
  sheet.text(LEFT, label.en, SIZE.body, { grey: MUTED });
  sheet.text(VALUE, value, SIZE.body);
  sheet.arabic(RIGHT, label.ar, SIZE.body, MUTED);
  sheet.down(LINE);
}

/** A column heading: English on the line, Arabic in small grey beneath it. */
function heading(sheet: Sheet, x: number, label: Phrase, align: 'start' | 'end'): void {
  sheet.ops.push({
    kind: 'text',
    x,
    y: sheet.baseline,
    text: label.en,
    style: { font: 'bold', size: SIZE.body, grey: INK },
    align,
  });
  sheet.ops.push({
    kind: 'text',
    x,
    y: sheet.baseline - SMALL_LINE,
    text: label.ar,
    style: { font: 'regular', size: SIZE.small, grey: MUTED },
    align,
    rtl: true,
  });
}

/** The practice, from the snapshot and nowhere else. */
function supplierBlock(sheet: Sheet, supplier: SupplierSnapshot): void {
  sheet.text(LEFT, supplier.legalName, SIZE.body, { bold: true });
  if (supplier.legalNameAr) {
    sheet.arabic(RIGHT, supplier.legalNameAr, SIZE.body);
  }
  sheet.down(LINE);

  if (supplier.address) {
    sheet.text(LEFT, supplier.address, SIZE.body, { grey: MUTED });
    sheet.down(LINE);
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
    labelled(sheet, WORDS.taxRegistrationNumber, supplier.corporateTaxNumber);
  }
  // The VAT number appears only on a document whose own snapshot says the
  // practice held one. There is no other branch that can print it.
  if (chargesVat(supplier) && supplier.vatNumber) {
    labelled(sheet, WORDS.vatRegistrationNumber, supplier.vatNumber);
  }
}

function documentHeading(sheet: Sheet, title: Phrase): void {
  sheet.text(LEFT, WORDMARK, SIZE.wordmark, { bold: true });
  sheet.arabic(RIGHT, title.ar, SIZE.heading);
  sheet.down(LINE + 4);
  sheet.text(LEFT, title.en, SIZE.heading, { bold: true });
  sheet.down(LINE);
  sheet.rule(0.45, 0.8);
  sheet.down(LINE + 2);
}

function footer(sheet: Sheet, basis: Phrase): void {
  sheet.down(6);
  sheet.rule();
  sheet.down(LINE);
  sheet.text(LEFT, basis.en, SIZE.small, { grey: MUTED });
  sheet.down(SMALL_LINE + 1);
  sheet.arabic(RIGHT, basis.ar, SIZE.small, MUTED);
}

/**
 * A total: its label in both languages, and its figure in the amount column.
 *
 * The Arabic sits beneath the English rather than beside it, which is the one
 * place on the document that departs from label-either-side. It has to: the
 * figure occupies the right margin, so there is nowhere on the line for a
 * right-aligned Arabic label to go without landing on top of the number — which
 * is exactly what it did on the first render. Stacked, it matches the column
 * headings above it, and the figures stay in one unbroken column down the page.
 */
function totalRow(sheet: Sheet, label: Phrase, value: string, bold = false): void {
  sheet.ops.push({
    kind: 'text',
    x: TOTAL_LABEL,
    y: sheet.baseline,
    text: label.en,
    style: { font: bold ? 'bold' : 'regular', size: SIZE.body, grey: bold ? INK : MUTED },
    align: 'end',
  });
  sheet.ops.push({
    kind: 'text',
    x: TOTAL_LABEL,
    y: sheet.baseline - SMALL_LINE,
    text: label.ar,
    style: { font: 'regular', size: SIZE.small, grey: MUTED },
    align: 'end',
    rtl: true,
  });
  sheet.ops.push({
    kind: 'text',
    x: RIGHT,
    y: sheet.baseline,
    text: value,
    style: { font: bold ? 'bold' : 'regular', size: SIZE.body, grey: INK },
    align: 'end',
  });
  sheet.down(LINE + SMALL_LINE - 2);
}

function invoicePage(document_: InvoiceDocument, fonts: FontSet): Page {
  const registered = chargesVat(document_.supplier);
  const sheet = new Sheet();
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

  heading(sheet, columns.description, WORDS.description, 'start');
  heading(sheet, columns.quantity, WORDS.quantity, 'end');
  heading(sheet, columns.unitPrice, WORDS.unitPrice, 'end');
  if (registered) {
    heading(sheet, COLUMN.vatRate, WORDS.vatRate, 'end');
    heading(sheet, COLUMN.vatAmount, WORDS.vatColumn, 'end');
  }
  heading(sheet, columns.amount, WORDS.amount, 'end');
  sheet.down(SMALL_LINE + LINE - 2);
  sheet.rule();
  sheet.down(LINE + 2);

  for (const line of document_.lines) {
    sheet.text(columns.description, line.description, SIZE.body);
    sheet.text(columns.quantity, String(line.quantity), SIZE.body, { align: 'end' });
    sheet.text(columns.unitPrice, formatFils(line.unitNetFils), SIZE.body, { align: 'end' });
    if (registered) {
      sheet.text(COLUMN.vatRate, formatRate(line.vatRateBasisPoints), SIZE.body, { align: 'end' });
      sheet.text(COLUMN.vatAmount, formatFils(line.vatFils), SIZE.body, { align: 'end' });
    }
    sheet.text(columns.amount, formatFils(registered ? line.grossFils : line.netFils), SIZE.body, {
      align: 'end',
    });
    sheet.down(SMALL_LINE + 1);
    if (line.descriptionAr) {
      // The service's own Arabic name, beneath its English, in the small grey
      // the price list uses for exactly the same pair.
      sheet.ops.push({
        kind: 'text',
        x: columns.description,
        y: sheet.baseline,
        text: line.descriptionAr,
        style: { font: 'regular', size: SIZE.small, grey: MUTED },
        align: 'start',
        rtl: true,
      });
    }
    sheet.down(LINE);
  }

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

  footer(sheet, registered ? SIMPLIFIED_BASIS : NOT_REGISTERED_BASIS);
  // `fonts` is taken so a caller cannot render a page for one font set and
  // print it with another; measuring happens in pdf.ts against these.
  void measure('', { font: 'regular', size: SIZE.body }, fonts);
  return { ops: sheet.ops };
}

function receiptPage(document_: ReceiptDocument, fonts: FontSet): Page {
  const registered = chargesVat(document_.supplier);
  const sheet = new Sheet();

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

  footer(sheet, registered ? SIMPLIFIED_BASIS : NOT_REGISTERED_BASIS);
  void measure('', { font: 'regular', size: SIZE.body }, fonts);
  return { ops: sheet.ops };
}

/** Lays out a document. One page: an invoice the practice issues is one visit or one bundle. */
export function layout(document_: MoneyDocument, fonts: FontSet): Page[] {
  return [
    document_.kind === 'invoice' ? invoicePage(document_, fonts) : receiptPage(document_, fonts),
  ];
}

/** The document's title, which is what a reader's browser tab and file manager show. */
export function titleOf(document_: MoneyDocument): string {
  if (document_.kind === 'receipt') {
    return `${WORDS.receipt.en} ${document_.reference}`;
  }
  const words = chargesVat(document_.supplier) ? WORDS.taxInvoice : WORDS.invoice;
  return `${words.en} ${document_.reference}`;
}
