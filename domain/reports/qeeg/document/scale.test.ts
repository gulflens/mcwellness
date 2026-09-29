/**
 * Scaling a finished block of ops on the numbers, so that where each thing
 * finally lands can be read straight off the op a test holds.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Op } from '@domain/shared/document';
import { scaleOps, translateOps } from './scale';
import type { LayoutOp } from './scale';
import { circle } from './shapes';
import type { PathOp } from './shapes';

const text: Op = {
  kind: 'text',
  x: 110,
  y: 220,
  text: 'Alpha',
  style: { font: 'regular', size: 10, grey: 0 },
  align: 'start',
};
const rule: Op = { kind: 'rule', x: 110, y: 200, width: 80, dy: 6, thickness: 1, grey: 0.5 };
const image: Op = { kind: 'image', image: 'map-1', x: 120, y: 100, width: 60, height: 90 };
const path: PathOp = {
  kind: 'path',
  segments: [...circle(150, 150, 20)],
  stroke: { width: 2, rgb: [0.2, 0.3, 0.4], cap: 'round' },
  fill: { grey: 0.9 },
};
const block: LayoutOp[] = [text, rule, image, path];
const origin = { x: 100, y: 100 };

/** Every number an op carries, in a fixed order, for comparing two ops closely. */
function numbersOf(op: LayoutOp): number[] {
  switch (op.kind) {
    case 'text':
      return [op.x, op.y, op.style.size];
    case 'rule':
      return [op.x, op.y, op.width, op.dy ?? 0, op.thickness ?? 0];
    case 'image':
      return [op.x, op.y, op.width, op.height];
    case 'path':
      return [
        ...op.segments.flatMap((segment) => segment.slice(1) as number[]),
        op.stroke?.width ?? 0,
      ];
    case 'rect':
      return [op.x, op.y, op.width, op.height, op.radius ?? 0, op.stroke?.thickness ?? 0];
    default: {
      const unknown: never = op;
      throw new Error(`unknown op ${String(unknown)}`);
    }
  }
}

