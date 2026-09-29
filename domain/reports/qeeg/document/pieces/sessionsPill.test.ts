import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { PILL } from '../geometry';
import { lineBox } from '../metrics';
import { ACCENT } from '../palette';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import type { PathOp } from '../shapes';
import { styleOf } from '../styles';
import type { Drawing } from '../typeset';
import { sessionsPill } from './sessionsPill';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };
const WIDTH = 480;
const LABEL = '20 sessions';

const PILL_STYLE = styleOf('pill', 'ltr').style;
const LINE = PILL_STYLE.size * PILL_STYLE.lineHeight;
const WORDS = measure(LABEL, 'bold', PILL_STYLE.size, false);
const PILL_WIDTH = WORDS + 2 * PILL.padH + 2 * PILL.edge;
const PILL_HEIGHT = LINE + 2 * PILL.padV + 2 * PILL.edge;

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

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

const outline = (block: Block) => extentOf(paths(block.ops), measure);

describe('sessionsPill', () => {
  for (const [name, drawing, label] of [
    ['English', english, LABEL],
    ['Arabic', arabic, '20 جلسة'],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expectInside(sessionsPill({ label }, WIDTH, drawing), WIDTH);
    });
  }

  it('draws the Arabic outline as the mirror of the English one', () => {
    const en = outline(sessionsPill({ label: LABEL }, WIDTH, english));
    const ar = outline(sessionsPill({ label: LABEL }, WIDTH, arabic));
    expect(ar.left).toBeCloseTo(WIDTH - en.right, 9);
    expect(ar.right).toBeCloseTo(WIDTH - en.left, 9);
    expect(ar.top).toBeCloseTo(en.top, 9);
    expect(ar.bottom).toBeCloseTo(en.bottom, 9);
  });

  it('draws an outline in the accent, as thick as the layout says, round its words', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, english);
    const [edge] = paths(block.ops);
    expect(paths(block.ops)).toHaveLength(1);
    expect(edge?.fill).toBeUndefined();
    expect(edge?.stroke?.width).toBe(PILL.edge);
    expect(edge?.stroke?.rgb).toEqual(ACCENT.rgb);
  });

  it('is as wide as its words and padding, at the start edge, its line inside its box', () => {
    const en = outline(sessionsPill({ label: LABEL }, WIDTH, english));
    expect(en.left).toBeCloseTo(0, 9);
    expect(en.right).toBeCloseTo(PILL_WIDTH, 9);
    expect(en.top).toBeCloseTo(-PILL.above, 9);
    expect(en.bottom).toBeCloseTo(-(PILL.above + PILL_HEIGHT), 9);
    const ar = outline(sessionsPill({ label: LABEL }, WIDTH, arabic));
    expect(ar.right).toBeCloseTo(WIDTH, 9);
    expect(ar.left).toBeCloseTo(WIDTH - PILL_WIDTH, 9);
  });

  it('has round ends: the outline is a stadium, its radius half its height', () => {
    const [edge] = paths(sessionsPill({ label: LABEL }, WIDTH, english).ops);
    const inner = PILL_HEIGHT - PILL.edge;
    const [first] = edge?.segments ?? [];
    expect(first).toEqual([
      'M',
      PILL.edge / 2 + inner / 2,
      expect.closeTo(-PILL.above - PILL_HEIGHT + PILL.edge / 2, 9),
    ]);
  });

  it('centres its words in the pill, in the role for it', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, english);
    const words = extentOf(texts(block.ops), measure);
    expect((words.left + words.right) / 2).toBeCloseTo(PILL_WIDTH / 2, 9);
    for (const op of texts(block.ops)) {
      expect(op.style.size).toBe(PILL_STYLE.size);
      expect(op.style.rgb).toEqual(ACCENT.rgb);
    }
    const first = PILL.above + PILL.edge + PILL.padV;
    expect(block.baseline).toBeCloseTo(first + lineBox(PILL_STYLE, FACE).firstBaseline, 9);
  });

  it('keeps the room above and below as part of the block', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, english);
    expect(block.height).toBeCloseTo(PILL.above + PILL_HEIGHT + PILL.below, 9);
  });

  it('draws its outline before its words', () => {
    const ops = sessionsPill({ label: LABEL }, WIDTH, english).ops;
    expect(ops[0]?.kind).toBe('path');
    expect(ops.slice(1).every((op) => op.kind === 'text')).toBe(true);
  });

  it('wraps a label wider than the page inside a pill as wide as the page', () => {
    for (const drawing of [english, arabic]) {
      for (const label of ['sessions '.repeat(20), 's'.repeat(400)]) {
        const block = sessionsPill({ label }, WIDTH, drawing);
        expectInside(block, WIDTH);
        const edge = outline(block);
        expect(edge.left).toBeCloseTo(0, 9);
        expect(edge.right).toBeCloseTo(WIDTH, 9);
        expect(block.height).toBeGreaterThan(PILL.above + PILL_HEIGHT + PILL.below);
      }
    }
  });

  it('draws nothing, and takes no room, for a label of no words', () => {
    const block = sessionsPill({ label: '  ' }, WIDTH, english);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    expect(() => sessionsPill({ label: LABEL }, Number.NaN, english)).toThrow(
      /sessionsPill needs a finite width/,
    );
    expect(() => sessionsPill({ label: LABEL }, -1, english)).toThrow(
      /sessionsPill needs a width of zero or more/,
    );
    expect(() => sessionsPill({ label: LABEL }, 2 * PILL.padH, english)).toThrow(
      /sessionsPill is left no room for its label by a width of/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ label: LABEL });
    expect(() => sessionsPill(input, WIDTH, deepFreeze({ ...arabic }))).not.toThrow();
  });
});
