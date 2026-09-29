import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { BAND_ICON } from '../geometry';
import type { Measure, Span } from '../paragraph';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { bandBlock } from './bandBlock';
import type { BandLines } from './bandBlock';
import { bandIcon } from './bandIcon';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };

const WIDTH = 300;
const WORDS = WIDTH - BAND_ICON.size - BAND_ICON.gutter;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const shapes = (ops: readonly LayoutOp[]) => ops.filter((op) => op.kind !== 'text');

const LINES: BandLines = [
  [
    { text: 'Alpha (8-12 Hz) ', bold: true },
    { text: 'Linked with: ', bold: true },
    { text: 'a calm and settled state of rest' },
  ],
  [{ text: 'May shape: ', bold: true }, { text: 'focus and ease' }],
  [{ text: 'The reading was even across the regions picked.' }],
];
const ARABIC_LINES: BandLines = [
  [{ text: 'ألفا (8-12 هرتز) ', bold: true }, { text: 'حالة من الهدوء' }],
  [{ text: 'قد يؤثر في: ', bold: true }, { text: 'التركيز' }],
  [{ text: 'كانت القراءة متوازنة.' }],
];

/** A line long enough to wrap in the column beside the icon. */
const LONG: readonly Span[] = [{ text: 'steady '.repeat(20).trim() }];

function inside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

const heightOf = (spans: readonly Span[], drawing: Drawing) =>
  typeset('band', spans, WORDS, drawing).height;

