import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { beside, blank, boxed, drawn, extentOf, paragraphBlock, stack } from './block';
import type { Block } from './block';
import type { Measure, ParagraphInput } from './paragraph';
import type { LayoutOp } from './scale';
import { boundsOf } from './shapes';
import type { PathOp } from './shapes';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;

const FACE = { ascent: 1, descent: -0.25 };

function input(text: string, width: number, more: Partial<ParagraphInput> = {}): ParagraphInput {
  return {
    spans: [{ text }],
    style: { size: 10, lineHeight: 1.5, weight: 'regular' },
    width,
    paragraph: 'ltr',
    align: 'start',
    ink: { grey: 0 },
    accent: { grey: 0 },
    faces: { latin: FACE, arabic: FACE },
    ...more,
  };
}

/** A block of one rule across its foot, so a test can see where it was put. */
function marked(width: number, height: number, overhang = 0): Block {
  return {
    width,
    height,
    overhang,
    ops: [{ kind: 'rule', x: 0, y: -height, width }],
  };
}

const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');
const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

describe('blank', () => {
  it('holds room and draws nothing', () => {
    expect(blank(100, 20)).toEqual({ width: 100, height: 20, overhang: 0, ops: [] });
  });

  it('refuses a size that is not a number, or is below nothing, by name', () => {
    expect(() => blank(Number.NaN, 20)).toThrow(/blank needs a finite width/);
    expect(() => blank(100, -1)).toThrow(/blank needs a height of zero or more/);
  });
});

describe('drawn', () => {
  it('puts a block’s top-left corner where it is told, y measured up the page', () => {
    const ops = drawn(marked(100, 20), { left: 48, top: 700 });
    expect(rules(ops)).toEqual([{ kind: 'rule', x: 48, y: 680, width: 100 }]);
  });

  it('leaves the block as it was', () => {
    const block = marked(100, 20);
    drawn(block, { left: 48, top: 700 });
    expect(block.ops).toEqual([{ kind: 'rule', x: 0, y: -20, width: 100 }]);
  });
});

describe('stack', () => {
  it('sets each part under the one before, with the gaps between', () => {
    const block = stack(100, [marked(100, 20), 5, marked(100, 30)]);
    expect(block.height).toBe(55);
    expect(rules(block.ops).map((op) => op.y)).toEqual([-20, -55]);
  });

  it('is as wide as it is told, whatever it holds', () => {
    expect(stack(100, [marked(60, 20)]).width).toBe(100);
  });

  it('adds two gaps that stand together', () => {
    expect(stack(100, [marked(100, 20), 2, 3, marked(100, 10)]).height).toBe(35);
  });

  it('widens a gap that is smaller than what hangs below the part above', () => {
    const block = stack(100, [marked(100, 20, 4), 1, marked(100, 10)]);
    expect(block.height).toBe(34);
    expect(rules(block.ops).map((op) => op.y)).toEqual([-20, -34]);
  });

  it('makes room for what hangs below a part with no gap after it', () => {
    expect(stack(100, [marked(100, 20, 4), marked(100, 10)]).height).toBe(34);
  });

  it('hands on what hangs below its last part, and nothing when a gap comes last', () => {
    expect(stack(100, [marked(100, 20), marked(100, 10, 3)]).overhang).toBe(3);
    expect(stack(100, [marked(100, 10, 3), 5]).overhang).toBe(0);
    expect(stack(100, [marked(100, 10, 3), 2]).overhang).toBe(1);
  });

  it('is nothing when it holds nothing', () => {
    expect(stack(100, [])).toEqual({ width: 100, height: 0, overhang: 0, ops: [] });
  });

  it('refuses a part wider than itself, and a gap below nothing, by name', () => {
    expect(() => stack(100, [marked(101, 20)])).toThrow(/stack holds a part 101 wide in 100/);
    expect(() => stack(100, [marked(100, 20), -1])).toThrow(/stack needs a gap of zero or more/);
    expect(() => stack(100, [Number.NaN])).toThrow(/stack needs a finite gap/);
  });

  it('is never cut', () => {
    expect(stack(100, [marked(100, 20)]).split).toBeUndefined();
  });
});

