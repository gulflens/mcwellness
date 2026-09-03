/**
 * Just enough of a TrueType font to embed it in a PDF and set text in it.
 *
 * Pure, and browser-safe: bytes in, numbers out. No file is opened here and no
 * Node built-in is imported — `app/api/billing/fonts.ts` is what reads the
 * faces off disk and turns the packaged `.woff` files into the plain sfnt this
 * expects (.claude/rules/testing.md, docs/SPEC/OWNERSHIP.md's browser-safe
 * barrel rule).
 *
 * Why a parser at all, rather than a library. A rendered invoice has to carry
 * its own type: it is a document a family keeps and a tax authority may read,
 * and a page that falls back to whatever font the reader happens to have is a
 * page whose Arabic is missing. Embedding a font means knowing three things
 * about it — which glyph draws a character (`cmap`), how wide that glyph is
 * (`hmtx`), and the descriptive metrics a PDF viewer wants (`head`, `hhea`,
 * `OS/2`, `post`) — and that is the whole of what this reads. Everything else
 * in the file is passed through untouched as the embedded font program.
 *
 * The repository already carries IBM Plex Sans and IBM Plex Sans Arabic
 * (`@fontsource/*`), which is the app's own type, so no font is added and no
 * dependency is either.
 */

/** A parsed font: what the renderer needs, plus the bytes to embed. */
export type Font = {
  /** The PostScript-ish name used as the PDF BaseFont. Ascii, no spaces. */
  name: string;
  /** The sfnt bytes, embedded verbatim as the PDF's FontFile2. */
  program: Uint8Array;
  unitsPerEm: number;
  /** Unicode code point to glyph id. */
  cmap: ReadonlyMap<number, number>;
  /** Glyph id to advance width, in font units. */
  widths: ReadonlyMap<number, number>;
  numGlyphs: number;
  /** Font units, as the PDF FontDescriptor wants them. */
  bbox: readonly [number, number, number, number];
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  /** True when this face draws Arabic, so the renderer knows which to pick. */
  arabic: boolean;
};

type Reader = {
  u8(at: number): number;
  u16(at: number): number;
  i16(at: number): number;
  u32(at: number): number;
};

function readerFor(bytes: Uint8Array): Reader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u8: (at) => view.getUint8(at),
    u16: (at) => view.getUint16(at),
    i16: (at) => view.getInt16(at),
    u32: (at) => view.getUint32(at),
  };
}

/** The sfnt table directory: tag to its slice of the file. */
function tablesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const read = readerFor(bytes);
  const numTables = read.u16(4);
  const tables = new Map<string, Uint8Array>();
  for (let index = 0; index < numTables; index += 1) {
    const at = 12 + index * 16;
    const tag = String.fromCharCode(read.u8(at), read.u8(at + 1), read.u8(at + 2), read.u8(at + 3));
    const offset = read.u32(at + 8);
    const length = read.u32(at + 12);
    if (offset + length > bytes.length) {
      throw new Error(`The font's "${tag}" table runs past the end of the file.`);
    }
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return tables;
}

/**
 * The best Unicode `cmap` subtable, read into a plain map.
 *
 * Format 4 covers the basic multilingual plane and format 12 everything; both
 * appear in the wild and the two Plex faces here carry format 4. A subtable of
 * any other format is skipped rather than guessed at.
 */
function readCmap(table: Uint8Array): Map<number, number> {
  const read = readerFor(table);
  const numSubtables = read.u16(2);
  let chosen = -1;
  let chosenScore = -1;
  for (let index = 0; index < numSubtables; index += 1) {
    const at = 4 + index * 8;
    const platform = read.u16(at);
    const encoding = read.u16(at + 2);
    const offset = read.u32(at + 4);
    if (offset + 2 > table.length) continue;
    const format = read.u16(offset);
    // Windows full repertoire, then Windows BMP, then anything Unicode.
    let score = -1;
    if (platform === 3 && encoding === 10 && format === 12) score = 3;
    else if (platform === 3 && encoding === 1 && format === 4) score = 2;
    else if (platform === 0 && (format === 4 || format === 12)) score = 1;
    if (score > chosenScore) {
      chosenScore = score;
      chosen = offset;
    }
  }
  if (chosen < 0) {
    throw new Error('That font carries no Unicode character map this can read.');
  }

  const map = new Map<number, number>();
  const format = read.u16(chosen);
  if (format === 4) {
    const segCountX2 = read.u16(chosen + 6);
    const segCount = segCountX2 / 2;
    const endsAt = chosen + 14;
    const startsAt = endsAt + segCountX2 + 2;
    const deltasAt = startsAt + segCountX2;
    const rangesAt = deltasAt + segCountX2;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = read.u16(endsAt + segment * 2);
      const start = read.u16(startsAt + segment * 2);
      const delta = read.i16(deltasAt + segment * 2);
      const rangeOffset = read.u16(rangesAt + segment * 2);
      if (start > end) continue;
      for (let code = start; code <= end && code !== 0xffff; code += 1) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (code + delta) & 0xffff;
        } else {
          const at = rangesAt + segment * 2 + rangeOffset + (code - start) * 2;
          if (at + 1 >= table.length) continue;
          glyph = read.u16(at);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) map.set(code, glyph);
      }
    }
    return map;
  }

  // Format 12: a list of contiguous groups.
  const groups = read.u32(chosen + 12);
  for (let index = 0; index < groups; index += 1) {
    const at = chosen + 16 + index * 12;
    const start = read.u32(at);
    const end = read.u32(at + 4);
    const startGlyph = read.u32(at + 8);
    for (let code = start; code <= end; code += 1) {
      map.set(code, startGlyph + (code - start));
    }
  }
  return map;
}

