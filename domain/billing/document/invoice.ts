/**
 * The invoice, in the operator's design of 24 September 2026
 * (docs/superpowers/specs/2026-09-24-invoice-redesign-design.md, which is the
 * authority for every block below and describes his page top to bottom).
 *
 * **His two instructions bind the page.** His colours: the practice's violet
 * for bands and accents, white on violet, and the three tints of that violet
 * (`CARD`, `EDGE`, `PILL`, all derived from `VIOLET` in `sheet.ts`) for card
 * grounds, borders and the discount pill — text otherwise in the ink and the
 * two greys the documents already use, and no other hue. And simplicity: what
 * his page shows and nothing it does not. No shadows, no gradients, no icons,
 * no rows his page leaves out, and Arabic only where the spec keeps it — the
 * title, the supplier block, the captions and headings, the summary's rows —
 * and never beside the bank account's rows.
 *
 * Seven blocks, top to bottom: the masthead (the mark left, the title right);
 * the supplier block and the number card; the billed-to card and the payment
 * method; the lines table under a violet header; the payment details and
 * invoice summary cards side by side; the tax information card; the footer,
 * pinned to the foot of the page.
 *
 * **Every block is measured before it is drawn**, and its box is recorded
 * (`Block`) so `tests/billing/geometry.test.ts` can assert the page as boxes:
 * nothing crosses a margin or another block, the table's header is at the top
 * of every page the table touches, the two cards and the tax card are kept on
 * one page together, the footer is pinned.
 *
 * **The registration decides only what a registration adds**: the title word,
 * the VAT number row, the VAT column, the Net and VAT rows. All of it from the
 * document's own snapshot (`model.ts`), asked through `chargesVat` alone.
 */

import { chargesVat, type InvoiceDocument, type InvoiceLine } from './model';
import type { DocumentImage, FontSet, Page } from '../../shared/document';
import {
  BAND,
  CARD,
  GUTTER,
  INK,
  LEFT,
  MUTED,
  PILL,
  RIGHT,
  SMALL_LINE,
  Sheet,
  VIOLET,
  type TextOptions,
} from './sheet';
import {
  discountTotalLabel,
  formatDocumentDate,
  formatRate,
  groupIban,
  money,
  NOT_REGISTERED_BASIS,
  SIMPLIFIED_BASIS,
  waivedNotice,
  WORDMARK,
  WORDS,
  type Phrase,
} from './strings';

/** The measure: everything on the page lies between the two margins. */
const WIDTH = RIGHT - LEFT;
/** Between two blocks set side by side. */
const GAP = 14;
/** The air inside a card, on every side. */
const PAD = 12;
/** The number card and the summary card take the right 40% of the measure. */
const RIGHT_WIDTH = WIDTH * 0.4;
const RIGHT_X = RIGHT - RIGHT_WIDTH;
/** The supplier block, the billed-to card and the payment card take the rest. */
const LEFT_WIDTH = WIDTH - RIGHT_WIDTH - GAP;
/** The practice's lockup, set against the left margin as his page sets it. */
const LOGO_WIDTH = 250;
/** Corners on every card. */
const RADIUS = 6;
/** The table's violet header band, English over Arabic. */
const HEADER_HEIGHT = 40;
/** The least a line of the table is tall: its description and the Arabic name beneath. */
const ROW_HEIGHT = 44;
/** The discount pill: fully rounded, so its radius is half this. */
const PILL_HEIGHT = 18;
/** The violet bar down the tax card's left edge. */
const BAR_WIDTH = 4;
/** The strip at the foot of the payment card that carries the payment reference. */
const STRIP_HEIGHT = 26;
/** Inside a table cell, either side of what it holds. */
const CELL_PAD = 8;
/** Inside the pill, either side of its text. */
const PILL_PAD = 9;
/** From a card's left edge to the value column of its labelled rows. */
const LABEL_COLUMN = 72;

/** Type sizes, in points. */
const TYPE = {
  title: 24,
  titleAr: 18,
  wordmark: 15,
  name: 11,
  row: 8,
  caption: 7,
  reference: 14,
  date: 9,
  household: 13,
  record: 8,
  method: 10,
  heading: 8.5,
  headingAr: 7.5,
  description: 9.5,
  descriptionAr: 7.5,
  cell: 9,
  pill: 8,
  cardTitle: 10,
  label: 7.5,
  value: 8.5,
  due: 22,
  taxTitle: 9,
  tax: 8,
  footer: 7.5,
} as const;

/** The page's own measurements, for `GEOMETRY` and the tests that read it. */
export const INVOICE_GEOMETRY = {
  LOGO_WIDTH,
  PAD,
  GAP,
  RIGHT_WIDTH,
  LEFT_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  PILL_HEIGHT,
  BAR_WIDTH,
} as const;

/** The blocks the page is made of, by the name the geometry tests read them by. */
export type BlockName =
  | 'masthead'
  | 'supplier'
  | 'numberCard'
  | 'billedTo'
  | 'paymentMethod'
  | 'tableHeader'
  | 'tableRows'
  | 'paymentCard'
  | 'summaryCard'
  | 'taxCard'
  | 'footer';

/** A block's box on its page, in points from the bottom-left as PDF measures. */
export type Block = { name: BlockName; left: number; right: number; top: number; bottom: number };

