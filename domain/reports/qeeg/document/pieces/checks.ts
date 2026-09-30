/**
 * What the tests of every piece ask of a block, asked one way.
 *
 * **For tests only.** No piece imports this file, and nothing that reaches
 * a page does. It is not a test file itself because sixteen test files
 * share it, and because a check that cannot fail guards nothing: it has
 * tests of its own (`checks.test.ts`).
 *
 * **Why it exists.** The first tests of the pieces each wrote these checks
 * for themselves, and each left something out. The contract said the
 * Arabic page's SHAPES mirror the English page's and said nothing of its
 * words, so a list whose words stood over their own marker on an Arabic
 * page passed every test. Here words are held to the mirror too, line by
 * line: where a line stands, not what it says.
 *
 * **An answer is a list of sentences**, empty when all is well, so that a
 * failing test says what is wrong and where, and a test asserts
 * `toEqual([])`.
 *
 * **The measure.** Every character is half its size wide, in either
 * weight and either script, and both scripts have one face. Every number
 * in a test is then exact, and the same words are as wide on an Arabic
 * page as on an English one, which is what lets one be held to the mirror
 * of the other.
 */

import { extentOf } from '../block';
import type { Block, Extent } from '../block';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import type { Drawing } from '../typeset';

export const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;

export const FACE = Object.freeze({ ascent: 1, descent: -0.25 });

export const ENGLISH: Drawing = Object.freeze({
  direction: 'ltr',
  measure,
  faces: Object.freeze({ latin: FACE, arabic: FACE }),
});

export const ARABIC: Drawing = Object.freeze({ ...ENGLISH, direction: 'rtl' });

/** What two numbers that should be equal may differ by. */
const TOLERANCE = 1e-6;

/** A number as a person would write it: no tail of a rounding error. */
function written(value: number): string {
  return String(Number(value.toFixed(6)));
}

type TextOp = Extract<LayoutOp, { kind: 'text' }>;

const isText = (op: LayoutOp): op is TextOp => op.kind === 'text';

type Line = { readonly baseline: number; readonly ops: readonly TextOp[] };

/** The text of a block gathered into lines, by baseline, the highest first. */
function linesOf(ops: readonly LayoutOp[]): Line[] {
  const lines: { baseline: number; ops: TextOp[] }[] = [];
  for (const op of ops.filter(isText)) {
    const line = lines.find((each) => Math.abs(each.baseline - op.y) <= TOLERANCE);
    if (line) line.ops.push(op);
    else lines.push({ baseline: op.y, ops: [op] });
  }
  return lines.sort((one, other) => other.baseline - one.baseline);
}

/** The words of one line as they stand, from the left of the page to its right. */
function standing(line: Line, given: Measure): string {
  return line.ops
    .map((op) => ({ text: op.text, left: extentOf([op], given).left }))
    .sort((one, other) => one.left - other.left)
    .map((each) => each.text)
    .join(' ');
}

/**
 * The words of a block, line by line, each as it stands across the page.
 * A sentence of English read right to left shows here with its full stop
 * before its first word, which is how a test sees which way a line was read.
 */
export function wordsOf(block: Block, given: Measure): string[] {
  return linesOf(block.ops).map((line) => standing(line, given));
}

/** Every word of some ops, as `wordsOf` gives them, in one line. */
export function across(ops: readonly LayoutOp[], given: Measure): string {
  return linesOf(ops)
    .map((line) => standing(line, given))
    .join(' ');
}

/**
 * Each edge of its box that a block's ink has crossed, and by how much.
 * Ink may hang below by as much as the block's `overhang` and no more.
 */
export function outside(block: Block, given: Measure): string[] {
  if (block.ops.length === 0) return [];
  const extent = extentOf(block.ops, given);
  const found: string[] = [];
  const crossed = (edge: string, by: number): void => {
    if (by > TOLERANCE) found.push(`${edge} by ${written(by)}`);
  };
  crossed('left', -extent.left);
  crossed('right', extent.right - block.width);
  crossed('top', extent.top);
  crossed('foot', -(block.height + block.overhang) - extent.bottom);
  return found;
}

