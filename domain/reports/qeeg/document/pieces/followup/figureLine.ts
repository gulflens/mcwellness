/**
 * A figure of a follow-up in words, with the shape that says which way it
 * moved: "about 40% lower" after a triangle pointing down.
 *
 * **Direction is a shape, in the ink** (`docs/SPEC/reports-qeeg.md`
 * section 10, point 7). A figure that fell is marked by a triangle pointing
 * down, one that rose by a triangle pointing up, and one that held by
 * nothing. The marker is a filled path and never a letter: the installed
 * faces have no glyph for a triangle, and a glyph they cannot draw is
 * dropped in silence. It is the ink, never a hue: whether a fall is welcome
 * is said in her summary, and never by a colour the system chose.
 *
 * **Where it stands.** At the start edge, in a square `MARKER[size]` on
 * each side whose foot is on the first baseline of the words, and the words
 * a gutter after it; so the Arabic line is the English one in a mirror. The
 * marker takes no line of its own, and a line with no marker is set from the
 * start edge.
 *
 * **Three sizes.** A headline tile's figure, a cell of the change table, and
 * the earlier score on a card of the dashboard. Each is a role of
 * `styles.ts` and a marker of `geometry.ts`; the piece holds neither.
 */

import { blank } from '../../block';
import type { Block } from '../../block';
import { boxLeft, fromStart } from '../../frame';
import type { Frame } from '../../frame';
import { MARKER } from '../../geometry';
import { finite } from '../../metrics';
import { INK } from '../../palette';
import { translateOps } from '../../scale';
import type { LayoutOp } from '../../scale';
import { triangle } from '../../shapes';
import type { Role } from '../../styles';
import { typeset } from '../../typeset';
import type { Drawing } from '../../typeset';
import type { Words } from '../words';

/** Which way a figure moved; `null` when it held. */
export type Points = 'up' | 'down';

export type FigureLineInput = { readonly words: Words; readonly points: Points | null };

export const FIGURE_SIZES = Object.freeze(['headline', 'cell', 'card'] as const);
export type FigureSize = (typeof FIGURE_SIZES)[number];

export type FigureLineOptions = { readonly size: FigureSize };

const ROLE: Readonly<Record<FigureSize, Role>> = Object.freeze({
  headline: 'headline',
  cell: 'body',
  card: 'cardSummary',
});

export function figureLine(
  input: FigureLineInput,
  width: number,
  drawing: Drawing,
  options: FigureLineOptions,
): Block {
  finite('figureLine', 'width', width);
  if (width < 0) {
    throw new RangeError(`figureLine needs a width of zero or more, and was given ${width}.`);
  }
  const side = MARKER[options.size];
  const indent = input.points === null ? 0 : side + MARKER.gutter;
  const room = width - indent;
  if (room <= 0) {
    throw new RangeError(`figureLine is left no room for its words by a width of ${width}.`);
  }
  const role = ROLE[options.size];
  if (input.words.text.trim() === '') return blank(width, 0);

  const words = typeset(role, input.words.text, room, drawing, { typed: input.words.typed });
  if (input.points === null || words.baseline === null) {
    return { ...words, width };
  }
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const marker: LayoutOp = {
    kind: 'path',
    segments: triangle(fromStart(frame, side / 2), -words.baseline + side / 2, side, input.points),
    fill: INK,
  };
  return {
    width,
    height: words.height,
    overhang: words.overhang,
    baseline: words.baseline,
    ops: [marker, ...translateOps(words.ops, boxLeft(frame, indent, room), 0)],
  };
}
