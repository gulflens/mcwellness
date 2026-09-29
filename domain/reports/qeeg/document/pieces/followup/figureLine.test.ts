import { describe, expect, it } from 'vitest';
import { MARKER } from '../../geometry';
import { INK } from '../../palette';
import type { LayoutOp } from '../../scale';
import type { PathOp } from '../../shapes';
import { styleOf } from '../../styles';
import { ARABIC, ENGLISH, downThePage, measure, outside, unmirrored, wordsOf } from '../checks';
import { fixed, typed } from '../words';
import { figureLine, FIGURE_SIZES } from './figureLine';
import type { FigureLineInput } from './figureLine';

/**
 * docs/SPEC/reports-qeeg.md section 10, point 7: a figure that went down is
 * marked by a triangle pointing down, in ink; one that went up, by one
 * pointing up; one that held, by none. Direction is a shape and never a colour.
 */

const WIDTH = 200;
const FALL: FigureLineInput = { words: fixed('about 25 to 30% lower'), points: 'down' };
const RISE: FigureLineInput = { words: fixed('about 15% higher'), points: 'up' };
const HELD: FigureLineInput = { words: fixed('No appreciable change'), points: null };

const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');
const texts = (ops: readonly LayoutOp[]) => ops.filter((op) => op.kind === 'text');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('figureLine', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, at every size, in ${name}`, () => {
      for (const size of FIGURE_SIZES) {
        for (const input of [FALL, RISE, HELD]) {
          expect(outside(figureLine(input, WIDTH, drawing, { size }), measure)).toEqual([]);
        }
      }
    });
  }

  it('draws the Arabic line as the mirror of the English one, marker and words', () => {
    for (const size of FIGURE_SIZES) {
      for (const input of [FALL, RISE, HELD]) {
        const en = figureLine(input, WIDTH, ENGLISH, { size });
        const ar = figureLine(input, WIDTH, ARABIC, { size });
        expect(unmirrored(en, ar, measure)).toEqual([]);
      }
    }
  });

  it('marks a fall with a triangle pointing down, and a rise with one pointing up', () => {
    const tip = (input: FigureLineInput) => {
      const [marker] = paths(figureLine(input, WIDTH, ENGLISH, { size: 'cell' }).ops);
      const [first] = marker?.segments ?? [];
      const [, second, third] = marker?.segments ?? [];
      // The apex is the first point; a triangle pointing down has it below its base.
      return first?.[0] === 'M' && second?.[0] === 'L' && third?.[0] === 'L'
        ? Math.sign(first[2] - second[2])
        : 0;
    };
    expect(tip(FALL)).toBe(-1);
    expect(tip(RISE)).toBe(1);
  });

  it('draws the marker as a filled shape in the ink, and never as a letter', () => {
    for (const input of [FALL, RISE]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        const block = figureLine(input, WIDTH, drawing, { size: 'headline' });
        const found = paths(block.ops);
        expect(found).toHaveLength(1);
        expect(found[0]?.fill).toEqual(INK);
        expect(found[0]?.stroke).toBeUndefined();
        expect(found[0]?.segments).toHaveLength(4);
        expect(wordsOf(block, measure).join(' ')).not.toMatch(/[▲▼△▽↑↓]/);
      }
    }
  });

  it('draws no marker for a figure that held, and sets its words from the start edge', () => {
    const block = figureLine(HELD, WIDTH, ENGLISH, { size: 'cell' });
    expect(paths(block.ops)).toEqual([]);
    const [first] = texts(block.ops);
    expect(first?.kind === 'text' && first.x).toBe(0);
  });

  it('stands the marker at the start, the gutter before the words, its base on their baseline', () => {
    for (const size of FIGURE_SIZES) {
      const side = MARKER[size];
      const block = figureLine(FALL, WIDTH, ENGLISH, { size });
      const [marker] = paths(block.ops);
      const segments = marker?.segments ?? [];
      const xs = segments.flatMap((s) => (s[0] === 'Z' ? [] : [s[1]]));
      const ys = segments.flatMap((s) => (s[0] === 'Z' ? [] : [s[2]]));
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(side, 9);
      expect(Math.min(...ys)).toBeCloseTo(-(block.baseline ?? 0), 9);
      expect(Math.max(...ys)).toBeCloseTo(-(block.baseline ?? 0) + side, 9);
      const [first] = texts(block.ops);
      expect(first?.kind === 'text' && first.x).toBeCloseTo(side + MARKER.gutter, 9);
    }
  });

  it('sets each size in its own role', () => {
    const role = { headline: 'headline', cell: 'body', card: 'cardSummary' } as const;
    for (const size of FIGURE_SIZES) {
      const [first] = texts(figureLine(FALL, WIDTH, ENGLISH, { size }).ops);
      expect(first?.kind === 'text' && first.style.size).toBe(
        styleOf(role[size], 'ltr').style.size,
      );
    }
  });

  it('draws the marker before the words', () => {
    const { ops } = figureLine(RISE, WIDTH, ARABIC, { size: 'cell' });
    expect(ops[0]?.kind).toBe('path');
    expect(ops.slice(1).every((op) => op.kind === 'text')).toBe(true);
    const order = downThePage(figureLine(RISE, WIDTH, ENGLISH, { size: 'cell' }), measure);
    expect(order.map((each) => each.what)).toContain('about 15% higher');
  });

  it('is as tall with its marker as without it: the marker takes no line of its own', () => {
    const marked = figureLine(FALL, WIDTH, ENGLISH, { size: 'cell' });
    const plain = figureLine({ ...FALL, points: null }, WIDTH, ENGLISH, { size: 'cell' });
    expect(marked.height).toBe(plain.height);
  });

  it('draws nothing, and takes no room, for words of nothing, marker and all', () => {
    const block = figureLine({ words: fixed('  '), points: 'down' }, WIDTH, ENGLISH, {
      size: 'cell',
    });
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('reads typed words their own way, and fixed words the report’s', () => {
    const sentence = 'Steady progress.';
    const own = figureLine({ words: typed(sentence), points: null }, WIDTH, ARABIC, {
      size: 'cell',
    });
    const report = figureLine({ words: fixed(sentence), points: null }, WIDTH, ARABIC, {
      size: 'cell',
    });
    expect(wordsOf(own, measure)).toEqual(['Steady progress.']);
    expect(wordsOf(report, measure)).toEqual(['. Steady progress']);
  });

  it('wraps words wider than its room, inside its box, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const text of ['lower '.repeat(40), 'w'.repeat(400)]) {
        const long = figureLine({ words: fixed(text), points: 'down' }, WIDTH, drawing, {
          size: 'cell',
        });
        expect(outside(long, measure)).toEqual([]);
        expect(long.height).toBeGreaterThan(
          figureLine(FALL, WIDTH, drawing, { size: 'cell' }).height,
        );
      }
    }
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    expect(() => figureLine(FALL, Number.NaN, ENGLISH, { size: 'cell' })).toThrow(
      /^figureLine needs a finite width/,
    );
    expect(() => figureLine(FALL, -1, ENGLISH, { size: 'cell' })).toThrow(
      /^figureLine needs a width of zero or more/,
    );
    expect(() => figureLine(FALL, MARKER.cell + MARKER.gutter, ENGLISH, { size: 'cell' })).toThrow(
      /^figureLine is left no room for its words by a width of/,
    );
    expect(() => figureLine(HELD, 0, ENGLISH, { size: 'cell' })).toThrow(
      /^figureLine is left no room for its words by a width of/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ words: fixed('about 40% lower'), points: 'down' as const });
    expect(() =>
      figureLine(input, WIDTH, ARABIC, deepFreeze({ size: 'card' as const })),
    ).not.toThrow();
  });
});
