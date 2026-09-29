import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { ACCENT } from '../palette';
import type { LayoutOp } from '../scale';
import { styleOf } from '../styles';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { heading } from './heading';
import { fixed, typed } from './words';

const WIDTH = 300;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const rules = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'rule' }> => op.kind === 'rule');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('heading', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      for (const level of ['heading', 'subheading'] as const) {
        for (const words of [fixed('Your brain map'), fixed('خريطة الدماغ')]) {
          expect(outside(heading({ words, level }, WIDTH, drawing), measure)).toEqual([]);
        }
      }
    });
  }

  it('draws the Arabic heading as the mirror of the English one, words and underline', () => {
    for (const level of ['heading', 'subheading'] as const) {
      for (const words of [
        fixed('Key findings'),
        typed('Key findings'),
        fixed('word '.repeat(30)),
      ]) {
        const en = heading({ words, level }, WIDTH, ENGLISH);
        const ar = heading({ words, level }, WIDTH, ARABIC);
        expect(unmirrored(en, ar, measure)).toEqual([]);
      }
    }
  });

  it('sets a heading and a subheading in the role of its level, in the accent', () => {
    for (const level of ['heading', 'subheading'] as const) {
      const block = heading({ words: fixed('Key findings'), level }, WIDTH, ENGLISH);
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
    const [en] = rules(heading({ words, level: 'heading' }, WIDTH, ENGLISH).ops);
    const [ar] = rules(heading({ words, level: 'heading' }, WIDTH, ARABIC).ops);
    expect(en?.x).toBe(0);
    expect(ar ? ar.x + ar.width : Number.NaN).toBeCloseTo(WIDTH, 9);
  });

  it('reads a typed Arabic label in an English report right to left, from the start edge', () => {
    const block = heading({ words: typed('خريطة الدماغ'), level: 'subheading' }, WIDTH, ENGLISH);
    expect(texts(block.ops).every((op) => op.rtl === true)).toBe(true);
    expect(extentOf(block.ops, measure).left).toBeCloseTo(0, 9);
  });

  it('reads a typed English label in an Arabic report left to right, from the start edge', () => {
    const block = heading({ words: typed('Eyes open'), level: 'subheading' }, WIDTH, ARABIC);
    expect(texts(block.ops).some((op) => op.rtl === true)).toBe(false);
    expect(extentOf(block.ops, measure).right).toBeCloseTo(WIDTH, 9);
  });

  it('wraps a long title inside its box, and grows', () => {
    const one = heading({ words: fixed('Short'), level: 'heading' }, WIDTH, ENGLISH);
    const long = heading({ words: fixed('word '.repeat(80)), level: 'heading' }, WIDTH, ENGLISH);
    const wide = heading({ words: fixed('w'.repeat(400)), level: 'heading' }, WIDTH, ENGLISH);
    for (const block of [long, wide]) {
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(one.height);
    }
  });

  it('draws nothing, and takes no room, for a title of no words', () => {
    const block = heading({ words: typed('   '), level: 'heading' }, WIDTH, ENGLISH);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('refuses a width that is not a number, or is below nothing, by name', () => {
    const words = fixed('Key findings');
    expect(() => heading({ words, level: 'heading' }, Number.NaN, ENGLISH)).toThrow(
      /heading needs a finite width/,
    );
    expect(() => heading({ words, level: 'heading' }, -1, ENGLISH)).toThrow(
      /heading needs a width of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ words: typed('Eyes closed'), level: 'heading' as const });
    expect(() => heading(input, WIDTH, ENGLISH)).not.toThrow();
  });
});
