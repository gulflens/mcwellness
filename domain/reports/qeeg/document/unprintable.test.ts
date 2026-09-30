import { describe, expect, it } from 'vitest';
import type { Font, FontSet, Page } from '@domain/shared/document';
import { forDrawing } from '@domain/shared/document';
import { unprintableIn } from './unprintable';

/** A face that draws exactly the code points it is given, and nothing else. */
function faceOf(name: string, codes: readonly number[]): Font {
  return {
    name,
    program: new Uint8Array(0),
    unitsPerEm: 1000,
    cmap: new Map(codes.map((code, glyph) => [code, glyph + 1])),
    widths: new Map(codes.map((_, glyph) => [glyph + 1, 500])),
    numGlyphs: codes.length + 1,
    bbox: [0, 0, 1000, 1000],
    ascent: 800,
    descent: -200,
    capHeight: 700,
    italicAngle: 0,
    arabic: false,
  };
}

const codesOf = (text: string) => [...text].map((c) => c.codePointAt(0) ?? 0);
const LATIN = codesOf(' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:');
const ARABIC_WORD = 'سلام';

/** Latin in both Latin faces; the Arabic word, shaped as drawn, in the Arabic face only. */
function fonts(withArabicBold: boolean): FontSet {
  const arabic = [0x20, ...forDrawing(ARABIC_WORD), ...codesOf(ARABIC_WORD)];
  return {
    regular: faceOf('Regular', LATIN),
    bold: faceOf('Bold', LATIN),
    arabic: faceOf('Arabic', arabic),
    ...(withArabicBold ? { arabicBold: faceOf('ArabicBold', [0x20]) } : {}),
  };
}

function page(...texts: { text: string; bold?: boolean; rtl?: boolean }[]): Page {
  return {
    ops: texts.map((each) => ({
      kind: 'text' as const,
      x: 0,
      y: 0,
      text: each.text,
      style: { font: each.bold === true ? ('bold' as const) : ('regular' as const), size: 10 },
      ...(each.rtl === true ? { rtl: true } : {}),
    })),
  };
}

describe('unprintableIn', () => {
  it('finds nothing where every character has a face that draws it', () => {
    expect(unprintableIn([page({ text: 'Steady attention, 12.' })], fonts(false))).toEqual([]);
  });

  it('names a letter the Latin faces cannot draw, once, as its code point', () => {
    const pages = [page({ text: 'Łukasz' }), page({ text: 'Ł again', bold: true })];
    expect(unprintableIn(pages, fonts(false))).toEqual(['U+0141']);
  });

  it('asks the Arabic face of an Arabic letter, shaped as it is drawn, and never a Latin one', () => {
    expect(unprintableIn([page({ text: ARABIC_WORD, rtl: true })], fonts(false))).toEqual([]);
  });

  it('asks the bold Arabic face of bold Arabic when the set carries one', () => {
    const found = unprintableIn([page({ text: ARABIC_WORD, rtl: true, bold: true })], fonts(true));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((code) => /^U\+[0-9A-F]{4,6}$/.test(code))).toBe(true);
  });

  it('lists what it finds in order of code point, whatever order the pages hold them in', () => {
    const pages = [page({ text: 'ž' }), page({ text: 'Ł' }), page({ text: 'ß' })];
    expect(unprintableIn(pages, fonts(false))).toEqual(['U+00DF', 'U+0141', 'U+017E']);
  });

  it('reads only words: a rule, a picture or a shape has no character to draw', () => {
    const drawn: Page = {
      ops: [
        { kind: 'rule', x: 0, y: 0, width: 10 },
        { kind: 'image', image: 'logo', x: 0, y: 0, width: 10, height: 10 },
      ],
    };
    expect(unprintableIn([drawn], fonts(false))).toEqual([]);
  });
});
