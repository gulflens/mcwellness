/**
 * Writing RGB pixels as the one kind of PNG the document engine embeds:
 * bit depth 8, colour type 2, no alpha, not interlaced.
 *
 * **Why this exists.** A brain map arrives in the browser as a BMP, a JPEG or
 * a PNG, and the browser decodes it to pixels. Its own PNG export is RGBA,
 * which `readPng` refuses (the engine draws no soft mask), and a JPEG is not
 * a PNG at all. So the map is trimmed, flattened onto white, and written again
 * here, losslessly, in the form the engine takes byte for byte.
 *
 * **The compressor is injected.** `IDAT` holds a zlib stream. The browser
 * supplies `CompressionStream('deflate')`, which writes exactly that; a test
 * supplies Node's zlib. `domain/` imports neither, and stays pure: the same
 * pixels and the same compressor give the same file.
 *
 * **Each row picks its own filter**, from the five PNG defines, by the usual
 * rule of thumb: the one whose output bytes, read as signed, have the smallest
 * sum of magnitudes. It costs one pass per filter and usually buys a file a
 * good deal smaller than filter 0 everywhere, which matters for a report that
 * carries up to eight maps.
 */

/** Deflate with the zlib wrapper, as `CompressionStream('deflate')` writes. */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BYTES_PER_PIXEL = 3;

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 PNG puts after each chunk, over its type and data. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Every row prefixed by its filter byte, each row filtered by whichever of
 * the five filters leaves the smallest sum of signed magnitudes. A tie goes
 * to the lower number, so the choice is deterministic.
 */
function filtered(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * BYTES_PER_PIXEL;
  const out = new Uint8Array(height * (stride + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  const empty = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : empty;
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter < 5; filter += 1) {
      const line = candidates[filter];
      if (!line) continue;
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const value = row[x] ?? 0;
        const a = x >= BYTES_PER_PIXEL ? (row[x - BYTES_PER_PIXEL] ?? 0) : 0;
        const b = above[x] ?? 0;
        const c = x >= BYTES_PER_PIXEL ? (above[x - BYTES_PER_PIXEL] ?? 0) : 0;
        let predicted = 0;
        if (filter === 1) predicted = a;
        else if (filter === 2) predicted = b;
        else if (filter === 3) predicted = (a + b) >> 1;
        else if (filter === 4) predicted = paeth(a, b, c);
        const byte = (value - predicted) & 0xff;
        line[x] = byte;
        score += byte < 128 ? byte : 256 - byte;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
      }
    }
    out[y * (stride + 1)] = best;
    out.set(candidates[best] ?? empty, y * (stride + 1) + 1);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * The PNG file for `rgb`, three bytes a pixel, row by row from the top.
 * `width * height * 3` must equal `rgb.length`, and both sides must be at
 * least one pixel; anything else is a `RangeError`.
 */
export async function encodePng(
  rgb: Uint8Array,
  width: number,
  height: number,
  deflate: Deflate,
): Promise<Uint8Array> {
  const counts = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  if (!counts || width * height * BYTES_PER_PIXEL !== rgb.length) {
    throw new RangeError(
      `A PNG of ${width} by ${height} needs ${width * height * BYTES_PER_PIXEL} bytes of RGB, at least one pixel, and was given ${rgb.length}.`,
    );
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  // Bit depth 8, colour type 2 (truecolour), compression 0, filter 0, interlace 0.
  header.set([8, 2, 0, 0, 0], 8);

  const compressed = await deflate(filtered(rgb, width, height));
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
