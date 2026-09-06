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

// --------------------------------------------------------------------------
// Colour
// --------------------------------------------------------------------------

/**
 * The one hue this writer may set, and the promise that nothing already filed
 * moves because it exists (docs/CHANGE-REQUESTS/reports-01.md, request R3).
 *
 * `docs/DESIGN-BRIEF.md` section 5 gives the session ribbon one hue per band
 * and calls it "the one place hue enters a report". Until round 34 the writer
 * had no operator for a colour at all, so the printed strip carried the whole
 * of the figure's shape in ink. It has one now — and an invoice the practice
 * handed a family in March must still render to the bytes it was filed as, so
 * the grey path is not merely equivalent, it is untouched.
 */

/** The one page's content stream, out of the rendered file. */
function streamOf(bytes: Uint8Array): string {
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.indexOf('stream\n');
  const end = text.indexOf('\nendstream', at);
  return text.slice(at + 'stream\n'.length, end);
}

/** Text and rules, in ink and in grey, and not a colour anywhere. */
const GREY_PAGE: Page = {
  ops: [
    { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
    { kind: 'rule', x: 56, y: 690, width: 200 },
    { kind: 'text', x: 56, y: 670, text: 'Muted', style: { font: 'regular', size: 9, grey: 0.42 } },
    { kind: 'text', x: 56, y: 655, text: 'Still', style: { font: 'bold', size: 9, grey: 0.42 } },
    { kind: 'rule', x: 56, y: 640, width: 120, thickness: 2, grey: 0.3 },
    { kind: 'text', x: 400, y: 620, text: 'Back', style: { font: 'regular', size: 10, grey: 0 } },
  ],
};

/**
 * What the writer produced for `GREY_PAGE` **before** the colour operator was
 * added, captured from the running writer and kept here verbatim.
 *
 * This is the whole point of the test: not that the two paths agree in spirit
 * but that this exact text still comes out. Nothing about it may be
 * regenerated from the writer — if a change makes this fail, the change moved
 * a document somebody has already been handed.
 */
const GREY_STREAM_BEFORE_COLOUR = [
  '0 g',
  'BT',
  '/F1 10 Tf',
  '1 0 0 1 56 700 Tm',
  '<002A004F004C> Tj',
  'ET',
  'q 0.50 w 0.80 G 56 690 m 256 690 l S Q',
  '0.42 g',
  'BT',
  '/F1 9 Tf',
  '1 0 0 1 56 670 Tm',
  '<002E0056005500460045> Tj',
  'ET',
  'BT',
  '/F2 9 Tf',
  '1 0 0 1 56 655 Tm',
  '<00340055004A004D004D> Tj',
  'ET',
  'q 2 w 0.30 G 56 640 m 176 640 l S Q',
  '0 g',
  'BT',
  '/F1 10 Tf',
  '1 0 0 1 400 620 Tm',
  '<002300420044004C> Tj',
  'ET',
].join('\n');

describe('a document with no colour on it', () => {
  it('renders to exactly the bytes it did before the writer could set one', () => {
    expect(streamOf(renderPdf([GREY_PAGE], fonts, 'Synthetic'))).toBe(GREY_STREAM_BEFORE_COLOUR);
  });

  it('sets no colour operator at all', () => {
    const stream = streamOf(renderPdf([GREY_PAGE], fonts, 'Synthetic'));
    expect(stream).not.toMatch(/(^|\s)rg(\s|$)/);
    expect(stream).not.toMatch(/(^|\s)RG(\s|$)/);
  });

  it('still says a grey once and not again for the op beside it', () => {
    // Two ops at 0.42 in a row; the writer tracks what it has set, and the
    // colour operator must not have cost that.
    const stream = streamOf(renderPdf([GREY_PAGE], fonts, 'Synthetic'));
    expect(stream.match(/(^|\n)0\.42 g(\n|$)/g)).toHaveLength(1);
  });
});

describe('a document that carries the ribbon’s hue', () => {
  it('strokes a rule in the colour it was given', () => {
    const page: Page = {
      ops: [{ kind: 'rule', x: 56, y: 690, width: 200, thickness: 3, rgb: [0.24, 0.29, 0.53] }],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    expect(stream).toContain('q 3 w 0.24 0.29 0.53 RG 56 690 m 256 690 l S Q');
    // The stroke stays inside its own q/Q, as the grey one always has, so the
    // op after it inherits nothing.
    expect(stream).not.toMatch(/(^|\s)G(\s|$)/);
  });

  it('fills type in the colour it was given', () => {
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 56,
          y: 700,
          text: 'Hue',
          style: { font: 'regular', size: 10, rgb: [1, 0.5, 0] },
        },
      ],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toContain('1 0.50 0 rg');
  });

  it('clamps a value outside 0 to 1 rather than writing a number a reader would refuse', () => {
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 56,
          y: 700,
          text: 'Hue',
          style: { font: 'regular', size: 10, rgb: [-2, 0.5, 9] },
        },
      ],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toContain('0 0.50 1 rg');
  });

  it('writes 0 for a component that is not a finite number at all', () => {
    // The clamp answers a non-finite component with 0 rather than with the
    // operator `NaN 0.50 0 rg`, which a reader is entitled to refuse, to clamp
    // itself, or to draw something nobody chose. Nothing reachable sends one —
    // every triple in the repository comes from `domain/shared/bands.ts` and
    // is proved against `tokens.css` — but this is the path that files a
    // household's most personal document, and a black component is a smaller
    // fault than a page that will not open (the round's default 13).
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 56,
          y: 700,
          text: 'Hue',
          style: { font: 'regular', size: 10, rgb: [Number.NaN, 0.5, 0.25] },
        },
      ],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    expect(stream).toContain('0 0.50 0.25 rg');
    expect(stream).not.toContain('NaN');
  });

  it('goes back to grey when the next op has no colour, and to colour again after', () => {
    const page: Page = {
      ops: [
        { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
        {
          kind: 'text',
          x: 56,
          y: 685,
          text: 'Hue',
          style: { font: 'regular', size: 10, rgb: [0.24, 0.29, 0.53] },
        },
        { kind: 'text', x: 56, y: 670, text: 'Ink', style: { font: 'regular', size: 10 } },
        {
          kind: 'text',
          x: 56,
          y: 655,
          text: 'Hue',
          style: { font: 'regular', size: 10, rgb: [0.24, 0.29, 0.53] },
        },
      ],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    const set = stream.split('\n').filter((line) => / (g|rg)$/.test(line));
    // A colour set is reset by the grey after it, and set again after that:
    // whichever of the two the writer tracked alone, one of these four would
    // be missing and a line would come out the wrong colour.
    expect(set).toEqual(['0 g', '0.24 0.29 0.53 rg', '0 g', '0.24 0.29 0.53 rg']);
  });

  it('says the same colour once when two ops in a row carry it', () => {
    const page: Page = {
      ops: [
        {
          kind: 'text',
          x: 56,
          y: 700,
          text: 'One',
          style: { font: 'regular', size: 10, rgb: [0.24, 0.29, 0.53] },
        },
        {
          kind: 'text',
          x: 56,
          y: 685,
          text: 'Two',
          style: { font: 'regular', size: 10, rgb: [0.24, 0.29, 0.53] },
        },
      ],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    expect(stream.match(/0\.24 0\.29 0\.53 rg/g)).toHaveLength(1);
  });
});