describe('beside', () => {
  it('sets each cell at its own left, their tops level, and is as tall as the tallest', () => {
    const block = beside(100, [
      { block: marked(40, 20), left: 0 },
      { block: marked(50, 30), left: 50 },
    ]);
    expect(block.height).toBe(30);
    expect(rules(block.ops)).toEqual([
      { kind: 'rule', x: 0, y: -20, width: 40 },
      { kind: 'rule', x: 50, y: -30, width: 50 },
    ]);
  });

  it('lowers a cell that asks for it, as a row set on one baseline does', () => {
    const block = beside(100, [
      { block: marked(40, 20), left: 0, down: 4 },
      { block: marked(50, 20), left: 50 },
    ]);
    expect(block.height).toBe(24);
    expect(rules(block.ops).map((op) => op.y)).toEqual([-24, -20]);
  });

  it('takes its cells in any order: an Arabic row names its last cell first', () => {
    const block = beside(100, [
      { block: marked(40, 20), left: 60 },
      { block: marked(50, 20), left: 0 },
    ]);
    expect(rules(block.ops).map((op) => op.x)).toEqual([60, 0]);
  });

  it('hangs below by as much as the cell that reaches lowest', () => {
    const block = beside(100, [
      { block: marked(40, 30), left: 0 },
      { block: marked(50, 28, 5), left: 50 },
    ]);
    expect(block.height).toBe(30);
    expect(block.overhang).toBe(3);
  });

  it('refuses a cell that leaves the box, by name', () => {
    expect(() => beside(100, [{ block: marked(40, 20), left: 61 }])).toThrow(
      /beside holds a cell from 61 to 101 in a box 100 wide/,
    );
    expect(() => beside(100, [{ block: marked(40, 20), left: -1 }])).toThrow(
      /beside holds a cell from -1 to 39 in a box 100 wide/,
    );
  });

  it('refuses two cells that lie over each other, by name', () => {
    expect(() =>
      beside(100, [
        { block: marked(40, 20), left: 0 },
        { block: marked(40, 20), left: 39 },
      ]),
    ).toThrow(/beside holds two cells that overlap, from 39 to 40/);
  });

  it('lets two cells touch, to within a rounding error', () => {
    const third = 100 / 3;
    expect(() =>
      beside(100, [
        { block: marked(third, 20), left: 0 },
        { block: marked(third, 20), left: third },
        { block: marked(third, 20), left: third * 2 },
      ]),
    ).not.toThrow();
  });
});

describe('boxed', () => {
  const box = {
    padH: 6,
    padV: 4,
    radius: 3,
    fill: { rgb: [0.9, 0.9, 1] as const },
    edge: { grey: 0.78, width: 0.6 },
  };

  it('is its inside and the padding round it', () => {
    const block = boxed(marked(88, 20), 100, box);
    expect(block.width).toBe(100);
    expect(block.height).toBe(28);
    expect(rules(block.ops)).toEqual([{ kind: 'rule', x: 6, y: -24, width: 88 }]);
  });

  it('draws the box first, so what it holds is drawn over it', () => {
    const block = boxed(marked(88, 20), 100, box);
    expect(block.ops[0]?.kind).toBe('path');
    const [panel] = paths(block.ops);
    expect(panel?.fill).toEqual({ rgb: [0.9, 0.9, 1] });
    expect(panel?.stroke).toEqual({ grey: 0.78, width: 0.6 });
  });

  it('keeps the edge inside the box: a line is drawn half to each side of its path', () => {
    const block = boxed(marked(88, 20), 100, box);
    const [panel] = paths(block.ops);
    const bounds = boundsOf(panel?.segments ?? []);
    expect(bounds.left).toBeCloseTo(0.3, 9);
    expect(bounds.right).toBeCloseTo(99.7, 9);
    expect(bounds.top).toBeCloseTo(-0.3, 9);
    expect(bounds.bottom).toBeCloseTo(-27.7, 9);
  });

  it('stands as tall as it is told when that is taller, as a row of cards does', () => {
    const block = boxed(marked(88, 20), 100, { ...box, height: 60 });
    expect(block.height).toBe(60);
    expect(rules(block.ops).map((op) => op.y)).toEqual([-24]);
  });

  it('is never shorter than what it holds', () => {
    expect(boxed(marked(88, 20), 100, { ...box, height: 10 }).height).toBe(28);
  });

  it('draws no edge when it is given none, and no fill when it is given none', () => {
    const { edge, ...noEdge } = box;
    const { fill, ...noFill } = box;
    expect(edge).toBeDefined();
    expect(fill).toBeDefined();
    expect(paths(boxed(marked(88, 20), 100, noEdge).ops)[0]?.stroke).toBeUndefined();
    expect(paths(boxed(marked(88, 20), 100, noFill).ops)[0]?.fill).toBeUndefined();
  });

  it('refuses an inside that does not fit the room the padding leaves, by name', () => {
    expect(() => boxed(marked(89, 20), 100, box)).toThrow(
      /boxed holds an inside 89 wide in the 88 its padding leaves/,
    );
  });
});

