/**
 * The byte-level half of the document writer: a small PDF file format, the
 * TrueType reading it needs, Arabic shaping, and an extractor that reads the
 * words back off a finished page.
 *
 * **Why it lives in `shared` and not in a stream.** Two modules render
 * documents — billing's invoices and receipts, and the reports stream's
 * session and progress reports (`docs/SPEC/reports-v1.md` section 5) — and
 * `docs/SPEC/OWNERSHIP.md` rule 3 forbids one module importing another's
 * `domain/`. A copy of an Arabic shaper is a copy that drifts, so the half
 * that knows about bytes and glyphs and nothing about money moved here. What
 * an invoice *says* — its wording, its layout, its model — stayed with
 * billing in `domain/billing/document`.
 *
 * Pure and browser-safe throughout: no Node built-in, no I/O, no clock. The
 * font programs arrive as bytes from `app/api/billing/fonts.ts`, which is the
 * server side of the same seam. `tests/lint/no-node-imports-in-browser-bundle.test.ts`
 * walks the graph from this file and proves it.
 *
 * Not re-exported through `domain/shared/index.ts`, deliberately: a barrel
 * every screen imports should not carry a PDF writer's names, and the two
 * modules that render documents import this one by its own path.
 */

export { measure, PAGE_HEIGHT, PAGE_WIDTH, renderPdf } from './pdf';
export type { Align, FontSet, FontSlot, Op, Page, Style } from './pdf';
export { glyphFor, readFont, widthOf } from './truetype';
export type { Font } from './truetype';
export { forDrawing, isArabic, shape, toVisualOrder } from './arabic';
export { extractAll, extractText } from './extract';
