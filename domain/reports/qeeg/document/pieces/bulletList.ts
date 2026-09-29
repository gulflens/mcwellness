/**
 * A list whose marker is a diamond: what was chosen for a client, one item
 * to a row, in one column or in two.
 *
 * **Its shape is the practice's.** A diamond in the accent at the start
 * edge, the words indented past it, a fixed gap between rows. A long list
 * (more than `BULLETS.columnsAbove` items) is set in two balanced columns to
 * save the page's room, the first taking the odd item; the list of benefits
 * asks for two columns whatever its length. The first column stands at the
 * START, so an Arabic list is read from the right, as its page is.
 *
 * **One block, never cut.** A list is short, and a list broken over a page
 * loses the balance of its columns, so it carries no `split`: the builder of
 * pages moves it whole.
 *
 * **What is not drawn takes no room.** An item that is empty once trimmed is
 * left out, and a list left with nothing shows the words it is handed for
 * an empty list, with no diamond.
 */

import { beside, stack } from '../block';
import type { Block } from '../block';
import { boxLeft, columns, fromStart } from '../frame';
import type { Frame } from '../frame';
import { BULLETS } from '../geometry';
import { finite } from '../metrics';
import { ACCENT } from '../palette';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { diamond } from '../shapes';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type BulletListInput = {
  readonly items: readonly Words[];
  /** 'auto' sets a long list in two columns; 'two' always does. */
  readonly columns: 'auto' | 'two';
  /** The report's words for a list with nothing in it. */
  readonly empty: string;
};

/** The side of the diamond's box: a square turned on its point. */
const MARKER_BOX = BULLETS.diamond * Math.SQRT2;

/** One item: its diamond, then its words, indented past it. */
function row(item: Words, width: number, drawing: Drawing): Block {
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const room = width - BULLETS.indent;
  const words = typeset('body', item.text, room, drawing, { typed: item.typed });
  const marker: LayoutOp = {
    kind: 'path',
    segments: diamond(
      fromStart(frame, BULLETS.diamondInset + MARKER_BOX / 2),
      -(BULLETS.diamondTop + MARKER_BOX / 2),
      BULLETS.diamond,
    ),
    fill: ACCENT,
  };
  const markerFoot = BULLETS.diamondTop + MARKER_BOX;
  const height = Math.max(words.height, markerFoot);
  const reach = Math.max(words.height + words.overhang, markerFoot);
  return {
    width,
    height,
    overhang: reach - height,
    baseline: words.baseline,
    ops: [marker, ...translateOps(words.ops, boxLeft(frame, BULLETS.indent, room), 0)],
  };
}

/** Rows one under another, a gap between each two and none after the last. */
function column(items: readonly Words[], width: number, drawing: Drawing): Block {
  const parts = items.flatMap((item, index): (Block | number)[] =>
    index === 0 ? [row(item, width, drawing)] : [BULLETS.rowGap, row(item, width, drawing)],
  );
  return stack(width, parts);
}

function roomFor(width: number, columnWidth: number): void {
  if (columnWidth <= BULLETS.indent) {
    throw new RangeError(`bulletList is left no room for its words by a width of ${width}.`);
  }
}

export function bulletList(input: BulletListInput, width: number, drawing: Drawing): Block {
  finite('bulletList', 'width', width);
  if (width < 0) {
    throw new RangeError(`bulletList needs a width of zero or more, and was given ${width}.`);
  }
  const items = input.items.filter((item) => item.text.trim() !== '');
  if (items.length === 0) {
    // The words alone, without the paragraph's way of being cut.
    const {
      width: w,
      height,
      overhang,
      baseline,
      ops,
    } = typeset('empty', input.empty, width, drawing);
    return { width: w, height, overhang, baseline, ops };
  }

  const two = input.columns === 'two' || items.length > BULLETS.columnsAbove;
  if (!two) {
    roomFor(width, width);
    return column(items, width, drawing);
  }

  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const [first, second] = columns(frame, 2, BULLETS.gutter);
  if (!first || !second) throw new RangeError('bulletList was given fewer than two columns.');
  roomFor(width, first.width);
  const split = Math.ceil(items.length / 2);
  return beside(width, [
    { block: column(items.slice(0, split), first.width, drawing), left: first.left },
    { block: column(items.slice(split), second.width, drawing), left: second.left },
  ]);
}
