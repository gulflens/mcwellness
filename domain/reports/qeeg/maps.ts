/**
 * The brain maps a draft names, changed the way the form changes them
 * (docs/SPEC/reports-qeeg.md sections 9 and 10).
 *
 * **Why these live here and not in the form.** A report's maps are an
 * ordered list kept as keyed entries, each with its place, and the shape
 * refuses a list whose places do not run from 0 without a gap or a repeat
 * (section 4, rule 2). Adding, moving and taking out a map each have to
 * renumber, and a follow-up's pairs have to name exactly the four fields of a
 * reference. Those are the report's rules, so they are answered here, once,
 * and tested; the form only asks.
 *
 * **What the form is told before it sends anything.** A ninth map is refused
 * by `mapRefusal`, with the same code the upload door answers, so the
 * practitioner is told before a picture crosses the wire. And a map still
 * named on the page of what has changed is found by `whereStillNamed`, from
 * the same list the remove door reads (`figuresNamedIn`), so the form says
 * where it is used instead of taking it out from under the page.
 *
 * **The earlier side of a pair belongs to the report compared with.** The
 * route borrows it from that report when the draft is saved, and refuses a
 * picture that report does not hold. So choosing another report to compare
 * with lets go of the earlier side of both pairs (`compareWith`), and the
 * later side, this report's own, is kept.
 *
 * Every function returns a new content and leaves the one given unchanged;
 * one with nothing to do returns the content it was given.
 */

import { figuresNamedIn } from './figuresNamed';
import {
  LIMITS,
  type Bilingual,
  type ComparedWith,
  type Condition,
  type FigureRef,
  type MapEntry,
  type QeegContent,
} from './types';

type Placed = MapEntry & { readonly position: number };

export type ListedMap = { readonly key: string; readonly entry: Placed };

/** The report's maps in the order they print. */
export function mapsInOrder(content: QeegContent): ListedMap[] {
  return Object.entries(content.maps)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => a.entry.position - b.entry.position);
}

/** Why another map cannot be added, or null when it can. */
export function mapRefusal(content: QeegContent): 'too_many_maps' | null {
  return Object.keys(content.maps).length >= LIMITS.maps ? 'too_many_maps' : null;
}

function refOf(figure: FigureRef): FigureRef {
  return {
    figureId: figure.figureId,
    sha256: figure.sha256,
    widthPx: figure.widthPx,
    heightPx: figure.heightPx,
  };
}

/** The list in this order, placed from 0. */
function renumbered(listed: readonly ListedMap[]): Record<string, Placed> {
  return Object.fromEntries(
    listed.map(({ key, entry }, position) => [key, { ...entry, position }]),
  );
}

/** A key of the shape's form (section 4, rule 9) not yet used by a map. */
function freeKey(content: QeegContent): string {
  let n = 0;
  while (Object.hasOwn(content.maps, `m${n}`)) n += 1;
  return `m${n}`;
}

/** The picture added at the end, or the content as it was when it is there already or full. */
export function addMap(
  content: QeegContent,
  figure: FigureRef,
  condition: Condition | null,
): QeegContent {
  if (mapRefusal(content) !== null) return content;
  if (Object.values(content.maps).some((entry) => entry.figureId === figure.figureId)) {
    return content;
  }
  const entry: Placed = {
    ...refOf(figure),
    condition,
    caption: null,
    position: Object.keys(content.maps).length,
  };
  return { ...content, maps: { ...content.maps, [freeKey(content)]: entry } };
}

/**
 * The map's condition, and her own label for it. A label is kept only where
 * there is no condition: the two conditions are named by the report's own
 * words, and a map shows one name.
 */
export function placeMap(
  content: QeegContent,
  figureId: string,
  condition: Condition | null,
  caption: Bilingual | null,
): QeegContent {
  const listed = mapsInOrder(content);
  if (!listed.some(({ entry }) => entry.figureId === figureId)) return content;
  return {
    ...content,
    maps: renumbered(
      listed.map((each) =>
        each.entry.figureId === figureId
          ? {
              key: each.key,
              entry: { ...each.entry, condition, caption: condition === null ? caption : null },
            }
          : each,
      ),
    ),
  };
}

/** The map one place earlier (-1) or later (1); at either end, the content as it was. */
export function moveMap(content: QeegContent, figureId: string, by: -1 | 1): QeegContent {
  const listed = mapsInOrder(content);
  const at = listed.findIndex(({ entry }) => entry.figureId === figureId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= listed.length) return content;
  const moved = [...listed];
  const [taken] = moved.splice(at, 1);
  if (taken === undefined) return content;
  moved.splice(to, 0, taken);
  return { ...content, maps: renumbered(moved) };
}

/** The map taken out of the list, and the places after it closed up. */
export function removeMap(content: QeegContent, figureId: string): QeegContent {
  const listed = mapsInOrder(content);
  if (!listed.some(({ entry }) => entry.figureId === figureId)) return content;
  return {
    ...content,
    maps: renumbered(listed.filter(({ entry }) => entry.figureId !== figureId)),
  };
}

/** Where the report names this picture other than in its list of maps. */
export function whereStillNamed(content: QeegContent, figureId: string): string[] {
  return figuresNamedIn(content)
    .filter((named) => named.ref.figureId === figureId && !named.path.startsWith('maps.'))
    .map((named) => named.path);
}

/** A follow-up's pair with one side set to this picture, or to none. A first report has none. */
export function choosePair(
  content: QeegContent,
  condition: Condition,
  side: 'earlier' | 'later',
  figure: FigureRef | null,
): QeegContent {
  if (content.edition !== 'follow-up') return content;
  const pair = {
    ...content.change.pairs[condition],
    [side]: figure === null ? null : refOf(figure),
  };
  return {
    ...content,
    change: { ...content.change, pairs: { ...content.change.pairs, [condition]: pair } },
  };
}

/**
 * A follow-up compared with another report. The earlier side of both pairs is
 * let go: it was the other report's picture, and the route borrows it only
 * from the report compared with.
 */
export function compareWith(content: QeegContent, comparedWith: ComparedWith): QeegContent {
  if (content.edition !== 'follow-up') return content;
  if (content.comparedWith.reportId === comparedWith.reportId) return content;
  const { pairs } = content.change;
  return {
    ...content,
    comparedWith,
    change: {
      ...content.change,
      pairs: {
        eyes_open: { ...pairs.eyes_open, earlier: null },
        eyes_closed: { ...pairs.eyes_closed, earlier: null },
      },
    },
  };
}
