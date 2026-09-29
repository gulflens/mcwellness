import { describe, expect, it } from 'vitest';
import { extentOf } from '../../block';
import { CHANGE } from '../../geometry';
import { INK, PANEL_EDGE, PANEL_FILL } from '../../palette';
import type { LayoutOp } from '../../scale';
import type { PathOp } from '../../shapes';
import { typeset } from '../../typeset';
import { ARABIC, ENGLISH, downThePage, measure, outside, unmirrored, wordsOf } from '../checks';
import { fixed, typed } from '../words';
import { figureLine } from './figureLine';
import { headlines } from './headlines';
import type { HeadlineTile } from './headlines';

/**
 * docs/SPEC/reports-qeeg.md section 10, "Headlines": up to two figures of
 * her own, each with her caption, and the number of sessions completed with
 * where that number came from. A headline left empty is not printed, and the
 * row of them never splits.
 */

const WIDTH = 480;
const TILE = (WIDTH - 2 * CHANGE.tileGutter) / 3;
const INNER = TILE - 2 * CHANGE.tilePadH;

const OVERALL: HeadlineTile = {
  figure: { words: fixed('about 40% lower'), points: 'down' },
  caption: typed('Overall slow activity'),
  source: null,
};
const SECOND: HeadlineTile = {
  figure: { words: fixed('about 15% higher'), points: 'up' },
  caption: typed('Calm focus'),
  source: null,
};
const SESSIONS: HeadlineTile = {
  figure: { words: fixed('20'), points: null },
  caption: fixed('Neurofeedback sessions completed'),
  source: 'Counted from visits',
};

