/**
 * What a brain-map report's preview tells the editor of its pages
 * (docs/SPEC/reports-qeeg.md section 12, point 10), in the shape it travels
 * in: how many pages, the dashboard's scale, what runs over, the characters no
 * face draws, and how each map prints where it sits.
 *
 * **Bounded, because it travels in a response header.** The preview answers
 * these notes in its `x-report-layout` header beside the PDF, and a header
 * that grows past a proxy's buffer (4 KB is a common default) turns the whole
 * answer into a gateway error. Everything else here is bounded by the report
 * itself: at most eight maps and four pair pictures, and nothing runs over on
 * an answer that carries a file. Only the characters grow with what she
 * typed, so the first `UNPRINTABLE_LISTED` are named and the rest counted
 * (`unprintableMore`). The test holds the largest case under 3 KB.
 *
 * Pure: the laid pages and the list of characters in, the notes out.
 */

import type { Laid } from './place';

/** How many characters no face draws are named; the rest are counted. */
export const UNPRINTABLE_LISTED = 20;

export type LayoutNotes = {
  readonly pages: number;
  readonly dashboardScale: number;
  readonly overflowing: readonly string[];
  readonly unprintable: readonly string[];
  /** How many more characters no face draws, beyond those named. */
  readonly unprintableMore: number;
  readonly maps: readonly { figureId: string; dpi: number; quality: string }[];
  readonly pairs: readonly {
    figureId: string;
    condition: string;
    side: string;
    dpi: number;
    quality: string;
  }[];
};

export function layoutNotesOf(
  laid: Pick<Laid, 'pages' | 'dashboardScale' | 'overflowing' | 'maps' | 'pairs'>,
  unprintable: readonly string[],
): LayoutNotes {
  return {
    pages: laid.pages.length,
    dashboardScale: Math.round(laid.dashboardScale * 1000) / 1000,
    overflowing: [...laid.overflowing],
    unprintable: unprintable.slice(0, UNPRINTABLE_LISTED),
    unprintableMore: Math.max(0, unprintable.length - UNPRINTABLE_LISTED),
    maps: laid.maps.map((map) => ({
      figureId: map.figureId,
      dpi: Math.round(map.dpi),
      quality: map.quality,
    })),
    pairs: laid.pairs.map((pair) => ({
      figureId: pair.figureId,
      condition: pair.condition,
      side: pair.side,
      dpi: Math.round(pair.dpi),
      quality: pair.quality,
    })),
  };
}
