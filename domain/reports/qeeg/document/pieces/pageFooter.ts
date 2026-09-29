/**
 * The foot of every page: a hairline, the practice's lines at the start
 * edge, and the page's words (which page of how many) at the end edge, their
 * last baselines level.
 *
 * **As tall on every page.** The builder of pages measures the footer once
 * and leaves that room on every page, so the footer's height must not hang
 * on which page it is. The page's words differ only in their figures, so the
 * room kept for them is the room they would take with every number made two
 * figures of the widest figure: `Page 2 of 9` is given the room of
 * `Page 99 of 99`. The lines then wrap in the same room on every page, and
 * neither they nor the height move.
 *
 * **A telephone number reads left to right** in an Arabic footer, whole and
 * in order: `typeset` and `bidi.ts` see to figures inside an Arabic line,
 * and the caller says which lines a person typed.
 *
 * A line that is empty once trimmed is left out and takes no room.
 */

import { beside, blank, extentOf, stack } from '../block';
import type { Block, Cell } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { FOOTER } from '../geometry';
import { finite } from '../metrics';
import { HAIRLINE } from '../palette';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type PageFooterInput = {
  /** The practice's lines: an address, a telephone number. */
  readonly lines: readonly Words[];
  /** Which page of how many, in the report's words. */
  readonly page: string;
};

const FIGURES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** The fewest figures the room for a page's number is kept for. */
const KEPT_FIGURES = 2;

/** The page's words with every number as wide as it may grow. */
function widestOf(page: string, drawing: Drawing): string {
  const { style } = styleOf('footer', drawing.direction);
  const width = (figure: string) => drawing.measure(figure, style.weight, style.size, false);
  const widest = FIGURES.reduce((best, figure) => (width(figure) > width(best) ? figure : best));
  return page.replace(/[0-9]+/g, (run) => widest.repeat(Math.max(KEPT_FIGURES, run.length)));
}

/** How far below its top the last baseline of a block stands; 0 for no type. */
function lastBaseline(block: Block): number {
  return block.ops.reduce(
    (lowest, op) => (op.kind === 'text' ? Math.max(lowest, -op.y) : lowest),
    0,
  );
}

export function pageFooter(input: PageFooterInput, width: number, drawing: Drawing): Block {
  finite('pageFooter', 'width', width);
  if (width < 0) {
    throw new RangeError(`pageFooter needs a width of zero or more, and was given ${width}.`);
  }
  // Refused here, under its own name, rather than by the paragraph it sets.
  if (width === 0) {
    throw new RangeError('pageFooter is left no room for its lines by a width of 0.');
  }
  const frame: Frame = { direction: drawing.direction, left: 0, width };

  const kept = typeset('footer', widestOf(input.page, drawing), width, drawing);
  const reach = extentOf(kept.ops, drawing.measure);
  const pageWidth = kept.ops.length > 0 ? reach.right - reach.left : 0;
  const room = width - pageWidth - (pageWidth > 0 ? FOOTER.gutter : 0);
  if (room <= 0) {
    throw new RangeError(`pageFooter is left no room for its lines by a width of ${width}.`);
  }

  const lines = input.lines
    .filter((line) => line.text.trim() !== '')
    .map((line) => typeset('footer', line.text, room, drawing, { typed: line.typed }));
  const practice = lines.length > 0 ? stack(room, lines) : blank(room, 0);
  const page = typeset('footer', input.page, pageWidth, drawing, { align: 'end' });

  const practiceLast = lastBaseline(practice);
  const pageLast = lastBaseline(page);
  const level = Math.max(practiceLast, pageLast);
  const cells: Cell[] = [
    { block: practice, left: boxLeft(frame, 0, room), down: level - practiceLast },
    { block: page, left: boxLeft(frame, width - pageWidth, pageWidth), down: level - pageLast },
  ];
  const content = beside(width, cells);

  // A line takes no room: the hairline is drawn inside the upper edge of
  // the padding under it.
  const top = FOOTER.padTop;
  const first = practice.baseline ?? page.baseline;
  const firstDown = practice.baseline === null ? level - pageLast : level - practiceLast;
  const hairline: LayoutOp = {
    kind: 'rule',
    x: 0,
    y: -FOOTER.rule / 2,
    width,
    thickness: FOOTER.rule,
    ...HAIRLINE,
  };
  return {
    width,
    height: top + content.height,
    overhang: content.overhang,
    baseline: first === null ? null : top + firstDown + first,
    ops: [hairline, ...translateOps(content.ops, 0, -top)],
  };
}
