import { describe, expect, it } from 'vitest';
import { boxLeft, columns, fromEnd, fromStart, inset, mirror, startAlign } from './frame';
import type { Frame } from './frame';

/**
 * A frame turns START and END into physical x, so the Arabic report is the
 * English one reflected by construction. These tests hold the reflection to
 * the arithmetic.
 */

const MM = 72 / 25.4;
const ltr: Frame = { direction: 'ltr', left: 17 * MM, width: 595.28 - 34 * MM };
const rtl: Frame = { ...ltr, direction: 'rtl' };
const right = (frame: Frame): number => frame.left + frame.width;

describe('the start and end of a frame', () => {
  it('puts the start on the left in a left-to-right frame', () => {
    expect(fromStart(ltr, 0)).toBe(ltr.left);
    expect(fromStart(ltr, 10)).toBe(ltr.left + 10);
    expect(fromEnd(ltr, 10)).toBeCloseTo(right(ltr) - 10, 9);
    expect(startAlign(ltr)).toBe('start');
  });

  it('puts the start on the right in a right-to-left frame', () => {
    expect(fromStart(rtl, 0)).toBeCloseTo(right(rtl), 9);
    expect(fromStart(rtl, 10)).toBeCloseTo(right(rtl) - 10, 9);
    expect(fromEnd(rtl, 10)).toBeCloseTo(rtl.left + 10, 9);
    // The engine's align is physical: 'end' puts x at the right-hand end of the line.
    expect(startAlign(rtl)).toBe('end');
  });
});

describe('a box placed from the start', () => {
  it('never leaves the frame', () => {
    for (const frame of [ltr, rtl]) {
      for (const boxWidth of [0, 1, 50, frame.width / 2, frame.width]) {
        for (let step = 0; step <= 10; step += 1) {
          const offset = ((frame.width - boxWidth) * step) / 10;
          const left = boxLeft(frame, offset, boxWidth);
          expect(left).toBeGreaterThanOrEqual(frame.left - 1e-9);
          expect(left + boxWidth).toBeLessThanOrEqual(right(frame) + 1e-9);
        }
      }
    }
  });

  it('sits against the start edge when its offset is nothing', () => {
    expect(boxLeft(ltr, 0, 40)).toBe(ltr.left);
    expect(boxLeft(rtl, 0, 40) + 40).toBeCloseTo(right(rtl), 9);
  });
});

describe('insetting a frame', () => {
  it('moves the left edge in for the start of a left-to-right frame', () => {
    const inner = inset(ltr, 10, 4);
    expect(inner.left).toBeCloseTo(ltr.left + 10, 9);
    expect(right(inner)).toBeCloseTo(right(ltr) - 4, 9);
    expect(inner.direction).toBe('ltr');
  });

  it('moves the right edge in for the start of a right-to-left frame', () => {
    const inner = inset(rtl, 10, 4);
    expect(right(inner)).toBeCloseTo(right(rtl) - 10, 9);
    expect(inner.left).toBeCloseTo(rtl.left + 4, 9);
    expect(inner.direction).toBe('rtl');
  });

  it('refuses to inset a frame past nothing', () => {
    expect(() => inset(ltr, ltr.width, 1)).toThrow(RangeError);
  });
});

describe('columns', () => {
  it('fill the width with their gutters', () => {
    for (const frame of [ltr, rtl]) {
      const cols = columns(frame, 3, 12);
      expect(cols).toHaveLength(3);
      const total = cols.reduce((sum, col) => sum + col.width, 0) + 2 * 12;
      expect(total).toBeCloseTo(frame.width, 9);
      for (const col of cols) {
        expect(col.width).toBeCloseTo(cols[0]?.width ?? Number.NaN, 9);
        expect(col.direction).toBe(frame.direction);
      }
    }
  });

  it('come back in reading order, the first at the start side', () => {
    const forward = columns(ltr, 3, 12);
    expect(forward[0]?.left).toBe(ltr.left);
    expect(forward.map((col) => col.left)).toEqual(
      [...forward.map((col) => col.left)].sort((a, b) => a - b),
    );

    const backward = columns(rtl, 3, 12);
    const first = backward[0];
    if (!first) throw new Error('no columns');
    expect(right(first)).toBeCloseTo(right(rtl), 9);
    expect(backward.map((col) => col.left)).toEqual(
      [...backward.map((col) => col.left)].sort((a, b) => b - a),
    );
  });

  it('leave the gutter between neighbours', () => {
    const cols = columns(ltr, 2, 20);
    const [a, b] = cols;
    if (!a || !b) throw new Error('no columns');
    expect(b.left - right(a)).toBeCloseTo(20, 9);
  });

  it('refuses a count that is not a whole number of one or more', () => {
    expect(() => columns(ltr, 0, 10)).toThrow(RangeError);
    expect(() => columns(ltr, 2.5, 10)).toThrow(/count/);
  });
});

describe('mirroring', () => {
  it('twice is where you began', () => {
    expect(mirror(mirror(ltr))).toEqual(ltr);
    expect(mirror(mirror(rtl))).toEqual(rtl);
  });

  it('turns one direction into the other and keeps the box', () => {
    expect(mirror(ltr)).toEqual(rtl);
  });

  it('reflects a left-to-right layout about the frame’s centre line', () => {
    const centre = ltr.left + ltr.width / 2;
    const reflect = (x: number): number => 2 * centre - x;
    const other = mirror(ltr);
    for (const offset of [0, 5, 33.3, ltr.width]) {
      expect(fromStart(other, offset)).toBeCloseTo(reflect(fromStart(ltr, offset)), 9);
      expect(fromEnd(other, offset)).toBeCloseTo(reflect(fromEnd(ltr, offset)), 9);
    }
    // A box's right edge in one is the reflection of its left edge in the other.
    expect(boxLeft(other, 14, 60) + 60).toBeCloseTo(reflect(boxLeft(ltr, 14, 60)), 9);
    const colsA = columns(ltr, 4, 8);
    const colsB = columns(other, 4, 8);
    colsA.forEach((col, i) => {
      const twin = colsB[i];
      if (!twin) throw new Error('missing column');
      expect(twin.left + twin.width).toBeCloseTo(reflect(col.left), 9);
    });
  });
});
