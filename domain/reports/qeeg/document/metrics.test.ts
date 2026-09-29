/**
 * The vertical measure of a line of type: a font's face in em, the line box
 * a browser would give it, a paragraph's height, and the millimetre.
 */

import { describe, expect, it } from 'vitest';
import { faceOf, lineBox, mm, MM, paragraphHeight } from './metrics';
import type { Face } from './metrics';

describe('faceOf', () => {
  it('reads a parsed font, whose metrics are already in thousandths of an em', () => {
    expect(faceOf({ ascent: 1025, descent: -275, unitsPerEm: 1000 })).toEqual({
      ascent: 1.025,
      descent: -0.275,
    });
  });

  it('is not thrown by a font drawn on a grid other than a thousand', () => {
    // `readFont` has already scaled a 2048-unit font's 2100 and -563 to thousandths.
    const face = faceOf({ ascent: 1025, descent: -275, unitsPerEm: 2048 });
    expect(face.ascent).toBeCloseTo(1.025, 9);
    expect(face.descent).toBeCloseTo(-0.275, 9);
  });
});

describe('lineBox', () => {
  const strut: Face = { ascent: 1.0, descent: -0.3 };

  it('sets the advance, the half leading and the first baseline from the style', () => {
    const box = lineBox({ size: 10, lineHeight: 1.5, weight: 'regular' }, strut);
    expect(box.advance).toBe(15);
    expect(box.halfLeading).toBeCloseTo(1, 9);
    expect(box.firstBaseline).toBeCloseTo(11, 9);
  });

  it('keeps its arithmetic when the leading is negative', () => {
    const box = lineBox({ size: 10, lineHeight: 1.1, weight: 'bold' }, strut);
    expect(box.advance).toBeCloseTo(11, 9);
    expect(box.halfLeading).toBeCloseTo(-1, 9);
    expect(box.firstBaseline).toBeCloseTo(9, 9);
  });
});

describe('paragraphHeight', () => {
  it('is the line count times the advance, exactly', () => {
    const box = lineBox(
      { size: 9, lineHeight: 1.45, weight: 'regular' },
      { ascent: 1, descent: -0.3 },
    );
    expect(paragraphHeight(7, box)).toBe(7 * box.advance);
    expect(paragraphHeight(0, box)).toBe(0);
  });
});

describe('mm', () => {
  it('turns millimetres into points', () => {
    expect(MM).toBeCloseTo(2.834645669, 8);
    expect(mm(3)).toBeCloseTo(8.504, 3);
    expect(mm(25.4)).toBeCloseTo(72, 9);
  });
});

describe('lineBox and numbers that are not numbers', () => {
  it('refuses a size, a line height or a face that is not finite', () => {
    const strut: Face = { ascent: 1, descent: -0.3 };
    expect(() => lineBox({ size: Number.NaN, lineHeight: 1.5, weight: 'regular' }, strut)).toThrow(
      /size/,
    );
    expect(() => lineBox({ size: 10, lineHeight: Number.NaN, weight: 'regular' }, strut)).toThrow(
      /lineHeight/,
    );
    expect(() =>
      lineBox({ size: 10, lineHeight: 1.5, weight: 'regular' }, { ascent: 1, descent: Number.NaN }),
    ).toThrow(/descent/);
  });
});
