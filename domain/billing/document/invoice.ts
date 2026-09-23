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
 * no rows his page leaves out, no page number, and Arabic only where his
 * page keeps it — the title, the supplier block, the captions, the card
 * titles and the table's headings — never beside the bank account's rows or
 * the summary's.
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
import { INK, LEFT, MUTED, PILL, RIGHT, VIOLET } from './sheet';
import {
  BAR_WIDTH,
  DocumentPage,
  GAP,
  LEFT_WIDTH,
  LOGO_WIDTH,
  NUMBER_WIDTH,
  PAD,
  RADIUS,
  RIGHT_WIDTH,
  SUPPLIER_WIDTH,
  TITLE_BAND,
  TYPE,
  WIDTH,
  type Block,
  type CardRow,
  type Laid,
  type NumberPair,
  type Sentence,
  type SummaryRow,
} from './page';
import {
  discountTotalLabel,
  formatDocumentDate,
  formatRate,
  groupIban,
  money,
  NOT_REGISTERED_BASIS,
  SIMPLIFIED_BASIS,
  waivedNotice,
  WORDS,
  type Phrase,
} from './strings';

/** The table's violet header band, English over Arabic. */
const HEADER_HEIGHT = 40;
/** The least a line of the table is tall: its description and the Arabic name beneath. */
const ROW_HEIGHT = 44;
/** The discount pill: fully rounded, so its radius is half this. */
const PILL_HEIGHT = 18;
/** Inside a table cell, either side of what it holds. */
const CELL_PAD = 8;
/** Inside the pill, either side of its text. */
const PILL_PAD = 9;

/** The page's own measurements, for `GEOMETRY` and the tests that read it. */
export const INVOICE_GEOMETRY = {
  LOGO_WIDTH,
  PAD,
  GAP,
  RIGHT_WIDTH,
  LEFT_WIDTH,
  NUMBER_WIDTH,
  SUPPLIER_WIDTH,
  TITLE_BAND,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  PILL_HEIGHT,
  BAR_WIDTH,
} as const;

/** Lays out an invoice, answering its pages and, per page, the boxes its blocks were drawn in. */
export function invoiceLayout(
  document_: InvoiceDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): { pages: Page[]; blocks: Block[][] } {
  const page = new InvoicePage(document_, fonts);
  page.draw(logo);
  return page.laidOut();
}

class InvoicePage extends DocumentPage {
  private readonly document_: InvoiceDocument;
  private readonly registered: boolean;

  constructor(document_: InvoiceDocument, fonts: FontSet) {
    super(fonts, document_.supplier, document_.reference);
    this.document_ = document_;
    this.registered = chargesVat(document_.supplier);
  }

  draw(logo: DocumentImage | null): void {
    // The footer is measured first: a long address wraps it upward, and the
    // flow on every page has to stop short of wherever its hairline lands.
    const footer = this.footer();
    this.sheet.setFloor(footer.top + GAP);

    this.masthead(logo, this.registered ? WORDS.taxInvoice : WORDS.invoice);
    this.sheet.down(18);
    this.supplierAndNumber({ vat: this.registered }, this.numberPairs());
    this.hairlineAcross();
    this.partyAndMethod(
      { caption: WORDS.billedToCaption, block: 'billedTo', ...this.document_.recipient },
      // Absent, caption and all, when the practice has recorded no account:
      // a bank transfer is the one way the page can say to pay.
      this.document_.bank ? WORDS.bankTransferMethod : null,
    );
    this.sheet.down(18);
    this.table();
    this.sheet.down(16);
    this.lowerCards(
      this.document_.bank
        ? { laid: this.paymentCard(this.document_.bank), block: 'paymentCard' }
        : null,
      this.summary(),
      { laid: this.barCard(WORDS.taxInformation, this.taxSentences()), block: 'taxCard' },
    );
    footer.draw();
  }

