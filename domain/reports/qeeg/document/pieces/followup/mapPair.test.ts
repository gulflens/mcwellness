import { describe, expect, it } from 'vitest';
import { extentOf } from '../../block';
import { CHANGE } from '../../geometry';
import { placeImage } from '../../mapPlacement';
import type { LayoutOp } from '../../scale';
import { styleOf } from '../../styles';
import { typeset } from '../../typeset';
import { ARABIC, ENGLISH, downThePage, measure, outside, unmirrored, wordsOf } from '../checks';
import { mapPair } from './mapPair';
import type { MapPairInput, PairSide } from './mapPair';

/**
 * docs/SPEC/reports-qeeg.md section 10, "Before and after": the earlier map
 * beside the later one, each under the words for which recording it is, and
 * a pair never split. Section 9, point 4: a map is drawn as large as its
 * place allows and never more than two and a half times its size.
 */

const WIDTH = 480;
const COLUMN = (WIDTH - CHANGE.pairGutter) / 2;
const HEIGHT = 150;
const PIXELS = { width: 1600, height: 1200 };

const EARLIER: PairSide = {
  label: 'Initial recording, eyes closed',
  date: '10/06/2026',
  map: { image: 'map:earlier', pixels: PIXELS },
  missing: 'Not recorded',
};
const LATER: PairSide = {
  label: 'Follow-up recording, eyes closed',
  date: '14/09/2026',
  map: { image: 'map:later', pixels: PIXELS },
  missing: 'Not recorded',
};
const PAIR: MapPairInput = { earlier: EARLIER, later: LATER };

const images = (ops: readonly LayoutOp[]) =>
  ops.filter((op): op is Extract<LayoutOp, { kind: 'image' }> => op.kind === 'image');

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const at = { mapHeight: HEIGHT };

