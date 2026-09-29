import { describe, expect, it } from 'vitest';
import { extentOf } from '../block';
import type { Block } from '../block';
import { HEADER } from '../geometry';
import type { Measure } from '../paragraph';
import type { Drawing } from '../typeset';
import { pageHeader } from './pageHeader';

/** Every character is half its size wide, so every width in a test is exact. */
const measure: Measure = (text, _weight, size) => [...text].length * size * 0.5;
const FACE = { ascent: 1, descent: -0.25 };
const english: Drawing = { direction: 'ltr', measure, faces: { latin: FACE, arabic: FACE } };
const arabic: Drawing = { ...english, direction: 'rtl' };
const WIDTH = 480;
const LOGO = 'logo';

function expectInside(block: Block, width: number): void {
  const extent = extentOf(block.ops, measure);
  expect(extent.left).toBeGreaterThanOrEqual(-1e-9);
  expect(extent.right).toBeLessThanOrEqual(width + 1e-9);
  expect(extent.top).toBeLessThanOrEqual(1e-9);
  expect(extent.bottom).toBeGreaterThanOrEqual(-(block.height + block.overhang) - 1e-9);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('pageHeader', () => {
  for (const [name, drawing] of [
    ['English', english],
    ['Arabic', arabic],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expectInside(pageHeader({ image: LOGO }, WIDTH, drawing), WIDTH);
    });
  }

  it('draws one image, the logo’s size, centred across the width, its top at the top', () => {
    const block = pageHeader({ image: LOGO }, WIDTH, english);
    expect(block.ops).toEqual([
      {
        kind: 'image',
        image: LOGO,
        x: (WIDTH - HEADER.logo.width) / 2,
        y: -HEADER.logo.height,
        width: HEADER.logo.width,
        height: HEADER.logo.height,
      },
    ]);
  });

  it('is as tall as the layout’s header', () => {
    expect(pageHeader({ image: LOGO }, WIDTH, english).height).toBe(HEADER.height);
    expect(pageHeader({ image: LOGO }, WIDTH, english).overhang).toBe(0);
  });

  it('is the same in both languages: a logo is not mirrored', () => {
    expect(pageHeader({ image: LOGO }, WIDTH, arabic)).toEqual(
      pageHeader({ image: LOGO }, WIDTH, english),
    );
  });

  it('refuses a width that is not a number, or narrower than the logo, by name', () => {
    expect(() => pageHeader({ image: LOGO }, Number.NaN, english)).toThrow(
      /pageHeader needs a finite width/,
    );
    expect(() => pageHeader({ image: LOGO }, HEADER.logo.width - 1, english)).toThrow(
      /pageHeader needs a width of at least/,
    );
  });

  it('refuses an image with no key to look it up by, by name', () => {
    expect(() => pageHeader({ image: '' }, WIDTH, english)).toThrow(
      /pageHeader needs the key of an image/,
    );
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ image: LOGO });
    expect(() => pageHeader(input, WIDTH, deepFreeze({ ...arabic }))).not.toThrow();
  });
});
