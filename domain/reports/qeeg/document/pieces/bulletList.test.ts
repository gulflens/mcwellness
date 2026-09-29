import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { BULLETS, columnWidth } from '../geometry';
import { ACCENT, MUTED } from '../palette';
import type { LayoutOp } from '../scale';
import type { PathOp } from '../shapes';
import { styleOf } from '../styles';
import { bulletList } from './bulletList';
import { ARABIC, ENGLISH, measure, outside, unmirrored, wordsOf } from './checks';
import { fixed, typed } from './words';
import type { Words } from './words';

const WIDTH = 480;
const EMPTY = 'None chosen.';

const BOX = BULLETS.diamond * Math.SQRT2;
const BODY = styleOf('body', 'ltr').style;
const LINE = BODY.size * BODY.lineHeight;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => fixed(`Item ${index + 1}`));

const list = (count: number, columns: 'auto' | 'two' = 'auto', drawing = ENGLISH) =>
  bulletList({ items: items(count), columns, empty: EMPTY }, WIDTH, drawing);

const extents = (block: Block) => paths(block.ops).map((op) => extentOf([op], measure));

describe('bulletList', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      for (const count of [0, 1, 6, 7, 12]) {
        for (const columns of ['auto', 'two'] as const) {
          expect(outside(list(count, columns, drawing), measure)).toEqual([]);
        }
      }
    });
  }

  it('draws the Arabic list as the mirror of the English one, words and diamonds', () => {
    for (const count of [0, 1, 5, 7, 9]) {
      for (const columns of ['auto', 'two'] as const) {
        const en = list(count, columns, ENGLISH);
        const ar = list(count, columns, ARABIC);
        expect(unmirrored(en, ar, measure, { upAndDown: true })).toEqual([]);
      }
    }
    const input = {
      items: [typed('Steady progress.'), fixed('word '.repeat(40))],
      columns: 'auto' as const,
      empty: EMPTY,
    };
    const en = bulletList(input, WIDTH, ENGLISH);
    const ar = bulletList(input, WIDTH, ARABIC);
    expect(unmirrored(en, ar, measure)).toEqual([]);
  });

  it('sets a diamond in the accent at the start edge, its words indented', () => {
    const block = list(1);
    const [marker] = paths(block.ops);
    expect(marker?.fill).toEqual(ACCENT);
    const box = extents(block)[0];
    expect(box?.left).toBeCloseTo(BULLETS.diamondInset, 9);
    expect(box?.right).toBeCloseTo(BULLETS.diamondInset + BOX, 9);
    expect(box?.top).toBeCloseTo(-BULLETS.diamondTop, 9);
    expect(box?.bottom).toBeCloseTo(-BULLETS.diamondTop - BOX, 9);
    expect(extentOf(texts(block.ops), measure).left).toBeCloseTo(BULLETS.indent, 9);
  });

  it('sets the diamond and the words at the right of an Arabic page', () => {
    const block = list(1, 'auto', ARABIC);
    const box = extents(block)[0];
    expect(box?.right).toBeCloseTo(WIDTH - BULLETS.diamondInset, 9);
    expect(extentOf(texts(block.ops), measure).right).toBeCloseTo(WIDTH - BULLETS.indent, 9);
  });

  it('keeps a row gap between rows and none after the last', () => {
    for (const count of [1, 2, 6]) {
      expect(list(count).height).toBeCloseTo(count * LINE + (count - 1) * BULLETS.rowGap, 9);
    }
    const tops = extents(list(3)).map((e) => e.top);
    expect(tops[1]).toBeCloseTo(-(LINE + BULLETS.rowGap + BULLETS.diamondTop), 9);
    expect(tops[2]).toBeCloseTo(-(2 * (LINE + BULLETS.rowGap) + BULLETS.diamondTop), 9);
  });

  it('sets up to the number the layout names in one column, and more in two', () => {
    const one = extents(list(BULLETS.columnsAbove));
    expect(new Set(one.map((e) => e.left.toFixed(6))).size).toBe(1);
    const two = extents(list(BULLETS.columnsAbove + 1));
    const second = WIDTH - columnWidth(WIDTH);
    expect(two.map((e) => e.left)).toEqual([
      ...Array.from({ length: 4 }, () => expect.closeTo(BULLETS.diamondInset, 9)),
      ...Array.from({ length: 3 }, () => expect.closeTo(second + BULLETS.diamondInset, 9)),
    ]);
  });

  it('balances two columns, the first taking the odd one, the first at the start', () => {
    const block = list(9, 'auto', ARABIC);
    const firstRight = WIDTH - BULLETS.diamondInset;
    const secondRight = columnWidth(WIDTH) - BULLETS.diamondInset;
    expect(extents(block).map((e) => e.right)).toEqual([
      ...Array.from({ length: 5 }, () => expect.closeTo(firstRight, 9)),
      ...Array.from({ length: 4 }, () => expect.closeTo(secondRight, 9)),
    ]);
    expect(block.height).toBeCloseTo(5 * LINE + 4 * BULLETS.rowGap, 9);
  });

  it('sets a list asked for in two columns in two, even with one item', () => {
    const long = fixed('word '.repeat(30));
    const block = bulletList({ items: [long], columns: 'two', empty: EMPTY }, WIDTH, ENGLISH);
    const extent = extentOf(texts(block.ops), measure);
    expect(extent.right).toBeLessThanOrEqual(columnWidth(WIDTH) + 1e-9);
    const wide = bulletList({ items: [long], columns: 'auto', empty: EMPTY }, WIDTH, ENGLISH);
    expect(block.height).toBeGreaterThan(wide.height);
  });

  it('draws each diamond before the words beside it', () => {
    const ops = list(2).ops;
    const kinds = ops.map((op) => op.kind);
    expect(kinds[0]).toBe('path');
    expect(kinds.indexOf('path', 1)).toBeGreaterThan(kinds.indexOf('text'));
  });

  it('sets the words for an empty list in the role for it, with no diamond', () => {
    const block = bulletList({ items: [], columns: 'auto', empty: EMPTY }, WIDTH, ENGLISH);
    expect(paths(block.ops)).toEqual([]);
    expect(
      texts(block.ops)
        .map((op) => op.text)
        .join(' '),
    ).toBe(EMPTY);
    expect(texts(block.ops)[0]?.style.grey).toBe(MUTED.grey);
    const empty = styleOf('empty', 'ltr').style;
    expect(block.height).toBeCloseTo(empty.size * empty.lineHeight, 9);
  });

  it('leaves out an item that is empty once trimmed, and leaves no gap for it', () => {
    const block = bulletList(
      { items: [fixed('One'), typed('   '), fixed('Two')], columns: 'auto', empty: EMPTY },
      WIDTH,
      ENGLISH,
    );
    expect(paths(block.ops)).toHaveLength(2);
    expect(block.height).toBeCloseTo(list(2).height, 9);
    const none = bulletList({ items: [typed(' ')], columns: 'auto', empty: EMPTY }, WIDTH, ENGLISH);
    expect(
      texts(none.ops)
        .map((op) => op.text)
        .join(' '),
    ).toBe(EMPTY);
  });

  it('reads a typed English item in an Arabic list left to right, from the start edge', () => {
    const block = bulletList(
      { items: [typed('Morning walk')], columns: 'auto', empty: EMPTY },
      WIDTH,
      ARABIC,
    );
    expect(texts(block.ops).some((op) => op.rtl === true)).toBe(false);
    expect(extentOf(texts(block.ops), measure).right).toBeCloseTo(WIDTH - BULLETS.indent, 9);
  });

  it('reads a typed item the way its letters do in an Arabic report, and a fixed one the report’s way', () => {
    const block = (item: Words) =>
      bulletList({ items: [item], columns: 'auto', empty: EMPTY }, WIDTH, ARABIC);
    expect(wordsOf(block(typed('Steady progress.')), measure)).toEqual(['Steady progress.']);
    expect(wordsOf(block(fixed('Steady progress.')), measure)).toEqual(['. Steady progress']);
  });

  it('wraps a long item inside its box, and grows', () => {
    for (const text of ['word '.repeat(90), 'w'.repeat(400)]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        const block = bulletList(
          { items: [typed(text), fixed('Short')], columns: 'auto', empty: EMPTY },
          WIDTH,
          drawing,
        );
        expect(outside(block, measure)).toEqual([]);
        expect(block.height).toBeGreaterThan(list(2).height);
      }
    }
  });

  it('is one block that is never cut', () => {
    expect(list(3).split).toBeUndefined();
    expect(list(9).split).toBeUndefined();
    expect(list(1).split).toBeUndefined();
    const empty = bulletList(
      { items: [], columns: 'auto', empty: 'word '.repeat(200) },
      WIDTH,
      ENGLISH,
    );
    expect(empty.split).toBeUndefined();
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    const input = { items: items(2), columns: 'auto' as const, empty: EMPTY };
    expect(() => bulletList(input, Number.NaN, ENGLISH)).toThrow(/bulletList needs a finite width/);
    expect(() => bulletList(input, -1, ENGLISH)).toThrow(
      /bulletList needs a width of zero or more/,
    );
    expect(() => bulletList(input, BULLETS.indent, ENGLISH)).toThrow(
      /bulletList is left no room for its words by a width of/,
    );
    expect(() => bulletList({ ...input, columns: 'two' }, BULLETS.gutter, ENGLISH)).toThrow(
      /bulletList is left no room for its words by a width of/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({
      items: [fixed('One'), typed('Two'), ...items(7)],
      columns: 'auto' as const,
      empty: EMPTY,
    });
    expect(() => bulletList(input, WIDTH, ARABIC)).not.toThrow();
  });
});