describe('mapPair', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      for (const input of [
        PAIR,
        { earlier: { ...EARLIER, map: null }, later: LATER },
        { earlier: EARLIER, later: { ...LATER, map: null, date: null } },
      ]) {
        expect(outside(mapPair(input, WIDTH, drawing, at), measure)).toEqual([]);
      }
    });
  }

  it('draws the Arabic pair as the mirror of the English one, maps and words', () => {
    // The same words on each side, so a line of one is as wide as the other's.
    const same = { earlier: EARLIER, later: { ...LATER, label: EARLIER.label } };
    for (const input of [same, { ...same, later: { ...same.later, map: null } }]) {
      expect(
        unmirrored(mapPair(input, WIDTH, ENGLISH, at), mapPair(input, WIDTH, ARABIC, at), measure),
      ).toEqual([]);
    }
  });

  it('sets the earlier map at the start, and the later one at the end', () => {
    const [earlier, later] = images(mapPair(PAIR, WIDTH, ENGLISH, at).ops);
    expect(earlier?.image).toBe('map:earlier');
    expect(later?.image).toBe('map:later');
    expect((earlier?.x ?? 0) + (earlier?.width ?? 0)).toBeLessThanOrEqual(COLUMN + 1e-9);
    expect(later?.x ?? 0).toBeGreaterThanOrEqual(COLUMN + CHANGE.pairGutter - 1e-9);
    const [arabicEarlier] = images(mapPair(PAIR, WIDTH, ARABIC, at).ops);
    expect(arabicEarlier?.x ?? 0).toBeGreaterThanOrEqual(COLUMN + CHANGE.pairGutter - 1e-9);
  });

  it('draws each map as large as its place allows, keeping its shape, centred in its column', () => {
    const placed = placeImage(PIXELS, { maxWidth: COLUMN, maxHeight: HEIGHT });
    for (const image of images(mapPair(PAIR, WIDTH, ENGLISH, at).ops)) {
      expect(image.width).toBeCloseTo(placed.width, 9);
      expect(image.height).toBeCloseTo(placed.height, 9);
      const column = image.x < COLUMN ? 0 : COLUMN + CHANGE.pairGutter;
      expect(image.x - column).toBeCloseTo((COLUMN - placed.width) / 2, 9);
    }
  });

  it('stands both maps level, under the taller of the two labels', () => {
    const input = {
      earlier: { ...EARLIER, label: `${EARLIER.label} ${EARLIER.label} ${EARLIER.label}` },
      later: LATER,
    };
    const block = mapPair(input, WIDTH, ENGLISH, at);
    const [one, other] = images(block.ops);
    expect((one?.y ?? 0) + (one?.height ?? 0)).toBeCloseTo(
      (other?.y ?? 0) + (other?.height ?? 0),
      9,
    );
    const label = typeset('pairLabel', input.earlier.label, COLUMN, ENGLISH);
    const date = typeset('note', EARLIER.date ?? '', COLUMN, ENGLISH);
    expect(-((one?.y ?? 0) + (one?.height ?? 0))).toBeCloseTo(
      label.height + date.height + CHANGE.pairLabelGap,
      9,
    );
    expect(block.height).toBeCloseTo(label.height + date.height + CHANGE.pairLabelGap + HEIGHT, 9);
  });

  it('puts each label over its date, and both over the map', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      const input = { earlier: EARLIER, later: { ...LATER, map: null } };
      const order = downThePage(mapPair(input, WIDTH, drawing, at), measure).map(
        (each) => each.what,
      );
      expect(order.findIndex((what) => what.includes('recording'))).toBeLessThan(
        order.findIndex((what) => what.includes('2026')),
      );
      expect(order.findIndex((what) => what.includes('2026'))).toBeLessThan(order.indexOf('image'));
    }
  });

  it('prints the words for a map not recorded in its place, and keeps the room', () => {
    const input = { earlier: { ...EARLIER, map: null }, later: LATER };
    const block = mapPair(input, WIDTH, ENGLISH, at);
    expect(images(block.ops)).toHaveLength(1);
    expect(wordsOf(block, measure).join(' ')).toContain('Not recorded');
    expect(block.height).toBeCloseTo(mapPair(PAIR, WIDTH, ENGLISH, at).height, 9);
    const missing = block.ops.find((op) => op.kind === 'text' && op.text.includes('recorded'));
    const reach = missing ? extentOf([missing], measure) : null;
    expect(reach?.right ?? WIDTH).toBeLessThanOrEqual(COLUMN);
    expect(missing).toBeDefined();
  });

  it('adds exactly the date’s line when a side has one, and nothing when neither has', () => {
    const none = mapPair(
      { earlier: { ...EARLIER, date: null }, later: { ...LATER, date: null } },
      WIDTH,
      ENGLISH,
      at,
    );
    const date = typeset('note', EARLIER.date ?? '', COLUMN, ENGLISH);
    expect(mapPair(PAIR, WIDTH, ENGLISH, at).height - none.height).toBeCloseTo(date.height, 9);
  });

  it('sets the label in its role and the date as a note', () => {
    const { ops } = mapPair(PAIR, WIDTH, ENGLISH, at);
    const label = ops.find((op) => op.kind === 'text' && op.text.startsWith('Initial'));
    const date = ops.find((op) => op.kind === 'text' && op.text.includes('2026'));
    expect(label?.kind === 'text' && label.style.size).toBe(styleOf('pairLabel', 'ltr').style.size);
    expect(date?.kind === 'text' && date.style.size).toBe(styleOf('note', 'ltr').style.size);
  });

  it('wraps a long label inside its column, and grows', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const label of ['Initial recording '.repeat(12), 'w'.repeat(400)]) {
        const block = mapPair({ ...PAIR, later: { ...LATER, label } }, WIDTH, drawing, at);
        expect(outside(block, measure)).toEqual([]);
        expect(block.height).toBeGreaterThan(mapPair(PAIR, WIDTH, drawing, at).height);
      }
    }
  });

  it('refuses a width, a height or a size in pixels that is no such thing, by name', () => {
    expect(() => mapPair(PAIR, Number.NaN, ENGLISH, at)).toThrow(/^mapPair needs a finite width/);
    expect(() => mapPair(PAIR, -1, ENGLISH, at)).toThrow(/^mapPair needs a width of zero or more/);
    expect(() => mapPair(PAIR, CHANGE.pairGutter, ENGLISH, at)).toThrow(
      /^mapPair is left no room for a map by a width of/,
    );
    expect(() => mapPair(PAIR, WIDTH, ENGLISH, { mapHeight: Number.NaN })).toThrow(
      /^mapPair needs a finite map height/,
    );
    expect(() => mapPair(PAIR, WIDTH, ENGLISH, { mapHeight: 0 })).toThrow(
      /^mapPair needs a map height above nothing, and was given 0/,
    );
    const bad = {
      ...PAIR,
      later: { ...LATER, map: { image: 'map:later', pixels: { width: 0, height: 5 } } },
    };
    expect(() => mapPair(bad, WIDTH, ENGLISH, at)).toThrow(
      /^mapPair needs pixels that are whole numbers above nothing, and was given 0 by 5/,
    );
  });

  it('changes nothing it was given', () => {
    expect(() =>
      mapPair(deepFreeze({ ...PAIR }), WIDTH, ARABIC, deepFreeze({ ...at })),
    ).not.toThrow();
  });
});
