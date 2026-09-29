/**
 * A score's ring: the whole ring in a pale track, an arc over it from the
 * top, clockwise, for the score's share of ten, and the score in the middle
 * with the words for "out of ten" under it.
 *
 * **Why on a grid.** The practice drew the ring on a square of 40 (`RING`),
 * `y` measured down; each length is multiplied by `size / RING.box` and `y`
 * is turned over, so the ring is the same drawing at any size.
 *
 * **Why figures placed by hand.** A score is a Latin figure in both
 * languages, drawn left to right and centred on the ring, so it is a text op
 * of its own with no `rtl`, and not a paragraph that would read the way its
 * report does.
 *
 * **A score of nothing.** A report's scores start empty, and a draft is
 * previewed before they are set: the track is drawn with a short grey mark
 * across its middle, round-ended, and no arc, no figure and no "out of ten".
 * A mark and not words: it needs no translating and is never too wide for
 * the ring. A score and its tier come together or not at all; one without
 * the other is a slip, and is refused.
 */

import type { Block } from '../block';
import { RING } from '../geometry';
import { finite } from '../metrics';
import { INK, MUTED, RING_TRACK, TIER_PAINT } from '../palette';
import type { Tier } from '../palette';
import type { LayoutOp } from '../scale';
import { arc, bar, circle } from '../shapes';
import type { Drawing } from '../typeset';

export type ScoreRingInput = {
  readonly score: number | null;
  readonly tier: Tier | null;
  /** The words under the score, "/10". */
  readonly outOf: string;
};

/** The most a score may be, and so a whole turn of the ring. */
const TOP_SCORE = 10;

function checked(input: ScoreRingInput): void {
  const { score, tier } = input;
  if (score !== null && !(Number.isInteger(score) && score >= 0 && score <= TOP_SCORE)) {
    throw new RangeError(
      `scoreRing needs a score that is a whole number from 0 to ${TOP_SCORE}, or none, and was given ${String(score)}.`,
    );
  }
  if (score !== null && tier === null) {
    throw new RangeError(`scoreRing needs a tier for a score of ${score}.`);
  }
  if (score === null && tier !== null) {
    throw new RangeError(`scoreRing needs a score for a tier of ${tier}.`);
  }
}

/** A score's ring, `size` on each side, the same in either language. */
export function scoreRing(input: ScoreRingInput, size: number, drawing: Drawing): Block {
  finite('scoreRing', 'size', size);
  if (size < 0) {
    throw new RangeError(`scoreRing needs a size of zero or more, and was given ${size}.`);
  }
  checked(input);
  // A figure is the same in both directions; the drawing is taken only so
  // that every piece is called alike.
  void drawing;

  const unit = size / RING.box;
  const centreX = (RING.box / 2) * unit;
  const centreY = -(RING.box / 2) * unit;
  const radius = RING.radius * unit;
  const line = RING.line * unit;

  const ops: LayoutOp[] = [
    {
      kind: 'path',
      segments: circle(centreX, centreY, radius),
      stroke: { ...RING_TRACK, width: line },
    },
  ];

  if (input.score === null || input.tier === null) {
    ops.push({
      kind: 'path',
      segments: bar(centreX, centreY, RING.unsetDash * unit, RING.unsetLine * unit),
      fill: MUTED,
    });
    return { width: size, height: size, overhang: 0, baseline: null, ops };
  }

  if (input.score > 0) {
    ops.push({
      kind: 'path',
      segments: arc(
        centreX,
        centreY,
        radius,
        Math.PI / 2,
        -2 * Math.PI * (input.score / TOP_SCORE),
      ),
      stroke: { rgb: TIER_PAINT[input.tier], width: line, cap: 'round' },
    });
  }
  ops.push(
    {
      kind: 'text',
      x: centreX,
      y: -RING.scoreBaseline * unit,
      text: String(input.score),
      style: { font: 'bold', size: RING.scoreSize * unit, ...INK },
      align: 'centre',
    },
    {
      kind: 'text',
      x: centreX,
      y: -RING.outOfBaseline * unit,
      text: input.outOf,
      style: { font: 'regular', size: RING.outOfSize * unit, ...MUTED },
      align: 'centre',
    },
  );
  return { width: size, height: size, overhang: 0, baseline: null, ops };
}
