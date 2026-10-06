/**
 * The receipt, in the same dress as the invoice (docs/superpowers/specs/
 * 2026-09-24-invoice-redesign-design.md, "The receipt"; since 7 October 2026
 * the softer dress of 2026-10-07-soft-documents-design.md): a receipt that
 * looked like another design beside this invoice would look like a different
 * practice's.
 *
 * Every block is the invoice's own (`page.ts`); what is here is only what a
 * receipt says in them. "RECEIPT" over "إيصال استلام"; the number card's
 * "Receipt no." and "Date received"; "RECEIVED FROM" over the household; the
 * method the money came by as the payment method; a table of one line —
 * "Payment received on account", and the invoice it was taken against when
 * there is one — and its amount; then a Note card carrying the receipt's own
 * sentence beside the "Receipt summary", whose rows name the method (and the
 * payment's own reference when one was recorded) over the lavender TOTAL PAID
 * block; the invoice's footer.
 *
 * **A receipt asks for nothing and claims nothing about tax.** It says money
 * arrived: no bank account, no payment card, and no corporate-tax or VAT
 * registration in the supplier block, whoever issued it. What tax was charged
 * is a fact about the invoice it settles, not about the act of paying — so a
 * registered practice's receipt reads word for word as an unregistered one's.
 *
 * One line in its table, so one page: the lower cards ask the sheet for room
 * before they draw, as the invoice's do.
 */

import type { ReceiptDocument } from './model';
import type { DocumentImage, FontSet, Page } from '../../shared/document';
import { LEFT, MUTED, RIGHT, VIOLET } from './sheet';
import {
  DocumentPage,
  GAP,
  HEADER_HEIGHT,
  LEFT_WIDTH,
  PAD,
  TYPE,
  WIDTH,
  type Block,
  type NumberPair,
  type SummaryRow,
} from './page';
import {
  againstInvoice,
  arabicDocumentDate,
  formatDocumentDate,
  money,
  receiptBasis,
  WORDS,
  type Phrase,
} from './strings';

/** The amount column: as wide as the invoice's figure columns at their least, and some. */
const AMOUNT_WIDTH = 120;
/** The least the table's one line is tall, as an invoice's line. */
const ROW_HEIGHT = 44;

/** Lays out a receipt, answering its page and the boxes its blocks were drawn in. */
export function receiptLayout(
  document_: ReceiptDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): { pages: Page[]; blocks: Block[][] } {
  const page = new ReceiptPage(document_, fonts);
  page.draw(logo);
  return page.laidOut();
}

class ReceiptPage extends DocumentPage {
  private readonly document_: ReceiptDocument;

  constructor(document_: ReceiptDocument, fonts: FontSet) {
    super(fonts, document_.supplier, document_.reference);
    this.document_ = document_;
  }

  draw(logo: DocumentImage | null): void {
    const document_ = this.document_;
    // The method's own name, spelt as the invoice spells it.
    const method = WORDS[document_.method];

    const footer = this.footer();
    this.sheet.setFloor(footer.top + GAP);

    this.masthead(logo, WORDS.receipt);
    this.sheet.down(18);
    // No tax rows: a receipt names no registration, whoever issued it.
    this.supplierAndNumber(null, this.numberPairs());
    this.hairlineAcross();
    this.partyAndMethod(
      { caption: WORDS.receivedFromCaption, block: 'receivedFrom', ...document_.recipient },
      method,
    );
    this.sheet.down(18);
    this.table();
    this.sheet.down(16);
    this.lowerCards(
      {
        laid: this.barCard(
          WORDS.note,
          [
            {
              phrase: receiptBasis({
                method: document_.method,
                receivedOn: document_.receivedOn,
                receivedOnAr: arabicDocumentDate(document_.receivedOn),
                settlesReference: document_.settles?.reference ?? null,
              }),
              grey: MUTED,
            },
          ],
          LEFT_WIDTH,
        ),
        block: 'noteCard',
      },
      this.summaryCard(
        WORDS.receiptSummary,
        this.summaryRows(method),
        WORDS.totalPaid,
        money(document_.amountFils),
      ),
      null,
    );
    footer.draw();
  }

