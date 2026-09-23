/**
 * What the invoice and the receipt share: the blocks of the operator's design
 * of 24 September 2026 (docs/superpowers/specs/2026-09-24-invoice-redesign-
 * design.md) that both pages wear, so a receipt beside an invoice reads as the
 * same practice's paper.
 *
 * **A base class, not a bag of functions.** Every block draws on one `Sheet`,
 * records its box into one list of blocks, and reads the one supplier the
 * document was numbered under. As functions each would take all three and
 * hand the cursor back; as methods of `DocumentPage` they share them the way
 * the invoice page's own methods always have, so the invoice's blocks moved
 * here with their arithmetic untouched — and the invoice's two goldens
 * (`tests/billing/document.test.ts`) are the proof that nothing on its page
 * moved with them. `InvoicePage` (`invoice.ts`) adds the lines table;
 * `ReceiptPage` (`receipt.ts`) adds nothing but its own words.
 *
 * **What a block is told, it prints; what it is not told, it leaves off.** The
 * base knows no document kind: the title, the number card's pairs, the party
 * card's caption, the payment method, the lower cards' rows and the bottom
 * card's sentences all arrive from the page that owns them. That is where the
 * rules that differ between the two documents live — a receipt names no tax
 * registration, an invoice names the ones the practice holds — so the base
 * cannot print one on the wrong document.
 *
 * His two instructions bind every block here as they bind the pages: his
 * colours (`VIOLET` and its three tints, white on violet, the greys the
 * documents already use) and his simplicity (what his page shows and nothing
 * it does not).
 */

import type { SupplierSnapshot } from './model';
import type { DocumentImage, FontSet, Page } from '../../shared/document';
import {
  BAND,
  CARD,
  GUTTER,
  INK,
  LEFT,
  MUTED,
  RIGHT,
  SMALL_LINE,
  Sheet,
  VIOLET,
  WHITE,
  type TextOptions,
} from './sheet';
import { WORDMARK, WORDS, type Phrase } from './strings';

/** The measure: everything on the page lies between the two margins. */
export const WIDTH = RIGHT - LEFT;
/** Between two blocks set side by side. */
export const GAP = 14;
/** The air inside a card, on every side. */
export const PAD = 12;
/** The summary card takes the right 40% of the measure. */
export const RIGHT_WIDTH = WIDTH * 0.4;
const RIGHT_X = RIGHT - RIGHT_WIDTH;
/** The party card and the left lower card take the rest. */
export const LEFT_WIDTH = WIDTH - RIGHT_WIDTH - GAP;
/**
 * The number card is narrower than the summary, as his page draws it, which
 * leaves the supplier block the room to set each of its rows — the English
 * label and value, the Arabic value and label — on one line.
 */
export const NUMBER_WIDTH = 150;
const NUMBER_X = RIGHT - NUMBER_WIDTH;
export const SUPPLIER_WIDTH = WIDTH - NUMBER_WIDTH - GAP;
/** The practice's lockup, set against the left margin as his page sets it. */
export const LOGO_WIDTH = 165;
/** The summary card's title band, tinted, above its white body. */
export const TITLE_BAND = 32;
/** Corners on every card. */
export const RADIUS = 6;
/** The violet bar down the number card's and the bottom card's left edge. */
export const BAR_WIDTH = 4;
/** The strip at the foot of the payment card that carries the payment reference. */
const STRIP_HEIGHT = 26;
/** From a card's left edge to the value column of its labelled rows. */
const LABEL_COLUMN = 72;

