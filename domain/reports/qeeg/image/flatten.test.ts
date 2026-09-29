/**
 * Laying a map's RGBA pixels onto white paper, three bytes a pixel, rounded
 * to the nearest byte.
 */

import { describe, expect, it } from 'vitest';
import { flattenOverWhite } from './flatten';

const pixels = (...rgba: number[]) => ({
  width: rgba.length / 4,
  height: 1,
  data: new Uint8ClampedArray(rgba),
});

describe('flattening a map onto white paper', () => {
  it('leaves an opaque pixel as it was', () => {
    expect(Array.from(flattenOverWhite(pixels(12, 130, 250, 255)))).toEqual([12, 130, 250]);
  });

  it('turns a clear pixel white, whatever colour it carries', () => {
    expect(Array.from(flattenOverWhite(pixels(12, 130, 250, 0)))).toEqual([255, 255, 255]);
  });

  it('puts a half-clear pixel halfway between its colour and white', () => {
    // round(128/255 * 0 + 127/255 * 255) = 127; round(128/255 * 200 + 127) = 227.
    expect(Array.from(flattenOverWhite(pixels(0, 200, 255, 128)))).toEqual([127, 227, 255]);
  });

  it('rounds to the nearest byte rather than down', () => {
    // 128/255 * 1 + 127/255 * 255 = 127.502: 128 rounded, 127 floored.
    expect(Array.from(flattenOverWhite(pixels(1, 1, 1, 128)))).toEqual([128, 128, 128]);
  });

  it('writes three bytes a pixel, row by row', () => {
    const image = { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4).fill(255) };
    const out = flattenOverWhite(image);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3 * 2 * 3);
  });

  it('refuses a size that is not a whole number above 0', () => {
    expect(() =>
      flattenOverWhite({ width: 0.5, height: 8, data: new Uint8ClampedArray(16) }),
    ).toThrow(RangeError);
    expect(() => flattenOverWhite({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toThrow(
      RangeError,
    );
  });

  it('refuses pixels whose data is not four bytes for each one', () => {
    expect(() =>
      flattenOverWhite({ width: 2, height: 2, data: new Uint8ClampedArray(15) }),
    ).toThrow(RangeError);
  });
});