function expectClose(actual: readonly LayoutOp[], expected: readonly LayoutOp[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((op, i) => {
    const want = expected[i];
    if (!want) throw new Error('missing op');
    expect(op.kind).toBe(want.kind);
    const got = numbersOf(op);
    const wanted = numbersOf(want);
    expect(got.length).toBe(wanted.length);
    got.forEach((n, j) => expect(n).toBeCloseTo(wanted[j] ?? Number.NaN, 9));
  });
}

describe('scaling ops about an origin', () => {
  it('changes nothing when the scale is one', () => {
    expect(scaleOps(block, 1, origin)).toEqual(block);
  });

  it('copies ops at a scale of one by hand, where a browser has no structuredClone', () => {
    vi.stubGlobal('structuredClone', undefined);
    try {
      const copied = scaleOps(block, 1, origin);
      expect(copied).toEqual(block);
      copied.forEach((op, i) => expect(op).not.toBe(block[i]));
      const [textCopy] = copied;
      if (textCopy?.kind !== 'text' || text.kind !== 'text') throw new Error('expected text');
      expect(textCopy.style).not.toBe(text.style);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not move a point that sits at the origin', () => {
    const [scaled] = scaleOps([{ ...text, x: 100, y: 100 }], 3, origin);
    expect(scaled).toMatchObject({ x: 100, y: 100 });
  });

  it('scales a text op’s size and its position both', () => {
    const [scaled] = scaleOps([text], 0.5, origin);
    expect(scaled).toEqual({
      ...text,
      x: 105,
      y: 160,
      style: { ...text.style, size: 5 },
    });
  });

  it('scales a rule’s length, rise and thickness with its position', () => {
    const [scaled] = scaleOps([rule], 2, origin);
    expect(scaled).toEqual({ ...rule, x: 120, y: 300, width: 160, dy: 12, thickness: 2 });
  });

  it('gives a rule with no thickness the engine’s own, scaled, so it does not stay heavy', () => {
    const [scaled] = scaleOps([{ kind: 'rule', x: 100, y: 100, width: 10 }], 0.5, origin);
    expect(scaled).toEqual({ kind: 'rule', x: 100, y: 100, width: 5, thickness: 0.25 });
  });

  it('keeps an image’s proportions', () => {
    const [scaled] = scaleOps([image], 0.37, origin);
    if (scaled?.kind !== 'image') throw new Error('expected an image');
    expect(scaled.width / scaled.height).toBeCloseTo(60 / 90, 12);
    expect(scaled.width).toBeCloseTo(60 * 0.37, 12);
  });

  it('scales every number in a path, and its stroke width', () => {
    const [scaled] = scaleOps([path], 2, origin);
    if (scaled?.kind !== 'path') throw new Error('expected a path');
    const want: PathOp = {
      ...path,
      segments: circle(200, 200, 40),
      stroke: { ...path.stroke, width: 4 },
    };
    expectClose([scaled], [want]);
    expect(scaled.fill).toEqual(path.fill);
    expect(scaled.stroke?.rgb).toEqual(path.stroke?.rgb);
  });

  it('scales a stroke that names no width from the width of 1 PDF starts with', () => {
    const bare: PathOp = { kind: 'path', segments: circle(150, 150, 20), stroke: { grey: 0 } };
    const [scaled] = scaleOps([bare], 2, origin);
    if (scaled?.kind !== 'path') throw new Error('expected a path');
    expect(scaled.stroke?.width).toBe(2);
  });

  it('gives the same result scaling by a then b as scaling once by a times b', () => {
    const twice = scaleOps(scaleOps(block, 1.7, origin), 0.3, origin);
    const once = scaleOps(block, 1.7 * 0.3, origin);
    expectClose(twice, once);
  });

  it('lands a scaled then translated op where the arithmetic says', () => {
    const [moved] = translateOps(scaleOps([text], 2, origin), 15, -40);
    expect(moved).toMatchObject({ x: 100 + 2 * 10 + 15, y: 100 + 2 * 120 - 40 });
  });

  it('translates every kind of op, a path point for point', () => {
    const moved = translateOps(block, 5, 7);
    expectClose(moved, [
      { ...text, x: 115, y: 227 },
      { ...rule, x: 115, y: 207 },
      { ...image, x: 125, y: 107 },
      { ...path, segments: circle(155, 157, 20) },
    ]);
  });

  it('mutates nothing it is given', () => {
    const before = structuredClone(block);
    scaleOps(block, 2.5, origin);
    translateOps(block, 3, 4);
    expect(block).toEqual(before);
  });

  it('refuses a scale of zero, a negative scale and a scale that is not finite', () => {
    expect(() => scaleOps(block, 0, origin)).toThrow(RangeError);
    expect(() => scaleOps(block, -1, origin)).toThrow(RangeError);
    expect(() => scaleOps(block, Number.NaN, origin)).toThrow(/scale/);
    expect(() => translateOps(block, Number.POSITIVE_INFINITY, 0)).toThrow(/dx/);
  });
});

describe('a rectangle, which the engine draws for the practice’s invoice', () => {
  const rect: LayoutOp = {
    kind: 'rect',
    x: 120,
    y: 140,
    width: 60,
    height: 20,
    radius: 4,
    fill: { rgb: [0.9, 0.8, 1] },
    stroke: { grey: 0.5, thickness: 2 },
  };

  it('is scaled about the origin: its corner, its sides, its corner’s radius and its line', () => {
    expect(scaleOps([rect], 0.5, { x: 100, y: 100 })).toEqual([
      {
        kind: 'rect',
        x: 110,
        y: 120,
        width: 30,
        height: 10,
        radius: 2,
        fill: { rgb: [0.9, 0.8, 1] },
        stroke: { grey: 0.5, thickness: 1 },
      },
    ]);
  });

  it('carries the line the engine would have drawn when it names none', () => {
    const [scaled] = scaleOps(
      [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, stroke: { grey: 0 } }],
      0.5,
      { x: 0, y: 0 },
    );
    expect(scaled).toMatchObject({ stroke: { grey: 0, thickness: 0.25 } });
  });

  it('is given no line and no corner it did not have', () => {
    const [scaled] = scaleOps(
      [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { grey: 0.9 } }],
      0.5,
      { x: 0, y: 0 },
    );
    expect(scaled).toEqual({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      fill: { grey: 0.9 },
    });
  });

  it('is moved whole, its lengths untouched', () => {
    expect(translateOps([rect], 10, -5)).toEqual([{ ...rect, x: 130, y: 135 }]);
  });

  it('is copied at a scale of one, and shares nothing with what it was made from', () => {
    const [copy] = scaleOps([rect], 1, { x: 0, y: 0 });
    expect(copy).toEqual(rect);
    expect(copy).not.toBe(rect);
    if (copy?.kind !== 'rect' || rect.kind !== 'rect') throw new Error('not a rectangle');
    expect(copy.fill).not.toBe(rect.fill);
    expect(copy.stroke).not.toBe(rect.stroke);
  });
});

