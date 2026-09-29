import { describe, expect, it } from 'vitest';
import { INK } from '../palette';
import type { Block } from '../block';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { BAND_ICON } from '../geometry';
import type { Span } from '../paragraph';
import { translateOps } from '../scale';
import type { LayoutOp } from '../scale';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, downThePage, measure, outside, unmirrored } from './checks';
import { bandBlock } from './bandBlock';
import type { BandLines } from './bandBlock';
import { bandIcon } from './bandIcon';

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

const heightOf = (spans: readonly Span[], drawing: Drawing) =>
  typeset('band', spans, WORDS, drawing).height;

/** Where each mark first stands down the page, among what the block draws. */
function placesOf(block: Block, marks: readonly string[]): number[] {
  const down = downThePage(block, measure).map((each) => each.what);
  return marks.map((mark) => down.findIndex((what) => what.includes(mark)));
}

/** Every mark is found, and each stands below the one before. */
function inOrder(places: readonly number[]): void {
  expect(places.every((place) => place >= 0)).toBe(true);
  expect([...places].sort((one, other) => one - other)).toEqual(places);
}

describe('bandBlock', () => {
  it('keeps every part inside its box, in either language', () => {
    expect(outside(bandBlock({ band: 'alpha', lines: LINES }, WIDTH, ENGLISH), measure)).toEqual(
      [],
    );
    expect(
      outside(bandBlock({ band: 'alpha', lines: ARABIC_LINES }, WIDTH, ARABIC), measure),
    ).toEqual([]);
  });

  it('draws the Arabic block as the mirror of the English one, its words too', () => {
    for (const lines of [LINES, [LONG, LONG, LONG] as const]) {
      const en = bandBlock({ band: 'theta', lines }, WIDTH, ENGLISH);
      const ar = bandBlock({ band: 'theta', lines }, WIDTH, ARABIC);
      // Nothing stands under the words, so up and down are held as well.
      expect(unmirrored(en, ar, measure, { upAndDown: true })).toEqual([]);
    }
  });

  it('sets the icon at the start edge, lowered to sit level with the first line', () => {
    const icon = bandIcon({ band: 'beta' }, BAND_ICON.size, ENGLISH).ops;
    const en = bandBlock({ band: 'beta', lines: LINES }, WIDTH, ENGLISH);
    expect(shapes(en.ops)).toEqual(translateOps(icon, 0, -BAND_ICON.top));
    const ar = bandBlock({ band: 'beta', lines: ARABIC_LINES }, WIDTH, ARABIC);
    expect(shapes(ar.ops)).toEqual(translateOps(icon, WIDTH - BAND_ICON.size, -BAND_ICON.top));
  });

  it('draws the icon before the words', () => {
    const block = bandBlock({ band: 'delta', lines: LINES }, WIDTH, ENGLISH);
    expect(block.ops.slice(0, 3).every((op) => op.kind === 'path')).toBe(true);
    expect(block.ops.slice(3).every((op) => op.kind === 'text')).toBe(true);
  });

  it('sets the words the gutter away from the icon, in what is left', () => {
    const en = extentOf(
      texts(bandBlock({ band: 'alpha', lines: LINES }, WIDTH, ENGLISH).ops),
      measure,
    );
    expect(en.left).toBeCloseTo(BAND_ICON.size + BAND_ICON.gutter, 9);
    const ar = extentOf(
      texts(bandBlock({ band: 'alpha', lines: ARABIC_LINES }, WIDTH, ARABIC).ops),
      measure,
    );
    expect(ar.right).toBeCloseTo(WIDTH - BAND_ICON.size - BAND_ICON.gutter, 9);
  });

  it('draws the three lines in the role of a band, heavier where it is told', () => {
    const block = bandBlock({ band: 'alpha', lines: LINES }, WIDTH, ENGLISH);
    const ops = texts(block.ops);
    expect(ops.every((op) => op.style.size === 10.2)).toBe(true);
    expect(ops.find((op) => op.text.includes('Linked'))?.style.font).toBe('bold');
    expect(ops.find((op) => op.text.includes('focus'))?.style.font).toBe('regular');
  });

  it('keeps its gaps between the first line and the second, and the second and the third', () => {
    const lines: BandLines = [LONG, LONG, LONG];
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = bandBlock({ band: 'alpha', lines }, WIDTH, drawing);
      const each = heightOf(LONG, drawing);
      expect(block.height).toBeCloseTo(3 * each + BAND_ICON.lineGap + BAND_ICON.findingGap, 9);
    }
  });

  it('is as tall as the taller of the icon and the words', () => {
    const short: BandLines = [[{ text: 'Alpha' }], [], []];
    const block = bandBlock({ band: 'alpha', lines: short }, WIDTH, ENGLISH);
    expect(block.height).toBeCloseTo(BAND_ICON.top + BAND_ICON.size, 9);
  });

  it('leaves out a line with no words, and the gap before it', () => {
    const full = bandBlock({ band: 'alpha', lines: [LONG, LONG, LONG] }, WIDTH, ENGLISH);
    const noSecond = bandBlock(
      { band: 'alpha', lines: [LONG, [{ text: '  ' }], LONG] },
      WIDTH,
      ENGLISH,
    );
    expect(full.height - noSecond.height).toBeCloseTo(
      heightOf(LONG, ENGLISH) + BAND_ICON.lineGap,
      9,
    );
    const noThird = bandBlock({ band: 'alpha', lines: [LONG, LONG, []] }, WIDTH, ENGLISH);
    expect(full.height - noThird.height).toBeCloseTo(
      heightOf(LONG, ENGLISH) + BAND_ICON.findingGap,
      9,
    );
    const noFirst = bandBlock({ band: 'alpha', lines: [[], LONG, LONG] }, WIDTH, ENGLISH);
    expect(full.height - noFirst.height).toBeCloseTo(
      heightOf(LONG, ENGLISH) + BAND_ICON.lineGap,
      9,
    );
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide: BandLines = [[{ text: 'a'.repeat(80) }], [{ text: 'b '.repeat(200) }], []];
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = bandBlock({ band: 'alpha', lines: wide }, WIDTH, drawing);
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(BAND_ICON.top + BAND_ICON.size);
    }
  });

  it('refuses a width that is no width, or leaves no room for the words, by name', () => {
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, Number.NaN, ENGLISH)).toThrow(
      /bandBlock needs a finite width/,
    );
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, -1, ENGLISH)).toThrow(
      /bandBlock needs a width of zero or more/,
    );
    expect(() => bandBlock({ band: 'alpha', lines: LINES }, BAND_ICON.size, ENGLISH)).toThrow(
      /bandBlock is left no room for its words/,
    );
  });

  it('refuses a list of lines that is not three long, by name', () => {
    // A tuple of three cut short when the program runs, as a slip would.
    const two: BandLines = Object.assign([LONG, LONG, LONG] as const, { length: 2 });
    expect(() => bandBlock({ band: 'alpha', lines: two }, WIDTH, ENGLISH)).toThrow(
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
    expect(() => bandBlock(input, WIDTH, ENGLISH)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('sets its three lines in ink, one under another, in either language', () => {
    const lines: BandLines = [
      [{ text: 'First line' }],
      [{ text: 'Second line' }],
      [{ text: 'Third line' }],
    ];
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = bandBlock({ band: 'alpha', lines }, WIDTH, drawing);
      inOrder(placesOf(block, ['First line', 'Second line', 'Third line']));
      for (const op of texts(block.ops)) expect(op.style.grey).toBe(INK.grey);
    }
  });
});
