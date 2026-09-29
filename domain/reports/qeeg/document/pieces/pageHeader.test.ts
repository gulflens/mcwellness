import { describe, expect, it } from 'vitest';
import { HEADER } from '../geometry';
import { ARABIC, ENGLISH, measure, outside, unmirrored } from './checks';
import { pageHeader } from './pageHeader';

const WIDTH = 480;
const LOGO = 'logo';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('pageHeader', () => {
  for (const [name, drawing] of [
    ['English', ENGLISH],
    ['Arabic', ARABIC],
  ] as const) {
    it(`keeps everything inside its box, in ${name}`, () => {
      expect(outside(pageHeader({ image: LOGO }, WIDTH, drawing), measure)).toEqual([]);
    });
  }

  it('draws one image, the logo’s size, centred across the width, its top at the top', () => {
    const block = pageHeader({ image: LOGO }, WIDTH, ENGLISH);
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
    expect(pageHeader({ image: LOGO }, WIDTH, ENGLISH).height).toBe(HEADER.height);
    expect(pageHeader({ image: LOGO }, WIDTH, ENGLISH).overhang).toBe(0);
  });

  it('stands where its own mirror would, since it is centred', () => {
    const en = pageHeader({ image: LOGO }, WIDTH, ENGLISH);
    const ar = pageHeader({ image: LOGO }, WIDTH, ARABIC);
    expect(unmirrored(en, ar, measure, { upAndDown: true })).toEqual([]);
  });

  it('is the same in both languages: a logo is not mirrored', () => {
    expect(pageHeader({ image: LOGO }, WIDTH, ARABIC)).toEqual(
      pageHeader({ image: LOGO }, WIDTH, ENGLISH),
    );
  });

  it('refuses a width that is not a number, or narrower than the logo, by name', () => {
    expect(() => pageHeader({ image: LOGO }, Number.NaN, ENGLISH)).toThrow(
      /pageHeader needs a finite width/,
    );
    expect(() => pageHeader({ image: LOGO }, HEADER.logo.width - 1, ENGLISH)).toThrow(
      /pageHeader needs a width of at least/,
    );
  });

  it('refuses an image with no key to look it up by, by name', () => {
    expect(() => pageHeader({ image: '' }, WIDTH, ENGLISH)).toThrow(
      /pageHeader needs the key of an image/,
    );
  });

  it('refuses a width it cannot stand in under its own name, before it calls anything', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, HEADER.logo.width - 1]) {
      for (const drawing of [ENGLISH, ARABIC]) {
        expect(() => pageHeader({ image: LOGO }, width, drawing)).toThrow(
          /^pageHeader (needs|is left)/,
        );
      }
    }
  });

  it('changes nothing it was given', () => {
    const input = deepFreeze({ image: LOGO });
    expect(() => pageHeader(input, WIDTH, ARABIC)).not.toThrow();
  });
});
