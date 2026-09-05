/**
 * Rendering a session or progress report to the PDF a household keeps.
 *
 * **What is here and what is next door.** The half that knows what a report
 * *says* — its model, its wording in both languages, and the layout that puts
 * it on an A4 sheet — is here, in the reports module, where a report's own
 * sentences belong. The half that knows about *bytes* — the PDF file format,
 * TrueType, Arabic shaping and the extractor that reads a finished page back —
 * is `domain/shared/document`, moved there by the trunk's round 29 precisely
 * so this module could use it without reaching into billing's `domain/`
 * (docs/SPEC/OWNERSHIP.md rule 3).
 *
 * Pure and browser-safe throughout: the font programs arrive as bytes
 * (`app/api/billing/fonts.ts` reads them), and the report arrives as a
 * snapshot off its own row. Nothing here reads a clock, a database or the
 * practice's live record, which is what makes a report re-renderable to the
 * same bytes years later — and what section 11's byte-identical test proves.
 */

export { bandsIn, layout, titleOf } from './render';
export {
  arabicReportDate,
  DRAFT_WORDING,
  formatDifference,
  formatFigure,
  formatReportDate,
  NOT_A_CLINIC,
  NOT_A_DIAGNOSIS,
  REFERENCE_BASIS,
  WORDING_IS_DRAFT,
  WORDMARK,
  WORDS,
} from './strings';
export type { Phrase } from './strings';
export { GEOMETRY } from './sheet';

import { layout, titleOf } from './render';
import { renderPdf, type FontSet } from '../../shared/document';
import type { ReportDocument } from '../types';

/** The one call: a report and the faces, in; the file, out. */
export function renderReport(document_: ReportDocument, fonts: FontSet): Uint8Array {
  return renderPdf(layout(document_, fonts), fonts, titleOf(document_));
}