  /**
   * "Invoice no." over the reference in violet bold and "Issue date" over the
   * date in bold; the date of supply as a third pair only when it differs —
   * a null here means the supply and the issue were the same day, which is
   * what the column's own constraint guarantees.
   */
  private numberPairs(): NumberPair[] {
    const date = (iso: string) => ({
      text: formatDocumentDate(iso),
      size: TYPE.date,
      options: { bold: true },
    });
    const pairs: NumberPair[] = [
      {
        label: WORDS.invoiceNo,
        value: {
          text: this.document_.reference,
          size: TYPE.reference,
          options: { bold: true, rgb: VIOLET },
        },
      },
      { label: WORDS.issueDate, value: date(this.document_.issuedOn) },
    ];
    if (this.document_.suppliedOn) {
      pairs.push({ label: WORDS.dateOfSupply, value: date(this.document_.suppliedOn) });
    }
    return pairs;
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
   * How to pay: Account name, the IBAN in violet bold grouped in fours,
   * SWIFT / BIC and the bank address, each wrapping rather than being cut —
   * a truncated account name is a transfer that bounces. A strip at its foot
   * names the payment reference: the invoice's own number.
   */
  private paymentCard(bank: NonNullable<InvoiceDocument['bank']>): Laid {
    const rows: CardRow[] = [
      { label: WORDS.accountName.en, value: bank.accountHolder, options: { bold: true } },
      { label: WORDS.iban.en, value: groupIban(bank.iban), options: { bold: true, rgb: VIOLET } },
    ];
    if (bank.bic) rows.push({ label: WORDS.swiftBic.en, value: bank.bic, options: { bold: true } });
    if (bank.bankAddress) {
      rows.push({ label: WORDS.bankAddress.en, value: bank.bankAddress, options: {} });
    }
    return this.rowsCard(WORDS.paymentDetails, rows, {
      label: WORDS.paymentReference,
      value: this.document_.reference,
    });
  }

  /**
   * What is owed: the subtotal (the list total), the discount when there was
   * one — "Discount 25%" when the lines share one percentage — with its
   * amount as "- AED …", a registered practice's Net and VAT; then "TOTAL
   * DUE" / "الإجمالي المستحق" over the gross.
   */
  private summary(): Laid {
    const document_ = this.document_;
    const rows: SummaryRow[] = [
      { label: WORDS.subtotal.en, value: money(document_.netFils + document_.discountFils) },
    ];
    if (document_.discountFils > 0) {
      rows.push({
        label: discountTotalLabel(document_.discountBasisPoints).en,
        value: `- ${money(document_.discountFils)}`,
        accent: true,
      });
    }
    if (this.registered) {
      rows.push({ label: WORDS.net.en, value: money(document_.netFils) });
      rows.push({ label: this.vatLabel(), value: money(document_.vatFils) });
    }
    return this.summaryCard(WORDS.invoiceSummary, rows, WORDS.totalDue, money(document_.grossFils));
  }

  /** "VAT 5%" when every line carries the one rate, which in the UAE they do; "VAT" otherwise. */
  private vatLabel(): string {
    const rates = new Set(this.document_.lines.map((line) => line.vatRateBasisPoints));
    const [rate] = [...rates];
    if (rates.size !== 1 || rate === undefined) return WORDS.vatColumn.en;
    return `${WORDS.vatColumn.en} ${formatRate(rate)}`;
  }

  /**
   * The sentence the practice's registration calls for, and before it — in
   * ink — a waived invoice's own: a charge the practice has forgiven, said on
   * the document rather than left to the ledger. The invoice keeps its number
   * and its figures — it is append-only — so a page that said nothing would
   * go on billing a family for money it does not owe (migration 408).
   */
  private taxSentences(): Sentence[] {
    const sentences: Sentence[] = [];
    if (this.document_.waivedOn) {
      sentences.push({ phrase: waivedNotice(this.document_.waivedOn), grey: INK });
    }
    sentences.push({
      phrase: this.registered ? SIMPLIFIED_BASIS : NOT_REGISTERED_BASIS,
      grey: MUTED,
    });
    return sentences;
  }
}

type Cell = { kind: 'text'; text: string } | { kind: 'pill'; text: string } | { kind: 'empty' };

type Column = { label: Phrase; width: number; cell: (line: InvoiceLine) => Cell };

type Row = { line: InvoiceLine; english: string[]; arabic: string[]; height: number };
