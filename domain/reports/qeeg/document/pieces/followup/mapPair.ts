/**
 * A pair of brain maps on a follow-up's page of what has changed: the
 * earlier recording's map beside the later one's, each under the words for
 * which recording it is and its date (`docs/SPEC/reports-qeeg.md`
 * section 10, "Before and after").
 *
 * **Earlier at the start, later at the end**, in two equal columns with
 * `CHANGE.pairGutter` between; so an Arabic page reads the pair from its
 * right as an English one reads it from its left, and the pair is one block,
 * which a page break never splits.
 *
 * **How large.** The height a map may take is handed in: whoever builds the
 * page shares the room it has between the pairs on it (`planFollowUp`). Each
 * map is drawn as large as its column and that height allow, keeping its
 * shape and never more than two and a half times its own size
 * (`placeImage`), and centred across its column. The two stand level under
 * the taller of the two labels.
 *
 * **A map not recorded** keeps its room, and the words for it stand in the
 * middle of it: a pair with one side missing is still a pair, and its other
 * map does not move.
 *
 * Every word is handed in. No figure is read from a picture here or
 * anywhere; a picture is a name the engine looks up, and its size.
 */

import { beside, stack } from '../../block';
import type { Block, Cell } from '../../block';
import { boxLeft } from '../../frame';
import type { Frame } from '../../frame';
import { CHANGE } from '../../geometry';
import { placeImage } from '../../mapPlacement';
import { finite } from '../../metrics';
import { typeset } from '../../typeset';
import type { Drawing } from '../../typeset';

export type PairSide = {
  /** Which recording, with its eyes: "Initial recording, eyes closed". */
  readonly label: string;
  /** The recording's day, as the report writes one; `null` when it has none yet. */
  readonly date: string | null;
  /** The picture the engine looks up, and its size; `null` when it was not recorded. */
  readonly map: {
    readonly image: string;
    readonly pixels: { readonly width: number; readonly height: number };
  } | null;
  /** The words printed in place of a map that was not recorded. */
  readonly missing: string;
};

export type MapPairInput = { readonly earlier: PairSide; readonly later: PairSide };

export type MapPairOptions = {
  /** The height each map may take. */
  readonly mapHeight: number;
};

function checked(input: MapPairInput, width: number, options: MapPairOptions): number {
  finite('mapPair', 'width', width);
  if (width < 0) {
    throw new RangeError(`mapPair needs a width of zero or more, and was given ${width}.`);
  }
  const column = (width - CHANGE.pairGutter) / 2;
  if (column <= 0) {
    throw new RangeError(`mapPair is left no room for a map by a width of ${width}.`);
  }
  finite('mapPair', 'map height', options.mapHeight);
  if (options.mapHeight <= 0) {
    throw new RangeError(
      `mapPair needs a map height above nothing, and was given ${options.mapHeight}.`,
    );
  }
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  for (const side of [input.earlier, input.later]) {
    if (side.map === null) continue;
    const { pixels } = side.map;
    if (!whole(pixels.width) || !whole(pixels.height)) {
      throw new RangeError(
        `mapPair needs pixels that are whole numbers above nothing, and was given ${String(pixels.width)} by ${String(pixels.height)}.`,
      );
    }
  }
  return column;
}

/** The words over a map: its label, then its date. */
function headOf(side: PairSide, column: number, drawing: Drawing): Block {
  const label = typeset('pairLabel', side.label, column, drawing);
  return side.date === null
    ? stack(column, [label])
    : stack(column, [label, typeset('note', side.date, column, drawing)]);
}

/** The map, or the words for one not recorded, in a room `height` tall. */
function mapOf(side: PairSide, column: number, height: number, drawing: Drawing): Block {
  if (side.map === null) {
    const words = typeset('empty', side.missing, column, drawing, { align: 'centre' });
    const lowered = Math.max(0, (height - words.height) / 2);
    return stack(column, [lowered, words, Math.max(0, height - lowered - words.height)]);
  }
  const placed = placeImage(side.map.pixels, { maxWidth: column, maxHeight: height });
  return {
    width: column,
    height,
    overhang: 0,
    baseline: null,
    ops: [
      {
        kind: 'image',
        image: side.map.image,
        x: (column - placed.width) / 2,
        y: -placed.height,
        width: placed.width,
        height: placed.height,
      },
    ],
  };
}

export function mapPair(
  input: MapPairInput,
  width: number,
  drawing: Drawing,
  options: MapPairOptions,
): Block {
  const column = checked(input, width, options);
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  const sides = [input.earlier, input.later];
  const heads = sides.map((side) => headOf(side, column, drawing));
  const headHeight = Math.max(...heads.map((head) => head.height + head.overhang));
  // Each side is one column: its words, then room down to the level of the
  // taller head, then its map, so the two maps stand level.
  const cells: Cell[] = sides.map((side, place) => {
    const head = heads[place] ?? stack(column, []);
    return {
      block: stack(column, [
        head,
        headHeight - head.height + CHANGE.pairLabelGap,
        mapOf(side, column, options.mapHeight, drawing),
      ]),
      left: boxLeft(frame, place * (column + CHANGE.pairGutter), column),
    };
  });
  const pair = beside(width, cells);
  return { ...pair, height: headHeight + CHANGE.pairLabelGap + options.mapHeight, overhang: 0 };
}
