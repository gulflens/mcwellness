/**
 * The receipt, in the same dress as the invoice (docs/superpowers/specs/
 * 2026-09-24-invoice-redesign-design.md, "The receipt"): a receipt that looked
 * like last week's design beside this invoice would look like a different
 * practice's.
 *
 * Every block is the invoice's own (`page.ts`); what is here is only what a
 * receipt says in them. "RECEIPT" over "إيصال استلام"; the number card's
 * "Receipt no." and "Date received"; "RECEIVED FROM" over the household; the
 * method the money came by as the payment method; no table; "Payment
 * received" beside the summary, whose violet block reads "TOTAL PAID"; a note
 * card carrying the receipt's own sentence; the invoice's footer.
 *
 * **A receipt asks for nothing and claims nothing about tax.** It says money
 * arrived: no bank account, no payment card, and no corporate-tax or VAT
 * registration in the supplier block, whoever issued it. What tax was charged
 * is a fact about the invoice it settles, not about the act of paying — so a
 * registered practice's receipt reads word for word as an unregistered one's.
 *
 * No table, so one page: the blocks still ask the sheet for room before they
 * draw, as the invoice's do.
 */

import type { ReceiptDocument } from './model';
import type { DocumentImage, FontSet, Page } from '../../shared/document';
import { MUTED, VIOLET } from './sheet';
import { DocumentPage, GAP, TYPE, type Block, type CardRow, type NumberPair } from './page';
import {
  arabicDocumentDate,
  formatDocumentDate,
  money,
  receiptBasis,
  WORDS,
  type Phrase,
} from './strings';

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
    this.lowerCards(
      {
        laid: this.rowsCard(WORDS.paymentReceived, this.receivedRows(method), null),
        block: 'receivedCard',
      },
      this.summaryCard(
        WORDS.receiptSummary,
        [{ label: WORDS.total.en, value: money(document_.amountFils) }],
        WORDS.totalPaid,
        money(document_.amountFils),
      ),
      {
        laid: this.barCard(WORDS.note, [
          {
            phrase: receiptBasis({
              method: document_.method,
              receivedOn: document_.receivedOn,
              receivedOnAr: arabicDocumentDate(document_.receivedOn),
              settlesReference: document_.settles?.reference ?? null,
            }),
            grey: MUTED,
          },
        ]),
        block: 'noteCard',
      },
    );
    footer.draw();
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
   * The method; the payment's own reference when one was recorded; and the
   * invoice it settles, by reference alone — that invoice carries its own
   * date. English labels only, as the payment details card's rows.
   */
  private receivedRows(method: Phrase): CardRow[] {
    const rows: CardRow[] = [{ label: WORDS.method.en, value: method.en, options: { bold: true } }];
    if (this.document_.paymentReference) {
      rows.push({
        label: WORDS.reference.en,
        value: this.document_.paymentReference,
        options: { bold: true },
      });
    }
    if (this.document_.settles) {
      rows.push({
        label: WORDS.settlesInvoice.en,
        value: this.document_.settles.reference,
        options: { bold: true },
      });
    }
    return rows;
  }
}