/** Lays out an invoice, answering its pages and, per page, the boxes its blocks were drawn in. */
export function invoiceLayout(
  document_: InvoiceDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): { pages: Page[]; blocks: Block[][] } {
  const page = new InvoicePage(document_, fonts);
  page.draw(logo);
  const pages = page.sheet.finish();
  return { pages, blocks: pages.map((_, index) => page.blocks[index] ?? []) };
}

/** A line of type within a block, measured, waiting for its baseline. */
type Setting = { text: string; size: number; options: TextOptions };

class InvoicePage {
  readonly sheet: Sheet;
  readonly blocks: Block[][] = [];
  private readonly document_: InvoiceDocument;
  private readonly registered: boolean;

  constructor(document_: InvoiceDocument, fonts: FontSet) {
    this.document_ = document_;
    this.registered = chargesVat(document_.supplier);
    this.sheet = new Sheet(fonts, {
      practice: document_.supplier.legalName,
      reference: document_.reference,
    });
  }

  draw(logo: DocumentImage | null): void {
    // The footer is measured first: a long address wraps it upward, and the
    // flow on every page has to stop short of wherever its hairline lands.
    const footer = this.footer();
    this.sheet.setFloor(footer.top + GAP);

    this.masthead(logo);
    this.sheet.down(18);
    this.supplierAndNumber();
    this.sheet.down(16);
    this.billedToAndMethod();
    this.sheet.down(18);
    this.table();
    this.sheet.down(16);
    this.cardsAndTax();
    footer.draw();
  }

  private record(name: BlockName, left: number, right: number, top: number, bottom: number): void {
    const page = this.sheet.page;
    const blocks = this.blocks[page] ?? [];
    blocks.push({ name, left, right, top, bottom });
    this.blocks[page] = blocks;
  }

  private width(setting: Setting): number {
    return this.sheet.width(setting.text, setting.size, setting.options);
  }

  // ------------------------------------------------------------------------
  // 1. The masthead
  // ------------------------------------------------------------------------

  /**
   * The mark left, about 250 points wide as his page sets the lockup, its
   * height from the file's own proportions so it is never stretched — or the
   * wordmark in type when the practice has none. The title right, in violet:
   * "INVOICE" bold and large and "فاتورة" beneath it; a registered practice's
   * "TAX INVOICE" and "فاتورة ضريبية". The capitals are his.
   */
  private masthead(logo: DocumentImage | null): void {
    const top = this.sheet.baseline;
    let markBottom: number;
    if (logo && logo.width > 0) {
      const height = (LOGO_WIDTH * logo.height) / logo.width;
      this.sheet.image(LEFT, top - height, LOGO_WIDTH, height);
      markBottom = top - height;
    } else {
      this.sheet.line(top - 14, LEFT, WORDMARK, TYPE.wordmark, { bold: true });
      markBottom = top - 14 - 5;
    }

    const title = this.registered ? WORDS.taxInvoice : WORDS.invoice;
    const english = top - 20;
    const arabic = english - 26;
    this.sheet.line(english, RIGHT, title.en.toUpperCase(), TYPE.title, {
      bold: true,
      rgb: VIOLET,
      align: 'end',
    });
    this.sheet.line(arabic, RIGHT, title.ar, TYPE.titleAr, {
      bold: true,
      rgb: VIOLET,
      align: 'end',
      rtl: true,
    });

    const bottom = Math.min(markBottom, arabic - 8);
    this.record('masthead', LEFT, RIGHT, top, bottom);
    this.sheet.down(top - bottom);
  }

  // ------------------------------------------------------------------------
  // 2. The supplier block and the number card
  // ------------------------------------------------------------------------

