/**
 * A block of connectivity: a bar in the accent down its start edge, and
 * beside it a title, what the measure is, and what the recording found.
 *
 * **Why a filled path and not a rule.** The engine strokes a rule half to
 * each side of its line, so a rule on the edge of the box would put half its
 * width outside it. A filled rectangle is exactly as wide as it is drawn, and
 * the whole of it stands inside the box.
 *
 * **What is absent leaves no gap.** Each of the three parts is drawn only
 * when it has words, and the gap between two parts is left only when both are
 * drawn. What hangs below the title's underline is allowed for by `stack`.
 */

import { beside, blank, stack } from '../block';
import type { Block } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { CONNECTIVITY } from '../geometry';
import { finite } from '../metrics';
import { ACCENT } from '../palette';
import type { Span } from '../paragraph';
import { roundedRect } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';

export type ConnectivityInput = {
  readonly title: string;
  readonly description: string;
  readonly finding: readonly Span[];
};

export function connectivityBlock(
  input: ConnectivityInput,
  width: number,
  drawing: Drawing,
): Block {
  finite('connectivityBlock', 'width', width);
  if (width < 0) {
    throw new RangeError(
      `connectivityBlock needs a width of zero or more, and was given ${width}.`,
    );
  }
  const room = width - CONNECTIVITY.inset;
  if (room <= 0) {
    throw new RangeError(`connectivityBlock is left no room for its words by a width of ${width}.`);
  }

  const drawn = [
    typeset('subheading', input.title, room, drawing),
    typeset('bandMuted', input.description, room, drawing),
    typeset('band', input.finding, room, drawing),
  ].filter((part) => part.height > 0);
  if (drawn.length === 0) return blank(width, 0);

  const words = stack(
    room,
    drawn.flatMap((part, index) => (index === 0 ? [part] : [CONNECTIVITY.gap, part])),
  );
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const bar: Block = {
    width: CONNECTIVITY.bar,
    height: words.height,
    overhang: 0,
    baseline: null,
    ops: [
      {
        kind: 'path',
        segments: roundedRect(0, -words.height, CONNECTIVITY.bar, words.height, 0),
        fill: ACCENT,
      },
    ],
  };
  return beside(width, [
    { block: bar, left: boxLeft(frame, 0, CONNECTIVITY.bar) },
    { block: words, left: boxLeft(frame, CONNECTIVITY.inset, room) },
  ]);
}
