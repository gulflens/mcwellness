import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { PILL } from '../geometry';
import { lineBox } from '../metrics';
import { ACCENT } from '../palette';
import type { LayoutOp } from '../scale';
import type { PathOp } from '../shapes';
import { styleOf } from '../styles';
import { ARABIC, ENGLISH, FACE, measure, outside, unmirrored } from './checks';
import { sessionsPill } from './sessionsPill';

const WIDTH = 480;
const LABEL = '20 sessions';

const PILL_STYLE = styleOf('pill', 'ltr').style;
const LINE = PILL_STYLE.size * PILL_STYLE.lineHeight;
const WORDS = measure(LABEL, 'bold', PILL_STYLE.size, false);
/** A line takes no room: the pill is its words and its padding, the outline inside. */
const PILL_WIDTH = WORDS + 2 * PILL.padH;
const PILL_HEIGHT = LINE + 2 * PILL.padV;

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

const outline = (block: Block) => extentOf(paths(block.ops), measure);

describe('sessionsPill', () => {
  for (const [name, drawing, label] of [
    ['English', ENGLISH, LABEL],
    ['Arabic', ARABIC, '20 جلسة'],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(sessionsPill({ label }, WIDTH, drawing), measure)).toEqual([]);
    });
  }

  it('draws the Arabic pill as the mirror of the English one, words and outline', () => {
    for (const label of [LABEL, 'sessions '.repeat(20)]) {
      const en = sessionsPill({ label }, WIDTH, ENGLISH);
      const ar = sessionsPill({ label }, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('draws an outline in the accent, as thick as the layout says, round its words', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, ENGLISH);
    const [edge] = paths(block.ops);
    expect(paths(block.ops)).toHaveLength(1);
    expect(edge?.fill).toBeUndefined();
    expect(edge?.stroke?.width).toBe(PILL.edge);
    expect(edge?.stroke?.rgb).toEqual(ACCENT.rgb);
  });

  it('is as wide as its words and padding, at the start edge, its line inside its box', () => {
    const en = outline(sessionsPill({ label: LABEL }, WIDTH, ENGLISH));
    expect(en.left).toBeCloseTo(0, 9);
    expect(en.right).toBeCloseTo(PILL_WIDTH, 9);
    expect(en.top).toBeCloseTo(-PILL.above, 9);
    expect(en.bottom).toBeCloseTo(-(PILL.above + PILL_HEIGHT), 9);
    const ar = outline(sessionsPill({ label: LABEL }, WIDTH, ARABIC));
    expect(ar.right).toBeCloseTo(WIDTH, 9);
    expect(ar.left).toBeCloseTo(WIDTH - PILL_WIDTH, 9);
  });

  it('has round ends: the outline is a stadium, its radius half its height', () => {
    const [edge] = paths(sessionsPill({ label: LABEL }, WIDTH, ENGLISH).ops);
    const inner = PILL_HEIGHT - PILL.edge;
    const [first] = edge?.segments ?? [];
    expect(first).toEqual([
      'M',
      PILL.edge / 2 + inner / 2,
      expect.closeTo(-PILL.above - PILL_HEIGHT + PILL.edge / 2, 9),
    ]);
  });

  it('centres its words in the pill, in the role for it', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, ENGLISH);
    const words = extentOf(texts(block.ops), measure);
    expect((words.left + words.right) / 2).toBeCloseTo(PILL_WIDTH / 2, 9);
    for (const op of texts(block.ops)) {
      expect(op.style.size).toBe(PILL_STYLE.size);
      expect(op.style.rgb).toEqual(ACCENT.rgb);
    }
    const first = PILL.above + PILL.padV;
    expect(block.baseline).toBeCloseTo(first + lineBox(PILL_STYLE, FACE).firstBaseline, 9);
  });

  it('centres each line of a label that wraps in the pill, in both languages', () => {
    const label = `${'sessions '.repeat(14)}more`;
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = sessionsPill({ label }, WIDTH, drawing);
      const baselines = [...new Set(texts(block.ops).map((op) => op.y))];
      expect(baselines.length).toBeGreaterThan(1);
      const middle =
        (extentOf(paths(block.ops), measure).left + extentOf(paths(block.ops), measure).right) / 2;
      const widths = baselines.map((y) => {
        const line = extentOf(
          texts(block.ops).filter((op) => op.y === y),
          measure,
        );
        expect((line.left + line.right) / 2).toBeCloseTo(middle, 9);
        return line.right - line.left;
      });
      // The last line is the shorter, so a line set from the start would show.
      expect(widths.at(-1)).toBeLessThan(widths[0] ?? 0);
    }
  });

  it('keeps the room above and below as part of the block', () => {
    const block = sessionsPill({ label: LABEL }, WIDTH, ENGLISH);
    expect(block.height).toBeCloseTo(PILL.above + PILL_HEIGHT + PILL.below, 9);
  });

  it('draws its outline before its words', () => {
    const ops = sessionsPill({ label: LABEL }, WIDTH, ENGLISH).ops;
    expect(ops[0]?.kind).toBe('path');
    expect(ops.slice(1).every((op) => op.kind === 'text')).toBe(true);
  });

  it('wraps a label wider than the page inside a pill as wide as the page', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const label of ['sessions '.repeat(20), 's'.repeat(400)]) {
        const block = sessionsPill({ label }, WIDTH, drawing);
        expect(outside(block, measure)).toEqual([]);
        const edge = outline(block);
        expect(edge.left).toBeCloseTo(0, 9);
        expect(edge.right).toBeCloseTo(WIDTH, 9);
        expect(block.height).toBeGreaterThan(PILL.above + PILL_HEIGHT + PILL.below);
      }
    }
  });

  it('draws nothing, and takes no room, for a label of no words', () => {
    const block = sessionsPill({ label: '  ' }, WIDTH, ENGLISH);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('refuses a width that is not a number, is below nothing, or leaves no room, by name', () => {
    expect(() => sessionsPill({ label: LABEL }, Number.NaN, ENGLISH)).toThrow(
      /sessionsPill needs a finite width/,
    );
    expect(() => sessionsPill({ label: LABEL }, -1, ENGLISH)).toThrow(
      /sessionsPill needs a width of zero or more/,
    );
    expect(() => sessionsPill({ label: LABEL }, 2 * PILL.padH, ENGLISH)).toThrow(
      /sessionsPill is left no room for its label by a width of/,
    );
  });

  it('refuses a width it cannot stand in under its own name, before it calls anything', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2 * PILL.padH]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        for (const label of [LABEL, '  ']) {
          expect(() => sessionsPill({ label }, width, drawing)).toThrow(
            /^sessionsPill (needs|is left)/,
          );
        }
      }
    }
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ label: LABEL });
    expect(() => sessionsPill(input, WIDTH, ARABIC)).not.toThrow();
  });
});