describe('what the review of the rectangle found the tests did not hold', () => {
  const rect: LayoutOp = {
    kind: 'rect',
    x: 120,
    y: 140,
    width: 60,
    height: 20,
    fill: { rgb: [0.9, 0.8, 1] },
    stroke: { rgb: [0.2, 0.4, 0.6] },
  };

  it('scales up and down about the origin’s own height, and keeps a line’s colour', () => {
    // An origin whose two numbers differ, so that one taken for the other shows.
    expect(scaleOps([rect], 0.5, { x: 100, y: 40 })).toEqual([
      {
        kind: 'rect',
        x: 110,
        y: 90,
        width: 30,
        height: 10,
        fill: { rgb: [0.9, 0.8, 1] },
        stroke: { rgb: [0.2, 0.4, 0.6], thickness: 0.25 },
      },
    ]);
  });

  /** Every paint of an op, and every colour triple inside one. */
  function paintsOf(op: LayoutOp): object[] {
    const found: object[] = [];
    const take = (paint: { rgb?: readonly number[] } | undefined): void => {
      if (!paint) return;
      found.push(paint);
      if (paint.rgb) found.push(paint.rgb);
    };
    if (op.kind === 'text') take(op.style);
    if (op.kind === 'rule' && op.rgb) found.push(op.rgb);
    if (op.kind === 'path' || op.kind === 'rect') {
      take(op.fill);
      take(op.stroke);
    }
    return found;
  }

  const coloured: LayoutOp[] = [
    {
      kind: 'text',
      x: 0,
      y: 0,
      text: 'a',
      style: { font: 'regular', size: 10, rgb: [0.1, 0.2, 0.3] },
    },
    { kind: 'rule', x: 0, y: 0, width: 10, rgb: [0.1, 0.2, 0.3] },
    {
      kind: 'path',
      segments: [
        ['M', 0, 0],
        ['L', 10, 10],
      ],
      fill: { rgb: [0.1, 0.2, 0.3] },
      stroke: { rgb: [0.3, 0.2, 0.1], width: 1 },
    },
    rect,
  ];

  it.each([
    ['copied at a scale of one', (ops: LayoutOp[]) => scaleOps(ops, 1, { x: 0, y: 0 })],
    ['scaled', (ops: LayoutOp[]) => scaleOps(ops, 0.5, { x: 0, y: 0 })],
    ['moved', (ops: LayoutOp[]) => translateOps(ops, 3, 4)],
  ])('shares no paint and no colour with what it was made from, when %s', (_name, change) => {
    const made = change(coloured);
    coloured.forEach((op, index) => {
      const result = made[index];
      if (!result) throw new Error('an op is missing');
      const before = paintsOf(op);
      const after = paintsOf(result);
      expect(after).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
      after.forEach((paint, at) => expect(paint, `${op.kind} paint ${at}`).not.toBe(before[at]));
    });
  });
});
