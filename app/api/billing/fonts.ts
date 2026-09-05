import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { readFont, type Font, type FontSet } from '../../../domain/shared/document';

/**
 * The three faces a rendered document is set in, read off disk once.
 *
 * The app's own type is IBM Plex Sans, with IBM Plex Sans Arabic for Arabic
 * (docs/DESIGN-BRIEF.md, `app/shell/tokens.css`), and both are already
 * dependencies because the browser loads them. So a document is set in the type
 * the screens are set in, and no font is added to the repository to do it.
 *
 * **This is the server side of the seam.** `domain/shared/document` is pure and
 * browser-safe: it takes font programs as bytes. Reading a file and inflating a
 * `.woff` are Node's, so they live here.
 *
 * **Why the packaged files need converting.** `@fontsource` ships `.woff` and
 * `.woff2`; a PDF embeds a plain sfnt. WOFF 1 is exactly an sfnt with each
 * table deflated, so turning one back is a header, a table directory and
 * `inflate` — about forty lines, and no dependency. (WOFF 2 is not: it
 * transforms the glyph outlines as well as compressing them, which is a real
 * decoder and not worth owning.)
 *
 * **What is dropped on the way.** The layout tables — GSUB, GPOS, GDEF, STAT —
 * go. This renderer does its own Arabic shaping
 * (`domain/shared/document/arabic.ts`) and no PDF viewer applies them to
 * already-positioned glyphs, so embedding them would put about forty kilobytes
 * of unread data into every invoice the practice sends.
 */

const require_ = createRequire(import.meta.url);

/** Where a fontsource package keeps its font files. */
function filesDirOf(packageName: string): string {
  return join(dirname(require_.resolve(`${packageName}/package.json`)), 'files');
}

const WOFF_SIGNATURE = 0x774f4646;

/**
 * Tables a PDF viewer needs to render an embedded TrueType font. Everything
 * else in the file is layout data this renderer has already applied itself.
 */
const KEEP = new Set([
  'head',
  'hhea',
  'maxp',
  'hmtx',
  'cmap',
  'loca',
  'glyf',
  'OS/2',
  'post',
  'name',
  'cvt ',
  'fpgm',
  'prep',
  'gasp',
]);

type Table = { tag: string; data: Uint8Array };

/** The tables inside a WOFF, inflated. */
function tablesOfWoff(woff: Uint8Array): Table[] {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== WOFF_SIGNATURE) {
    throw new Error('That font file is not a WOFF.');
  }
  const numTables = view.getUint16(12);
  const tables: Table[] = [];
  for (let index = 0; index < numTables; index += 1) {
    const at = 44 + index * 20;
    const tag = String.fromCharCode(
      woff[at] ?? 0,
      woff[at + 1] ?? 0,
      woff[at + 2] ?? 0,
      woff[at + 3] ?? 0,
    );
    const offset = view.getUint32(at + 4);
    const compressed = view.getUint32(at + 8);
    const original = view.getUint32(at + 12);
    const raw = woff.subarray(offset, offset + compressed);
    // A table shorter compressed than it is whole was deflated; one the same
    // length was stored as it stands. That is WOFF's own rule, not a guess.
    const data = compressed < original ? new Uint8Array(inflateSync(raw)) : raw;
    if (data.length !== original) {
      throw new Error(`The font's "${tag}" table did not inflate to its stated length.`);
    }
    tables.push({ tag, data });
  }
  return tables;
}

function checksumOf(data: Uint8Array): number {
  let sum = 0;
  for (let at = 0; at < data.length; at += 4) {
    const word =
      ((data[at] ?? 0) << 24) |
      ((data[at + 1] ?? 0) << 16) |
      ((data[at + 2] ?? 0) << 8) |
      (data[at + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/** Rebuilds a plain sfnt from a WOFF's tables, keeping only what is drawn from. */
function toSfnt(woff: Uint8Array): Uint8Array {
  const tables = tablesOfWoff(woff)
    .filter((table) => KEEP.has(table.tag))
    // The table directory is sorted by tag; a reader is entitled to assume it.
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const count = tables.length;
  const headerSize = 12 + count * 16;
  const padded = (length: number): number => (length + 3) & ~3;
  const total = tables.reduce((size, table) => size + padded(table.data.length), headerSize);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  // The offset table. searchRange and its two companions are derived from the
  // table count and no reader depends on them, but they are part of the format.
  const power = Math.floor(Math.log2(count));
  const searchRange = 2 ** power * 16;
  view.setUint32(0, 0x00010000);
  view.setUint16(4, count);
  view.setUint16(6, searchRange);
  view.setUint16(8, power);
  view.setUint16(10, count * 16 - searchRange);

  let at = headerSize;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let byte = 0; byte < 4; byte += 1) {
      out[record + byte] = table.tag.charCodeAt(byte);
    }
    view.setUint32(record + 4, checksumOf(table.data));
    view.setUint32(record + 8, at);
    view.setUint32(record + 12, table.data.length);
    out.set(table.data, at);
    at += padded(table.data.length);
  });
  return out;
}

let cached: FontSet | null = null;

/**
 * The document faces, loaded once per process.
 *
 * Cached because a PDF is rendered inside a request's own transaction and
 * parsing three fonts on every invoice would put file reads on that path for no
 * gain: the files never change while the process runs.
 */
export function documentFonts(): FontSet {
  if (cached) return cached;

  const latin = filesDirOf('@fontsource/ibm-plex-sans');
  const arabic = filesDirOf('@fontsource/ibm-plex-sans-arabic');
  const read = (path: string): Uint8Array => toSfnt(new Uint8Array(readFileSync(path)));

  const load = (path: string, name: string, isArabic = false): Font =>
    readFont(read(path), { name, arabic: isArabic });

  cached = {
    regular: load(join(latin, 'ibm-plex-sans-latin-400-normal.woff'), 'IBMPlexSans'),
    // 600 rather than 700: the design brief's headings are semibold, and the
    // screens use the same weight.
    bold: load(join(latin, 'ibm-plex-sans-latin-600-normal.woff'), 'IBMPlexSans-SemiBold'),
    arabic: load(
      join(arabic, 'ibm-plex-sans-arabic-arabic-400-normal.woff'),
      'IBMPlexSansArabic',
      true,
    ),
  };
  return cached;
}
