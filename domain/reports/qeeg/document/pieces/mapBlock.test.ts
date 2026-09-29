import { describe, expect, it } from 'vitest';
import type { Op } from '@domain/shared/document';
import { extentOf } from '../block';
import { BODY_WIDTH, MAP } from '../geometry';
import { MAX_MAP_SCALE, placeImage } from '../mapPlacement';
import type { LayoutOp } from '../scale';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { mapBlock, mapPlaced } from './mapBlock';
import type { MapInput } from './mapBlock';
import { fixed, typed } from './words';

const WIDTH = BODY_WIDTH;
const ROOM = 700;

const images = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<Op, { kind: 'image' }> => op.kind === 'image');

/** An invented map: a key and a size in pixels, and no picture. */
const WIDE: MapInput = {
  label: typed('Absolute power, eyes closed'),
  image: 'map-one',
  pixels: { width: 1200, height: 400 },
};
const TALL: MapInput = { ...WIDE, pixels: { width: 800, height: 2000 } };
const SMALL: MapInput = { ...WIDE, pixels: { width: 40, height: 40 } };

/** The room the label takes, with the gap under it. */
function labelled(input: MapInput, drawing: Drawing): number {
  if (!input.label) return 0;
  const label = typeset('subheading', input.label.text, WIDTH, drawing, {
    typed: input.label.typed,
  });
  return label.height + Math.max(MAP.labelGap, label.overhang);
}

