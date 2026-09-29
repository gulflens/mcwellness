import type { FigureRef, QeegContent } from './types';

/**
 * Every picture a brain-map report names, and where it names it
 * (docs/SPEC/reports-qeeg.md section 9, points 6 and 7).
 *
 * **Why the route needs a list.** A report's content names each map by the id
 * of a stored document and the digest of its bytes. The draft route refuses a
 * content naming a picture that is not linked to that report (brief L, "For
 * PR 7"), and the remove door refuses to take away a picture the saved draft
 * still prints; both ask the same question of the same places, so the places
 * are listed once, here, and a later part of the content that names a picture
 * is added in one file.
 *
 * **Where a report names a picture:** each entry of `maps`, and on a
 * follow-up each side of the two pairs on the page of what has changed. The
 * earlier side of a pair is the earlier report's picture, brought forward by
 * the server, and is marked `borrowed`: the route links it by borrowing it
 * (section 9, point 7), never by an upload.
 *
 * **The path names the reference itself**, as a refusal names a field: a
 * route that finds the picture unlinked answers with `<path>.figureId`, and
 * one whose digest or size disagrees with the link with `<path>.<field>`.
 *
 * Pure, and sorted by path so the same content always gives the same list and
 * the first refusal is the same one every time. Each `ref` is a new object
 * holding the four fields of a reference and nothing else of the entry.
 */

export type NamedFigure = {
  readonly path: string;
  readonly ref: FigureRef;
  /** The earlier picture of a pair: the earlier report's, linked by borrowing. */
  readonly borrowed: boolean;
};

function refOf(entry: FigureRef): FigureRef {
  return {
    figureId: entry.figureId,
    sha256: entry.sha256,
    widthPx: entry.widthPx,
    heightPx: entry.heightPx,
  };
}

export function figuresNamedIn(content: QeegContent): readonly NamedFigure[] {
  const named: NamedFigure[] = Object.entries(content.maps).map(([key, entry]) => ({
    path: `maps.${key}`,
    ref: refOf(entry),
    borrowed: false,
  }));
  switch (content.edition) {
    case 'initial':
      break;
    case 'follow-up':
      for (const [condition, pair] of Object.entries(content.change.pairs)) {
        if (pair.earlier !== null) {
          named.push({
            path: `change.pairs.${condition}.earlier`,
            ref: refOf(pair.earlier),
            borrowed: true,
          });
        }
        if (pair.later !== null) {
          named.push({
            path: `change.pairs.${condition}.later`,
            ref: refOf(pair.later),
            borrowed: false,
          });
        }
      }
      break;
    default: {
      const unknown: never = content;
      return unknown;
    }
  }
  return named.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