/** Type sizes, in points: one scale for both pages. */
export const TYPE = {
  title: 24,
  titleAr: 18,
  wordmark: 15,
  name: 11,
  row: 7,
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

/** The blocks the two pages are made of, by the name the geometry tests read them by. */
export type BlockName =
  | 'masthead'
  | 'supplier'
  | 'numberCard'
  | 'billedTo'
  | 'receivedFrom'
  | 'paymentMethod'
  | 'tableHeader'
  | 'tableRows'
  | 'paymentCard'
  | 'receivedCard'
  | 'summaryCard'
  | 'taxCard'
  | 'noteCard'
  | 'footer';

/** A block's box on its page, in points from the bottom-left as PDF measures. */
export type Block = { name: BlockName; left: number; right: number; top: number; bottom: number };

/** A line of type within a block, measured, waiting for its baseline. */
export type Setting = { text: string; size: number; options: TextOptions };

/** A card measured and waiting to be drawn at a top edge and a height the pair agrees on. */
export type Laid = { height: number; draw: (top: number, height: number) => void };

/** One pair of the number card: a caption over its value. */
export type NumberPair = { label: Phrase; value: Setting };

/** A labelled row of a lower card: an English label, its value set as it says. */
export type CardRow = { label: string; value: string; options: TextOptions };

/** A row of the summary card: English label and figure, violet when it is the discount. */
export type SummaryRow = { label: string; value: string; accent?: boolean };

/** A sentence of the bottom card, in both languages, in the grey it is set in. */
export type Sentence = { phrase: Phrase; grey: number };

/**
 * The page both documents are drawn as. A subclass draws its own blocks in
 * its own order (`draw`) and answers the pages and their boxes (`laidOut`).
 */
export abstract class DocumentPage {
  readonly sheet: Sheet;
  readonly blocks: Block[][] = [];
  protected readonly supplier: SupplierSnapshot;

  protected constructor(fonts: FontSet, supplier: SupplierSnapshot, reference: string) {
    this.supplier = supplier;
    this.sheet = new Sheet(fonts, { practice: supplier.legalName, reference });
  }

  abstract draw(logo: DocumentImage | null): void;

  /** The finished pages, and per page the boxes its blocks were drawn in. */
  laidOut(): { pages: Page[]; blocks: Block[][] } {
    const pages = this.sheet.finish();
    return { pages, blocks: pages.map((_, index) => this.blocks[index] ?? []) };
  }

  protected record(
    name: BlockName,
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): void {
    const page = this.sheet.page;
    const blocks = this.blocks[page] ?? [];
    blocks.push({ name, left, right, top, bottom });
    this.blocks[page] = blocks;
  }

  protected width(setting: Setting): number {
    return this.sheet.width(setting.text, setting.size, setting.options);
  }

  // ------------------------------------------------------------------------
  // The masthead
  // ------------------------------------------------------------------------

  /**
   * The mark left, about 165 points wide as his page sets the lockup, its
   * height from the file's own proportions so it is never stretched — or the
   * wordmark in type when the practice has none. The title right, in violet:
   * the English in capitals, bold and large, and the Arabic beneath it. The
   * capitals are his.
   */
  protected masthead(logo: DocumentImage | null, title: Phrase): void {
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
  // The supplier block and the number card
  // ------------------------------------------------------------------------

  /**
   * The practice, left: its legal name bold with the Arabic name beside it,
   * then licence and authority — each English label and value against the
   * left and the Arabic label and value against the right of the same half,
   * as his page sets them. `taxRows` adds the corporate-tax registration and,
   * on a registered practice's document, the VAT number: an invoice names the
   * registrations the practice holds, and a receipt, which makes no tax claim
   * in either direction, names none. The number card, right, with the pairs
   * its page gives it.
   */
  protected supplierAndNumber(
    taxRows: { vat: boolean } | null,
    pairs: readonly NumberPair[],
  ): void {
    const supplier = this.supplier;
    const labelled = (label: Phrase, value: string, bold = false): FacingRow => ({
      en: `${label.en} ${value}`,
      ar: `${label.ar} ${value}`,
      size: TYPE.row,
      step: 11,
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
    if (taxRows && supplier.corporateTaxNumber) {
      rows.push(labelled(WORDS.corporateTaxNumber, supplier.corporateTaxNumber));
    }
    // The VAT number only on a document whose own snapshot says the practice
    // held one. There is no other branch that can print it.
    if (taxRows?.vat && supplier.vatNumber) {
      rows.push(labelled(WORDS.vatRegistrationNumber, supplier.vatNumber, true));
    }

    const top = this.sheet.baseline;
    const facing = this.facing(rows, SUPPLIER_WIDTH);
    const firstBaseline = top - 9;
    const supplierBottom = firstBaseline - facing.depth - 4;

    const placed: (NumberPair & { caption: number; baseline: number })[] = [];
    let caption = top - PAD - 6;
    for (const pair of pairs) {
      const baseline = caption - pair.value.size - 4;
      placed.push({ ...pair, caption, baseline });
      caption = baseline - 15;
    }
    const lastValue = placed[placed.length - 1]?.baseline ?? top;
    const cardHeight = top - (lastValue - PAD + 2);

    // The card, and a violet bar down its left edge like the bottom card's.
    this.sheet.card(NUMBER_X, top, NUMBER_WIDTH, cardHeight, { radius: RADIUS });
    this.sheet.bandFill(NUMBER_X, top, BAR_WIDTH, cardHeight);
    const inside = NUMBER_X + BAR_WIDTH + PAD;
    for (const each of placed) {
      this.caption(each.caption, inside, RIGHT - PAD, each.label, TYPE.caption, {
        grey: MUTED,
      });
      this.sheet.line(each.baseline, inside, each.value.text, each.value.size, {
        ...each.value.options,
      });
    }
    this.drawFacing(facing, LEFT, SUPPLIER_WIDTH, firstBaseline);

    this.record('supplier', LEFT, LEFT + SUPPLIER_WIDTH, top, supplierBottom);
    this.record('numberCard', NUMBER_X, RIGHT, top, top - cardHeight);
    this.sheet.down(top - Math.min(supplierBottom, top - cardHeight));
  }

  /** A hairline across the page beneath the supplier row, as his page draws. */
  protected hairlineAcross(): void {
    this.sheet.down(14);
    this.sheet.ruleAt(this.sheet.baseline, LEFT, WIDTH);
    this.sheet.down(14);
  }

  // ------------------------------------------------------------------------
  // The party card and the payment method
  // ------------------------------------------------------------------------

  /**
   * The household, in a card on the left: its caption small, the name bold
   * and large, then its client record with the Arabic label and the number on
   * the right. The payment method, right, with no card — its caption, then
   * the method's own name bold in violet in both languages — and absent,
   * caption and all, when the page gives it none.
   */
  protected partyAndMethod(
    party: { caption: Phrase; block: BlockName; name: string; recordNumber: string },
    method: Phrase | null,
  ): void {
    const top = this.sheet.baseline;
    const inner = LEFT_WIDTH - PAD * 2;
    const x = LEFT + PAD;
    const captionAt = top - PAD - 5;

    const name = this.sheet.wrap(party.name, inner, TYPE.household, {
      bold: true,
    });
    const nameAt = captionAt - 18;
    const lastName = nameAt - (name.length - 1) * 16;
    const record = party.recordNumber;
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
    this.caption(captionAt, x, LEFT + LEFT_WIDTH - PAD, party.caption, TYPE.caption, {
      bold: true,
      grey: MUTED,
    });
    name.forEach((line, index) => {
      this.sheet.line(nameAt - index * 16, x, line, TYPE.household, { bold: true });
    });
    this.sheet.line(recordAt, x, english.text, english.size, english.options);
    this.sheet.line(arabicAt, LEFT + LEFT_WIDTH - PAD, arabic.text, arabic.size, arabic.options);
    this.record(party.block, LEFT, LEFT + LEFT_WIDTH, top, top - cardHeight);

    let bottom = top - cardHeight;
    if (method) {
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
            text: method.en,
            size: TYPE.method,
            options: { bold: true, rgb: VIOLET, align: 'end' },
          },
        },
        {
          at: captionAt - 44,
          setting: {
            text: method.ar,
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
  // The two lower cards and the bottom card
  // ------------------------------------------------------------------------

  /**
   * The left card (when there is one) and the summary side by side, then the
   * full-width bottom card beneath them — measured together and moved to the
   * next page together when they do not fit, so what the money was never
   * lands a sheet away from how much.
   */
  protected lowerCards(
    left: { laid: Laid; block: BlockName } | null,
    summary: Laid,
    bottom: { laid: { height: number; draw: (top: number) => void }; block: BlockName },
  ): void {
    const cardsHeight = Math.max(left?.laid.height ?? 0, summary.height);
    this.sheet.room(cardsHeight + GAP + bottom.laid.height);

    const top = this.sheet.baseline;
    if (left) {
      left.laid.draw(top, cardsHeight);
      this.record(left.block, LEFT, LEFT + LEFT_WIDTH, top, top - cardsHeight);
    }
    // The summary keeps its place on the right whether or not a card is
    // beside it, and is as tall as the taller of the two.
    summary.draw(top, cardsHeight);
    this.record('summaryCard', RIGHT_X, RIGHT, top, top - cardsHeight);

    const lowTop = top - cardsHeight - GAP;
    bottom.laid.draw(lowTop);
    this.record(bottom.block, LEFT, RIGHT, lowTop, lowTop - bottom.laid.height);
    this.sheet.down(top - (lowTop - bottom.laid.height));
  }

  /**
   * The left lower card: its title bold with the Arabic right and a hairline
   * under it, then rows with English labels only — an account number or a
   * payment reference read against a second language's labels is one a
   * reader misreads — each value wrapping within its column rather than being
   * cut. The invoice's payment card closes with a strip naming the payment
   * reference; a card given no strip has none.
   */
  protected rowsCard(
    title: Phrase,
    rows: readonly CardRow[],
    strip: { label: Phrase; value: string } | null,
  ): Laid {
    const x = LEFT;
    const width = LEFT_WIDTH;
    const valueAt = x + PAD + LABEL_COLUMN;
    const valueWidth = width - PAD * 2 - LABEL_COLUMN;
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
    const height = strip ? stripTop + STRIP_HEIGHT + PAD : lastLine + PAD + 4;

    return {
      height,
      draw: (top, cardHeight) => {
        this.sheet.outline(x, top, width, cardHeight, RADIUS);
        this.cardTitle(top - titleAt, x, width, title);
        for (const row of placed) {
          this.sheet.line(top - row.first, x + PAD, row.label, TYPE.label, { grey: MUTED });
          row.lines.forEach((line, index) => {
            this.sheet.line(top - row.first - index * 11, valueAt, line, TYPE.value, row.options);
          });
        }
        if (!strip) return;
        // The strip sits at the card's foot, however tall the summary beside
        // it has made the pair.
        const stripBottom = top - cardHeight + PAD;
        const stripAt = stripBottom + STRIP_HEIGHT;
        this.sheet.rect(x + PAD, stripBottom, width - PAD * 2, STRIP_HEIGHT, {
          fill: { rgb: CARD },
          radius: 4,
        });
        const baseline = stripAt - 16;
        const label = strip.label;
        this.sheet.line(baseline, x + PAD + 10, label.en, TYPE.label, { grey: MUTED });
        this.sheet.line(
          baseline,
          x + PAD + 10 + this.sheet.width(label.en, TYPE.label) + 10,
          label.ar,
          TYPE.label,
          { grey: MUTED, rtl: true, align: 'start' },
        );
        this.sheet.line(baseline, x + width - PAD - 10, strip.value, TYPE.cell, {
          bold: true,
          rgb: VIOLET,
          align: 'end',
        });
      },
    };
  }

  /**
   * The summary, under its title on a tinted band: rows of English labels
   * and figures and no Arabic, as his page sets them; a hairline; and the
   * violet block, its caption small in white in both languages over the
   * figure large in white.
   */
  protected summaryCard(
    title: Phrase,
    rows: readonly SummaryRow[],
    block: Phrase,
    figure: string,
  ): Laid {
    const x = RIGHT_X;
    const width = RIGHT_WIDTH;

    const titleAt = PAD + 8;
    const firstRow = TITLE_BAND + 17;
    const lastRow = firstRow + (rows.length - 1) * 16;
    const ruleAt = lastRow + 9;
    const blockTop = ruleAt + 10;
    const least = 60;
    const height = blockTop + least + 8;

    return {
      height,
      draw: (top, cardHeight) => {
        // The title on a tinted band, rounded at the top as the card is and
        // square where the white body meets it; the border drawn over both.
        this.sheet.rect(x, top - TITLE_BAND, width, TITLE_BAND, {
          fill: { rgb: CARD },
          radius: RADIUS,
        });
        this.sheet.rect(x, top - TITLE_BAND, width, TITLE_BAND / 2, { fill: { rgb: CARD } });
        this.sheet.outline(x, top, width, cardHeight, RADIUS);
        this.caption(top - titleAt, x + PAD, x + width - PAD, title, TYPE.cardTitle, {
          bold: true,
          rgb: VIOLET,
        });
        rows.forEach((row, index) => {
          const y = top - firstRow - index * 16;
          const valueOptions: TextOptions = row.accent
            ? { bold: true, rgb: VIOLET, align: 'end' }
            : { bold: true, align: 'end' };
          this.sheet.line(y, x + PAD, row.label, TYPE.value, { grey: MUTED });
          this.sheet.line(y, x + width - PAD, row.value, TYPE.value, valueOptions);
        });
        this.sheet.hairline(x + PAD, top - ruleAt, width - PAD * 2);

        // The violet block fills the card to its foot.
        const inset = 8;
        const bandTop = top - blockTop;
        const bandBottom = top - cardHeight + inset;
        const bandWidth = width - inset * 2;
        this.sheet.bandFill(x + inset, bandTop, bandWidth, bandTop - bandBottom, RADIUS);
        const captionAt = bandTop - 14;
        this.sheet.line(captionAt, x + inset + 10, block.en, TYPE.caption, {
          bold: true,
          rgb: WHITE,
        });
        this.sheet.line(captionAt, x + width - inset - 10, block.ar, TYPE.caption, {
          bold: true,
          rgb: WHITE,
          align: 'end',
          rtl: true,
        });
        const room = bandWidth - 20;
        const natural = this.sheet.width(figure, TYPE.due, { bold: true });
        // Smaller only when a figure in the millions would not fit the block.
        const size = natural > room ? (TYPE.due * room) / natural : TYPE.due;
        const middle = (captionAt - 6 + bandBottom) / 2;
        this.sheet.line(middle - size * 0.35, x + width / 2, figure, size, {
          bold: true,
          rgb: WHITE,
          align: 'centre',
        });
      },
    };
  }

  /**
   * Full width, the card's ground with a violet bar down its left edge: the
   * title, then each sentence in English and beneath it in Arabic, in the
   * grey it is given.
   */
  protected barCard(
    title: Phrase,
    sentences: readonly Sentence[],
  ): { height: number; draw: (top: number) => void } {
    const x = LEFT + BAR_WIDTH + PAD;
    const width = WIDTH - BAR_WIDTH - PAD * 2;

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
        this.caption(top - titleAt, x, RIGHT - PAD, title, TYPE.taxTitle, {
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
  // The footer
  // ------------------------------------------------------------------------

  /**
   * A hairline, then the legal name and the address on one centred line, the
   * address's parts spaced by three spaces as his page spaces them; the
   * telephone, email and website on the next. Pinned to the foot of the last
   * page, and **wrapped, never cut**: the address is a thing a UAE invoice
   * must state and this is the only place the page states it, so a long one
   * grows the footer upward into the page rather than losing its end.
   */
  protected footer(): { top: number; draw: () => void } {
    const supplier = this.supplier;
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
  protected caption(
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
  protected cardTitle(y: number, x: number, width: number, label: Phrase): void {
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
    return { laid, depth: facingDepth(laid) };
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
      y -= (linesOf(each) - 1) * each.row.step + (next ? next.row.step : 0);
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

/** How many lines a laid row takes. */
function linesOf(each: Facing['laid'][number]): number {
  return each.beneath
    ? each.english.length + each.arabic.length
    : Math.max(each.english.length, each.arabic.length);
}

/** From the first baseline to the last. */
function facingDepth(laid: Facing['laid']): number {
  let depth = 0;
  laid.forEach((each, index) => {
    const next = laid[index + 1];
    depth += (linesOf(each) - 1) * each.row.step + (next ? next.row.step : 0);
  });
  return depth;
}