  /**
   * The practice, left: its legal name bold with the Arabic name beside it,
   * then licence, authority and corporate-tax registration — each English
   * label and value against the left and the Arabic label and value against
   * the right of the same half, as his page sets them. A registered practice
   * adds its VAT number as a fourth row. The number card, right.
   */
  private supplierAndNumber(): void {
    const supplier = this.document_.supplier;
    const labelled = (label: Phrase, value: string, bold = false): FacingRow => ({
      en: `${label.en} ${value}`,
      ar: `${label.ar} ${value}`,
      size: TYPE.row,
      step: 12,
      bold,
      grey: bold ? INK : MUTED,
    });
    const rows: FacingRow[] = [
      {
        en: supplier.legalName,
        ar: supplier.legalNameAr,
        size: TYPE.name,
        step: 16,
        bold: true,
        grey: INK,
      },
    ];
    if (supplier.licenceNumber) rows.push(labelled(WORDS.licenceNumber, supplier.licenceNumber));
    if (supplier.licensingAuthority) {
      rows.push(labelled(WORDS.licensingAuthority, supplier.licensingAuthority));
    }
    if (supplier.corporateTaxNumber) {
      rows.push(labelled(WORDS.corporateTaxNumber, supplier.corporateTaxNumber));
    }
    // The VAT number only on a document whose own snapshot says the practice
    // held one. There is no other branch that can print it.
    if (this.registered && supplier.vatNumber) {
      rows.push(labelled(WORDS.vatRegistrationNumber, supplier.vatNumber, true));
    }

    const top = this.sheet.baseline;
    const facing = this.facing(rows, LEFT_WIDTH);
    const firstBaseline = top - 9;
    const supplierBottom = firstBaseline - facing.depth - 4;

    const pairs: { label: Phrase; value: Setting }[] = [
      {
        label: WORDS.invoiceNo,
        value: {
          text: this.document_.reference,
          size: TYPE.reference,
          options: { bold: true, rgb: VIOLET },
        },
      },
      {
        label: WORDS.issueDate,
        value: {
          text: formatDocumentDate(this.document_.issuedOn),
          size: TYPE.date,
          options: { bold: true },
        },
      },
    ];
    // Only when it differs: a null here means the supply and the issue were
    // the same day, which is what the column's own constraint guarantees.
    if (this.document_.suppliedOn) {
      pairs.push({
        label: WORDS.dateOfSupply,
        value: {
          text: formatDocumentDate(this.document_.suppliedOn),
          size: TYPE.date,
          options: { bold: true },
        },
      });
    }
    const placed: { label: Phrase; value: Setting; caption: number; baseline: number }[] = [];
    let caption = top - PAD - 6;
    for (const pair of pairs) {
      const baseline = caption - pair.value.size - 4;
      placed.push({ ...pair, caption, baseline });
      caption = baseline - 15;
    }
    const lastValue = placed[placed.length - 1]?.baseline ?? top;
    const cardHeight = top - (lastValue - PAD + 2);

    this.sheet.card(RIGHT_X, top, RIGHT_WIDTH, cardHeight, { radius: RADIUS });
    for (const each of placed) {
      this.caption(each.caption, RIGHT_X + PAD, RIGHT - PAD, each.label, TYPE.caption, {
        grey: MUTED,
      });
      this.sheet.line(each.baseline, RIGHT_X + PAD, each.value.text, each.value.size, {
        ...each.value.options,
      });
    }
    this.drawFacing(facing, LEFT, LEFT_WIDTH, firstBaseline);

    this.record('supplier', LEFT, LEFT + LEFT_WIDTH, top, supplierBottom);
    this.record('numberCard', RIGHT_X, RIGHT, top, top - cardHeight);
    this.sheet.down(top - Math.min(supplierBottom, top - cardHeight));
  }

  // ------------------------------------------------------------------------
  // 3. The billed-to card and the payment method
  // ------------------------------------------------------------------------

  /**
   * The household, in a card on the left: "BILLED TO" / "الفاتورة إلى" small,
   * the name bold and large, then its client record with the Arabic label
   * and the number on the right. The payment method, right, with no card —
   * and absent, caption and all, when the practice has recorded no account.
   */
  private billedToAndMethod(): void {
    const top = this.sheet.baseline;
    const inner = LEFT_WIDTH - PAD * 2;
    const x = LEFT + PAD;
    const captionAt = top - PAD - 5;

    const name = this.sheet.wrap(this.document_.recipient.name, inner, TYPE.household, {
      bold: true,
    });
    const nameAt = captionAt - 18;
    const lastName = nameAt - (name.length - 1) * 16;
    const record = this.document_.recipient.recordNumber;
    const english: Setting = {
      text: `${WORDS.clientRecord.en}: ${record}`,
      size: TYPE.record,
      options: { grey: MUTED },
    };
    const arabic: Setting = {
      text: `${WORDS.clientRecord.ar} ${record}`,
      size: TYPE.record,
      options: { grey: MUTED, align: 'end', rtl: true },
    };
    const recordAt = lastName - 18;
    // Side by side when they fit, the Arabic beneath when they do not.
    const arabicAt =
      this.width(english) + GUTTER + this.width(arabic) <= inner ? recordAt : recordAt - 11;
    const cardHeight = top - (arabicAt - PAD + 2);

    this.sheet.card(LEFT, top, LEFT_WIDTH, cardHeight, { radius: RADIUS });
    this.caption(captionAt, x, LEFT + LEFT_WIDTH - PAD, WORDS.billedToCaption, TYPE.caption, {
      bold: true,
      grey: MUTED,
    });
    name.forEach((line, index) => {
      this.sheet.line(nameAt - index * 16, x, line, TYPE.household, { bold: true });
    });
    this.sheet.line(recordAt, x, english.text, english.size, english.options);
    this.sheet.line(arabicAt, LEFT + LEFT_WIDTH - PAD, arabic.text, arabic.size, arabic.options);
    this.record('billedTo', LEFT, LEFT + LEFT_WIDTH, top, top - cardHeight);

    let bottom = top - cardHeight;
    if (this.document_.bank) {
      const lines: { at: number; setting: Setting }[] = [
        {
          at: captionAt,
          setting: {
            text: WORDS.paymentMethodCaption.en,
            size: TYPE.caption,
            options: { bold: true, grey: MUTED, align: 'end' },
          },
        },
        {
          at: captionAt - 11,
          setting: {
            text: WORDS.paymentMethodCaption.ar,
            size: TYPE.caption,
            options: { grey: MUTED, align: 'end', rtl: true },
          },
        },
        {
          at: captionAt - 28,
          setting: {
            text: WORDS.bankTransferMethod.en,
            size: TYPE.method,
            options: { bold: true, rgb: VIOLET, align: 'end' },
          },
        },
        {
          at: captionAt - 44,
          setting: {
            text: WORDS.bankTransferMethod.ar,
            size: TYPE.method,
            options: { bold: true, rgb: VIOLET, align: 'end', rtl: true },
          },
        },
      ];
      for (const each of lines) {
        this.sheet.line(each.at, RIGHT, each.setting.text, each.setting.size, each.setting.options);
      }
      const widest = Math.max(...lines.map((each) => this.width(each.setting)));
      const methodBottom = captionAt - 44 - 5;
      this.record('paymentMethod', RIGHT - widest, RIGHT, top, methodBottom);
      bottom = Math.min(bottom, methodBottom);
    }
    this.sheet.down(top - bottom);
  }

