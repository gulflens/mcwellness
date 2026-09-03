/**
 * A very small PDF writer: enough to set bilingual type, rule a line, and
 * embed the two faces the app already uses.
 *
 * **Why this exists rather than a library.** An invoice is a document the
 * practice hands to a family and a tax authority may read, so it has to carry
 * its own type and be byte-identical every time it is rendered from the same
 * row. What that needs from a PDF is narrow: pages, text in an embedded
 * TrueType font, and horizontal rules. No images, no colour, no forms, no
 * transparency, no compression. `package.json` is the shared zone
 * (docs/SPEC/OWNERSHIP.md), so a dependency here is a change request and a
 * standing supply-chain surface on the one path that renders a client's
 * financial record; three hundred lines of well-understood file format is the
 * smaller thing to own. The fonts are already in the repository.
 *
 * **Deterministic on purpose.** Nothing here reads a clock or a random source.
 * The same document renders to the same bytes, so the sha256 on the `document`
 * row is stable, a re-render after a failed upload produces exactly the file
 * that was promised, and a test can assert the bytes rather than around them.
 *
 * Pure and browser-safe: no Node built-in, no I/O. The font programs arrive as
 * bytes from `app/api/billing/fonts.ts`.
 */

import { forDrawing, isArabic } from './arabic';
import { glyphFor, widthOf, type Font } from './truetype';

/** A4 in points, which is what the practice prints and what a phone shows. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

export type FontSlot = 'regular' | 'bold' | 'arabic';
export type FontSet = Readonly<Record<FontSlot, Font>>;

export type Style = {
  font: FontSlot;
  size: number;
  /** 0 is black, 1 is white. The ledger's only two greys are ink and a hairline. */
  grey?: number;
};

/** Where `x` sits relative to the text: its start, its end, or its middle. */
export type Align = 'start' | 'end' | 'centre';

export type Op =
  | {
      kind: 'text';
      x: number;
      /** Baseline, measured from the bottom of the page as PDF does. */
      y: number;
      text: string;
      style: Style;
      align?: Align;
      /** Right to left. Arabic lines set this; it is not inferred from the text. */
      rtl?: boolean;
    }
  | { kind: 'rule'; x: number; y: number; width: number; thickness?: number; grey?: number };

export type Page = { ops: Op[] };

/** A run of text one font can draw, already in the order it is placed. */
type Run = { slot: FontSlot; codes: number[] };

/**
 * Splits a string into runs by which face can draw it.
 *
 * This is not a nicety. The packaged IBM Plex Sans Arabic subset carries Arabic
 * and the space character and nothing else — no Latin letters, no digits, not
 * even a full stop — and the Latin subset carries no Arabic. A line that mixes
 * them has to change font mid-line or lose half of itself, silently.
 *
 * A space joins whichever run it follows, so "الفاتورة INV-000001" is two runs
 * and not four.
 */
function runsOf(text: string, latin: FontSlot, rtl: boolean): Run[] {
  const codes = rtl ? forDrawing(text) : [...text].map((c) => c.codePointAt(0) ?? 0);
  const runs: Run[] = [];
  for (const code of codes) {
    const slot: FontSlot = isArabic(code) ? 'arabic' : latin;
    const last = runs[runs.length - 1];
    // A space belongs to the run it follows: starting a new one on every space
    // would split a phrase into a run per word for no gain.
    if (last && (last.slot === slot || code === 0x20)) {
      last.codes.push(code);
      continue;
    }
    runs.push({ slot, codes: [code] });
  }
  return runs;
}

/** How wide a run is at a given size, in points. */
function widthOfRun(run: Run, fonts: FontSet, size: number): number {
  const font = fonts[run.slot];
  let total = 0;
  for (const code of run.codes) {
    const glyph = glyphFor(font, code);
    if (glyph === null) continue;
    total += widthOf(font, glyph);
  }
  return (total * size) / 1000;
}

/** How wide a line of text is at its style's size, in points. */
export function measure(text: string, style: Style, fonts: FontSet, rtl = false): number {
  return runsOf(text, style.font === 'bold' ? 'bold' : 'regular', rtl).reduce(
    (total, run) => total + widthOfRun(run, fonts, style.size),
    0,
  );
}

