/**
 * Start and end, turned into physical x.
 *
 * **Why pieces are written in terms of reading direction.** The qEEG report
 * goes out in English and in Arabic, and the Arabic page is the English one
 * reflected: what sits at the left of one sits at the right of the other. The
 * Dart tool reached that with a second copy of each piece. Here each piece of
 * the report asks a frame where its START and END are, so the Arabic page is
 * the mirror of the English one by construction, and a fix to one is a fix to
 * both.
 *
 * A frame is a horizontal band: its physical `left`, its `width`, and which
 * way it reads. Vertical position is not its business; a page grows the same
 * way in both languages.
 */

import type { Direction } from './direction';

export type Frame = {
  readonly direction: Direction;
  readonly left: number;
  readonly width: number;
};

/** The most columns a frame is cut into: a report's widest grid has four. */
const MAX_COLUMNS = 12;

function finite(fn: string, name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${fn} needs a finite ${name}, and was given ${String(value)}.`);
  }
}

function checked(fn: string, frame: Frame): void {
  finite(fn, 'frame left', frame.left);
  finite(fn, 'frame width', frame.width);
  if (frame.width < 0) {
    throw new RangeError(
      `${fn} needs a frame width of zero or more, and was given ${frame.width}.`,
    );
  }
}

/** The x of a point `offset` in from the start edge. */
export function fromStart(frame: Frame, offset: number): number {
  checked('fromStart', frame);
  finite('fromStart', 'offset', offset);
  return frame.direction === 'ltr' ? frame.left + offset : frame.left + frame.width - offset;
}

/** The x of a point `offset` in from the end edge. */
export function fromEnd(frame: Frame, offset: number): number {
  checked('fromEnd', frame);
  finite('fromEnd', 'offset', offset);
  return frame.direction === 'ltr' ? frame.left + frame.width - offset : frame.left + offset;
}

/**
 * The physical left of a box `boxWidth` wide whose start-side edge is
 * `offsetFromStart` in from the frame's start. The engine places images and
 * rules by their left edge, so a right-to-left box is placed by its far side.
 */
export function boxLeft(frame: Frame, offsetFromStart: number, boxWidth: number): number {
  checked('boxLeft', frame);
  finite('boxLeft', 'offset', offsetFromStart);
  finite('boxLeft', 'box width', boxWidth);
  return frame.direction === 'ltr'
    ? frame.left + offsetFromStart
    : frame.left + frame.width - offsetFromStart - boxWidth;
}

/** A narrower frame reading the same way, pulled in from its start and its end. */
export function inset(frame: Frame, fromStartBy: number, fromEndBy: number): Frame {
  checked('inset', frame);
  finite('inset', 'start inset', fromStartBy);
  finite('inset', 'end inset', fromEndBy);
  const width = frame.width - fromStartBy - fromEndBy;
  if (width < 0) {
    throw new RangeError(
      `inset would leave a frame ${frame.width} wide with a width of ${width}, which is less than nothing.`,
    );
  }
  const left = frame.direction === 'ltr' ? frame.left + fromStartBy : frame.left + fromEndBy;
  return { direction: frame.direction, left, width };
}

/**
 * `count` equal columns with `gutter` between each pair, filling the frame,
 * in reading order: the first is at the start side, so an Arabic page's first
 * column is its rightmost and a loop over them reads in the right order in
 * either language.
 */
export function columns(frame: Frame, count: number, gutter: number): Frame[] {
  checked('columns', frame);
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `columns needs a count that is a whole number of 1 or more, and was given ${count}.`,
    );
  }
  if (count > MAX_COLUMNS) {
    throw new RangeError(`columns needs at most ${MAX_COLUMNS} columns, and was given ${count}.`);
  }
  finite('columns', 'gutter', gutter);
  const width = (frame.width - gutter * (count - 1)) / count;
  if (width < 0) {
    throw new RangeError(
      `columns cannot fit ${count} columns and their gutters of ${gutter} in a width of ${frame.width}.`,
    );
  }
  return Array.from({ length: count }, (_, i) => ({
    direction: frame.direction,
    left: boxLeft(frame, i * (width + gutter), width),
    width,
  }));
}

/**
 * The engine's `align` for text that sits against the start edge. The
 * engine's align is physical ('start' puts `x` at the text's left, 'end' at
 * its right), so start-side text in a right-to-left frame is 'end'.
 */
export function startAlign(frame: Frame): 'start' | 'end' {
  return frame.direction === 'ltr' ? 'start' : 'end';
}

/** The same band reading the other way. Twice is where it began. */
export function mirror(frame: Frame): Frame {
  return {
    direction: frame.direction === 'ltr' ? 'rtl' : 'ltr',
    left: frame.left,
    width: frame.width,
  };
}