  // ------------------------------------------------------------------------
  // 4. The lines table
  // ------------------------------------------------------------------------

  /**
   * A card whose header is a solid violet band with white headings, English
   * over Arabic. The Discount column only when the invoice carries a
   * discount; a registered practice's VAT column before Total, whose figure
   * is then the gross. A page taken mid-table draws the header again.
   */
  private table(): void {
    const columns = this.columns();
    const descriptionWidth = WIDTH - columns.reduce((total, column) => total + column.width, 0);
    const rows = this.document_.lines.map((line) => this.row(line, descriptionWidth));

    let next = 0;
    while (next < rows.length) {
      const first = rows[next];
      if (!first) break;
      // Never a header alone at the foot of a page: it and its first row together.
      this.sheet.room(HEADER_HEIGHT + first.height);
      const top = this.sheet.baseline;
      let bottom = top - HEADER_HEIGHT;
      let end = next;
      while (end < rows.length) {
        const row = rows[end];
        if (!row) break;
        const fits = bottom - row.height >= this.sheet.floor;
        // A row taller than a whole page is still drawn rather than lost; the
        // clamp on what is set (`clampForDocument`) keeps that from happening.
        if (!fits && end > next) break;
        bottom -= row.height;
        end += 1;
      }

      // The card's border first, from half-way down the band, so the band
      // drawn over it hides its upper corners and the rows keep the lower two.
      this.sheet.outline(LEFT, top - HEADER_HEIGHT / 2, WIDTH, top - HEADER_HEIGHT / 2 - bottom);
      this.header(top, columns, descriptionWidth);
      let y = top - HEADER_HEIGHT;
      for (let index = next; index < end; index += 1) {
        const row = rows[index];
        if (!row) continue;
        this.drawRow(row, y, columns, descriptionWidth, index === end - 1);
        y -= row.height;
      }
      this.record('tableHeader', LEFT, RIGHT, top, top - HEADER_HEIGHT);
      this.record('tableRows', LEFT, RIGHT, top - HEADER_HEIGHT, bottom);
      this.sheet.down(top - bottom);

      next = end;
      if (next < rows.length) this.sheet.breakPage();
    }
  }

  /** The figure columns, each as wide as its widest heading or cell and no narrower than its least. */
  private columns(): Column[] {
    const figure = (text: string): Cell => ({ kind: 'text', text });
    const columns: { label: Phrase; least: number; cell: (line: InvoiceLine) => Cell }[] = [
      { label: WORDS.qty, least: 44, cell: (line) => figure(String(line.quantity)) },
      { label: WORDS.unitPrice, least: 70, cell: (line) => figure(money(line.unitNetFils)) },
    ];
    if (this.document_.discountFils > 0) {
      columns.push({
        label: WORDS.discount,
        least: 70,
        cell: (line) => {
          if (line.discountFils <= 0) return { kind: 'empty' };
          return {
            kind: 'pill',
            text:
              line.discountBasisPoints === null
                ? money(line.discountFils)
                : formatRate(line.discountBasisPoints),
          };
        },
      });
    }
    if (this.registered) {
      columns.push({
        label: WORDS.vatColumn,
        least: 70,
        cell: (line) => figure(money(line.vatFils)),
      });
    }
    columns.push({
      label: WORDS.total,
      least: 70,
      cell: (line) => figure(money(this.registered ? line.grossFils : line.netFils)),
    });

    return columns.map((column) => {
      const widths = [
        this.sheet.width(column.label.en, TYPE.heading, { bold: true }),
        this.sheet.width(column.label.ar, TYPE.headingAr, { bold: true, rtl: true }),
        ...this.document_.lines.map((line) => {
          const cell = column.cell(line);
          if (cell.kind === 'empty') return 0;
          const text = this.sheet.width(cell.text, cell.kind === 'pill' ? TYPE.pill : TYPE.cell, {
            bold: true,
          });
          return cell.kind === 'pill' ? text + PILL_PAD * 2 : text;
        }),
      ];
      return {
        label: column.label,
        cell: column.cell,
        width: Math.max(column.least, Math.max(...widths) + CELL_PAD * 2),
      };
    });
  }

  private header(top: number, columns: readonly Column[], descriptionWidth: number): void {
    // Rounded at the top as the card is, square where the rows meet it.
    this.sheet.bandFill(LEFT, top, WIDTH, HEADER_HEIGHT, RADIUS);
    this.sheet.bandFill(LEFT, top - HEADER_HEIGHT / 2, WIDTH, HEADER_HEIGHT / 2);
    const english = top - 16;
    const arabic = top - 30;
    const white = [1, 1, 1] as const;
    this.sheet.line(english, LEFT + PAD, WORDS.description.en, TYPE.heading, {
      bold: true,
      rgb: white,
    });
    this.sheet.line(arabic, LEFT + PAD, WORDS.description.ar, TYPE.headingAr, {
      bold: true,
      rgb: white,
      rtl: true,
      align: 'start',
    });
    let x = LEFT + descriptionWidth;
    for (const column of columns) {
      const centre = x + column.width / 2;
      this.sheet.line(english, centre, column.label.en, TYPE.heading, {
        bold: true,
        rgb: white,
        align: 'centre',
      });
      this.sheet.line(arabic, centre, column.label.ar, TYPE.headingAr, {
        bold: true,
        rgb: white,
        align: 'centre',
        rtl: true,
      });
      x += column.width;
    }
  }

