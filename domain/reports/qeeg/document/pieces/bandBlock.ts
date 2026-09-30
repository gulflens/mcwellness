/**
 * A band of the report: its icon at the start edge, and beside it three
 * lines, the band's name and what it is linked with, what it may shape, and
 * what the recording found.
 *
 * **Why spans and not a band.** Which words are heavier, and what a finding
 * says, are the caller's to compose: this piece is handed three lines of
 * spans and draws them, so it knows nothing of a band but its hue.
 *
 * **Which gap goes with which line.** The gap above a line belongs to it: the
 * second line has `BAND_ICON.lineGap` over it and the third
 * `BAND_ICON.findingGap`. A line with no words is left out with its gap, and
 * the first line drawn has none, so nothing absent leaves room behind.
 */

import { beside, stack } from '../block';
import type { Block } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { BAND_ICON } from '../geometry';
import { finite } from '../metrics';
import type { ReportBand } from '../palette';
import type { Span } from '../paragraph';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { bandIcon } from './bandIcon';

export type BandLines = readonly [readonly Span[], readonly Span[], readonly Span[]];
export type BandBlockInput = { readonly band: ReportBand; readonly lines: BandLines };

/** The room over each of the three lines, when a line is drawn above it. */
const GAP_OVER = [0, BAND_ICON.lineGap, BAND_ICON.findingGap] as const;

export function bandBlock(input: BandBlockInput, width: number, drawing: Drawing): Block {
  finite('bandBlock', 'width', width);
  if (width < 0) {
    throw new RangeError(`bandBlock needs a width of zero or more, and was given ${width}.`);
  }
  if (input.lines.length !== 3) {
    throw new RangeError(`bandBlock needs three lines, and was given ${input.lines.length}.`);
  }
  const room = width - BAND_ICON.size - BAND_ICON.gutter;
  if (room <= 0) {
    throw new RangeError(`bandBlock is left no room for its words by a width of ${width}.`);
  }

  const parts: (Block | number)[] = [];
  input.lines.forEach((spans, index) => {
    const line = typeset('band', spans, room, drawing);
    if (line.height === 0) return;
    if (parts.length > 0) parts.push(GAP_OVER[index] ?? 0);
    parts.push(line);
  });
  const words = stack(room, parts);

  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const icon = bandIcon({ band: input.band }, BAND_ICON.size, drawing);
  return beside(width, [
    { block: icon, left: boxLeft(frame, 0, BAND_ICON.size), down: BAND_ICON.top },
    { block: words, left: boxLeft(frame, BAND_ICON.size + BAND_ICON.gutter, room) },
  ]);
}
