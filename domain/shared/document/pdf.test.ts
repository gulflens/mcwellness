import { describe, expect, it } from 'vitest';
import { extractText } from './extract';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  renderPdf,
  type DocumentImage,
  type FontSet,
  type Page,
} from './pdf';
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

// --------------------------------------------------------------------------
// Images
// --------------------------------------------------------------------------

/**
 * The one picture these documents draw: the practice's own mark at the top of
 * an invoice (docs/SPEC/billing.md section 5.6).
 *
 * **Nothing is decoded on the way in.** A PNG's IDAT stream is already
 * zlib-deflated scanlines carrying PNG's own per-row predictor bytes, which is
 * exactly what PDF's `/FlateDecode` with `/Predictor 15` consumes — so the
 * bytes the practice uploaded are the bytes in the file, and no image library
 * enters the dependency tree of the path that renders a household's financial
 * record.
 *
 * As with the colour operator before it, the promise that matters most is the
 * one about absence: a page that draws no image must render to exactly the
 * bytes it did before the writer could draw one.
 */

/** A four-byte "image": the writer embeds it verbatim and never looks inside. */
const MARK: DocumentImage = {
  width: 2,
  height: 2,
  colours: 'rgb',
  data: new Uint8Array([0x78, 0x9c, 0x01, 0x00]),
};

