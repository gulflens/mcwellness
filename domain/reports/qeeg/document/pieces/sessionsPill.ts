/**
 * The number of sessions a programme holds, in an outline with round ends,
 * at the start edge.
 *
 * **As wide as its words.** The pill is its label and its padding and no
 * more, as the practice's layout has it. A label too wide for the page wraps
 * inside a pill as wide as the page, rather than running off it.
 *
 * **A line takes no room** (contract, ruling R1). The outline is drawn
 * wholly inside the pill: a stroke falls half to each side of its path, so
 * the path is set in by half the line. The padding is measured from the
 * pill's edge, and the line lies within it.
 *
 * The room over and under the pill is part of the block, so the builder of
 * pages sets it with no gap of its own. A label of no words draws nothing
 * and takes no room at all.
 */

import { blank, extentOf } from '../block';
import type { Block } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { PILL } from '../geometry';
import { finite } from '../metrics';
import { ACCENT } from '../palette';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { stadium } from '../shapes';
import { styleOf } from '../styles';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';

export type SessionsPillInput = { readonly label: string };

/** Room for a rounding error when a line is compared with the room it has. */
const EPSILON = 1e-9;

export function sessionsPill(input: SessionsPillInput, width: number, drawing: Drawing): Block {
  finite('sessionsPill', 'width', width);
  if (width < 0) {
    throw new RangeError(`sessionsPill needs a width of zero or more, and was given ${width}.`);
  }
  if (input.label.trim() === '') return blank(width, 0);

  const around = PILL.padH;
  const most = width - 2 * around;
  if (most <= 0) {
    throw new RangeError(`sessionsPill is left no room for its label by a width of ${width}.`);
  }

  // Set once in all the room there is, to learn how wide the words are. On
  // one line the pill hugs them; wrapped, it takes the whole of the room.
  const trial = typeset('pill', input.label, most, drawing);
  const { style } = styleOf('pill', drawing.direction);
  const oneLine = trial.height <= style.size * style.lineHeight + EPSILON;
  const reach = extentOf(trial.ops, drawing.measure);
  const inner = oneLine ? Math.min(most, reach.right - reach.left) : most;
  const words = typeset('pill', input.label, inner, drawing, { align: 'centre' });

  const pillWidth = inner + 2 * around;
  const pillHeight = words.height + words.overhang + 2 * PILL.padV;
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const left = boxLeft(frame, 0, pillWidth);
  const half = PILL.edge / 2;
  const edge: LayoutOp = {
    kind: 'path',
    segments: stadium(
      left + half,
      -(PILL.above + pillHeight) + half,
      pillWidth - PILL.edge,
      pillHeight - PILL.edge,
    ),
    stroke: { ...ACCENT, width: PILL.edge },
  };
  const top = PILL.above + PILL.padV;
  return {
    width,
    height: PILL.above + pillHeight + PILL.below,
    overhang: 0,
    baseline: words.baseline === null ? null : top + words.baseline,
    ops: [edge, ...translateOps(words.ops, left + around, -top)],
  };
}