const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');
const panels = (ops: readonly LayoutOp[]) => paths(ops).filter((op) => op.fill === PANEL_FILL);
const markers = (ops: readonly LayoutOp[]) => paths(ops).filter((op) => op.fill === INK);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('headlines', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      for (const tiles of [[OVERALL], [OVERALL, SECOND], [OVERALL, SECOND, SESSIONS], [SESSIONS]]) {
        expect(outside(headlines({ tiles }, WIDTH, drawing), measure)).toEqual([]);
      }
    });
  }

  it('draws the Arabic row as the mirror of the English one, tiles, markers and words', () => {
    // Words are held line by line, by baseline; an Arabic line is taller, so
    // tiles of unlike parts are held one by one, and alike ones side by side.
    for (const tiles of [[OVERALL], [SESSIONS], [OVERALL, SECOND]]) {
      const en = headlines({ tiles }, WIDTH, ENGLISH);
      const ar = headlines({ tiles }, WIDTH, ARABIC);
      expect(unmirrored(en, ar, measure)).toEqual([]);
    }
  });

  it('sets each tile a third of the row wide, the first at the start edge', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      const tiles = panels(headlines({ tiles: [OVERALL, SECOND] }, WIDTH, drawing).ops);
      expect(tiles).toHaveLength(2);
      const [first, second] = tiles.map((op) => extentOf([op], measure));
      // A line takes no room: the edge is drawn wholly inside the tile.
      expect((first?.right ?? 0) - (first?.left ?? 0)).toBeCloseTo(TILE, 9);
      if (drawing === ENGLISH) {
        expect(first?.left).toBeCloseTo(0, 9);
        expect(second?.left).toBeCloseTo(TILE + CHANGE.tileGutter, 9);
      } else {
        expect(first?.right).toBeCloseTo(WIDTH, 9);
        expect(second?.right).toBeCloseTo(WIDTH - TILE - CHANGE.tileGutter, 9);
      }
    }
  });

  it('fills each tile with the violet’s wash and edges it with its pale', () => {
    for (const panel of panels(headlines({ tiles: [OVERALL, SESSIONS] }, WIDTH, ENGLISH).ops)) {
      expect(panel.stroke).toMatchObject({ ...PANEL_EDGE, width: CHANGE.tileEdge });
    }
  });

  it('stands every tile of the row level, as tall as the tallest', () => {
    const block = headlines({ tiles: [OVERALL, SESSIONS] }, WIDTH, ENGLISH);
    const [one, other] = panels(block.ops).map((op) => extentOf([op], measure));
    expect(one?.bottom).toBeCloseTo(other?.bottom ?? 0, 9);
    expect(block.height).toBeCloseTo((other?.top ?? 0) - (other?.bottom ?? 0), 9);
  });

  it('puts the figure over the caption, and where it came from under both', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      const order = downThePage(headlines({ tiles: [SESSIONS] }, WIDTH, drawing), measure)
        .filter((each) => each.what !== 'path')
        .map((each) => each.what);
      expect(order[0]).toBe('20');
      expect(order.at(-1)).toContain('visits');
    }
  });

  it('marks a figure that moved, and draws no marker for the sessions completed', () => {
    expect(
      markers(headlines({ tiles: [OVERALL, SECOND, SESSIONS] }, WIDTH, ENGLISH).ops),
    ).toHaveLength(2);
    expect(markers(headlines({ tiles: [SESSIONS] }, WIDTH, ENGLISH).ops)).toEqual([]);
  });

  it('draws each panel before what stands on it', () => {
    const { ops } = headlines({ tiles: [OVERALL] }, WIDTH, ENGLISH);
    expect(ops[0]?.kind === 'path' && ops[0].fill).toBe(PANEL_FILL);
    expect(ops.slice(1).some((op) => op.kind === 'path' && op.fill === PANEL_FILL)).toBe(false);
  });

  it('adds to a tile exactly the gap and the line of where its figure came from', () => {
    const without = headlines({ tiles: [{ ...SESSIONS, source: null }] }, WIDTH, ENGLISH);
    const withSource = headlines({ tiles: [SESSIONS] }, WIDTH, ENGLISH);
    const source = typeset('note', SESSIONS.source ?? '', INNER, ENGLISH);
    expect(withSource.height - without.height).toBeCloseTo(CHANGE.tileGap + source.height, 9);
  });

  it('adds exactly the tile’s padding round its figure and its caption', () => {
    const tile = headlines({ tiles: [OVERALL] }, WIDTH, ENGLISH);
    const figure = figureLine(OVERALL.figure, INNER, ENGLISH, { size: 'headline' });
    const caption = typeset('headlineCaption', OVERALL.caption.text, INNER, ENGLISH, {
      typed: true,
    });
    expect(tile.height).toBeCloseTo(
      figure.height + CHANGE.tileGap + caption.height + 2 * CHANGE.tilePadV,
      9,
    );
  });

  it('draws nothing, and takes no room, with no headline', () => {
    const block = headlines({ tiles: [] }, WIDTH, ENGLISH);
    expect(block.ops).toEqual([]);
    expect(block.height).toBe(0);
  });

  it('reads her caption its own way, and the report’s caption the report’s', () => {
    const sentence = 'Steady progress.';
    const own = headlines(
      { tiles: [{ ...SESSIONS, caption: typed(sentence), source: null }] },
      WIDTH,
      ARABIC,
    );
    const report = headlines(
      { tiles: [{ ...SESSIONS, caption: fixed(sentence), source: null }] },
      WIDTH,
      ARABIC,
    );
    expect(wordsOf(own, measure)).toContain('Steady progress.');
    expect(wordsOf(report, measure)).toContain('. Steady progress');
  });

  it('wraps a long caption inside its tile, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const text of ['Overall slow activity '.repeat(8), 'w'.repeat(400)]) {
        const long = headlines({ tiles: [{ ...OVERALL, caption: typed(text) }] }, WIDTH, drawing);
        expect(outside(long, measure)).toEqual([]);
        expect(long.height).toBeGreaterThan(headlines({ tiles: [OVERALL] }, WIDTH, drawing).height);
      }
    }
  });

  it('refuses more tiles than a row holds, and a width it cannot stand in, by name', () => {
    expect(() =>
      headlines({ tiles: [OVERALL, SECOND, SESSIONS, OVERALL] }, WIDTH, ENGLISH),
    ).toThrow(/^headlines needs at most 3 tiles, and was given 4/);
    expect(() => headlines({ tiles: [OVERALL] }, Number.NaN, ENGLISH)).toThrow(
      /^headlines needs a finite width/,
    );
    expect(() => headlines({ tiles: [OVERALL] }, -1, ENGLISH)).toThrow(
      /^headlines needs a width of zero or more/,
    );
    expect(() => headlines({ tiles: [OVERALL] }, 60, ENGLISH)).toThrow(
      /^headlines is left no room for a tile by a width of 60/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ tiles: [OVERALL, SECOND, SESSIONS] });
    expect(() => headlines(input, WIDTH, ARABIC)).not.toThrow();
  });
});