const IMAGE_PAGE: Page = {
  ops: [
    { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
    { kind: 'image', image: 'logo', x: 200, y: 720, width: 150, height: 60 },
    { kind: 'text', x: 56, y: 670, text: 'Under', style: { font: 'regular', size: 10 } },
  ],
};

describe('a page that draws an image', () => {
  const file = (): string =>
    new TextDecoder('latin1').decode(renderPdf([IMAGE_PAGE], fonts, 'Synthetic', { logo: MARK }));

  it('names the image as a resource of the page that draws it', () => {
    expect(file()).toContain('/XObject << /Im1');
  });

  it('writes the bitmap as an image object a reader can decode without unpacking it', () => {
    const text = file();
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Width 2');
    expect(text).toContain('/Height 2');
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/BitsPerComponent 8');
    expect(text).toContain('/Filter /FlateDecode');
    // PNG's own predictor and PDF's are the same arithmetic, which is the
    // whole reason the IDAT bytes go in untouched.
    expect(text).toContain(
      '/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2 >>',
    );
  });

  it('draws it at the size and the corner it was given, inside its own q and Q', () => {
    const stream = streamOf(renderPdf([IMAGE_PAGE], fonts, 'Synthetic', { logo: MARK }));
    expect(stream).toContain('q 150 0 0 60 200 720 cm /Im1 Do Q');
  });

  it('leaves the text either side of it exactly as it was', () => {
    // An image between two text runs may not leak a transform onto the second:
    // the fill is untouched, the q/Q is balanced, and the text state is the
    // text state.
    const stream = streamOf(renderPdf([IMAGE_PAGE], fonts, 'Synthetic', { logo: MARK }));
    const lines = stream.split('\n');
    expect(lines.filter((line) => line.startsWith('q ')).length).toBe(1);
    expect(lines.filter((line) => line.endsWith(' Q')).length).toBe(1);
    expect(stream).toContain('1 0 0 1 56 670 Tm');
  });

  it('embeds a greyscale bitmap as one component rather than three', () => {
    const page: Page = {
      ops: [{ kind: 'image', image: 'mark', x: 0, y: 0, width: 10, height: 10 }],
    };
    const text = new TextDecoder('latin1').decode(
      renderPdf([page], fonts, 'Synthetic', { mark: { ...MARK, colours: 'grey' } }),
    );
    expect(text).toContain('/ColorSpace /DeviceGray');
    expect(text).toContain('/Colors 1');
  });

  it('writes only the images a page actually drew', () => {
    const text = new TextDecoder('latin1').decode(
      renderPdf([IMAGE_PAGE], fonts, 'Synthetic', { logo: MARK, unused: { ...MARK, width: 99 } }),
    );
    expect(text).not.toContain('/Width 99');
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(1);
  });

  it('draws nothing at all for an image the caller never supplied', () => {
    // The same discipline a character no face can draw is held to: the page is
    // rendered without it rather than with a box where the practice's mark
    // should be.
    const stream = streamOf(renderPdf([IMAGE_PAGE], fonts, 'Synthetic'));
    expect(stream).not.toContain('Do');
    expect(stream).toContain('1 0 0 1 56 670 Tm');
  });
});

describe('a page that draws no image', () => {
  it('renders to exactly the bytes it did before the writer could draw one', () => {
    expect(streamOf(renderPdf([GREY_PAGE], fonts, 'Synthetic'))).toBe(GREY_STREAM_BEFORE_COLOUR);
  });

  it('gains no /XObject key in its resources, with or without an images argument', () => {
    const without = renderPdf([GREY_PAGE], fonts, 'Synthetic');
    const with_ = renderPdf([GREY_PAGE], fonts, 'Synthetic', { logo: MARK });
    expect(new TextDecoder('latin1').decode(without)).not.toContain('/XObject');
    // An unused image is not written, so the two files are the same file.
    expect(Buffer.from(with_).equals(Buffer.from(without))).toBe(true);
  });
});

describe('a rule that is not horizontal', () => {
  it('runs from where it starts to where its rise puts it', () => {
    // The side of a totals box (docs/SPEC/billing.md section 5.6): the same op
    // with no run and a rise.
    const page: Page = { ops: [{ kind: 'rule', x: 300, y: 400, width: 0, dy: 60 }] };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toContain(
      'q 0.50 w 0.80 G 300 400 m 300 460 l S Q',
    );
  });

  it('leaves a rule with no rise exactly as it was', () => {
    const page: Page = { ops: [{ kind: 'rule', x: 56, y: 690, width: 200 }] };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe(
      'q 0.50 w 0.80 G 56 690 m 256 690 l S Q',
    );
  });
});

/**
 * The filled and stroked rectangle the practice's own invoice design is drawn
 * with: violet bands, tinted cards, rounded corners and a pill.
 *
 * Every rectangle lives inside its own q/Q, as a rule does, so the colour it
 * paints is discarded at the Q and the writer's record of what fill the text
 * was last given stays true. The golden greyscale stream above is the proof
 * that a page drawing no rectangle is the page it always was.
 */
describe('a rectangle', () => {
  const VIOLET = [0.22, 0.02, 0.45] as const;

  it('fills a square rectangle in one line, inside its own q and Q', () => {
    const page: Page = {
      ops: [{ kind: 'rect', x: 20, y: 30, width: 100, height: 40, fill: { rgb: VIOLET } }],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe(
      'q 0.22 0.02 0.45 rg 20 30 100 40 re f Q',
    );
  });

  it('fills in grey when given a grey rather than a colour', () => {
    const page: Page = {
      ops: [{ kind: 'rect', x: 20, y: 30, width: 100, height: 40, fill: { grey: 0.95 } }],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe('q 0.95 g 20 30 100 40 re f Q');
  });

  it('rounds its corners with four lines and four arcs, closed before it is painted', () => {
    const page: Page = {
      ops: [
        {
          kind: 'rect',
          x: 20,
          y: 30,
          width: 100,
          height: 40,
          radius: 10,
          fill: { rgb: VIOLET },
        },
      ],
    };
    // κ·r = 5.523, so each arc's control points sit 4.48 in from the corner's
    // tangent points (10 − 5.523), which is what bends a quarter circle.
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe(
      'q 0.22 0.02 0.45 rg ' +
        '30 30 m 110 30 l 115.52 30 120 34.48 120 40 c ' +
        '120 60 l 120 65.52 115.52 70 110 70 c ' +
        '30 70 l 24.48 70 20 65.52 20 60 c ' +
        '20 40 l 20 34.48 24.48 30 30 30 c h f Q',
    );
  });

  it('never lets a radius exceed half the shorter side, so a pill stays a pill', () => {
    const page: Page = {
      ops: [{ kind: 'rect', x: 0, y: 0, width: 60, height: 20, radius: 50, fill: { grey: 0.9 } }],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    // Clamped to 10: the straight runs begin 10 in from either end.
    expect(stream).toContain('10 0 m 50 0 l');
    expect(stream.match(/ c /g)).toHaveLength(4);
    expect(stream.match(/ l /g)).toHaveLength(4);
    expect(stream.endsWith(' h f Q')).toBe(true);
  });

  it('paints fill and stroke together with B', () => {
    const page: Page = {
      ops: [
        {
          kind: 'rect',
          x: 20,
          y: 30,
          width: 100,
          height: 40,
          fill: { grey: 1 },
          stroke: { rgb: VIOLET, thickness: 1 },
        },
      ],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe(
      'q 1 g 0.22 0.02 0.45 RG 1 w 20 30 100 40 re B Q',
    );
  });

  it('strokes only, with S, in the rule’s own default hairline when nothing else is said', () => {
    const page: Page = {
      ops: [{ kind: 'rect', x: 20, y: 30, width: 100, height: 40, stroke: {} }],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe(
      'q 0.80 G 0.50 w 20 30 100 40 re S Q',
    );
  });

  it('strokes a rounded rectangle with S after closing it', () => {
    const page: Page = {
      ops: [
        {
          kind: 'rect',
          x: 20,
          y: 30,
          width: 100,
          height: 40,
          radius: 6,
          stroke: { grey: 0.3, thickness: 0.75 },
        },
      ],
    };
    const stream = streamOf(renderPdf([page], fonts, 'Synthetic'));
    expect(stream.startsWith('q 0.30 G 0.75 w 26 30 m ')).toBe(true);
    expect(stream.endsWith(' h S Q')).toBe(true);
  });

  it('clamps a colour outside 0 to 1, as every other colour in the file is', () => {
    const page: Page = {
      ops: [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: { rgb: [1.4, -0.2, 0.5] } }],
    };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe('q 1 0 0.50 rg 0 0 10 10 re f Q');
  });

  it('leaves the text after it to set its own fill, and leaks nothing onto it', () => {
    // A rectangle first on a page: the text after it has been told nothing, so
    // it says its grey itself.
    const first: Page = {
      ops: [
        { kind: 'rect', x: 20, y: 30, width: 100, height: 40, fill: { rgb: VIOLET } },
        { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
      ],
    };
    expect(
      streamOf(renderPdf([first], fonts, 'Synthetic'))
        .split('\n')
        .slice(0, 3),
    ).toEqual(['q 0.22 0.02 0.45 rg 20 30 100 40 re f Q', '0 g', 'BT']);

    // Between two lines of ink: the violet is discarded at the Q, so the
    // reader's fill is still the ink the first line set, and the violet is
    // said nowhere but inside the rectangle's own q/Q.
    const between: Page = {
      ops: [
        { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
        { kind: 'rect', x: 20, y: 30, width: 100, height: 40, fill: { rgb: VIOLET } },
        { kind: 'text', x: 56, y: 670, text: 'Ink', style: { font: 'regular', size: 10 } },
      ],
    };
    const lines = streamOf(renderPdf([between], fonts, 'Synthetic')).split('\n');
    expect(lines.filter((line) => line === '0 g')).toHaveLength(1);
    expect(
      lines.filter((line) => line.includes(' rg')).every((line) => line.startsWith('q ')),
    ).toBe(true);

    // And a page with no rectangle on it is the page it always was.
    expect(streamOf(renderPdf([GREY_PAGE], fonts, 'Synthetic'))).toBe(GREY_STREAM_BEFORE_COLOUR);
  });

  it('writes nought for a number that is not finite, so the stream still parses', () => {
    // A NaN or an infinity written as itself is "NaN" or "Infinity" in the
    // content stream — not a number, and a page a reader refuses to open.
    const square: Page = {
      ops: [
        {
          kind: 'rect',
          x: 20,
          y: 30,
          width: Number.POSITIVE_INFINITY,
          height: 1e21,
          fill: { grey: 0.9 },
        },
      ],
    };
    expect(streamOf(renderPdf([square], fonts, 'Synthetic'))).toBe('q 0.90 g 20 30 0 0 re f Q');

    const rounded: Page = {
      ops: [
        {
          kind: 'rect',
          x: 20,
          y: 30,
          width: Number.NaN,
          height: 40,
          radius: Number.POSITIVE_INFINITY,
          fill: { grey: 0.9 },
        },
      ],
    };
    const stream = streamOf(renderPdf([rounded], fonts, 'Synthetic'));
    expect(stream).not.toMatch(/NaN|Infinity|e\+/);
    // Every token is a number or one of the operators a rectangle uses.
    for (const token of stream.split(' ')) {
      expect(token, stream).toMatch(/^(-?\d+(\.\d+)?|q|Q|g|m|l|c|h|f)$/);
    }
    expect(stream.startsWith('q 0.90 g ')).toBe(true);
    expect(stream.endsWith(' h f Q')).toBe(true);
  });

  it('draws nothing for a rectangle with neither a fill nor a stroke', () => {
    const page: Page = { ops: [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10 }] };
    expect(streamOf(renderPdf([page], fonts, 'Synthetic'))).toBe('');
  });

  it('renders the same rectangles to the same bytes every time', () => {
    const page: Page = {
      ops: [
        { kind: 'rect', x: 0, y: 780, width: PAGE_WIDTH, height: 62, fill: { rgb: VIOLET } },
        {
          kind: 'rect',
          x: 40,
          y: 500,
          width: 250,
          height: 120,
          radius: 8,
          fill: { rgb: [0.95, 0.93, 0.98] },
          stroke: { rgb: VIOLET, thickness: 0.5 },
        },
        { kind: 'text', x: 56, y: 700, text: 'Ink', style: { font: 'regular', size: 10 } },
      ],
    };
    const once = renderPdf([page], fonts, 'Synthetic');
    const again = renderPdf([page], fonts, 'Synthetic');
    expect(Buffer.from(once).equals(Buffer.from(again))).toBe(true);
  });
});