describe('bandBlock', () => {
  it('keeps every part inside its box, in either language', () => {
    inside(bandBlock({ band: 'alpha', lines: LINES }, WIDTH, english), WIDTH);
    inside(bandBlock({ band: 'alpha', lines: ARABIC_LINES }, WIDTH, arabic), WIDTH);
  });

  it('draws the Arabic block as the mirror of the English one', () => {
    const en = shapes(bandBlock({ band: 'theta', lines: LINES }, WIDTH, english).ops);
    const ar = shapes(bandBlock({ band: 'theta', lines: ARABIC_LINES }, WIDTH, arabic).ops);
    expect(ar).toHaveLength(en.length);
    en.forEach((op, index) => {
      const a = extentOf([op], measure);
      const b = extentOf(ar[index] ? [ar[index]] : [], measure);
      expect(b.left).toBeCloseTo(WIDTH - a.right, 9);
      expect(b.right).toBeCloseTo(WIDTH - a.left, 9);
      expect(b.top).toBeCloseTo(a.top, 9);
      expect(b.bottom).toBeCloseTo(a.bottom, 9);
    });
  });

  it('sets the icon at the start edge, lowered to sit level with the first line', () => {
    const icon = bandIcon({ band: 'beta' }, BAND_ICON.size, english).ops;
    const en = bandBlock({ band: 'beta', lines: LINES }, WIDTH, english);
    expect(shapes(en.ops)).toEqual(translateOps(icon, 0, -BAND_ICON.top));
    const ar = bandBlock({ band: 'beta', lines: ARABIC_LINES }, WIDTH, arabic);
    expect(shapes(ar.ops)).toEqual(translateOps(icon, WIDTH - BAND_ICON.size, -BAND_ICON.top));
  });

  it('draws the icon before the words', () => {
    const block = bandBlock({ band: 'delta', lines: LINES }, WIDTH, english);
    expect(block.ops.slice(0, 3).every((op) => op.kind === 'path')).toBe(true);
    expect(block.ops.slice(3).every((op) => op.kind === 'text')).toBe(true);
  });

  it('sets the words the gutter away from the icon, in what is left', () => {
    const en = extentOf(
      texts(bandBlock({ band: 'alpha', lines: LINES }, WIDTH, english).ops),
      measure,
    );
    expect(en.left).toBeCloseTo(BAND_ICON.size + BAND_ICON.gutter, 9);
    const ar = extentOf(
      texts(bandBlock({ band: 'alpha', lines: ARABIC_LINES }, WIDTH, arabic).ops),
      measure,
    );
    expect(ar.right).toBeCloseTo(WIDTH - BAND_ICON.size - BAND_ICON.gutter, 9);
  });

  it('draws the three lines in the role of a band, heavier where it is told', () => {
    const block = bandBlock({ band: 'alpha', lines: LINES }, WIDTH, english);
    const ops = texts(block.ops);
    expect(ops.every((op) => op.style.size === 10.2)).toBe(true);
    expect(ops.find((op) => op.text.includes('Linked'))?.style.font).toBe('bold');
    expect(ops.find((op) => op.text.includes('focus'))?.style.font).toBe('regular');
  });

  it('keeps its gaps between the first line and the second, and the second and the third', () => {
    const lines: BandLines = [LONG, LONG, LONG];
    for (const drawing of [english, arabic]) {
      const block = bandBlock({ band: 'alpha', lines }, WIDTH, drawing);
      const each = heightOf(LONG, drawing);
      expect(block.height).toBeCloseTo(3 * each + BAND_ICON.lineGap + BAND_ICON.findingGap, 9);
    }
  });

  it('is as tall as the taller of the icon and the words', () => {
    const short: BandLines = [[{ text: 'Alpha' }], [], []];
    const block = bandBlock({ band: 'alpha', lines: short }, WIDTH, english);
    expect(block.height).toBeCloseTo(BAND_ICON.top + BAND_ICON.size, 9);
  });

  it('leaves out a line with no words, and the gap before it', () => {
    const full = bandBlock({ band: 'alpha', lines: [LONG, LONG, LONG] }, WIDTH, english);
    const noSecond = bandBlock(
      { band: 'alpha', lines: [LONG, [{ text: '  ' }], LONG] },
      WIDTH,
      english,
    );
    expect(full.height - noSecond.height).toBeCloseTo(
      heightOf(LONG, english) + BAND_ICON.lineGap,
      9,
    );
    const noThird = bandBlock({ band: 'alpha', lines: [LONG, LONG, []] }, WIDTH, english);
    expect(full.height - noThird.height).toBeCloseTo(
      heightOf(LONG, english) + BAND_ICON.findingGap,
      9,
    );
    const noFirst = bandBlock({ band: 'alpha', lines: [[], LONG, LONG] }, WIDTH, english);
    expect(full.height - noFirst.height).toBeCloseTo(
      heightOf(LONG, english) + BAND_ICON.lineGap,
      9,
    );
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide: BandLines = [[{ text: 'a'.repeat(80) }], [{ text: 'b '.repeat(200) }], []];
    for (const drawing of [english, arabic]) {
      const block = bandBlock({ band: 'alpha', lines: wide }, WIDTH, drawing);
      inside(block, WIDTH);
      expect(block.height).toBeGreaterThan(BAND_ICON.top + BAND_ICON.size);
    }
  });

  it('refuses a width that is no width, or leaves no room for the words, by name', () => {
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, Number.NaN, english)).toThrow(
      /bandBlock needs a finite width/,
    );
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, -1, english)).toThrow(
      /bandBlock needs a width of zero or more/,
    );
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, BAND_ICON.size, english)).toThrow(
      /bandBlock is left no room for its words/,
    );
  });

  it('refuses a list of lines that is not three long, by name', () => {
    // A tuple of three cut short when the program runs, as a slip would.
    const two: BandLines = Object.assign([LONG, LONG, LONG] as const, { length: 2 });
    expect(() => bandBlock({ band: 'alpha', lines: two }, WIDTH, english)).toThrow(
      /bandBlock needs three lines, and was given 2/,
    );
  });

  it('changes nothing it was given', () => {
    const line = (spans: readonly Span[]) =>
      Object.freeze(spans.map((span) => Object.freeze({ ...span })));
    const [first, second, third] = LINES;
    const lines: BandLines = Object.freeze([line(first), line(second), line(third)] as const);
    const input = Object.freeze({ band: 'alpha' as const, lines });
    const before = JSON.stringify(input);
    expect(() => bandBlock(input, WIDTH, english)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