/**
 * Advance widths per glyph. `hmtx` gives `numberOfHMetrics` pairs and then
 * bare left-side bearings: every glyph past that count keeps the last width,
 * which is how monospaced tails are stored.
 */
function readWidths(
  hmtx: Uint8Array,
  numberOfHMetrics: number,
  numGlyphs: number,
): Map<number, number> {
  const read = readerFor(hmtx);
  const widths = new Map<number, number>();
  let last = 0;
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    if (glyph < numberOfHMetrics) {
      const at = glyph * 4;
      if (at + 1 >= hmtx.length) break;
      last = read.u16(at);
    }
    widths.set(glyph, last);
  }
  return widths;
}

/**
 * Reads a font from its sfnt bytes.
 *
 * `name` is the PDF BaseFont and is the caller's to choose, because the font's
 * own `name` table is a thicket of platform encodings and nothing in a PDF
 * depends on the two agreeing. `arabic` likewise: the renderer decides which
 * face draws which script, and this only carries the answer.
 */
export function readFont(program: Uint8Array, options: { name: string; arabic?: boolean }): Font {
  const tables = tablesOf(program);
  const need = (tag: string): Uint8Array => {
    const table = tables.get(tag);
    if (!table) throw new Error(`That font has no "${tag}" table.`);
    return table;
  };

  const head = readerFor(need('head'));
  const unitsPerEm = head.u16(18);
  if (unitsPerEm === 0) throw new Error('That font declares no units per em.');

  const maxp = readerFor(need('maxp'));
  const numGlyphs = maxp.u16(4);

  const hhea = readerFor(need('hhea'));
  const numberOfHMetrics = hhea.u16(34);

  const os2Table = tables.get('OS/2');
  const os2 = os2Table ? readerFor(os2Table) : null;
  const os2Version = os2 ? os2.u16(0) : 0;

  // sTypoAscender/Descender when OS/2 is there, the hhea pair otherwise; both
  // are in font units and both are scaled to the PDF's thousandths below.
  const ascent = os2 ? os2.i16(68) : hhea.i16(4);
  const descent = os2 ? os2.i16(70) : hhea.i16(6);
  // sCapHeight only exists from OS/2 version 2. Above that, seven tenths of the
  // em is the conventional stand-in and no viewer relies on it for layout.
  const capHeight =
    os2 && os2Version >= 2 && os2Table && os2Table.length >= 90
      ? os2.i16(88)
      : Math.round(unitsPerEm * 0.7);

  const postTable = tables.get('post');
  const italicAngle = postTable
    ? // A 16.16 fixed-point number: the whole part is the signed upper half.
      readerFor(postTable).i16(4)
    : 0;

  const scale = 1000 / unitsPerEm;
  const bbox: [number, number, number, number] = [
    Math.round(head.i16(36) * scale),
    Math.round(head.i16(38) * scale),
    Math.round(head.i16(40) * scale),
    Math.round(head.i16(42) * scale),
  ];

  return {
    name: options.name,
    program,
    unitsPerEm,
    cmap: readCmap(need('cmap')),
    widths: readWidths(need('hmtx'), numberOfHMetrics, numGlyphs),
    numGlyphs,
    bbox,
    ascent: Math.round(ascent * scale),
    descent: Math.round(descent * scale),
    capHeight: Math.round(capHeight * scale),
    italicAngle,
    arabic: options.arabic === true,
  };
}

/** The glyph a code point draws in this font, or null when it draws none. */
export function glyphFor(font: Font, codePoint: number): number | null {
  return font.cmap.get(codePoint) ?? null;
}

/** How wide a glyph is, in thousandths of an em — the unit a PDF wants. */
export function widthOf(font: Font, glyph: number): number {
  const raw = font.widths.get(glyph) ?? 0;
  return Math.round((raw * 1000) / font.unitsPerEm);
}