describe('mapBlock', () => {
  it('keeps every part inside its box and its room, in either language', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const input of [WIDE, TALL, SMALL]) {
        const block = mapBlock(input, WIDTH, drawing, { room: ROOM });
        expect(outside(block, measure)).toEqual([]);
        expect(block.height).toBeLessThanOrEqual(ROOM - MAP.reserve + 1e-9);
      }
    }
  });

  it('draws the Arabic block as the mirror of the English one, its words too', () => {
    for (const input of [WIDE, TALL, SMALL]) {
      const en = mapBlock(input, WIDTH, ENGLISH, { room: ROOM });
      const ar = mapBlock(input, WIDTH, ARABIC, { room: ROOM });
      // A typed English label is as tall in either report: nothing stands lower.
      expect(unmirrored(en, ar, measure, { upAndDown: true })).toEqual([]);
    }
  });

  it('sets the label as a title from the start edge, as a person typed it', () => {
    const en = mapBlock(WIDE, WIDTH, ENGLISH, { room: ROOM });
    const title = en.ops.find((op) => op.kind === 'text');
    expect(title?.kind === 'text' && title.style.size).toBe(11.5);
    expect(title?.kind === 'text' && title.style.font).toBe('bold');
    expect(
      extentOf(
        en.ops.filter((op) => op.kind === 'text'),
        measure,
      ).left,
    ).toBe(0);
    const ar = mapBlock(WIDE, WIDTH, ARABIC, { room: ROOM });
    const words = ar.ops.filter((op) => op.kind === 'text');
    expect(extentOf(words, measure).right).toBeCloseTo(WIDTH, 9);
    expect(words.every((op) => op.kind === 'text' && op.rtl !== true)).toBe(true);
  });

  it('sets the picture under the label and its gap, centred across the width', () => {
    const block = mapBlock(WIDE, WIDTH, ENGLISH, { room: ROOM });
    const [picture] = images(block.ops);
    expect(picture?.image).toBe('map-one');
    const top = -labelled(WIDE, ENGLISH);
    expect((picture?.y ?? 0) + (picture?.height ?? 0)).toBeCloseTo(top, 9);
    expect((picture?.x ?? 0) + (picture?.width ?? 0) / 2).toBeCloseTo(WIDTH / 2, 9);
    expect(block.height).toBeCloseTo(labelled(WIDE, ENGLISH) + (picture?.height ?? 0), 9);
  });

  it('draws the label before the picture', () => {
    const kinds = mapBlock(WIDE, WIDTH, ENGLISH, { room: ROOM }).ops.map((op) => op.kind);
    expect(kinds[kinds.length - 1]).toBe('image');
    expect(kinds.indexOf('image')).toBe(kinds.length - 1);
  });

  it('draws a wide map as wide as the block, keeping its shape', () => {
    const [picture] = images(mapBlock(WIDE, WIDTH, ENGLISH, { room: ROOM }).ops);
    expect(picture?.width).toBeCloseTo(WIDTH, 9);
    expect((picture?.width ?? 0) / (picture?.height ?? 1)).toBeCloseTo(1200 / 400, 9);
  });

  it('draws a tall map as tall as the room under the label allows, less what is kept clear', () => {
    const [picture] = images(mapBlock(TALL, WIDTH, ENGLISH, { room: 400 }).ops);
    expect(picture?.height).toBeCloseTo(400 - labelled(TALL, ENGLISH) - MAP.reserve, 9);
    expect((picture?.width ?? 0) / (picture?.height ?? 1)).toBeCloseTo(800 / 2000, 9);
  });

  it('never draws a map past its most magnified size', () => {
    const [picture] = images(mapBlock(SMALL, WIDTH, ENGLISH, { room: ROOM }).ops);
    expect(picture?.width).toBeCloseTo(40 * 0.75 * MAX_MAP_SCALE, 9);
  });

  it('gives the placement it drew with, as the page builder asks for it', () => {
    for (const input of [WIDE, TALL, SMALL]) {
      const placed = mapPlaced(input, WIDTH, ENGLISH, { room: 400 });
      expect(placed).toEqual(
        placeImage(input.pixels, {
          maxWidth: WIDTH,
          maxHeight: 400 - labelled(input, ENGLISH) - MAP.reserve,
        }),
      );
      const [picture] = images(mapBlock(input, WIDTH, ENGLISH, { room: 400 }).ops);
      expect(picture?.width).toBe(placed.width);
      expect(picture?.height).toBe(placed.height);
    }
  });

  it('leaves no room for a label that is absent or has no words', () => {
    const withLabel = mapBlock(WIDE, WIDTH, ENGLISH, { room: ROOM });
    for (const label of [null, fixed('  ')]) {
      const block = mapBlock({ ...WIDE, label }, WIDTH, ENGLISH, { room: ROOM });
      expect(block.ops.filter((op) => op.kind !== 'image')).toEqual([]);
      expect(images(block.ops)[0]?.y).toBeCloseTo(-block.height, 9);
      expect(withLabel.height - block.height).toBeCloseTo(labelled(WIDE, ENGLISH), 9);
    }
  });

  it('draws a label of 400 characters and a word wider than the page inside its box', () => {
    const long: MapInput = { ...TALL, label: typed(`${'a'.repeat(120)} ${'b '.repeat(140)}`) };
    for (const drawing of [ENGLISH, ARABIC]) {
      const block = mapBlock(long, WIDTH, drawing, { room: ROOM });
      expect(outside(block, measure)).toEqual([]);
      const [picture] = images(block.ops);
      const [shorter] = images(mapBlock(TALL, WIDTH, drawing, { room: ROOM }).ops);
      expect(picture?.height ?? 0).toBeLessThan(shorter?.height ?? 0);
    }
  });

  it('refuses a size in pixels that is not a whole number above nothing, by name', () => {
    for (const pixels of [
      { width: 0, height: 400 },
      { width: 1200, height: -1 },
      { width: 12.5, height: 400 },
      { width: Number.NaN, height: 400 },
    ]) {
      expect(() => mapBlock({ ...WIDE, pixels }, WIDTH, ENGLISH, { room: ROOM })).toThrow(
        /mapBlock needs pixels that are whole numbers above nothing/,
      );
      expect(() => mapPlaced({ ...WIDE, pixels }, WIDTH, ENGLISH, { room: ROOM })).toThrow(
        /mapPlaced needs pixels that are whole numbers above nothing/,
      );
    }
  });

  it('refuses a room too small for its label and a point of map, by name', () => {
    const least = labelled(WIDE, ENGLISH) + MAP.reserve;
    expect(() => mapBlock(WIDE, WIDTH, ENGLISH, { room: least })).toThrow(
      /mapBlock is given a room of .* too small for its label and a point of map/,
    );
    expect(() => mapBlock(WIDE, WIDTH, ENGLISH, { room: least + 2 })).not.toThrow();
    expect(() => mapBlock(WIDE, WIDTH, ENGLISH, { room: Number.NaN })).toThrow(
      /mapBlock needs a finite room/,
    );
  });

  it('refuses a width that is no width, by name', () => {
    expect(() => mapBlock(WIDE, Number.NaN, ENGLISH, { room: ROOM })).toThrow(
      /mapBlock needs a finite width/,
    );
    expect(() => mapBlock(WIDE, 0, ENGLISH, { room: ROOM })).toThrow(
      /mapBlock needs a width above nothing/,
    );
  });

  it('changes nothing it was given', () => {
    const input: MapInput = Object.freeze({
      label: Object.freeze(typed('Absolute power')),
      image: 'map-one',
      pixels: Object.freeze({ width: 1200, height: 400 }),
    });
    const before = JSON.stringify(input);
    expect(() => mapBlock(input, WIDTH, ENGLISH, Object.freeze({ room: ROOM }))).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});