  /** A line measured: its description and Arabic name wrapped to the column, its height. */
  private row(line: InvoiceLine, descriptionWidth: number): Row {
    const inner = descriptionWidth - PAD * 2;
    const english = this.sheet.wrap(line.description, inner, TYPE.description, { bold: true });
    const arabic = line.descriptionAr
      ? this.sheet.wrap(line.descriptionAr, inner, TYPE.descriptionAr, { rtl: true })
      : [];
    const lastEnglish = 17 + (english.length - 1) * 12;
    const deepest = arabic.length > 0 ? lastEnglish + 13 + (arabic.length - 1) * 10 : lastEnglish;
    return { line, english, arabic, height: Math.max(ROW_HEIGHT, deepest + 14) };
  }

  private drawRow(
    row: Row,
    top: number,
    columns: readonly Column[],
    descriptionWidth: number,
    last: boolean,
  ): void {
    const bottom = top - row.height;
    const x = LEFT + PAD;
    row.english.forEach((text, index) => {
      this.sheet.line(top - 17 - index * 12, x, text, TYPE.description, { bold: true });
    });
    const arabicAt = top - 17 - (row.english.length - 1) * 12 - 13;
    row.arabic.forEach((text, index) => {
      // Right-to-left, but in a column read from the left: said explicitly,
      // or it would end at `x` and run off the paper.
      this.sheet.line(arabicAt - index * 10, x, text, TYPE.descriptionAr, {
        grey: MUTED,
        rtl: true,
        align: 'start',
      });
    });

    const middle = top - row.height / 2;
    let left = LEFT + descriptionWidth;
    for (const column of columns) {
      // A hairline between each cell and the one before it.
      this.sheet.hairline(left - 0.25, bottom, 0.5, row.height);
      const centre = left + column.width / 2;
      const cell = column.cell(row.line);
      if (cell.kind === 'text') {
        this.sheet.line(middle - 3, centre, cell.text, TYPE.cell, { bold: true, align: 'centre' });
      } else if (cell.kind === 'pill') {
        const width = this.sheet.width(cell.text, TYPE.pill, { bold: true }) + PILL_PAD * 2;
        this.sheet.rect(centre - width / 2, middle - PILL_HEIGHT / 2, width, PILL_HEIGHT, {
          fill: { rgb: PILL },
          radius: PILL_HEIGHT / 2,
        });
        this.sheet.line(middle - 2.8, centre, cell.text, TYPE.pill, {
          bold: true,
          rgb: VIOLET,
          align: 'centre',
        });
      }
      left += column.width;
    }
    // A hairline under each row; the last on a page has the card's own edge.
    if (!last) this.sheet.hairline(LEFT, bottom - 0.25, WIDTH);
  }

  // ------------------------------------------------------------------------
  // 5 and 6. The two cards and the tax information card
  // ------------------------------------------------------------------------

  /**
   * The payment details card and the invoice summary side by side, then the
   * tax information card beneath them — measured together and moved to the
   * next page together when they do not fit, so how to pay never lands a
   * sheet away from what is owed.
   */
  private cardsAndTax(): void {
    const payment = this.document_.bank ? this.paymentCard(this.document_.bank) : null;
    const summary = this.summaryCard();
    const tax = this.taxCard();
    const cardsHeight = Math.max(payment?.height ?? 0, summary.height);
    this.sheet.room(cardsHeight + GAP + tax.height);

    const top = this.sheet.baseline;
    if (payment) {
      payment.draw(top, cardsHeight);
      this.record('paymentCard', LEFT, LEFT + LEFT_WIDTH, top, top - cardsHeight);
    }
    // The summary keeps its place on the right whether or not the payment
    // card is beside it, and is as tall as the taller of the two.
    summary.draw(top, cardsHeight);
    this.record('summaryCard', RIGHT_X, RIGHT, top, top - cardsHeight);

    const taxTop = top - cardsHeight - GAP;
    tax.draw(taxTop);
    this.record('taxCard', LEFT, RIGHT, taxTop, taxTop - tax.height);
    this.sheet.down(top - (taxTop - tax.height));
  }

