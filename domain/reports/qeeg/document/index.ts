/**
 * The door to the brain-map report's pages: a report in, its pages or its
 * file out.
 *
 * **Two calls.** `layoutQeegReport` gives the pages and what the editor is
 * told of them (how many, the dashboard's scale, what runs over, how each
 * map will print), for the preview's notes and for tests. `renderQeegReport`
 * gives the file, through the shared writer, and refuses while anything runs
 * over: a page whose last lines print over its footer is never filed.
 *
 * **The faces are handed in.** The server passes `reportFonts()`
 * (`app/api/billing/fonts.ts`), the three faces every document is set in and
 * a bold Arabic one. The set of three that invoices use, `documentFonts()`,
 * would draw every bold Arabic word in the regular face: a heading on an
 * Arabic page would not be bold. Nothing here can tell the two sets apart
 * but by that face, so the caller is trusted with it and the pages' tests
 * render with the set of four.
 *
 * **Content that has passed the shape, of either edition.** Whoever builds
 * the pages takes only content that `validateQeegContent` accepts, and says
 * so here by asking it again: a report that the shape refuses is refused by
 * name, never drawn. A first report and a follow-up take the same door; a
 * follow-up's pages are the first report's, in its own words, with its page
 * of what has changed (`changePage.ts`).
 *
 * **Maps are drawn smooth.** A brain map is printed far larger than it was
 * captured, so each is embedded with `/Interpolate`, which asks a reader to
 * resample it smoothly. No pixel is changed and nothing is re-encoded: the
 * picture's own compressed lines travel into the file (`DocumentImage`).
 */

import { measure, renderPdf } from '@domain/shared/document';
import type { DocumentImage, FontSet, ImageSet } from '@domain/shared/document';
import { validateQeegContent } from '../shape';
import type { Locale, QeegContent } from '../types';
import { LOGO_IMAGE, mapImageKey, titleOf } from './build';
import type { ReportFacts } from './build';
import type { Direction } from './direction';
import { faceOf } from './metrics';
import { placeQeegReport } from './place';
import type { Laid } from './place';
import type { Drawing } from './typeset';

export { LEFT_OUT_WITHOUT_PROGRAMME, SECTIONS } from './build';
export type { PracticeLines, ReportFacts } from './build';
export type { Laid, MapPrint, PairPrint, PlacedPart, Sheet } from './place';

export type QeegReportInput = {
  readonly content: QeegContent;
  readonly locale: Locale;
  readonly facts: ReportFacts;
};

/** What every piece draws with, from the faces the writer sets the file in. */
export function drawingFor(fonts: FontSet, direction: Direction): Drawing {
  return {
    direction,
    measure: (text, weight, size, rtl) => measure(text, { font: weight, size }, fonts, rtl),
    faces: { latin: faceOf(fonts.regular), arabic: faceOf(fonts.arabic) },
  };
}

/** A report's pages, and what the editor is told of them. */
export function layoutQeegReport(input: QeegReportInput, fonts: FontSet): Laid {
  const checked = validateQeegContent(input.content);
  if (!checked.ok) {
    // The field and nothing of what it holds: an error reaches a log.
    const at = checked.refusals[0]?.path ?? '';
    throw new RangeError(
      `layoutQeegReport takes only a report the shape accepts, and was given one refused at ${at === '' ? 'its top' : at}.`,
    );
  }
  return placeQeegReport(
    { content: checked.content, locale: input.locale, facts: input.facts },
    drawingFor(fonts, input.locale === 'ar' ? 'rtl' : 'ltr'),
  );
}

/** The pictures the pages name: the logo as it came, and each map drawn smooth. */
function imagesOf(facts: ReportFacts): ImageSet {
  const images: Record<string, DocumentImage> = {};
  if (facts.logo !== null) images[LOGO_IMAGE] = facts.logo;
  for (const [figureId, picture] of Object.entries(facts.pictures)) {
    images[mapImageKey(figureId)] = { ...picture, interpolate: true };
  }
  return images;
}

/** A report as a PDF, set in the faces handed in. Refused while anything runs over. */
export function renderQeegReport(input: QeegReportInput, fonts: FontSet): Uint8Array {
  const laid = layoutQeegReport(input, fonts);
  if (laid.overflowing.length > 0) {
    throw new RangeError(
      `renderQeegReport will not file pages that run over, and ${laid.overflowing.join(', ')} ${laid.overflowing.length === 1 ? 'does' : 'do'}.`,
    );
  }
  return renderPdf(laid.pages, fonts, titleOf(input), imagesOf(input.facts));
}
