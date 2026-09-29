/**
 * Trimming the blank border off a map export, so it prints as large as the
 * page allows. The first two cases are the Dart tool's own numbers.
 */

import { describe, expect, it } from 'vitest';
import { crop, trimWhiteBorder } from './trim';
import type { Crop, Pixels } from './trim';

type Rgba = readonly [number, number, number, number];

function filled(width: number, height: number, colour: Rgba): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(colour, i * 4);
  return { width, height, data };
}

/** A copy with the inclusive block from (x1,y1) to (x2,y2) painted. */
function withBlock(image: Pixels, x1: number, y1: number, x2: number, y2: number, colour: Rgba) {
  const data = new Uint8ClampedArray(image.data);
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) data.set(colour, (y * image.width + x) * 4);
  }
  return { ...image, data };
}

const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const BLUE: Rgba = [30, 60, 200, 255];
const INK: Rgba = [10, 10, 10, 255];

const whole = (image: Pixels): Crop => ({
  left: 0,
  top: 0,
  width: image.width,
  height: image.height,
});

function inside(image: Pixels, to: Crop): void {
  expect(to.left).toBeGreaterThanOrEqual(0);
  expect(to.top).toBeGreaterThanOrEqual(0);
  expect(to.left + to.width).toBeLessThanOrEqual(image.width);
  expect(to.top + to.height).toBeLessThanOrEqual(image.height);
}

describe('trimming a white border', () => {
  it('trims a white border down to the content with a little padding', () => {
    const image = withBlock(filled(1000, 1400, WHITE), 150, 150, 849, 1249, BLUE);
    const to = trimWhiteBorder(image);
    expect(to.width).toBeGreaterThanOrEqual(700);
    expect(to.width).toBeLessThanOrEqual(730);
    expect(to.height).toBeGreaterThanOrEqual(1100);
    expect(to.height).toBeLessThanOrEqual(1130);
    // Padding is 1% of the width, 10 pixels here, on every side.
    expect(to).toEqual({ left: 140, top: 140, width: 720, height: 1120 });
  });

  it('leaves an image with no border untouched', () => {
    const image = filled(400, 300, INK);
    expect(trimWhiteBorder(image)).toEqual(whole(image));
  });

  it('leaves a wholly white image whole', () => {
    const image = filled(300, 200, WHITE);
    expect(trimWhiteBorder(image)).toEqual(whole(image));
  });

  it('leaves an image whole when what is left would be under 20 pixels either way', () => {
    const image = withBlock(filled(300, 200, WHITE), 100, 50, 110, 150, INK);
    expect(trimWhiteBorder(image)).toEqual(whole(image));
  });

  it('trims a transparent border as it trims a white one', () => {
    const white = withBlock(filled(1000, 1400, WHITE), 150, 150, 849, 1249, BLUE);
    const clear = withBlock(filled(1000, 1400, CLEAR), 150, 150, 849, 1249, BLUE);
    expect(trimWhiteBorder(clear)).toEqual(trimWhiteBorder(white));
  });

  it('counts a near-white of 247 and over as blank, and 246 as content', () => {
    const faint = withBlock(filled(400, 400, WHITE), 100, 100, 299, 299, [247, 250, 255, 255]);
    expect(trimWhiteBorder(faint)).toEqual(whole(faint));
    const grey = withBlock(filled(400, 400, WHITE), 100, 100, 299, 299, [246, 250, 255, 255]);
    expect(trimWhiteBorder(grey)).not.toEqual(whole(grey));
  });

  it('keeps the padding between 4 and 16 pixels whatever the width', () => {
    const narrow = withBlock(filled(200, 200, WHITE), 50, 50, 149, 149, INK);
    expect(trimWhiteBorder(narrow).left).toBe(50 - 4);
    const wide = withBlock(filled(3000, 400, WHITE), 500, 100, 2499, 299, INK);
    expect(trimWhiteBorder(wide).left).toBe(500 - 16);
  });

  it('samples rows every second pixel, so content only in odd columns is not seen', () => {
    let image = filled(200, 200, WHITE);
    for (let x = 51; x < 150; x += 2) image = withBlock(image, x, 50, x, 149, INK);
    expect(trimWhiteBorder(image)).toEqual(whole(image));
  });

  it('samples columns every second pixel, so content only in odd rows is not seen', () => {
    let image = filled(200, 200, WHITE);
    for (let y = 51; y < 150; y += 2) image = withBlock(image, 50, y, 149, y, INK);
    expect(trimWhiteBorder(image)).toEqual(whole(image));
  });

  it('counts an alpha under 16 as blank, and 16 as content', () => {
    const faint = withBlock(filled(400, 400, [0, 0, 0, 15]), 100, 100, 299, 299, INK);
    expect(trimWhiteBorder(faint)).toEqual({ left: 96, top: 96, width: 208, height: 208 });
    const seen = withBlock(filled(400, 400, [0, 0, 0, 16]), 100, 100, 299, 299, INK);
    expect(trimWhiteBorder(seen)).toEqual(whole(seen));
  });

  it('never gives a crop that leaves the image', () => {
    const cases = [
      withBlock(filled(500, 400, WHITE), 1, 1, 300, 300, INK),
      withBlock(filled(500, 400, WHITE), 200, 100, 499, 399, INK),
      withBlock(filled(64, 64, CLEAR), 3, 3, 60, 60, INK),
      withBlock(filled(1000, 1400, WHITE), 150, 150, 849, 1249, BLUE),
    ];
    for (const image of cases) inside(image, trimWhiteBorder(image));
  });
});

describe('cropping', () => {
  it('copies exactly the pixels inside the crop, row by row', () => {
    const image = withBlock(filled(10, 8, WHITE), 2, 3, 4, 5, INK);
    const out = crop(image, { left: 2, top: 3, width: 3, height: 3 });
    expect(out.width).toBe(3);
    expect(out.height).toBe(3);
    expect(Array.from(out.data)).toEqual(Array.from(filled(3, 3, INK).data));
  });

  it('does not change the image it is given', () => {
    const image = withBlock(filled(10, 8, WHITE), 2, 3, 4, 5, INK);
    const before = new Uint8ClampedArray(image.data);
    const out = crop(image, { left: 0, top: 0, width: 5, height: 5 });
    out.data.fill(7);
    expect(image.data).toEqual(before);
  });

  it('refuses a crop that runs outside the image', () => {
    const image = filled(10, 8, WHITE);
    expect(() => crop(image, { left: 8, top: 0, width: 3, height: 2 })).toThrow(RangeError);
    expect(() => crop(image, { left: -1, top: 0, width: 3, height: 2 })).toThrow(RangeError);
    expect(() => crop(image, { left: 0, top: 0, width: 1.5, height: 2 })).toThrow(RangeError);
  });
});
