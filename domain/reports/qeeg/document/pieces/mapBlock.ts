/**
 * A brain map on a page of its own: its label, if it has one, as a title,
 * and under it the picture, as large as the page allows.
 *
 * **How large.** As wide as the block and as tall as the room left under the
 * label, less `MAP.reserve` kept clear above the footer, keeping its shape
 * and never more than `MAX_MAP_SCALE` times its own size. `placeImage` does
 * that arithmetic; this piece only works out the box it is given. The
 * picture is centred across the width, which is the same place in either
 * language.
 *
 * **Why `mapPlaced` is exported.** Whoever builds the pages says how sharply
 * each map will print, and that depends on the size it is drawn at. Asking
 * the piece for its placement, rather than working the box out again, keeps
 * the two from ever disagreeing.
 *
 * **What is refused.** A size in pixels is a stored map's own and must be
 * whole numbers above nothing; a room too small for the label and a point of
 * picture is a slip in the page that asked. Unlike `placeImage`, which the
 * screen asks about whatever a person has attached, a piece is drawn only
 * once a map is whole, so both are refused by name.
 */

import { stack } from '../block';
import type { Block } from '../block';
import { MAP } from '../geometry';
import { placeImage } from '../mapPlacement';
import type { PlacedImage } from '../mapPlacement';
import { finite } from '../metrics';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type MapInput = {
  readonly label: Words | null;
  readonly image: string;
  readonly pixels: { readonly width: number; readonly height: number };
};

export type MapRoom = {
  /** The height the block may fill, `MAP.reserve` of it kept clear. */
  readonly room: number;
};

/** The unit the least picture is counted in: a map must have a point of height to be drawn. */
const ONE_POINT = 1;

type Laid = { readonly label: Block | null; readonly placed: PlacedImage };

function laid(fn: string, input: MapInput, width: number, drawing: Drawing, room: number): Laid {
  finite(fn, 'width', width);
  if (width <= 0) {
    throw new RangeError(`${fn} needs a width above nothing, and was given ${width}.`);
  }
  finite(fn, 'room', room);
  const { pixels } = input;
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  if (!whole(pixels.width) || !whole(pixels.height)) {
    throw new RangeError(
      `${fn} needs pixels that are whole numbers above nothing, and was given ${String(pixels.width)} by ${String(pixels.height)}.`,
    );
  }

  const set = input.label
    ? typeset('subheading', input.label.text, width, drawing, { typed: input.label.typed })
    : null;
  const label = set && set.height > 0 ? stack(width, [set, MAP.labelGap]) : null;
  const height = room - (label ? label.height + label.overhang : 0) - MAP.reserve;
  if (height < ONE_POINT) {
    throw new RangeError(
      `${fn} is given a room of ${room}, too small for its label and a point of map.`,
    );
  }
  return { label, placed: placeImage(pixels, { maxWidth: width, maxHeight: height }) };
}

/** The size, scale and sharpness a map is drawn with in this width and room. */
export function mapPlaced(
  input: MapInput,
  width: number,
  drawing: Drawing,
  options: MapRoom,
): PlacedImage {
  return laid('mapPlaced', input, width, drawing, options.room).placed;
}

export function mapBlock(
  input: MapInput,
  width: number,
  drawing: Drawing,
  options: MapRoom,
): Block {
  const { label, placed } = laid('mapBlock', input, width, drawing, options.room);
  const picture: Block = {
    width,
    height: placed.height,
    overhang: 0,
    baseline: null,
    ops: [
      {
        kind: 'image',
        image: input.image,
        x: (width - placed.width) / 2,
        y: -placed.height,
        width: placed.width,
        height: placed.height,
      },
    ],
  };
  return stack(width, label ? [label, picture] : [picture]);
}
