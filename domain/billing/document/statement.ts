/**
 * The statement of account, in the invoice's dress (docs/superpowers/specs/
 * 2026-10-23-debtors-design.md, "Document"): the same masthead, supplier block,
 * number card, party card, table and summary, drawn by the blocks `page.ts`
 * shares, with the table's geometry (a violet header band repeated on every
 * page, rows kept whole) taken from `invoice.ts`.
 *
 * **One language.** A statement is made on request and never filed, so it has
 * no language of its own on a row: it is set in the household's, read when it
 * was made (`StatementDocument.locale`), and so never in both.
 *
 * **Says nothing about tax.** It is a list of what happened to an account, not
 * a supply: no registration numbers in the supplier block, no tax sentence.
 *
 * **A credit is a credit.** A negative balance is printed as its figure with
 * CR after it, and the summary's violet block reads IN CREDIT, never a minus.
 */

import type { DocumentImage, FontSet, Page } from '../../shared/document';
import type { StatementDocument } from './model';
import { LEFT, MUTED, RIGHT, WHITE } from './sheet';
import {
  DocumentPage,
  GAP,
  RADIUS,
  TYPE,
  WIDTH,
  type Block,
  type CardRow,
  type NumberPair,
} from './page';
import { money, signedBalance, STATEMENT_NOTE, WORDS, type Phrase } from './strings';

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 26;
const CELL_PAD = 8;
/** The item column is never narrower than this. */
const ITEM_LEAST = 80;

/** Lays out a statement, answering its pages and the boxes its blocks were drawn in. */
export function statementLayout(
  document_: StatementDocument,
  fonts: FontSet,
  logo: DocumentImage | null,
): { pages: Page[]; blocks: Block[][] } {
  const page = new StatementPage(document_, fonts);
  page.draw(logo);
  return page.laidOut();
}

type Row = {
  cells: [date: string, reference: string, charged: string, paid: string, balance: string];
  item: string[];
  bold: boolean;
  height: number;
};

type Column = { label: Phrase; width: number };

class StatementPage extends DocumentPage {
  private readonly document_: StatementDocument;

  constructor(document_: StatementDocument, fonts: FontSet) {
    // The running header's reference is the record number, never a name.
    super(fonts, document_.supplier, document_.recipient.recordNumber, document_.locale);
    this.document_ = document_;
  }

  draw(logo: DocumentImage | null): void {
    const document_ = this.document_;
    const footer = this.footer();
    this.sheet.setFloor(footer.top + GAP);

    this.masthead(logo, WORDS.statement);
    this.sheet.down(18);
    this.supplierAndNumber(null, this.numberPairs());
    this.hairlineAcross();
    this.partyAndMethod(
      { caption: WORDS.statementFor, block: 'billedTo', ...document_.recipient },
      null,
    );
    this.sheet.down(18);
    this.table();
    this.sheet.down(16);

    const closing = document_.closingFils;
    this.lowerCards(
      { laid: this.rowsCard(WORDS.ageingTitle, this.ageingRows(), null), block: 'paymentCard' },
      this.summaryCard(
        WORDS.statementSummary,
        [],
        closing < 0 ? WORDS.inCreditBlock : WORDS.balanceDue,
        money(Math.abs(closing)),
      ),
      {
        laid: this.barCard(WORDS.note, [{ phrase: STATEMENT_NOTE, grey: MUTED }]),
        block: 'noteCard',
      },
    );
    footer.draw();
  }

  /** The period as two pairs: a range of long dates would not fit the number card. */
  private numberPairs(): NumberPair[] {
    const date = (iso: string) => ({
      text: this.date(iso),
      size: TYPE.date,
      options: { bold: true },
    });
    return [
      { label: WORDS.periodFrom, value: date(this.document_.from) },
      { label: WORDS.periodTo, value: date(this.document_.to) },
    ];
  }

  private ageingRows(): CardRow[] {
    const { ageing } = this.document_;
    const row = (label: Phrase, value: number): CardRow => ({
      label: this.say(label),
      value: money(value),
      options: { bold: true },
    });
    return [
      row(WORDS.age0to30, ageing.b0to30Fils),
      row(WORDS.age31to60, ageing.b31to60Fils),
      row(WORDS.age61to90, ageing.b61to90Fils),
      row(WORDS.ageOver90, ageing.over90Fils),
    ];
  }

  // ------------------------------------------------------------------------
  // The table
  // ------------------------------------------------------------------------

  private balance(fils: number): string {
    return signedBalance(fils, this.say(WORDS.creditMark));
  }

  private rows(itemWidth: number): Row[] {
    const document_ = this.document_;
    const made = (cells: Row['cells'], item: string, bold: boolean): Row => {
      const wrapped = this.sheet.wrap(
        item,
        itemWidth - CELL_PAD * 2,
        TYPE.cell,
        this.fixed({ bold }),
      );
      return { cells, item: wrapped, bold, height: Math.max(ROW_HEIGHT, wrapped.length * 11 + 14) };
    };
    const names = {
      charge: WORDS.invoice,
      payment: WORDS.paymentItem,
      credit: WORDS.creditNote,
      reversal: WORDS.paymentReversed,
    } as const;
    return [
      made(
        [this.date(document_.from), '', '', '', this.balance(document_.openingFils)],
        this.say(WORDS.balanceBroughtForward),
        false,
      ),
      ...document_.lines.map((line) =>
        made(
          [
            this.date(line.on),
            line.reference,
            line.chargedFils > 0 ? money(line.chargedFils) : '',
            line.paidFils > 0 ? money(line.paidFils) : '',
            this.balance(line.balanceFils),
          ],
          this.say(names[line.kind]),
          false,
        ),
      ),
      made(
        [this.date(document_.to), '', '', '', this.balance(document_.closingFils)],
        this.say(WORDS.closingBalance),
        true,
      ),
    ];
  }