  /**
   * How to pay: English labels only, because an account number read against
   * six labels is a number a payer misreads. Account name, the IBAN in violet
   * bold grouped in fours, SWIFT / BIC and the bank address, each wrapping
   * within its column rather than being cut — a truncated account name is a
   * transfer that bounces. A strip at its foot names the payment reference.
   */
  private paymentCard(bank: NonNullable<InvoiceDocument['bank']>): Laid {
    const x = LEFT;
    const width = LEFT_WIDTH;
    const valueAt = x + PAD + LABEL_COLUMN;
    const valueWidth = width - PAD * 2 - LABEL_COLUMN;
    const rows: { label: string; value: string; options: TextOptions }[] = [
      { label: WORDS.accountName.en, value: bank.accountHolder, options: { bold: true } },
      { label: WORDS.iban.en, value: groupIban(bank.iban), options: { bold: true, rgb: VIOLET } },
    ];
    if (bank.bic) rows.push({ label: WORDS.swiftBic.en, value: bank.bic, options: { bold: true } });
    if (bank.bankAddress) {
      rows.push({ label: WORDS.bankAddress.en, value: bank.bankAddress, options: {} });
    }
    const laid = rows.map((row) => ({
      ...row,
      lines: this.sheet.wrap(row.value, valueWidth, TYPE.value, row.options),
    }));
    // Offsets from the card's top.
    const titleAt = PAD + 8;
    let at = titleAt + 8 + 17;
    const placed = laid.map((row) => {
      const first = at;
      at = first + (row.lines.length - 1) * 11 + 19;
      return { ...row, first };
    });
    const lastLine = at - 19;
    const stripTop = lastLine + 14;
    const height = stripTop + STRIP_HEIGHT + PAD;

    return {
      height,
      draw: (top, cardHeight) => {
        this.sheet.outline(x, top, width, cardHeight, RADIUS);
        this.cardTitle(top - titleAt, x, width, WORDS.paymentDetails);
        for (const row of placed) {
          this.sheet.line(top - row.first, x + PAD, row.label, TYPE.label, { grey: MUTED });
          row.lines.forEach((line, index) => {
            this.sheet.line(top - row.first - index * 11, valueAt, line, TYPE.value, row.options);
          });
        }
        // The strip sits at the card's foot, however tall the summary beside
        // it has made the pair.
        const stripBottom = top - cardHeight + PAD;
        const stripAt = stripBottom + STRIP_HEIGHT;
        this.sheet.rect(x + PAD, stripBottom, width - PAD * 2, STRIP_HEIGHT, {
          fill: { rgb: CARD },
          radius: 4,
        });
        const baseline = stripAt - 16;
        const label = WORDS.paymentReference;
        this.sheet.line(baseline, x + PAD + 10, label.en, TYPE.label, { grey: MUTED });
        this.sheet.line(
          baseline,
          x + PAD + 10 + this.sheet.width(label.en, TYPE.label) + 10,
          label.ar,
          TYPE.label,
          { grey: MUTED, rtl: true, align: 'start' },
        );
        this.sheet.line(baseline, x + width - PAD - 10, this.document_.reference, TYPE.cell, {
          bold: true,
          rgb: VIOLET,
          align: 'end',
        });
      },
    };
  }

  /**
   * What is owed: the subtotal (the list total), the discount when there was
   * one — "Discount 25%" when the lines share one percentage — with its
   * amount as "- AED …", a registered practice's Net and VAT, a hairline, and
   * the violet block: "TOTAL DUE" / "الإجمالي المستحق" small in white over the
   * figure large in white.
   */
  private summaryCard(): Laid {
    const document_ = this.document_;
    const x = RIGHT_X;
    const width = RIGHT_WIDTH;
    const rows: { label: Phrase; value: string; accent?: boolean }[] = [
      { label: WORDS.subtotal, value: money(document_.netFils + document_.discountFils) },
    ];
    if (document_.discountFils > 0) {
      rows.push({
        label: discountTotalLabel(document_.discountBasisPoints),
        value: `- ${money(document_.discountFils)}`,
        accent: true,
      });
    }
    if (this.registered) {
      rows.push({ label: WORDS.net, value: money(document_.netFils) });
      rows.push({ label: this.vatLabel(), value: money(document_.vatFils) });
    }

    const titleAt = PAD + 8;
    const firstRow = titleAt + 8 + 17;
    const lastRow = firstRow + (rows.length - 1) * 16;
    const ruleAt = lastRow + 9;
    const blockTop = ruleAt + 10;
    const least = 60;
    const height = blockTop + least + 8;

    return {
      height,
      draw: (top, cardHeight) => {
        this.sheet.outline(x, top, width, cardHeight, RADIUS);
        this.cardTitle(top - titleAt, x, width, WORDS.invoiceSummary);
        rows.forEach((row, index) => {
          const y = top - firstRow - index * 16;
          const valueOptions: TextOptions = row.accent
            ? { bold: true, rgb: VIOLET, align: 'end' }
            : { bold: true, align: 'end' };
          this.sheet.line(y, x + PAD, row.label.en, TYPE.value, { grey: MUTED });
          // The Arabic label beside the English, and left off only when a
          // figure grown into the millions would come within a gutter of it:
          // a reader loses a translation of a word, never a number.
          const arabicAt = x + PAD + this.sheet.width(row.label.en, TYPE.value) + 6;
          const arabicWidth = this.sheet.width(row.label.ar, TYPE.label, { rtl: true });
          const figureAt =
            x + width - PAD - this.sheet.width(row.value, TYPE.value, { bold: true });
          if (arabicAt + arabicWidth + GUTTER <= figureAt) {
            this.sheet.line(y, arabicAt, row.label.ar, TYPE.label, {
              grey: MUTED,
              rtl: true,
              align: 'start',
            });
          }
          this.sheet.line(y, x + width - PAD, row.value, TYPE.value, valueOptions);
        });
        this.sheet.hairline(x + PAD, top - ruleAt, width - PAD * 2);

        // The violet block fills the card to its foot.
        const inset = 8;
        const bandTop = top - blockTop;
        const bandBottom = top - cardHeight + inset;
        const bandWidth = width - inset * 2;
        this.sheet.bandFill(x + inset, bandTop, bandWidth, bandTop - bandBottom, RADIUS);
        const white = [1, 1, 1] as const;
        const captionAt = bandTop - 14;
        this.sheet.line(captionAt, x + inset + 10, WORDS.totalDue.en, TYPE.caption, {
          bold: true,
          rgb: white,
        });
        this.sheet.line(captionAt, x + width - inset - 10, WORDS.totalDue.ar, TYPE.caption, {
          bold: true,
          rgb: white,
          align: 'end',
          rtl: true,
        });
        const figure = money(document_.grossFils);
        const room = bandWidth - 20;
        const natural = this.sheet.width(figure, TYPE.due, { bold: true });
        // Smaller only when a figure in the millions would not fit the block.
        const size = natural > room ? (TYPE.due * room) / natural : TYPE.due;
        const middle = (captionAt - 6 + bandBottom) / 2;
        this.sheet.line(middle - size * 0.35, x + width / 2, figure, size, {
          bold: true,
          rgb: white,
          align: 'centre',
        });
      },
    };
  }

