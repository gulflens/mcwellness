/**
 * The headlines at the top of a follow-up's page of what has changed: up to
 * two figures of her own, each over her caption, and the number of sessions
 * completed over what it is and where the number came from
 * (`docs/SPEC/reports-qeeg.md` section 10).
 *
 * **One row, never split.** The tiles are one block, so a page break never
 * falls between them. Each is a third of the row wide and the first stands
 * at the start edge, so one tile, two or three keep the same size and an
 * Arabic row is the English one in a mirror.
 *
 * **Level.** Every tile of the row is as tall as the tallest, as the cards
 * of the dashboard stand level.
 *
 * **What a tile is.** A panel filled with the violet's wash and edged with
 * its pale, as the panel at the head of a report is; inside it the figure
 * with the marker of the way it moved (`figureLine`), the caption under it,
 * and, when there is one, the line that says where the figure came from.
 * What is absent leaves no gap; a row of no tiles draws nothing.
 *
 * Every word is handed in. Whether a figure is hers, and which way it moved,
 * is the builder's to know.
 */

import { beside, blank, boxed, stack } from '../../block';
import type { Block, Box } from '../../block';
import { boxLeft } from '../../frame';
import type { Frame } from '../../frame';
import { CHANGE, MARKER } from '../../geometry';
import { finite } from '../../metrics';
import { PANEL_EDGE, PANEL_FILL } from '../../palette';
import { typeset } from '../../typeset';
import type { Drawing } from '../../typeset';
import type { Words } from '../words';
import { figureLine } from './figureLine';
import type { FigureLineInput } from './figureLine';

export type HeadlineTile = {
  readonly figure: FigureLineInput;
  readonly caption: Words;
  /** Where the figure came from, when the tile says; `null` when it does not. */
  readonly source: string | null;
};

export type HeadlinesInput = { readonly tiles: readonly HeadlineTile[] };

const BOX: Box = {
  padH: CHANGE.tilePadH,
  padV: CHANGE.tilePadV,
  radius: CHANGE.tileRadius,
  fill: PANEL_FILL,
  edge: { ...PANEL_EDGE, width: CHANGE.tileEdge },
};

/** What a tile holds, its parts with the gap between each two that hold something. */
function inside(tile: HeadlineTile, inner: number, drawing: Drawing): Block {
  const parts = [
    figureLine(tile.figure, inner, drawing, { size: 'headline' }),
    typeset('headlineCaption', tile.caption.text, inner, drawing, { typed: tile.caption.typed }),
    tile.source === null ? blank(inner, 0) : typeset('note', tile.source, inner, drawing),
  ].filter((part) => part.height > 0);
  return stack(
    inner,
    parts.flatMap((part, index) => (index === 0 ? [part] : [CHANGE.tileGap, part])),
  );
}

export function headlines(input: HeadlinesInput, width: number, drawing: Drawing): Block {
  finite('headlines', 'width', width);
  if (width < 0) {
    throw new RangeError(`headlines needs a width of zero or more, and was given ${width}.`);
  }
  const count = input.tiles.length;
  if (count > CHANGE.tilesMost) {
    throw new RangeError(
      `headlines needs at most ${CHANGE.tilesMost} tiles, and was given ${count}.`,
    );
  }
  const tileWidth = (width - (CHANGE.tilesMost - 1) * CHANGE.tileGutter) / CHANGE.tilesMost;
  const inner = tileWidth - 2 * CHANGE.tilePadH;
  if (inner - MARKER.headline - MARKER.gutter <= 0) {
    throw new RangeError(`headlines is left no room for a tile by a width of ${width}.`);
  }
  if (count === 0) return blank(width, 0);

  const held = input.tiles.map((tile) => inside(tile, inner, drawing));
  const tallest = Math.max(...held.map((each) => boxed(each, tileWidth, BOX).height));
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  return beside(
    width,
    held.map((each, place) => ({
      block: boxed(each, tileWidth, { ...BOX, height: tallest }),
      left: boxLeft(frame, place * (tileWidth + CHANGE.tileGutter), tileWidth),
    })),
  );
}
