import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { ACCENT } from '../palette';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import { heading } from './heading';
import { fixed, typed } from './words';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };
const WIDTH = 300;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

function expectInside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('heading', () => {
  for (const [name, drawing, words] of [
    ['English', english, fixed('Your brain map')],
    ['Arabic', arabic, fixed('خريطة الدماغ')],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      for (const level of ['heading', 'subheading'] as const) {
        expectInside(heading({ words, level }, WIDTH, drawing), WIDTH);
      }
    });
  }

  it('sets a heading and a subheading in the role of its level, in the accent', () => {
    for (const level of ['heading', 'subheading'] as const) {
      const block = heading({ words: fixed('Key findings'), level }, WIDTH, english);
      const { style } = styleOf(level, 'ltr');
      for (const op of texts(block.ops)) {
        expect(op.style.size).toBe(style.size);
        expect(op.style.font).toBe('bold');
        expect(op.style.rgb).toEqual(ACCENT.rgb);
      }
      expect(block.height).toBeCloseTo(style.size * style.lineHeight, 9);
    }
  });

  it('underlines its words from the start edge, in both languages', () => {
    const words = fixed('Key findings');
    const [en] = rules(heading({ words, level: 'heading' }, WIDTH, english).ops);
    const [ar] = rules(heading({ words, level: 'heading' }, WIDTH, arabic).ops);
    expect(en?.x).toBe(0);
    expect(ar ? ar.x + ar.width : Number.NaN).toBeCloseTo(WIDTH, 9);
  });

  it('draws the Arabic underline as the mirror of the English one', () => {
    const words = fixed('Key findings');
    const en = rules(heading({ words, level: 'subheading' }, WIDTH, english).ops);
    const ar = rules(heading({ words, level: 'subheading' }, WIDTH, arabic).ops);
    expect(ar).toHaveLength(en.length);
    en.forEach((op, index) => {
      const e = extentOf([op], measure);
      const a = extentOf([ar[index] as LayoutOp], measure);
      expect(a.left).toBeCloseTo(WIDTH - e.right, 9);
      expect(a.right).toBeCloseTo(WIDTH - e.left, 9);
      expect(a.top).toBeCloseTo(e.top, 9);
      expect(a.bottom).toBeCloseTo(e.bottom, 9);
    });
  });

  it('reads a typed Arabic label in an English report right to left, from the start edge', () => {
    const block = heading({ words: typed('خريطة الدماغ'), level: 'subheading' }, WIDTH, english);
    expect(texts(block.ops).every((op) => op.rtl === true)).toBe(true);
    expect(extentOf(block.ops, measure).left).toBeCloseTo(0, 9);
  });

  it('reads a typed English label in an Arabic report left to right, from the start edge', () => {
    const block = heading({ words: typed('Eyes open'), level: 'subheading' }, WIDTH, arabic);
    expect(texts(block.ops).some((op) => op.rtl === true)).toBe(false);
    expect(extentOf(block.ops, measure).right).toBeCloseTo(WIDTH, 9);
  });

  it('wraps a long title inside its box, and grows', () => {
    const one = heading({ words: fixed('Short'), level: 'heading' }, WIDTH, english);
    const long = heading({ words: fixed('word '.repeat(80)), level: 'heading' }, WIDTH, english);
    const wide = heading({ words: fixed('w'.repeat(400)), level: 'heading' }, WIDTH, english);
    for (const block of [long, wide]) {
      expectInside(block, WIDTH);
      expect(block.height).toBeGreaterThan(one.height);
    }
  });

  it('draws nothing, and takes no room, for a title of no words', () => {
    const block = heading({ words: typed('   '), level: 'heading' }, WIDTH, english);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('refuses a width that is not a number, or is below nothing, by name', () => {
    const words = fixed('Key findings');
    expect(() => heading({ words, level: 'heading' }, Number.NaN, english)).toThrow(
      /heading needs a finite width/,
    );
    expect(() => heading({ words, level: 'heading' }, -1, english)).toThrow(
      /heading needs a width of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ words: typed('Eyes closed'), level: 'heading' as const });
    expect(() => heading(input, WIDTH, deepFreeze({ ...english }))).not.toThrow();
  });
});
