/**
 * A very small PDF writer: enough to set bilingual type, rule a line, embed
 * the two faces the app already uses, and set one hue.
 *
 * **Why this exists rather than a library.** An invoice is a document the
 * practice hands to a family and a tax authority may read, so it has to carry
 * its own type and be byte-identical every time it is rendered from the same
 * row. What that needs from a PDF is narrow: pages, text in an embedded
 * TrueType font, horizontal rules, and — since round 34 — a flat red-green-blue
 * fill and stroke for the one figure the design brief admits a hue on
 * (`docs/DESIGN-BRIEF.md` section 5, the session ribbon). No images, no colour
 * spaces beyond that one operator, no forms, no transparency, no compression.
 * `package.json` is the shared zone
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

import { isArabic, place, type Placed } from './arabic';
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
  /**
   * Red, green and blue, each 0 to 1, and the whole of the colour this writer
   * can set. **When it is absent the grey path is taken, unchanged**, so every
   * document already filed renders to the bytes it was filed as; `pdf.test.ts`
   * holds the greyscale content stream from before this field existed and
   * asserts it verbatim.
   *
   * It exists for one figure. `docs/DESIGN-BRIEF.md` section 5 gives the
   * session ribbon one hue per band and calls it "the one place hue enters a
   * report"; `docs/CHANGE-REQUESTS/reports-01.md` request R3 asked for the
   * operator that would let paper carry what the screen already does. Nothing
   * else in any report or any invoice sets it, and the five triples it is
   * given come from `domain/shared/bands.ts`, which is proved against
   * `app/shell/tokens.css`.
   *
   * Set beside `grey` rather than instead of it: a caller that passes both
   * gets the colour, and every caller that passes neither is where it was.
   */
  rgb?: readonly [number, number, number];
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
  | {
      kind: 'rule';
      x: number;
      y: number;
      width: number;
      thickness?: number;
      grey?: number;
      /** As `Style.rgb`: when absent the rule is stroked in grey, unchanged. */
      rgb?: readonly [number, number, number];
    };

export type Page = { ops: Op[] };

/** A run of text one font can draw, already in the order it is placed. */
type Run = { slot: FontSlot; glyphs: Placed[] };

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
  // Each glyph arrives with the characters it was made from, because the two
  // differ for Arabic and it is the characters, not the shapes, that the
  // `/ToUnicode` map below owes a reader. Left to right the two are the same
  // thing, so a character stands for itself.
  const glyphs: Placed[] = rtl
    ? place(text)
    : [...text].map((c) => {
        const code = c.codePointAt(0) ?? 0;
        return { code, from: [code] };
      });
  const runs: Run[] = [];
  for (const glyph of glyphs) {
    const slot: FontSlot = isArabic(glyph.code) ? 'arabic' : latin;
    const last = runs[runs.length - 1];
    // A space belongs to the run it follows: starting a new one on every space
    // would split a phrase into a run per word for no gain.
    if (last && (last.slot === slot || glyph.code === 0x20)) {
      last.glyphs.push(glyph);
      continue;
    }
    runs.push({ slot, glyphs: [glyph] });
  }
  return runs;
}

