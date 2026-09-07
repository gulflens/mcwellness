/**
 * The look of a money document: the practice's own design, on paper.
 *
 * The operator supplied a designed invoice and receipt on 8 September 2026 and
 * asked the platform's documents to match them (`docs/SPEC/billing.md` section
 * 5.6). Its shape, top to bottom: the practice's logo centred, the title in
 * both languages in the brand violet, the supplier as two facing blocks rather
 * than as labelled rows, the document's own facts, the lines table, the totals
 * in a bordered box against the right margin, and a footer band with the
 * practice's contact details.
 *
 * **Three things carry hue and nothing else does.** The two title words, the
 * table's column headings and the document's reference, all in `VIOLET`
 * sampled from the practice's own mark. `docs/DESIGN-BRIEF.md`'s rule that hue
 * is reserved for band data and three status states is a rule for the console;
 * section 5.6 answers `PRODUCT.md`'s open question for **documents only**.
 * Everything else is the ink and two greys these documents already used.
 *
 * **Bilingual, side by side.** The title, the supplier block, the column
 * headings, the totals labels and the basis sentence are set twice, English
 * against the left margin and Arabic against the right, which is how a
 * bilingual invoice is read in the Gulf. Figures are set once, in Latin
 * digits, because they are the same figures read by both readers — and because
 * a number typeset twice has two chances to be wrong.
 *
 * **The registration decides the page.** An invoice from an unregistered
 * practice is headed "Invoice", carries no VAT number, no rate, no VAT column
 * and no VAT line in the totals, and shows one figure. All of that comes from
 * the document's own snapshot (`model.ts`), never from the practice's live
 * row, and `chargesVat` is the one place it is asked.
 *
 * **Everything is measured before it is drawn**, which was the design review's
 * finding and is the difference between a layout and a set of guesses. Every
 * string is measured against the room it actually has: it wraps onto further
 * lines, the description is clamped to its column, and nothing is drawn past
 * the right margin. When a document runs out of page it gets another one, with
 * a running header, and the totals stay with the last of it.
 *
 * Pure: laying out a page is arithmetic, so this is testable without a font
 * file, a database or a clock — and `tests/billing/geometry.test.ts` tests it as
 * geometry, by measuring the ops this produces rather than by reading the text
 * back out of a stream. The practice's mark arrives as bytes, exactly as the
 * fonts do; nothing here opens anything.
 */

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
  type DocumentImage,
  type FontSet,
  type Op,
  type Page,
} from '../../shared/document';
import {
  arabicDocumentDate,
  discountLine,
  formatDocumentDate,
  formatRate,
  money,
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
/** The first baseline. */
const TOP = PAGE_HEIGHT - MARGIN;
/** Where a page number sits: below the content floor, above the paper's edge. */
const FOLIO = MARGIN + 8;
/** The hairline the footer band hangs from, pinned to the bottom of the page. */
const BAND = FOLIO + 30;
/** The floor the flow may not go below: far enough above the band to clear it. */
const BOTTOM = BAND + 18;
/** The smallest gap two pieces of type may have between them. */
const GUTTER = 10;

const INK = 0;
const MUTED = 0.42;
const RULE = 0.78;

/**
 * The practice's own violet, `#380473`, sampled from the darkest large area of
 * its mark. Three things wear it — the two title words, the column headings
 * and the reference — and nothing else on either document does.
 */
export const VIOLET = [0x38 / 255, 0x04 / 255, 0x73 / 255] as const;

const SIZE = { wordmark: 15, title: 20, reference: 13, heading: 12, body: 9, small: 7.5 };
const LINE = 13;
const SMALL_LINE = 9.5;

/** How wide the practice's mark is set, whatever the shape of the file. */
const LOGO_WIDTH = 150;
/** The totals box against the right margin, and the air inside it. */
const TOTALS_WIDTH = 200;
const TOTALS_PAD = 10;
const TOTALS_ROW = 15;
/** From the top rule of the totals box to the first row's baseline. */
const TOTALS_TOP_AIR = 14;

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
  BAND,
  GUTTER,
  LINE,
  SMALL_LINE,
  SIZE,
  VIOLET,
  LOGO_WIDTH,
  TOTALS_WIDTH,
  TOTALS_PAD,
} as const;