  /**
   * One line under the lavender header: "Payment received on account" bold,
   * the invoice it was taken against beneath in grey when there is one, and
   * the Arabic of each beneath that, read from the left as the invoice's
   * Arabic names are; the amount, bold, centred in its column.
   */
  private table(): void {
    const descriptionWidth = WIDTH - AMOUNT_WIDTH;
    const inner = descriptionWidth - PAD * 2;
    const settles = this.document_.settles;
    const english: { text: string; size: number; bold: boolean; grey: number }[] = [
      {
        text: WORDS.paymentOnAccount.en,
        size: TYPE.description,
        bold: true,
        grey: 0,
      },
    ];
    const arabic: string[] = [WORDS.paymentOnAccount.ar];
    if (settles) {
      const against = againstInvoice(settles.reference);
      english.push({ text: against.en, size: TYPE.descriptionAr, bold: false, grey: MUTED });
      arabic.push(against.ar);
    }
    const lines = [
      ...english.flatMap((line) =>
        this.sheet
          .wrap(line.text, inner, line.size, { bold: line.bold })
          .map((text) => ({ ...line, text, rtl: false })),
      ),
      ...arabic.flatMap((text) =>
        this.sheet.wrap(text, inner, TYPE.descriptionAr, { rtl: true }).map((each) => ({
          text: each,
          size: TYPE.descriptionAr,
          bold: false,
          grey: MUTED,
          rtl: true,
        })),
      ),
    ];
    const deepest = 17 + (lines.length - 1) * 12;
    const rowHeight = Math.max(ROW_HEIGHT, deepest + 14);

    this.sheet.room(HEADER_HEIGHT + rowHeight);
    const top = this.sheet.baseline;
    const bottom = top - HEADER_HEIGHT - rowHeight;
    this.tableFrame(top, bottom);
    this.heading(top, LEFT + PAD, WORDS.description, 'start');
    const amountCentre = RIGHT - AMOUNT_WIDTH / 2;
    this.heading(top, amountCentre, WORDS.amount, 'centre');

    const rowTop = top - HEADER_HEIGHT;
    lines.forEach((line, index) => {
      this.sheet.line(rowTop - 17 - index * 12, LEFT + PAD, line.text, line.size, {
        bold: line.bold,
        grey: line.grey,
        ...(line.rtl ? { rtl: true, align: 'start' as const } : {}),
      });
    });
    // A hairline between the description and the amount, as between the invoice's cells.
    this.sheet.hairline(RIGHT - AMOUNT_WIDTH - 0.25, bottom, 0.5, rowHeight);
    this.sheet.line(
      rowTop - rowHeight / 2 - 3,
      amountCentre,
      money(this.document_.amountFils),
      TYPE.cell,
      { bold: true, align: 'centre' },
    );

    this.record('tableHeader', LEFT, RIGHT, top, rowTop);
    this.record('tableRows', LEFT, RIGHT, rowTop, bottom);
    this.sheet.down(top - bottom);
  }

  /** "Receipt no." over the reference in violet bold, "Date received" over the date in bold. */
  private numberPairs(): NumberPair[] {
    return [
      {
        label: WORDS.receiptNo,
        value: {
          text: this.document_.reference,
          size: TYPE.reference,
          options: { bold: true, rgb: VIOLET },
        },
      },
      {
        label: WORDS.dateReceived,
        value: {
          text: formatDocumentDate(this.document_.receivedOn),
          size: TYPE.date,
          options: { bold: true },
        },
      },
    ];
  }

  /**
   * The summary's rows over its one figure: the method the money came by,
   * and the payment's own reference when one was recorded. English only, as
   * the invoice's summary rows are; the invoice it settles is the table's.
   */
  private summaryRows(method: Phrase): SummaryRow[] {
    const rows: SummaryRow[] = [{ label: WORDS.method.en, value: method.en }];
    if (this.document_.paymentReference) {
      rows.push({ label: WORDS.reference.en, value: this.document_.paymentReference });
    }
    return rows;
  }
}