// --------------------------------------------------------------------------
// Bytes
// --------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Latin-1 bytes: PDF syntax outside a string is ascii, so this is exact. */
function ascii(text: string): Uint8Array {
  return encoder.encode(text);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

/** A number as PDF writes one: no exponent, no trailing noise. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * A stable file identifier, from the content rather than a clock or a random
 * source. Two renders of the same invoice are the same file, byte for byte,
 * which is what makes the hash on the `document` row mean something.
 */
function fingerprint(bytes: Uint8Array): string {
  // FNV-1a, 32 bits, run four times over the same bytes with different seeds to
  // fill the sixteen a PDF identifier wants. This names a file; it guards
  // nothing, and the document's own sha256 is what the record keeps.
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  return seeds
    .map((seed) => {
      let hash = seed >>> 0;
      for (const byte of bytes) {
        hash = (hash ^ byte) >>> 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    })
    .join('')
    .toUpperCase();
}

// --------------------------------------------------------------------------
// The content stream
// --------------------------------------------------------------------------

type Used = Map<FontSlot, Map<number, number>>;

/** Draws one page's operations, recording which glyphs each face was asked for. */
function contentOf(
  page: Page,
  fonts: FontSet,
  resourceOf: Map<FontSlot, string>,
  used: Used,
): string {
  const out: string[] = [];
  let grey = -1;

  const setGrey = (value: number): void => {
    if (grey !== value) {
      out.push(`${num(value)} g`);
      grey = value;
    }
  };

  for (const op of page.ops) {
    if (op.kind === 'rule') {
      const shade = op.grey ?? 0.8;
      out.push(
        `q ${num(op.thickness ?? 0.5)} w ${num(shade)} G ` +
          `${num(op.x)} ${num(op.y)} m ${num(op.x + op.width)} ${num(op.y)} l S Q`,
      );
      continue;
    }

    const latin: FontSlot = op.style.font === 'bold' ? 'bold' : 'regular';
    const runs = runsOf(op.text, latin, op.rtl === true);
    const total = runs.reduce((sum, run) => sum + widthOfRun(run, fonts, op.style.size), 0);
    const align = op.align ?? (op.rtl === true ? 'end' : 'start');
    let x = op.x;
    if (align === 'end') x = op.x - total;
    else if (align === 'centre') x = op.x - total / 2;

    setGrey(op.style.grey ?? 0);
    out.push('BT');
    for (const run of runs) {
      const font = fonts[run.slot];
      const resource = resourceOf.get(run.slot);
      if (!resource) continue;
      let glyphs = '';
      let seen = used.get(run.slot);
      if (!seen) {
        seen = new Map();
        used.set(run.slot, seen);
      }
      for (const code of run.codes) {
        const glyph = glyphFor(font, code);
        // A character this face cannot draw is dropped rather than replaced
        // with a box: every string on these documents comes from a row the
        // practice wrote, and a missing glyph is a fault to notice in review,
        // not something to paper over on a tax invoice.
        if (glyph === null) continue;
        glyphs += hex4(glyph);
        seen.set(glyph, code);
      }
      if (glyphs.length === 0) continue;
      out.push(`/${resource} ${num(op.style.size)} Tf`);
      out.push(`1 0 0 1 ${num(x)} ${num(op.y)} Tm`);
      out.push(`<${glyphs}> Tj`);
      x += widthOfRun(run, fonts, op.style.size);
    }
    out.push('ET');
  }
  return out.join('\n');
}

// --------------------------------------------------------------------------
// The file
// --------------------------------------------------------------------------

function toUnicodeCMap(glyphs: ReadonlyMap<number, number>): string {
  const entries = [...glyphs.entries()].sort((a, b) => a[0] - b[0]);
  const chunks: string[] = [];
  for (let at = 0; at < entries.length; at += 100) {
    const slice = entries.slice(at, at + 100);
    chunks.push(
      `${slice.length} beginbfchar\n` +
        slice
          .map(([glyph, code]) => {
            // Above the basic plane a code point is written as a surrogate
            // pair, which is what a PDF's UTF-16BE bfchar target wants.
            const text =
              code > 0xffff
                ? hex4(0xd800 + ((code - 0x10000) >> 10)) +
                  hex4(0xdc00 + ((code - 0x10000) & 0x3ff))
                : hex4(code);
            return `<${hex4(glyph)}> <${text}>`;
          })
          .join('\n') +
        '\nendbfchar',
    );
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    `${chunks.join('\n')}\n` +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'
  );
}

function widthsArray(font: Font, glyphs: ReadonlyMap<number, number>): string {
  const entries = [...glyphs.keys()].sort((a, b) => a - b);
  return `[${entries.map((glyph) => `${glyph}[${widthOf(font, glyph)}]`).join(' ')}]`;
}

/**
 * Renders pages to a PDF file.
 *
 * Objects are written in a fixed order and the cross-reference table is built
 * from the byte offsets as they are laid down, which is the whole of what makes
 * a PDF a PDF. Nothing is compressed: an invoice is a few kilobytes of text
 * beside the font programs, and an uncompressed content stream is one a person
 * can read in a text editor when they need to know what the practice sent.
 */
export function renderPdf(pages: readonly Page[], fonts: FontSet, title: string): Uint8Array {
  const slots: FontSlot[] = ['regular', 'bold', 'arabic'];
  const resourceOf = new Map<FontSlot, string>(slots.map((slot, index) => [slot, `F${index + 1}`]));

  const used: Used = new Map();
  const contents = pages.map((page) => contentOf(page, fonts, resourceOf, used));

  // Object numbering, decided up front so references can be written as they go.
  // 1 catalogue, 2 page tree, then a page and a content stream each, then five
  // objects per face.
  const pageObjectAt = 3;
  const fontObjectAt = pageObjectAt + pages.length * 2;
  const fontObject = new Map<FontSlot, number>(
    slots.map((slot, index) => [slot, fontObjectAt + index * 5]),
  );

  const objects: string[] = [];
  const binary = new Map<number, Uint8Array>();
  const push = (body: string): number => {
    objects.push(body);
    return objects.length; // object numbers are one-based
  };

  const fontResources = slots
    .map((slot) => `/${resourceOf.get(slot)} ${fontObject.get(slot)} 0 R`)
    .join(' ');

  push('<< /Type /Catalog /Pages 2 0 R >>');
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [` +
      pages.map((_, index) => `${pageObjectAt + index * 2} 0 R`).join(' ') +
      '] >>',
  );

  pages.forEach((_, index) => {
    const contentNumber = pageObjectAt + index * 2 + 1;
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << ${fontResources} >> >> /Contents ${contentNumber} 0 R >>`,
    );
    const stream = contents[index] ?? '';
    push(`<< /Length ${ascii(stream).length} >>\nstream\n${stream}\nendstream`);
  });

  for (const slot of slots) {
    const font = fonts[slot];
    const glyphs = used.get(slot) ?? new Map<number, number>();
    const base = fontObject.get(slot) ?? 0;
    const descendant = base + 1;
    const descriptor = base + 2;
    const file = base + 3;
    const cmap = base + 4;

    push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H ` +
        `/DescendantFonts [${descendant} 0 R] /ToUnicode ${cmap} 0 R >>`,
    );
    push(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} ` +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
        `/FontDescriptor ${descriptor} 0 R /DW 1000 /W ${widthsArray(font, glyphs)} ` +
        '/CIDToGIDMap /Identity >>',
    );
    push(
      `<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 ` +
        `/FontBBox [${font.bbox.map(num).join(' ')}] /ItalicAngle ${font.italicAngle} ` +
        `/Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.capHeight} ` +
        `/StemV 80 /FontFile2 ${file} 0 R >>`,
    );
    const marker = push(
      `<< /Length ${font.program.length} /Length1 ${font.program.length} >>\nstream\n`,
    );
    binary.set(marker, font.program);
    push(
      `<< /Length ${ascii(toUnicodeCMap(glyphs)).length} >>\nstream\n${toUnicodeCMap(glyphs)}\nendstream`,
    );
  }

  // The information dictionary. No dates: a document that carries the moment it
  // was rendered cannot be rendered twice to the same bytes, and the moment
  // that matters — when the invoice was issued — is on the page itself.
  const infoNumber = push(`<< /Title (${title.replace(/([()\\])/g, '\\$1')}) >>`);

  const parts: Uint8Array[] = [ascii('%PDF-1.7\n%âãÏÓ\n')];
  let offset = parts[0]?.length ?? 0;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    const number = index + 1;
    offsets.push(offset);
    const head = ascii(`${number} 0 obj\n${body}`);
    parts.push(head);
    offset += head.length;
    const bytes = binary.get(number);
    if (bytes) {
      parts.push(bytes);
      offset += bytes.length;
      const tail = ascii('\nendstream');
      parts.push(tail);
      offset += tail.length;
    }
    const end = ascii('\nendobj\n');
    parts.push(end);
    offset += end.length;
  });

  const body = concat(parts);
  const id = fingerprint(body);
  const xrefAt = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNumber} 0 R ` +
      `/ID [<${id}> <${id}>] >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  ].join('');

  return concat([body, ascii(xref)]);
}