  /** Date, reference, item, then the three figures; the item takes what the others leave. */
  private columns(rows: (itemWidth: number) => Row[]): { columns: Column[]; rows: Row[] } {
    const labels = [
      WORDS.dateColumn,
      WORDS.referenceColumn,
      WORDS.itemColumn,
      WORDS.charged,
      WORDS.paidOrCredited,
      WORDS.balanceColumn,
    ];
    // Measured against every cell of the column, whatever width the item is given.
    const measured = rows(ITEM_LEAST);
    const widthOf = (label: Phrase, cell: number | null): number =>
      Math.max(
        this.sheet.width(this.say(label), TYPE.heading, this.fixed({ bold: true })),
        ...measured.map((row) =>
          cell === null ? 0 : this.sheet.width(row.cells[cell] ?? '', TYPE.cell, { bold: true }),
        ),
      ) +
      CELL_PAD * 2;
    const cellOf = [0, 1, null, 2, 3, 4] as const;
    const natural = labels.map((label, index) => ({
      label,
      width: widthOf(label, cellOf[index] ?? null),
    }));
    const others = natural.reduce(
      (sum, column, index) => (index === 2 ? sum : sum + column.width),
      0,
    );
    const itemWidth = Math.max(ITEM_LEAST, WIDTH - others);
    const columns = natural.map((column, index) =>
      index === 2 ? { ...column, width: itemWidth } : column,
    );
    return { columns, rows: rows(itemWidth) };
  }

  /**
   * The invoice's table: a violet header band drawn again on every page the
   * rows touch and never alone at the foot of one, and rows kept whole.
   */
  private table(): void {
    const { columns, rows } = this.columns((itemWidth) => this.rows(itemWidth));

    let next = 0;
    while (next < rows.length) {
      const first = rows[next];
      if (!first) break;
      this.sheet.room(HEADER_HEIGHT + first.height);
      const top = this.sheet.baseline;
      let bottom = top - HEADER_HEIGHT;
      let end = next;
      while (end < rows.length) {
        const row = rows[end];
        if (!row) break;
        if (bottom - row.height < this.sheet.floor && end > next) break;
        bottom -= row.height;
        end += 1;
      }

      this.sheet.outline(LEFT, top - HEADER_HEIGHT / 2, WIDTH, top - HEADER_HEIGHT / 2 - bottom);
      this.header(top, columns);
      let y = top - HEADER_HEIGHT;
      for (let index = next; index < end; index += 1) {
        const row = rows[index];
        if (!row) continue;
        this.drawRow(row, y, columns, index === end - 1);
        y -= row.height;
      }
      this.record('tableHeader', LEFT, RIGHT, top, top - HEADER_HEIGHT);
      this.record('tableRows', LEFT, RIGHT, top - HEADER_HEIGHT, bottom);
      this.sheet.down(top - bottom);

      next = end;
      if (next < rows.length) this.sheet.breakPage();
    }
  }

  private header(top: number, columns: readonly Column[]): void {
    this.sheet.bandFill(LEFT, top, WIDTH, HEADER_HEIGHT, RADIUS);
    this.sheet.bandFill(LEFT, top - HEADER_HEIGHT / 2, WIDTH, HEADER_HEIGHT / 2);
    let x = LEFT;
    for (const column of columns) {
      this.sheet.line(
        top - 23,
        x + column.width / 2,
        this.say(column.label),
        TYPE.heading,
        this.fixed({ bold: true, rgb: WHITE, align: 'centre' }),
      );
      x += column.width;
    }
  }

  private drawRow(row: Row, top: number, columns: readonly Column[], last: boolean): void {
    const bottom = top - row.height;
    const middle = top - row.height / 2;
    // Date, reference, then (skipping the item) the three figures.
    const figures = [row.cells[0], row.cells[1], null, row.cells[2], row.cells[3], row.cells[4]];
    let left = LEFT;
    columns.forEach((column, index) => {
      if (index > 0) this.sheet.hairline(left - 0.25, bottom, 0.5, row.height);
      const text = figures[index];
      if (text === null) {
        row.item.forEach((line, at) => {
          this.sheet.line(
            top - 15 - at * 11,
            left + CELL_PAD,
            line,
            TYPE.cell,
            this.fixed({ bold: row.bold }),
          );
        });
      } else {
        this.sheet.line(middle - 3, left + column.width / 2, text ?? '', TYPE.cell, {
          bold: true,
          align: 'centre',
        });
      }
      left += column.width;
    });
    if (!last) this.sheet.hairline(LEFT, bottom - 0.25, WIDTH);
  }
}