function differ(one: number, other: number): boolean {
  return Math.abs(one - other) > TOLERANCE;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One thing in English and the same thing in Arabic, held to the mirror. */
function held(
  name: string,
  english: Extent,
  arabic: Extent,
  width: number,
  upAndDown: boolean,
): string[] {
  const found: string[] = [];
  const left = width - english.right;
  const right = width - english.left;
  if (differ(arabic.left, left) || differ(arabic.right, right)) {
    found.push(
      `${name}: ${written(english.left)} to ${written(english.right)} in English wants ` +
        `${written(left)} to ${written(right)} in Arabic, ` +
        `and is at ${written(arabic.left)} to ${written(arabic.right)}`,
    );
  }
  if (upAndDown && (differ(arabic.top, english.top) || differ(arabic.bottom, english.bottom))) {
    found.push(
      `${name}: from ${written(english.top)} down to ${written(english.bottom)} in English, ` +
        `from ${written(arabic.top)} down to ${written(arabic.bottom)} in Arabic`,
    );
  }
  return found;
}

/**
 * Where the Arabic block is not the English one reflected about the middle
 * of its width. Shapes are held one by one, in the order they are drawn;
 * words line by line, by where the line stands. Up and down are asked only
 * when `upAndDown` is set: an Arabic line is taller than an English one, so
 * what stands under words stands lower on an Arabic page, and rightly.
 */
export function unmirrored(
  english: Block,
  arabic: Block,
  given: Measure,
  options: { readonly upAndDown?: boolean } = {},
): string[] {
  if (differ(english.width, arabic.width)) {
    throw new RangeError(
      `unmirrored needs two blocks of one width, and was given ${english.width} and ${arabic.width}.`,
    );
  }
  const width = english.width;
  const upAndDown = options.upAndDown === true;
  const found: string[] = [];

  const shapes = (block: Block) => block.ops.filter((op) => !isText(op));
  const ours = shapes(english);
  const theirs = shapes(arabic);
  if (ours.length !== theirs.length) {
    found.push(
      `${counted(ours.length, 'shape', 'shapes')} in English and ${theirs.length} in Arabic`,
    );
  } else {
    ours.forEach((op, index) => {
      const other = theirs[index];
      if (!other) return;
      found.push(
        ...held(
          `shape ${index + 1} of ${ours.length} (${op.kind})`,
          extentOf([op], given),
          extentOf([other], given),
          width,
          upAndDown,
        ),
      );
    });
  }

  const lines = linesOf(english.ops);
  const others = linesOf(arabic.ops);
  if (lines.length !== others.length) {
    found.push(
      `${counted(lines.length, 'line', 'lines')} in English and ${others.length} in Arabic`,
    );
  } else {
    lines.forEach((line, index) => {
      const other = others[index];
      if (!other) return;
      found.push(
        ...held(
          `line ${index + 1} of ${lines.length}`,
          extentOf(line.ops, given),
          extentOf(other.ops, given),
          width,
          false,
        ),
      );
    });
  }
  return found;
}

/**
 * Everything a block draws, by how high it stands, the highest first: a
 * line of words once, as its words, and a shape as the kind of op it is.
 * A line is placed by its baseline and a shape by its top, so a shape and a
 * line that share a row are in the order of those two, which is enough to
 * say that one part of a piece stands above another.
 */
export function downThePage(
  block: Block,
  given: Measure,
): { readonly what: string; readonly top: number }[] {
  const things = [
    ...linesOf(block.ops).map((line) => ({ what: standing(line, given), top: line.baseline })),
    ...block.ops
      .filter((op) => !isText(op))
      .map((op) => ({ what: op.kind, top: extentOf([op], given).top })),
  ];
  return things.sort((one, other) => other.top - one.top);
}