type TextOptions = {
  bold?: boolean;
  grey?: number;
  rgb?: readonly [number, number, number];
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
      style: {
        font: options.bold ? 'bold' : 'regular',
        size,
        grey: options.grey ?? INK,
        ...(options.rgb ? { rgb: options.rgb } : {}),
      },
      ...(options.align ? { align: options.align } : {}),
      ...(options.rtl ? { rtl: true } : {}),
    });
  }

  /** The same, on the current baseline. */
  text(x: number, text: string, size: number, options: TextOptions = {}): void {
    this.line(this.y, x, text, size, options);
  }

  /** The practice's mark, with its bottom-left corner where it is told. */
  image(x: number, y: number, width: number, height: number): void {
    this.ops.push({ kind: 'image', image: 'logo', x, y, width, height });
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
   * The same string, cut to one line that fits.
   *
   * For the footer band alone, which is pinned to the bottom of the page and
   * so cannot grow downward into the page number. The address is set in full
   * in the supplier block at the top of the same sheet, so what is lost here
   * is a repetition and not a fact.
   */
  fit(text: string, maxWidth: number, size: number, options: TextOptions = {}): string {
    if (this.width(text, size, options) <= maxWidth) return text;
    // Eight points of room kept back for the ellipsis, so the cut line is
    // still inside the measure once it is added.
    return `${this.wrap(text, maxWidth - 8, size, options)[0] ?? ''}…`;
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

  /** A rule where it is told, and — with a rise — down the side of a box. */
  ruleAt(y: number, x: number, width: number, dy = 0, grey = RULE, thickness = 0.5): void {
    this.ops.push({ kind: 'rule', x, y, width, ...(dy ? { dy } : {}), thickness, grey });
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
    const height = (LOGO_WIDTH * logo.height) / logo.width;
    sheet.image((PAGE_WIDTH - LOGO_WIDTH) / 2, sheet.baseline - height, LOGO_WIDTH, height);
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
  if (supplier.address) rows.push({ en: supplier.address, ar: null, grey: MUTED });
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

/** A column heading: English on the line in violet, its Arabic beneath it, smaller. */
function heading(sheet: Sheet, x: number, label: Phrase, align: 'start' | 'end'): void {
  const y = sheet.baseline;
  sheet.line(y, x, label.en, SIZE.body, { bold: true, align, rgb: VIOLET });
  sheet.line(y - SMALL_LINE, x, label.ar, SIZE.small, { align, rtl: true, rgb: VIOLET });
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
  sheet.ruleAt(BAND, LEFT, measureWidth);

  const who = [supplier.legalName, supplier.address].filter(Boolean).join('  ');
  sheet.line(BAND - 12, centre, sheet.fit(who, measureWidth, SIZE.small), SIZE.small, {
    grey: MUTED,
    align: 'centre',
  });

  const parts = [
    supplier.contactPhone ? `P: ${supplier.contactPhone}` : null,
    supplier.contactEmail ? `E: ${supplier.contactEmail}` : null,
    supplier.website ? `W: ${supplier.website}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return;
  sheet.line(
    BAND - 12 - SMALL_LINE,
    centre,
    sheet.fit(parts.join('     '), measureWidth, SIZE.small),
    SIZE.small,
    { grey: MUTED, align: 'centre' },
  );
}

// --------------------------------------------------------------------------
// The two documents
// --------------------------------------------------------------------------

function invoicePage(
  document_: InvoiceDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): Page[] {
  const registered = chargesVat(document_.supplier);
  const sheet = new Sheet(fonts, {
    practice: document_.supplier.legalName,
    reference: document_.reference,
  });
  const columns = registered ? COLUMN : COLUMN_PLAIN;
  const descriptionWidth = registered ? DESCRIPTION_WIDTH : DESCRIPTION_WIDTH_PLAIN;

  masthead(sheet, registered ? WORDS.taxInvoice : WORDS.invoice, logo);
  supplierBlock(sheet, document_.supplier);

  sheet.down(4);
  sheet.rule();
  sheet.down(16);

  const dates = [`${WORDS.issued.en} ${formatDocumentDate(document_.issuedOn)}`];
  // Only when it differs: a null here means the supply and the issue were the
  // same day, which is what the column's own constraint guarantees.
  if (document_.suppliedOn) {
    dates.push(`${WORDS.dateOfSupply.en} ${formatDocumentDate(document_.suppliedOn)}`);
  }
  facts(sheet, document_.reference, dates, {
    label: WORDS.billedTo,
    name: document_.recipient.name,
    recordNumber: document_.recipient.recordNumber,
  });

  sheet.down(4);
  sheet.rule();
  sheet.down(16);

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

  for (const line of document_.lines) {
    const englishRows = sheet.wrap(line.description, descriptionWidth, SIZE.body, {}).length;
    const arabicRows = line.descriptionAr
      ? sheet.wrap(line.descriptionAr, descriptionWidth, SIZE.small, { rtl: true }).length
      : 0;
    // A discounted line says what came off it beneath its description, once in
    // each language: two more small rows, counted into the height before
    // anything is drawn so the break still happens between rows.
    const noteRows = line.discountFils > 0 ? 2 : 0;
    const height = (englishRows - 1) * LINE + (arabicRows + noteRows) * SMALL_LINE + LINE;
    sheet.room(height);

    const y = sheet.baseline;
    sheet.line(y, columns.quantity, String(line.quantity), SIZE.body, { align: 'end' });
    sheet.line(y, columns.unitPrice, money(line.unitNetFils), SIZE.body, { align: 'end' });
    if (registered) {
      sheet.line(y, COLUMN.vatRate, formatRate(line.vatRateBasisPoints), SIZE.body, {
        align: 'end',
      });
      sheet.line(y, COLUMN.vatAmount, money(line.vatFils), SIZE.body, { align: 'end' });
    }
    sheet.line(y, columns.amount, money(registered ? line.grossFils : line.netFils), SIZE.body, {
      align: 'end',
    });
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
    if (line.discountFils > 0) {
      // The design's own phrasing: the price that was quoted and what came off
      // it, which is the pair a family reading a smaller figure wants to see.
      const note = discountLine(line.netFils + line.discountFils, line.discountFils);
      const beneath = y - (englishRows - 1) * LINE - arabicRows * SMALL_LINE;
      sheet.line(beneath - SMALL_LINE, columns.description, note.en, SIZE.small, {
        grey: MUTED,
        align: 'start',
      });
      sheet.line(beneath - SMALL_LINE * 2, columns.description, note.ar, SIZE.small, {
        grey: MUTED,
        rtl: true,
        align: 'start',
      });
    }
    sheet.down(height);
  }
  sheet.setContinuation(null);
  sheet.down(4);

  const totals: TotalRow[] = [];
  // What was taken off, above whatever the totals say next. Only when there was
  // a discount: a "Discount 0.00" row on every other invoice would be a figure
  // a reader has to decide to ignore.
  if (document_.discountFils > 0) {
    totals.push({
      label: WORDS.beforeDiscount,
      value: money(document_.netFils + document_.discountFils),
    });
    totals.push({ label: WORDS.discount, value: money(document_.discountFils) });
  }
  if (registered) {
    totals.push({ label: WORDS.net, value: money(document_.netFils) });
    totals.push({ label: WORDS.vatAmount, value: money(document_.vatFils) });
  }
  // One figure at the foot of it, and on an unregistered practice's invoice one
  // figure in all: a net-and-VAT-and-gross breakdown on a document that charges
  // no VAT invites the reader to look for a rate that is not there (round 20,
  // request 1c).
  totals.push({ label: WORDS.total, value: money(document_.grossFils), bold: true });
  totalsBox(sheet, totals);

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
  band(sheet, document_.supplier);
  return sheet.finish();
}

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
  return document_.kind === 'invoice'
    ? invoicePage(document_, fonts, logo)
    : receiptPage(document_, fonts, logo);
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
 * right-aligned except the description).
 *
 * Wider than they were, and for one reason: every figure now carries its own
 * currency, so `AED 12,150.00` stands where `12,150.00` did and the columns
 * were spaced for the shorter one. The gaps are measured against the widest
 * figure a line can hold rather than against the headings, which are shorter
 * now that they have lost their `(AED)`.
 */
const COLUMN = {
  description: LEFT,
  quantity: LEFT + 220,
  unitPrice: LEFT + 297,
  vatRate: LEFT + 347,
  vatAmount: LEFT + 422,
  amount: RIGHT,
};
/** Where a description stops, clear of the quantity heading beside it. */
const DESCRIPTION_WIDTH = 170;

/** Without VAT there are three columns of figures, not five, so they spread out. */
const COLUMN_PLAIN = {
  description: LEFT,
  quantity: LEFT + 347,
  unitPrice: LEFT + 422,
  amount: RIGHT,
};
const DESCRIPTION_WIDTH_PLAIN = 290;
