/**
 * The dashboard: six cards, three to a row, each row as tall as its tallest
 * card and every card in it drawn at that height, so a row stands level.
 *
 * **Why each card is set twice.** A row's height is known only once each of
 * its cards has been set at its own height; each is then set again at the
 * row's, with its advice lowered to the foot. Twelve cards in all, and
 * nothing else: the rule that scales the dashboard to fit its page calls
 * this again and again at different widths, so it stays quick, and gives the
 * same block for the same width every time.
 *
 * **Reading order.** The first card is at the start of the first row: the
 * left of an English page and the right of an Arabic one. `columns` gives
 * the frames in reading order, so the loop is the same in both.
 */

import { beside, stack } from '../block';
import type { Block } from '../block';
import { columns } from '../frame';
import type { Frame } from '../frame';
import { GRID, cardWidth } from '../geometry';
import { finite } from '../metrics';
import type { Drawing } from '../typeset';
import { dashboardCard } from './dashboardCard';
import type { CardInput } from './dashboardCard';

export type GridInput = { readonly cards: readonly CardInput[] };

const COUNT = GRID.columns * GRID.rows;

export function dashboardGrid(input: GridInput, width: number, drawing: Drawing): Block {
  finite('dashboardGrid', 'width', width);
  if (width < 0) {
    throw new RangeError(`dashboardGrid needs a width of zero or more, and was given ${width}.`);
  }
  if (input.cards.length !== COUNT) {
    throw new RangeError(
      `dashboardGrid needs ${COUNT} cards, and was given ${input.cards.length}.`,
    );
  }
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const across = columns(frame, GRID.columns, GRID.columnGap);
  const each = cardWidth(width);

  const rows = Array.from({ length: GRID.rows }, (_, row) => {
    const cards = input.cards.slice(row * GRID.columns, (row + 1) * GRID.columns);
    const height = Math.max(...cards.map((card) => dashboardCard(card, each, drawing).height));
    return beside(
      width,
      cards.map((card, column) => ({
        block: dashboardCard(card, each, drawing, { height }),
        left: across[column]?.left ?? 0,
      })),
    );
  });
  return stack(
    width,
    rows.flatMap((row, index) => (index === 0 ? [row] : [GRID.rowGap, row])),
  );
}