  /** "VAT 5%" when every line carries the one rate, which in the UAE they do; "VAT" otherwise. */
  private vatLabel(): Phrase {
    const rates = new Set(this.document_.lines.map((line) => line.vatRateBasisPoints));
    const [rate] = [...rates];
    if (rates.size !== 1 || rate === undefined) return WORDS.vatColumn;
    return {
      en: `${WORDS.vatColumn.en} ${formatRate(rate)}`,
      ar: `${WORDS.vatColumn.ar} ${formatRate(rate)}`,
    };
  }

  /**
   * Full width, the card's ground with a violet bar down its left edge: the
   * title, then the sentence the practice's registration calls for, English
   * and beneath it Arabic. A waived invoice says so first, in ink.
   */
  private taxCard(): { height: number; draw: (top: number) => void } {
    const x = LEFT + BAR_WIDTH + PAD;
    const width = WIDTH - BAR_WIDTH - PAD * 2;
    const sentences: { phrase: Phrase; grey: number }[] = [];
    if (this.document_.waivedOn) {
      // A charge the practice has forgiven, said on the document rather than
      // left to the ledger: the invoice keeps its number and its figures —
      // it is append-only — so a page that said nothing would go on billing
      // a family for money it does not owe (migration 408).
      sentences.push({ phrase: waivedNotice(this.document_.waivedOn), grey: INK });
    }
    sentences.push({
      phrase: this.registered ? SIMPLIFIED_BASIS : NOT_REGISTERED_BASIS,
      grey: MUTED,
    });

    const titleAt = PAD + 7;
    let at = titleAt + 16;
    const placed = sentences.map((sentence) => {
      const english = this.sheet.wrap(sentence.phrase.en, width, TYPE.tax);
      const arabic = this.sheet.wrap(sentence.phrase.ar, width, TYPE.tax, { rtl: true });
      const englishAt = at;
      const arabicAt = englishAt + english.length * 12;
      at = arabicAt + (arabic.length - 1) * 12 + 16;
      return { ...sentence, english, arabic, englishAt, arabicAt };
    });
    const lastLine = at - 16;
    const height = lastLine + PAD - 2;

    return {
      height,
      draw: (top) => {
        this.sheet.card(LEFT, top, WIDTH, height, { radius: RADIUS });
        this.sheet.bandFill(LEFT, top, BAR_WIDTH, height);
        this.caption(top - titleAt, x, RIGHT - PAD, WORDS.taxInformation, TYPE.taxTitle, {
          bold: true,
          rgb: VIOLET,
        });
        for (const sentence of placed) {
          sentence.english.forEach((line, index) => {
            this.sheet.line(top - sentence.englishAt - index * 12, x, line, TYPE.tax, {
              grey: sentence.grey,
            });
          });
          sentence.arabic.forEach((line, index) => {
            this.sheet.line(top - sentence.arabicAt - index * 12, RIGHT - PAD, line, TYPE.tax, {
              grey: sentence.grey,
              align: 'end',
              rtl: true,
            });
          });
        }
      },
    };
  }

  // ------------------------------------------------------------------------
  // 7. The footer
  // ------------------------------------------------------------------------

