import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { BODY_WIDTH, CARD, GRID, cardWidth } from '../geometry';
import { PANEL_FILL } from '../palette';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { dashboardCard } from './dashboardCard';
import type { CardInput } from './dashboardCard';
import { dashboardGrid } from './dashboardGrid';
import { typed } from './words';

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

describe('dashboardGrid', () => {
  it('keeps every card inside its box, in either language', () => {
    expect(outside(dashboardGrid({ cards: UNEVEN }, WIDTH, ENGLISH), measure)).toEqual([]);
    expect(outside(dashboardGrid({ cards: UNEVEN }, WIDTH, ARABIC), measure)).toEqual([]);
  });

  it('draws the Arabic grid as the mirror of the English one, its words too', () => {
    // Scores of 10 fill their rings, so no arc runs one way round only.
    const cards = UNEVEN.map((each) => ({ ...each, score: 10, tier: 'high' as const }));
    const en = dashboardGrid({ cards }, WIDTH, ENGLISH);
    const ar = dashboardGrid({ cards }, WIDTH, ARABIC);
    expect(unmirrored(en, ar, measure)).toEqual([]);
  });

  it('sets the cards in rows of three, each a card wide with the gap between', () => {
    const lefts = panels(dashboardGrid({ cards: SIX }, WIDTH, ENGLISH).ops).map(
      (panel) => boundsOf(panel.segments).left,
    );
    const step = CARD_WIDTH + GRID.columnGap;
    const edge = lefts[0] ?? 0;
    expect(lefts.map((left) => left - edge)).toEqual(
      [0, step, 2 * step, 0, step, 2 * step].map((each) => expect.closeTo(each, 9)),
    );
  });

  it('puts the first card at the start of the first row: the right of an Arabic page', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
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
    const block = dashboardGrid({ cards: UNEVEN }, WIDTH, ENGLISH);
    const heights = UNEVEN.map((each) => dashboardCard(each, CARD_WIDTH, ENGLISH).height);
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
    const shortCard = dashboardCard(card(0), CARD_WIDTH, ENGLISH, { height: first });
    expect(panels(block.ops)[0]).toEqual(panels(shortCard.ops)[0]);
  });

  it('gives the same block for the same width, and a taller grid for a narrower width', () => {
    const once = dashboardGrid({ cards: UNEVEN }, WIDTH, ENGLISH);
    expect(dashboardGrid({ cards: UNEVEN }, WIDTH, ENGLISH)).toEqual(once);
    expect(dashboardGrid({ cards: UNEVEN }, WIDTH * 0.8, ENGLISH).height).toBeGreaterThan(
      once.height,
    );
  });

  it('draws a word wider than its column, and a line of 400 characters, inside its box', () => {
    const wide = SIX.map((each, index) =>
      index === 4 ? { ...each, title: 'a'.repeat(60), summary: 'b '.repeat(200) } : each,
    );
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = dashboardGrid({ cards: wide }, WIDTH, drawing);
      expect(outside(block, measure)).toEqual([]);
      expect(block.height).toBeGreaterThan(dashboardGrid({ cards: SIX }, WIDTH, drawing).height);
    }
  });

  it('refuses any number of cards but six, by name', () => {
    expect(() => dashboardGrid({ cards: SIX.slice(0, 5) }, WIDTH, ENGLISH)).toThrow(
      /dashboardGrid needs 6 cards, and was given 5/,
    );
    expect(() => dashboardGrid({ cards: [...SIX, card(6)] }, WIDTH, ENGLISH)).toThrow(
      /dashboardGrid needs 6 cards, and was given 7/,
    );
  });

  it('refuses a width that is no width, by name', () => {
    expect(() => dashboardGrid({ cards: SIX }, Number.NaN, ENGLISH)).toThrow(
      /dashboardGrid needs a finite width/,
    );
    expect(() => dashboardGrid({ cards: SIX }, -1, ENGLISH)).toThrow(
      /dashboardGrid needs a width of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const cards = Object.freeze(SIX.map((each) => Object.freeze({ ...each })));
    const input = Object.freeze({ cards });
    const before = JSON.stringify(input);
    expect(() => dashboardGrid(input, WIDTH, ENGLISH)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
