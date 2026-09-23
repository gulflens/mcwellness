/**
 * The look of a money document: the practice's own design, on paper.
 *
 * **Both pages are the operator's design of 24 September 2026**
 * (docs/superpowers/specs/2026-09-24-invoice-redesign-design.md): the
 * invoice laid out in `invoice.ts`, the receipt in `receipt.ts`, both built
 * from the blocks they share in `page.ts` and drawn on the `Sheet` in
 * `sheet.ts`. What is left here is the door: `layout` picks the page by the
 * document's kind, `titleOf` names the file, and `GEOMETRY` hands the tests
 * the numbers the pages are laid out by.
 *
 * **Bilingual, side by side.** English against the left margin and Arabic
 * against the right, which is how a bilingual document is read in the Gulf.
 * Figures are set once, in Latin digits, because they are the same figures
 * read by both readers — and because a number typeset twice has two chances
 * to be wrong.
 *
 * Pure: laying out a page is arithmetic, so this is testable without a font
 * file, a database or a clock — and `tests/billing/geometry.test.ts` tests it
 * as geometry, by measuring the ops and the blocks this produces rather than
 * by reading the text back out of a stream. The practice's mark arrives as
 * bytes, exactly as the fonts do; nothing here opens anything.
 */

import { chargesVat, type MoneyDocument } from './model';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type DocumentImage,
  type FontSet,
  type Page,
} from '../../shared/document';
import { WORDS } from './strings';
import { INVOICE_GEOMETRY, invoiceLayout } from './invoice';
import { receiptLayout } from './receipt';
import type { Block } from './page';
import {
  BAND,
  BOTTOM,
  FOLIO,
  GUTTER,
  LEFT,
  LINE,
  MARGIN,
  RIGHT,
  SIZE,
  SMALL_LINE,
  TOP,
  VIOLET,
} from './sheet';

export { CARD, clampForDocument, EDGE, PILL, Sheet, VIOLET } from './sheet';
export type { Block, BlockName } from './page';

/**
 * The pages' own measurements, exported so the geometry tests assert against
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
  ...INVOICE_GEOMETRY,
} as const;

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