  /**
   * A hairline, then the legal name and the address on one centred line, the
   * address's parts spaced by three spaces as his page spaces them; the
   * telephone, email and website on the next. Pinned to the foot of the last
   * page, and **wrapped, never cut**: the address is a thing a UAE invoice
   * must state and this is the only place the page states it, so a long one
   * grows the footer upward into the page rather than losing its end.
   */
  private footer(): { top: number; draw: () => void } {
    const supplier = this.document_.supplier;
    const centre = (LEFT + RIGHT) / 2;
    const spacer = '   ';
    const pieces = [
      supplier.legalName,
      ...(supplier.address ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ];
    const lines: string[] = [];
    let line = '';
    for (const piece of pieces) {
      const candidate = line.length === 0 ? piece : `${line}${spacer}${piece}`;
      if (this.sheet.width(candidate, TYPE.footer) <= WIDTH) {
        line = candidate;
        continue;
      }
      if (line.length > 0) lines.push(line);
      // A single part wider than the page: wrapped within itself.
      const wrapped = this.sheet.wrap(piece, WIDTH, TYPE.footer);
      lines.push(...wrapped.slice(0, -1));
      line = wrapped[wrapped.length - 1] ?? '';
    }
    if (line.length > 0) lines.push(line);

    const contact = [
      supplier.contactPhone ? `P: ${supplier.contactPhone}` : null,
      supplier.contactEmail ? `E: ${supplier.contactEmail}` : null,
      supplier.website ? `W: ${supplier.website}` : null,
    ].filter((part): part is string => part !== null);

    // The last line stays where it always was; more lines rise above it.
    const top = BAND + (lines.length - 1) * SMALL_LINE;
    const baselines = lines.map((_, index) => top - 12 - index * SMALL_LINE);
    const contactAt = top - 12 - lines.length * SMALL_LINE;
    const lowest = contact.length > 0 ? contactAt : (baselines[baselines.length - 1] ?? top - 12);

    return {
      top,
      draw: () => {
        this.sheet.ruleAt(top, LEFT, WIDTH);
        lines.forEach((each, index) => {
          this.sheet.line(baselines[index] ?? top, centre, each, TYPE.footer, {
            grey: MUTED,
            align: 'centre',
          });
        });
        if (contact.length > 0) {
          this.sheet.line(
            contactAt,
            centre,
            this.sheet.fit(contact.join(spacer), WIDTH, TYPE.footer),
            TYPE.footer,
            { grey: MUTED, align: 'centre' },
          );
        }
        this.record('footer', LEFT, RIGHT, top, lowest - 3);
      },
    };
  }

  // ------------------------------------------------------------------------
  // Shared by the blocks
  // ------------------------------------------------------------------------

  /** A caption pair: English against `left`, Arabic against `right`, on one baseline. */
  private caption(
    y: number,
    left: number,
    right: number,
    label: Phrase,
    size: number,
    options: TextOptions,
  ): void {
    this.sheet.line(y, left, label.en, size, options);
    this.sheet.line(y, right, label.ar, size, { ...options, align: 'end', rtl: true });
  }

  /** A card's title: English left, Arabic right, violet bold, a hairline under it. */
  private cardTitle(y: number, x: number, width: number, label: Phrase): void {
    this.caption(y, x + PAD, x + width - PAD, label, TYPE.cardTitle, { bold: true, rgb: VIOLET });
    this.sheet.hairline(x + PAD, y - 8, width - PAD * 2);
  }

  /**
   * Rows of English against Arabic across `width`: English against the left
   * and Arabic against the right of one line when the two fit side by side
   * with a gutter between, and otherwise the Arabic on the line beneath the
   * English — each wrapped across the whole width if it must be — so a long
   * authority name on one side can never print through the other, and a
   * registration number is never broken in two.
   */
  private facing(rows: readonly FacingRow[], width: number): Facing {
    const laid = rows.map((row) => {
      const options: TextOptions = { bold: row.bold === true };
      const arabicOptions: TextOptions = { ...options, rtl: true };
      const english = this.sheet.wrap(row.en, width, row.size, options);
      if (!row.ar) return { row, english, arabic: [], beneath: false };
      const together =
        english.length === 1 &&
        this.sheet.width(row.en, row.size, options) +
          GUTTER +
          this.sheet.width(row.ar, row.size, arabicOptions) <=
          width;
      if (together) return { row, english, arabic: [row.ar], beneath: false };
      return {
        row,
        english,
        arabic: this.sheet.wrap(row.ar, width, row.size, arabicOptions),
        beneath: true,
      };
    });
    return { laid, depth: this.facingDepth(laid) };
  }

  /** How many lines a laid row takes. */
  private static linesOf(each: Facing['laid'][number]): number {
    return each.beneath
      ? each.english.length + each.arabic.length
      : Math.max(each.english.length, each.arabic.length);
  }

  /** From the first baseline to the last. */
  private facingDepth(laid: Facing['laid']): number {
    let depth = 0;
    laid.forEach((each, index) => {
      const next = laid[index + 1];
      depth += (InvoicePage.linesOf(each) - 1) * each.row.step + (next ? next.row.step : 0);
    });
    return depth;
  }

  private drawFacing(facing: Facing, x: number, width: number, firstBaseline: number): void {
    let y = firstBaseline;
    facing.laid.forEach((each, index) => {
      const options: TextOptions = { bold: each.row.bold === true, grey: each.row.grey };
      each.english.forEach((line, row) => {
        this.sheet.line(y - row * each.row.step, x, line, each.row.size, options);
      });
      const arabicAt = each.beneath ? y - each.english.length * each.row.step : y;
      each.arabic.forEach((line, row) => {
        this.sheet.line(arabicAt - row * each.row.step, x + width, line, each.row.size, {
          ...options,
          align: 'end',
          rtl: true,
        });
      });
      const next = facing.laid[index + 1];
      y -= (InvoicePage.linesOf(each) - 1) * each.row.step + (next ? next.row.step : 0);
    });
  }
}

type FacingRow = {
  en: string;
  ar: string | null;
  size: number;
  step: number;
  bold?: boolean;
  grey: number;
};

type Facing = {
  /** `beneath`: the Arabic sits on the lines after the English rather than beside it. */
  laid: { row: FacingRow; english: string[]; arabic: string[]; beneath: boolean }[];
  /** From the first baseline to the last. */
  depth: number;
};

type Cell = { kind: 'text'; text: string } | { kind: 'pill'; text: string } | { kind: 'empty' };

type Column = { label: Phrase; width: number; cell: (line: InvoiceLine) => Cell };

type Row = { line: InvoiceLine; english: string[]; arabic: string[]; height: number };

/** A card measured and waiting to be drawn at a top edge and a height the pair agrees on. */
type Laid = { height: number; draw: (top: number, height: number) => void };
