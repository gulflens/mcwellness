import { describe, expect, it } from 'vitest';
import { extractText } from './extract';
import { PAGE_HEIGHT, renderPdf, type FontSet, type Page } from './pdf';
import type { Font } from './truetype';

/**
 * What a person gets when they select a line of a rendered document and copy
 * it.
 *
 * A PDF places glyphs; the only thing that tells a reader what those glyphs
 * *say* is the `/ToUnicode` map the writer embeds beside each face. For Latin
 * the two are the same thing. For Arabic they are not: the writer shapes each
 * letter into the presentation form it takes in its word and reverses the run
 * before drawing it, so a map built from the glyphs drawn hands back the FE70
 * block in visual order — legible on the page, unusable on the clipboard and
 * unfindable by a search. So the map is built from the letters each glyph was
 * made from instead, which is what these tests assert.
 *
 * Fixture-free and font-free: the faces below are synthetic, a code point to a
 * glyph number and a width, which is all the writer asks of a font. Nothing
 * here reads a real font file, so this stays a test of the writer.
 */

/** A face that draws every code point in the given ranges, one glyph each. */
function syntheticFont(
  name: string,
  ranges: ReadonlyArray<readonly [number, number]>,
  arabic: boolean,
): Font {
  const cmap = new Map<number, number>();
  let next = 1;
  for (const [from, to] of ranges) {
    for (let code = from; code <= to; code += 1) {
      cmap.set(code, next);
      next += 1;
    }
  }
  const widths = new Map([...cmap.values()].map((glyph) => [glyph, 500] as const));
  return {
    name,
    // Never parsed by the writer: it is embedded verbatim as the FontFile2.
    program: new Uint8Array([0, 1, 0, 0]),
    unitsPerEm: 1000,
    cmap,
    widths,
    numGlyphs: next,
    bbox: [0, -200, 1000, 800],
    ascent: 800,
    descent: -200,
    capHeight: 700,
    italicAngle: 0,
    arabic,
  };
}

const LATIN: readonly (readonly [number, number])[] = [[0x0020, 0x007e]];
const ARABIC: readonly (readonly [number, number])[] = [
  [0x0020, 0x0020],
  [0x0600, 0x06ff],
  [0xfb50, 0xfefc],
];

const fonts: FontSet = {
  regular: syntheticFont('Synthetic', LATIN, false),
  bold: syntheticFont('Synthetic-Bold', LATIN, false),
  arabic: syntheticFont('SyntheticArabic', ARABIC, true),
};

/** One right-to-left line on one page, rendered and read back. */
function copiedFrom(text: string): string {
  const page: Page = {
    ops: [
      {
        kind: 'text',
        x: 400,
        y: PAGE_HEIGHT - 100,
        text,
        style: { font: 'regular', size: 10 },
        rtl: true,
      },
    ],
  };
  return extractText(renderPdf([page], fonts, 'Synthetic')).join('');
}

/** The Arabic Presentation Forms blocks: the shapes a page draws, never what a person types. */
const PRESENTATION_FORMS = /[\uFB50-\uFEFF]/;

describe('copying Arabic off a rendered page', () => {
  it('gives back the letters somebody would type, not the shapes they are drawn as', () => {
    const copied = copiedFrom('فاتورة');
    expect(copied).not.toMatch(PRESENTATION_FORMS);
    expect([...copied].sort().join('')).toBe([...'فاتورة'].sort().join(''));
  });

  it('gives back the whole word, once the right-to-left run is turned round', () => {
    // The glyphs are drawn left to right in the order they appear on the page,
    // so what comes off the clipboard is the line in visual order — which is
    // exactly what a reader's bidirectional algorithm expects to be handed,
    // and can only turn round correctly when it is holding real letters.
    expect([...copiedFrom('فاتورة')].reverse().join('')).toBe('فاتورة');
  });

  it('turns one lam-alef glyph back into the two letters it is spelt with', () => {
    expect([...copiedFrom('لا')].reverse().join('')).toBe('لا');
  });

  it('keeps a Latin reference inside an Arabic phrase readable and the right way round', () => {
    const copied = copiedFrom('فاتورة INV-000001');
    expect(copied).toContain('INV-000001');
    expect(copied).not.toMatch(PRESENTATION_FORMS);
  });

  it('gives back the bracket that was written, not the one that was drawn', () => {
    // A right-to-left run draws the mirror image of a bracket, because the one
    // that opens the phrase is the one on the right. The character somebody
    // wrote is still the one they should get back.
    const copied = copiedFrom('(فاتورة)');
    expect([...copied].reverse().join('')).toBe('(فاتورة)');
  });

  it('leaves Latin exactly as it always was', () => {
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 60,
          y: PAGE_HEIGHT - 100,
          text: 'Invoice INV-000001',
          style: { font: 'regular', size: 10 },
        },
      ],
    };
    expect(extractText(renderPdf([page], fonts, 'Synthetic')).join('')).toBe('Invoice INV-000001');
  });

  it('does not let a bracket in an Arabic run change what an English label copies as', () => {
    // Both brackets below are drawn by the Latin face, which has one
    // `/ToUnicode` map between them, and the Arabic run draws each as its
    // mirror image. So the glyph that draws ")" stands for ")" in the label and
    // for "(" in the Arabic line, and the map has one entry to say it with.
    // The Arabic line is drawn second, so before this was fixed the label
    // copied as "Total )AED(" — a real invoice's English half broken by a pair
    // of brackets in a legal name or a line description.
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 60,
          y: PAGE_HEIGHT - 100,
          text: 'Total (AED)',
          style: { font: 'regular', size: 10 },
        },
        {
          kind: 'text',
          x: 535,
          y: PAGE_HEIGHT - 120,
          text: '(فاتورة)',
          style: { font: 'regular', size: 10 },
          rtl: true,
        },
      ],
    };
    const lines = extractText(renderPdf([page], fonts, 'Synthetic'));

    expect(lines[0]).toBe('Total (AED)');

    // And the Arabic run still hands back its own letters rather than the
    // shapes it draws them as. Its brackets are the one thing that gives way:
    // a glyph cannot stand for two characters at once, so they come off the
    // page as drawn, while the word between them is intact and searchable.
    const arabic = lines.slice(1).join('');
    expect(arabic).not.toMatch(PRESENTATION_FORMS);
    expect([...arabic].reverse().join('')).toBe(')فاتورة(');
  });
});
