import { describe, expect, it } from 'vitest';
import { BAND_ICON, BAND_WAVE } from '../geometry';
import { BAND_PAINT, REPORT_BANDS, bandDisc } from '../palette';
import type { LayoutOp } from '../scale';
import { boundsOf } from '../shapes';
import type { PathOp } from '../shapes';
import { ARABIC, ENGLISH, measure, outside } from './checks';
import { bandIcon } from './bandIcon';

const SIZE = BAND_ICON.size;
const UNIT = SIZE / BAND_ICON.box;

const paths = (ops: readonly LayoutOp[]) => ops.filter((op): op is PathOp => op.kind === 'path');

describe('bandIcon', () => {
  it('is a square block as wide as it is told, holding no type', () => {
    const block = bandIcon({ band: 'alpha' }, SIZE, ENGLISH);
    expect(block.width).toBe(SIZE);
    expect(block.height).toBe(SIZE);
    expect(block.overhang).toBe(0);
    expect(block.baseline).toBeNull();
  });

  it('keeps every part inside its box, in either language, for every band', () => {
    for (const drawing of [ENGLISH, ARABIC]) {
      for (const band of REPORT_BANDS) {
        expect(outside(bandIcon({ band }, SIZE, drawing), measure)).toEqual([]);
      }
    }
  });

  it('is the same in both languages: a figure is not mirrored', () => {
    for (const band of REPORT_BANDS) {
      expect(bandIcon({ band }, SIZE, ARABIC)).toEqual(bandIcon({ band }, SIZE, ENGLISH));
    }
  });

  it('draws the disc, then the ring, then the wave', () => {
    const [disc, ring, wave, ...rest] = paths(bandIcon({ band: 'theta' }, SIZE, ENGLISH).ops);
    expect(rest).toEqual([]);
    expect(disc?.fill).toEqual({ rgb: bandDisc('theta') });
    expect(disc?.stroke).toBeUndefined();
    expect(ring?.fill).toBeUndefined();
    expect(ring?.stroke).toEqual({ rgb: BAND_PAINT.theta, width: BAND_ICON.ringLine * UNIT });
    expect(wave?.fill).toBeUndefined();
    expect(wave?.stroke).toEqual({
      rgb: BAND_PAINT.theta,
      width: BAND_ICON.waveLine * UNIT,
      cap: 'round',
      join: 'round',
    });
  });

  it('centres the disc and its ring on the icon, at the radius of its grid', () => {
    const [disc, ring] = paths(bandIcon({ band: 'delta' }, SIZE, ENGLISH).ops);
    const r = BAND_ICON.discRadius * UNIT;
    for (const shape of [disc, ring]) {
      const bounds = boundsOf(shape?.segments ?? []);
      expect(bounds.left).toBeCloseTo(SIZE / 2 - r, 9);
      expect(bounds.right).toBeCloseTo(SIZE / 2 + r, 9);
      expect(bounds.top).toBeCloseTo(-SIZE / 2 + r, 9);
      expect(bounds.bottom).toBeCloseTo(-SIZE / 2 - r, 9);
    }
  });

  it('runs the wave across the grid from its start to its end, rising first', () => {
    for (const band of REPORT_BANDS) {
      const [, , wave] = paths(bandIcon({ band }, SIZE, ENGLISH).ops);
      const segments = wave?.segments ?? [];
      const [start, first] = segments;
      const last = segments[segments.length - 1];
      expect(start).toEqual(['M', BAND_ICON.waveFrom * UNIT, -SIZE / 2]);
      expect(last?.[0]).toBe('C');
      if (last?.[0] === 'C') expect(last[5]).toBeCloseTo(BAND_ICON.waveTo * UNIT, 9);
      // The first cubic ends a quarter of a cycle in, at the crest.
      expect(first?.[0]).toBe('C');
      if (first?.[0] === 'C') {
        expect(first[6]).toBeCloseTo(-SIZE / 2 + BAND_WAVE[band].amplitude * UNIT, 9);
      }
    }
  });

  it('draws a slower band with fewer waves than a faster one', () => {
    const count = (band: (typeof REPORT_BANDS)[number]) =>
      paths(bandIcon({ band }, SIZE, ENGLISH).ops)[2]?.segments.length ?? 0;
    expect(count('delta')).toBeLessThan(count('high_beta'));
  });

  it('grows every length with its size', () => {
    const small = bandIcon({ band: 'beta' }, SIZE, ENGLISH);
    const large = bandIcon({ band: 'beta' }, 2 * SIZE, ENGLISH);
    const small3 = paths(small.ops)[2];
    const large3 = paths(large.ops)[2];
    expect(large3?.stroke?.width).toBeCloseTo(2 * (small3?.stroke?.width ?? 0), 9);
    const a = boundsOf(small3?.segments ?? []);
    const b = boundsOf(large3?.segments ?? []);
    expect(b.right - b.left).toBeCloseTo(2 * (a.right - a.left), 9);
  });

  it('refuses a size that is not a number, or is below nothing, by name', () => {
    expect(() => bandIcon({ band: 'alpha' }, Number.NaN, ENGLISH)).toThrow(
      /bandIcon needs a finite size/,
    );
    expect(() => bandIcon({ band: 'alpha' }, -1, ENGLISH)).toThrow(
      /bandIcon needs a size of zero or more/,
    );
  });

  it('changes nothing it was given', () => {
    const input = Object.freeze({ band: 'alpha' as const });
    expect(() => bandIcon(input, SIZE, Object.freeze({ ...ENGLISH }))).not.toThrow();
    expect(input).toEqual({ band: 'alpha' });
  });
});