describe('paragraphBlock', () => {
  it('is as tall as its lines, drawn from its own top-left corner', () => {
    // Ten characters at five points each fill a line of fifty.
    const block = paragraphBlock(input('aaaa bbbb cccc dddd', 50), measure);
    expect(block.width).toBe(50);
    expect(block.height).toBe(30);
    // A line of 15 holds a face of 12.5, so 1.25 stands above its ascent of 10.
    expect([...new Set(texts(block.ops).map((op) => op.y))]).toEqual([-11.25, -26.25]);
    expect(extentOf(block.ops, measure).left).toBe(0);
  });

  it('says how far an underline hangs below it', () => {
    const block = paragraphBlock(
      input('', 200, {
        spans: [{ text: 'A title', underline: true }],
        style: { size: 10, lineHeight: 1, weight: 'bold' },
      }),
      measure,
    );
    expect(block.overhang).toBeGreaterThan(0);
    expect(block.overhang).toBeLessThan(3);
  });

  it('is cut between lines, each part a block that can be cut again', () => {
    const six = paragraphBlock(
      input('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll', 50),
      measure,
    );
    expect(six.height).toBe(90);
    const cut = six.split?.(50);
    expect(cut).not.toBeNull();
    const [first, second] = cut ?? [];
    expect(first?.height).toBe(45);
    expect(second?.height).toBe(45);
    expect(texts(second?.ops ?? []).map((op) => op.y)[0]).toBe(-11.25);
    const words = (block: Block | undefined) =>
      texts(block?.ops ?? [])
        .map((op) => op.text)
        .join(' ');
    expect(words(first)).toBe('aaaa bbbb cccc dddd eeee ffff');
    expect(words(second)).toBe('gggg hhhh iiii jjjj kkkk llll');
    expect(typeof second?.split).toBe('function');
  });

  it('is not cut when either side would be left with one line', () => {
    const three = paragraphBlock(input('aaaa bbbb cccc dddd eeee ffff', 50), measure);
    expect(three.split?.(30)).toBeNull();
  });

  it('draws an Arabic paragraph from its right edge, inside its own box', () => {
    const block = paragraphBlock(input('مرحبا بكم', 100, { paragraph: 'rtl' }), measure);
    const extent = extentOf(block.ops, measure);
    expect(extent.right).toBe(100);
    expect(extent.left).toBeGreaterThanOrEqual(0);
  });
});

describe('extentOf', () => {
  it('is the smallest box that holds every op, a text op by its measured width', () => {
    const ops: LayoutOp[] = [
      { kind: 'text', x: 10, y: -12, text: 'abcd', style: { font: 'regular', size: 10 } },
      { kind: 'rule', x: 5, y: -20, width: 50 },
      { kind: 'image', image: 'map', x: 0, y: -80, width: 30, height: 40 },
      {
        kind: 'path',
        segments: [['M', 70, -5], ['L', 90, -30], ['Z']],
        fill: { grey: 0 },
      },
    ];
    expect(extentOf(ops, measure)).toEqual({ left: 0, right: 90, top: -5, bottom: -80 });
  });

  it('reads a text op from the edge it is anchored at', () => {
    const style = { font: 'regular' as const, size: 10 };
    const at = (align: 'start' | 'end' | 'centre') =>
      extentOf([{ kind: 'text', x: 50, y: -10, text: 'abcd', style, align }], measure);
    expect([at('start').left, at('start').right]).toEqual([50, 70]);
    expect([at('end').left, at('end').right]).toEqual([30, 50]);
    expect([at('centre').left, at('centre').right]).toEqual([40, 60]);
  });

  it('counts a line’s thickness and a rule’s rise', () => {
    expect(
      extentOf([{ kind: 'rule', x: 0, y: -10, width: 0, dy: 6, thickness: 2 }], measure),
    ).toEqual({ left: -1, right: 1, top: -4, bottom: -10 });
    expect(
      extentOf(
        [
          {
            kind: 'path',
            segments: [
              ['M', 10, -10],
              ['L', 20, -10],
            ],
            stroke: { grey: 0, width: 4 },
          },
        ],
        measure,
      ),
    ).toEqual({ left: 8, right: 22, top: -8, bottom: -12 });
  });

  it('is nothing at all for no ops', () => {
    expect(extentOf([], measure)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});
