import type { DocumentImage } from './pdf';

/**
 * Reading a PNG into the one shape this writer embeds.
 *
 * **Nothing is decoded, and that is the point.** A PNG stores its picture as
 * scanlines, each prefixed by a predictor byte, the whole run zlib-deflated
 * into one or more `IDAT` chunks. A PDF image with `/Filter /FlateDecode` and
 * `/DecodeParms << /Predictor 15 ... >>` reads exactly that. So the practice's
 * own file goes into its invoices byte for byte: no image library on the path
 * that renders a household's financial record, no dependency added to
 * `package.json` (the shared zone, docs/SPEC/OWNERSHIP.md), and a document
 * that re-renders to the same bytes for as long as the mark is unchanged.
 *
 * What that buys is narrow, so this refuses everything outside it — loudly,
 * naming the reason, rather than embedding something a reader would draw as
 * noise:
 *
 * - **Bit depth 8 only.** `/BitsPerComponent` is written as 8 and the
 *   predictor arithmetic depends on it.
 * - **Colour type 2 (truecolour) or 0 (greyscale) only.** A palette (3) stores
 *   indices rather than colours and would need a `/Indexed` colour space and
 *   the palette beside it; alpha (4 and 6) would need a soft mask, which means
 *   splitting the channels apart — and splitting them apart means decoding,
 *   which is the one thing this does not do.
 * - **Not interlaced.** Adam7 stores seven reduced images rather than rows of
 *   the whole one, so a PDF predictor reading it row by row gets confetti.
 *
 * **Pure**: bytes in, a value out. No clock, no file, no allocation the caller
 * cannot see. `domain/` reads nothing (CLAUDE.md rule 4 and the seam rules);
 * the bytes arrive from the storage seam, exactly as the fonts do.
 *
 * The CRC on each chunk is deliberately **not** checked. It guards a file in
 * transit, and these bytes came out of the practice's own store with a sha256
 * on the `document` row that already says they are the bytes that were filed;
 * a second, weaker checksum would only add a way for a mark to stop printing.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** The header's own fields, at their offsets inside the 13 bytes of `IHDR`. */
const IHDR_LENGTH = 13;

function refuse(reason: string): RangeError {
  // Never the bytes and never a length that would let a caller probe the file:
  // a reason a person can act on, and nothing about the image itself.
  return new RangeError(`That image cannot be embedded: ${reason}.`);
}

/**
 * The PNG's own bytes in; what the writer embeds out. Throws a `RangeError`
 * naming the reason for anything it cannot embed.
 */
export function readPng(bytes: Uint8Array): DocumentImage {
  // The signature first, so a JPEG — the other type the practice may file as
  // its logo (migration 909) — is refused for what it is rather than for its
  // length. A file shorter than the signature fails here too: a byte that is
  // not there is not the byte the signature wants.
  for (const [at, byte] of SIGNATURE.entries()) {
    if (bytes[at] !== byte) throw refuse('it is not a PNG');
  }
  if (bytes.length < SIGNATURE.length + 12 + IHDR_LENGTH) {
    throw refuse('the file is too short to be a PNG');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at: number = SIGNATURE.length;
  let header: { width: number; height: number; colours: 'rgb' | 'grey' } | null = null;
  const parts: Uint8Array[] = [];

  // Every chunk, in order: four bytes of length, four of type, the data, four
  // of CRC. Anything this does not know about is walked past, because a logo
  // arrives carrying whatever the tool that made it writes — a colour profile,
  // a physical size, a comment.
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    // A length that runs past the end of the file is a truncated or a
    // malformed image, and reading it would be reading somebody else's memory.
    if (end > bytes.length) throw refuse('the file ends in the middle of a chunk');
    const type = String.fromCharCode(
      bytes[at + 4] ?? 0,
      bytes[at + 5] ?? 0,
      bytes[at + 6] ?? 0,
      bytes[at + 7] ?? 0,
    );
    const data = bytes.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      if (length !== IHDR_LENGTH) throw refuse('its header is not the size a PNG header is');
      header = readHeader(new DataView(data.buffer, data.byteOffset, data.byteLength));
    } else if (type === 'IDAT') {
      // A writer may split the compressed stream across any number of chunks,
      // and it is only a stream once they are back together.
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at = end;
  }

  if (!header) throw refuse('it carries no PNG header');
  if (parts.length === 0) throw refuse('it carries no image data');

  return { ...header, data: concat(parts) };
}

function readHeader(header: DataView): { width: number; height: number; colours: 'rgb' | 'grey' } {
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const depth = header.getUint8(8);
  const colourType = header.getUint8(9);
  const compression = header.getUint8(10);
  const filter = header.getUint8(11);
  const interlace = header.getUint8(12);

  if (width === 0 || height === 0) throw refuse('it has no pixels in it');
  if (depth !== 8) throw refuse(`it has bit depth ${depth} and only 8 can be embedded`);
  if (colourType !== 0 && colourType !== 2) {
    // 3 is a palette, 4 is grey with alpha, 6 is truecolour with alpha. Each
    // would need a decode this reader deliberately does not do.
    throw refuse(
      `it has colour type ${colourType}, and only 0 (greyscale) and 2 (truecolour) can be embedded`,
    );
  }
  // Both of these have exactly one defined value in the format; anything else
  // is a file from a future nobody has written yet.
  if (compression !== 0) throw refuse('its compression method is not the one PNG defines');
  if (filter !== 0) throw refuse('its filter method is not the one PNG defines');
  if (interlace !== 0)
    throw refuse('it is interlaced, and only a progressive image can be embedded');

  return { width, height, colours: colourType === 2 ? 'rgb' : 'grey' };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0];
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