/** How wide a run is at a given size, in points. */
function widthOfRun(run: Run, fonts: FontSet, size: number): number {
  const font = fonts[run.slot];
  let total = 0;
  for (const placed of run.glyphs) {
    const glyph = glyphFor(font, placed.code);
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

/**
 * A colour component as the content stream wants it: 0 to 1, and nothing else.
 *
 * A PDF reader meeting `1.4 0 0 rg` is entitled to clamp, to refuse the
 * operator, or to draw something nobody chose; a document the practice hands a
 * family should not depend on which. The clamp happens here rather than at the
 * caller so there is one place it happens, and `num` writes the result exactly
 * as it writes every other number in the file.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
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

/**
 * Per face, every glyph the document drew with and the characters it stands
 * for — which is what the `/ToUnicode` map is written from, and so what a
 * person selecting a line and copying it gets back.
 */
type Used = Map<FontSlot, Map<number, readonly number[]>>;

/** Whether two glyphs stand for the same characters, in the same order. */
function sameSource(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((code, at) => code === b[at]);
}

/** Draws one page's operations, recording which glyphs each face was asked for. */
function contentOf(
  page: Page,
  fonts: FontSet,
  resourceOf: Map<FontSlot, string>,
  used: Used,
): string {
  const out: string[] = [];
  // What the writer has already told the reader the fill is, as the operator
  // it wrote. **One piece of state for both paths**, and that is the point: a
  // colour set with `rg` has to be undone by the grey after it and a grey by
  // the colour after it, and two counters — one tracking a number, one a
  // triple — would each think the other's op had left the fill where it wanted
  // it, so a line would come out in the colour of the line before it. Empty
  // means nothing has been set on this page yet, which no operator can spell.
  let fill = '';

  const setFill = (operator: string): void => {
    if (fill !== operator) {
      out.push(operator);
      fill = operator;
    }
  };

  /** The fill operator an op asks for: a colour if it named one, else a grey. */
  const fillOf = (colour: readonly [number, number, number] | undefined, grey: number): string =>
    colour
      ? `${num(clamp01(colour[0]))} ${num(clamp01(colour[1]))} ${num(clamp01(colour[2]))} rg`
      : `${num(grey)} g`;

  for (const op of page.ops) {
    if (op.kind === 'rule') {
      // The stroke stays inside its own q/Q, exactly as it always has, so
      // whatever it sets is discarded at the Q and no later op inherits it —
      // which is why `fill` need not know a rule happened.
      const stroke = op.rgb
        ? `${num(clamp01(op.rgb[0]))} ${num(clamp01(op.rgb[1]))} ${num(clamp01(op.rgb[2]))} RG`
        : `${num(op.grey ?? 0.8)} G`;
      out.push(
        `q ${num(op.thickness ?? 0.5)} w ${stroke} ` +
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

    setFill(fillOf(op.style.rgb, op.style.grey ?? 0));
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
      for (const placed of run.glyphs) {
        const glyph = glyphFor(font, placed.code);
        // A character this face cannot draw is dropped rather than replaced
        // with a box: every string on these documents comes from a row the
        // practice wrote, and a missing glyph is a fault to notice in review,
        // not something to paper over on a tax invoice.
        if (glyph === null) continue;
        glyphs += hex4(glyph);
        // One glyph, one entry in the map — but a document can reach the same
        // glyph from two different sources. A bracket inside a right-to-left
        // run is drawn as its mirror image, so the shape that closes an Arabic
        // line stands for the bracket that opened it, while the identical shape
        // in "Total (AED)" stands for itself; both are drawn by the Latin face,
        // which has one `/ToUnicode` map between them. Letting whichever was
        // drawn last win hands the English half the Arabic half's answer, so an
        // Arabic legal name or line description carrying brackets would make
        // "Total (AED)" copy as "Total )AED(".
        //
        // When the sources disagree the glyph therefore falls back to the
        // character it itself draws. The English reading is then right, and the
        // mirrored bracket in the Arabic run comes off the clipboard as the
        // shape on the page rather than as the wrong bracket: a bracket the
        // reader can see is the smaller loss, and the letters either side of it
        // — the half that could not be searched for at all — are untouched.
        const already = seen.get(glyph);
        if (already === undefined) {
          seen.set(glyph, placed.from);
        } else if (!sameSource(already, placed.from)) {
          seen.set(glyph, [placed.code]);
        }
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

/** One code point as a PDF's UTF-16BE bfchar target wants it. */
function utf16(code: number): string {
  // Above the basic plane a code point is written as a surrogate pair.
  return code > 0xffff
    ? hex4(0xd800 + ((code - 0x10000) >> 10)) + hex4(0xdc00 + ((code - 0x10000) & 0x3ff))
    : hex4(code);
}

/**
 * What each glyph says, for a reader selecting a line and copying it.
 *
 * The entries map a glyph to the *characters it was made from*, not to the
 * shape it draws. For Latin those are the same thing. For Arabic they are not:
 * a letter is drawn as the presentation form it takes in its word, and lam
 * followed by alef is drawn as one glyph standing for two letters, so a map
 * built from the shapes hands back the FE70 block — legible on the page,
 * unusable on the clipboard, and unfindable by a search for the word.
 */
function toUnicodeCMap(glyphs: ReadonlyMap<number, readonly number[]>): string {
  const entries = [...glyphs.entries()].sort((a, b) => a[0] - b[0]);
  const chunks: string[] = [];
  for (let at = 0; at < entries.length; at += 100) {
    const slice = entries.slice(at, at + 100);
    chunks.push(
      `${slice.length} beginbfchar\n` +
        slice.map(([glyph, from]) => `<${hex4(glyph)}> <${from.map(utf16).join('')}>`).join('\n') +
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

function widthsArray(font: Font, glyphs: ReadonlyMap<number, readonly number[]>): string {
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

  // Only the faces this document actually drew with. A receipt in English sets
  // no Arabic, and embedding the Arabic face anyway put ninety kilobytes of
  // unread outlines into every one — on a document the practice sends over a
  // telephone connection to a family.
  const embedded = slots.filter((slot) => (used.get(slot)?.size ?? 0) > 0);

  // Object numbering, decided up front so references can be written as they go.
  // 1 catalogue, 2 page tree, then a page and a content stream each, then five
  // objects per face.
  const pageObjectAt = 3;
  const fontObjectAt = pageObjectAt + pages.length * 2;
  const fontObject = new Map<FontSlot, number>(
    embedded.map((slot, index) => [slot, fontObjectAt + index * 5]),
  );

  const objects: string[] = [];
  const binary = new Map<number, Uint8Array>();
  const push = (body: string): number => {
    objects.push(body);
    return objects.length; // object numbers are one-based
  };

  const fontResources = embedded
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

  for (const slot of embedded) {
    const font = fonts[slot];
    const glyphs = used.get(slot) ?? new Map<number, readonly number[]>();
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
