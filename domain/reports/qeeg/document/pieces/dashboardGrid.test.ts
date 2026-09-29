import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import type { Block } from '../block';
import { BODY_WIDTH, CARD, GRID, cardWidth } from '../geometry';
import { PANEL_FILL } from '../palette';
import type { Measure } from '../paragraph';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import type { Drawing } from '../typeset';
import { dashboardCard } from './dashboardCard';
import type { CardInput } from './dashboardCard';
import { dashboardGrid } from './dashboardGrid';
import { typed } from './words';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };

const WIDTH = BODY_WIDTH;
const CARD_WIDTH = cardWidth(WIDTH);

const texts = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
/** The panels of the cards, in the order they are drawn. */
const panels = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is PathOp => op.kind === 'path' && op.fill === PANEL_FILL);

function card(index: number, summary = 'Focus held steady for short stretches.'): CardInput {
  return {
    score: index,
    tier: 'middle',
    outOf: '/10',
    unset: '-',
    category: `Card ${index}`,
    title: 'Attention',
    summary,
    evidence: { label: 'Recording evidence', words: typed('Frontal theta was raised.') },
    meaning: { label: 'What this may mean', items: ['Drifting in long tasks'] },
    advice: [{ text: 'Advice: ', bold: true }, { text: 'short daily training blocks.' }],
  };
}
const SIX = [0, 1, 2, 3, 4, 5].map((index) => card(index));
/** The second card's summary runs long, so the first row is as tall as it. */
const UNEVEN = SIX.map((each, index) =>
  index === 1 ? card(1, 'A longer summary that runs on over several lines. '.repeat(3)) : each,
);

function inside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

describe('dashboardGrid', () => {
  it('keeps every card inside its box, in either language', () => {
    inside(dashboardGrid({ cards: UNEVEN }, WIDTH, english), WIDTH);
    inside(dashboardGrid({ cards: UNEVEN }, WIDTH, arabic), WIDTH);
  });

  it('draws the Arabic grid as the mirror of the English one', () => {
    const en = panels(dashboardGrid({ cards: UNEVEN }, WIDTH, english).ops);
    const ar = panels(dashboardGrid({ cards: UNEVEN }, WIDTH, arabic).ops);
    expect(ar).toHaveLength(en.length);
    en.forEach((op, index) => {
      const a = extentOf([op], measure);
      const b = extentOf(ar[index] ? [ar[index]] : [], measure);
      expect(b.left).toBeCloseTo(WIDTH - a.right, 9);
      expect(b.right).toBeCloseTo(WIDTH - a.left, 9);
    });
  });

  it('sets the cards in rows of three, each a card wide with the gap between', () => {
    const lefts = panels(dashboardGrid({ cards: SIX }, WIDTH, english).ops).map(
      (panel) => boundsOf(panel.segments).left,
    );
    const step = CARD_WIDTH + GRID.columnGap;
    const edge = lefts[0] ?? 0;
    expect(lefts.map((left) => left - edge)).toEqual(
      [0, step, 2 * step, 0, step, 2 * step].map((each) => expect.closeTo(each, 9)),
    );
  });

  it('puts the first card at the start of the first row: the right of an Arabic page', () => {
    for (const drawing of [english, arabic]) {
      const ops = texts(dashboardGrid({ cards: SIX }, WIDTH, drawing).ops);
      const first = ops.find((op) => op.text === 'Card 0');
      const second = ops.find((op) => op.text === 'Card 1');
      if (drawing.direction === 'ltr') {
        expect(first?.x ?? 0).toBeLessThan(CARD_WIDTH);
        expect(first?.x ?? 0).toBeLessThan(second?.x ?? 0);
      } else {
        expect(first?.x ?? 0).toBeGreaterThan(WIDTH - CARD_WIDTH);
        expect(first?.x ?? 0).toBeGreaterThan(second?.x ?? 0);
      }
    }
  });

  it('makes each row as tall as its tallest card, every card in it drawn at that height', () => {
    const block = dashboardGrid({ cards: UNEVEN }, WIDTH, english);
    const heights = UNEVEN.map((each) => dashboardCard(each, CARD_WIDTH, english).height);
    const first = Math.max(...heights.slice(0, GRID.columns));
    const second = Math.max(...heights.slice(GRID.columns));
    expect(first).toBeGreaterThan(second);
    expect(block.height).toBeCloseTo(first + GRID.rowGap + second, 9);
    panels(block.ops).forEach((panel, index) => {
      const bounds = boundsOf(panel.segments);
      const row = index < GRID.columns ? first : second;
      const top = index < GRID.columns ? 0 : -(first + GRID.rowGap);
      // A panel's edge is drawn half its width in from the card's box.
      expect(bounds.top).toBeCloseTo(top - CARD.edge / 2, 9);
      expect(bounds.bottom).toBeCloseTo(top - row + CARD.edge / 2, 9);
    });
    const shortCard = dashboardCard(card(0), CARD_WIDTH, english, { height: first });
    expect(panels(block.ops)[0]).toEqual(panels(shortCard.ops)[0]);
  });

  it('gives the same block for the same width, and a taller grid for a narrower width', () => {
    const once = dashboardGrid({ cards: UNEVEN }, WIDTH, english);
    expect(dashboardGrid({ cards: UNEVEN }, WIDTH, english)).toEqual(once);
    expect(dashboardGrid({ cards: UNEVEN }, WIDTH * 0.8, english).height).toBeGreaterThan(
      once.height,
    );
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide = SIX.map((each, index) =>
      index === 4 ? { ...each, title: 'a'.repeat(60), summary: 'b '.repeat(200) } : each,
    );
    for (const drawing of [english, arabic]) {
      const block = dashboardGrid({ cards: wide }, WIDTH, drawing);
      inside(block, WIDTH);
      expect(block.height).toBeGreaterThan(dashboardGrid({ cards: SIX }, WIDTH, drawing).height);
    }
  });

  it('refuses any number of cards but six, by name', () => {
    expect(() => dashboardGrid({ cards: SIX.slice(0, 5) }, WIDTH, english)).toThrow(
      /dashboardGrid needs 6 cards, and was given 5/,
    );
    expect(() => dashboardGrid({ cards: [...SIX, card(6)] }, WIDTH, english)).toThrow(
      /dashboardGrid needs 6 cards, and was given 7/,
    );
  });

  it('refuses a width that is no width, by name', () => {
    expect(() => dashboardGrid({ cards: SIX }, Number.NaN, english)).toThrow(
      /dashboardGrid needs a finite width/,
    );
    expect(() => dashboardGrid({ cards: SIX }, -1, english)).toThrow(
      /dashboardGrid needs a width of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const cards = Object.freeze(SIX.map((each) => Object.freeze({ ...each })));
    const input = Object.freeze({ cards });
    const before = JSON.stringify(input);
    expect(() => dashboardGrid(input, WIDTH, english)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
