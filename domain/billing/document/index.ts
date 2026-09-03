/**
 * Rendering an invoice or a receipt to a PDF the practice can send.
 *
 * Pure and browser-safe throughout: the font programs arrive as bytes
 * (`app/api/billing/fonts.ts` reads them), and the document arrives as a
 * snapshot off its own row (`model.ts`). Nothing here reads a clock, a
 * database or the practice's live record, which is what makes a document
 * re-renderable to the same bytes years later.
 */

export { renderPdf, measure, PAGE_HEIGHT, PAGE_WIDTH } from './pdf';
export type { Align, FontSet, FontSlot, Op, Page, Style } from './pdf';
export { readFont, glyphFor, widthOf } from './truetype';
export type { Font } from './truetype';
export { forDrawing, isArabic, shape, toVisualOrder } from './arabic';
export { chargesVat } from './model';
export type {
  InvoiceDocument,
  InvoiceLine,
  MoneyDocument,
  PaymentMethod,
  Recipient,
  ReceiptDocument,
  SupplierSnapshot,
} from './model';
export { layout, titleOf } from './render';
export {
  formatDocumentDate,
  formatRate,
  NOT_REGISTERED_BASIS,
  SIMPLIFIED_BASIS,
  WORDMARK,
  WORDS,
} from './strings';
export type { Phrase } from './strings';
export { extractAll, extractText } from './extract';

import { layout, titleOf } from './render';
import { renderPdf, type FontSet } from './pdf';
import type { MoneyDocument } from './model';

/** The one call: a document and the faces, in; the file, out. */
export function renderDocument(document_: MoneyDocument, fonts: FontSet): Uint8Array {
  return renderPdf(layout(document_, fonts), fonts, titleOf(document_));
}
