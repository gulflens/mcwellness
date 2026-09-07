/**
 * Rendering an invoice or a receipt to a PDF the practice can send.
 *
 * **What is here and what is next door.** The half that knows about money —
 * the document's model, its wording in both languages, and the layout that
 * puts it on an A4 sheet — is here, in billing, where an invoice's own
 * sentences belong. The half that knows about bytes — the PDF file format,
 * TrueType, Arabic shaping and the extractor that reads a finished page back
 * — is `domain/shared/document`, because the reports stream renders documents
 * too and `docs/SPEC/OWNERSHIP.md` rule 3 forbids it reaching into billing's
 * `domain/` to do so.
 *
 * This barrel exports both halves under the names billing's callers have
 * always used, so the move cost nothing outside these two folders.
 *
 * Pure and browser-safe throughout: the font programs arrive as bytes
 * (`app/api/billing/fonts.ts` reads them), and the document arrives as a
 * snapshot off its own row (`model.ts`). Nothing here reads a clock, a
 * database or the practice's live record, which is what makes a document
 * re-renderable to the same bytes years later.
 */

export {
  extractAll,
  extractText,
  forDrawing,
  glyphFor,
  isArabic,
  measure,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  readFont,
  renderPdf,
  shape,
  toVisualOrder,
  widthOf,
} from '../../shared/document';
export type {
  Align,
  DocumentImage,
  Font,
  FontSet,
  FontSlot,
  ImageSet,
  Op,
  Page,
  Style,
} from '../../shared/document';
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
export { clampForDocument, GEOMETRY, layout, titleOf } from './render';
export {
  arabicDocumentDate,
  callOutFeeDescription,
  discountNote,
  formatDocumentDate,
  formatRate,
  NOT_REGISTERED_BASIS,
  SIMPLIFIED_BASIS,
  waivedNotice,
  WORDMARK,
  WORDS,
} from './strings';
export type { Phrase } from './strings';

import { layout, titleOf } from './render';
import { renderPdf, type FontSet } from '../../shared/document';
import type { MoneyDocument } from './model';

/** The one call: a document and the faces, in; the file, out. */
export function renderDocument(document_: MoneyDocument, fonts: FontSet): Uint8Array {
  return renderPdf(layout(document_, fonts), fonts, titleOf(document_));
}
