import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readPng } from '@domain/shared/document';
import { crc32, encodePng } from './encodePng';
import type { Deflate } from './encodePng';

/**
 * Writing the one kind of PNG the document engine embeds: 8-bit truecolour,
 * no alpha, not interlaced. The browser hands the encoder
 * `CompressionStream('deflate')`; here Node's zlib stands in for it, in this
 * file only, because `domain/` imports nothing from Node.
 *
 * The test reads its own output back with its own small reader and undoes the
 * filters itself, so "lossless" is proved on the bytes and not assumed.
 */

const deflate: Deflate = (bytes) => Promise.resolve(new Uint8Array(deflateSync(bytes)));

type Chunk = { type: string; data: Uint8Array; crc: number };

function chunksOf(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    chunks.push({
      type: String.fromCharCode(...png.subarray(at + 4, at + 8)),
      data: png.subarray(at + 8, at + 8 + length),
      crc: view.getUint32(at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

function idatOf(png: Uint8Array): Uint8Array {
  return new Uint8Array(
    Buffer.concat(
      chunksOf(png)
        .filter((c) => c.type === 'IDAT')
        .map((c) => c.data),
    ),
  );
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

/** The test's own unfiltering, straight from the PNG specification. */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
): { rgb: Uint8Array; filters: number[] } {
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  const filters: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? -1;
    filters.push(filter);
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= 3 ? (rgb[y * stride + x - 3] ?? 0) : 0;
      const b = y > 0 ? (rgb[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= 3 && y > 0 ? (rgb[(y - 1) * stride + x - 3] ?? 0) : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      rgb[y * stride + x] = (byte + predicted) & 0xff;
    }
  }
  return { rgb, filters };
}

function picture(
  width: number,
  height: number,
  at: (x: number, y: number) => [number, number, number],
) {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgb.set(at(x, y), (y * width + x) * 3);
  }
  return rgb;
}

const checkerboard = picture(700, 500, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
const flat = picture(64, 48, () => [56, 4, 115]);
const gradient = picture(256, 200, (x, y) => [x, y, (x + y) & 0xff]);

describe('encoding pixels as a PNG the engine embeds', () => {
  it('writes a file readPng accepts, with the right width and height', async () => {
    const png = await encodePng(flat, 64, 48, deflate);
    const image = readPng(png);
    expect(image.width).toBe(64);
    expect(image.height).toBe(48);
    expect(image.colours).toBe('rgb');
  });

  it('writes a header none of readPng’s refusals apply to', async () => {
    const png = await encodePng(gradient, 256, 200, deflate);
    const header = chunksOf(png)[0];
    expect(header?.type).toBe('IHDR');
    // Bit depth 8, colour type 2, compression 0, filter 0, interlace 0.
    expect(Array.from(header?.data.subarray(8) ?? [])).toEqual([8, 2, 0, 0, 0]);
    expect(chunksOf(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(() => readPng(png)).not.toThrow();
  });

  it('gives every chunk its CRC-32', async () => {
    const png = await encodePng(flat, 64, 48, deflate);
    for (const chunk of chunksOf(png)) {
      const typed = new Uint8Array([...Buffer.from(chunk.type, 'latin1'), ...chunk.data]);
      expect(chunk.crc).toBe(crc32(typed));
    }
  });

  it('inflates to exactly one filter byte and three bytes a pixel for every row', async () => {
    const png = await encodePng(gradient, 256, 200, deflate);
    expect(inflateSync(idatOf(png)).length).toBe(200 * (1 + 3 * 256));
  });

  it.each([
    ['a one-pixel checkerboard', checkerboard, 700, 500],
    ['a flat colour', flat, 64, 48],
    ['a gradient', gradient, 256, 200],
  ] as const)('gives back every pixel of %s when its filters are undone', async (_, rgb, w, h) => {
    const png = await encodePng(rgb, w, h, deflate);
    const { rgb: back, filters } = unfilter(new Uint8Array(inflateSync(idatOf(png))), w, h);
    expect(Buffer.from(back).equals(Buffer.from(rgb))).toBe(true);
    for (const filter of filters) {
      expect(filter).toBeGreaterThanOrEqual(0);
      expect(filter).toBeLessThanOrEqual(4);
    }
  });

  it('chooses a predicting filter where one helps, rather than none on every row', async () => {
    const png = await encodePng(gradient, 256, 200, deflate);
    const { filters } = unfilter(new Uint8Array(inflateSync(idatOf(png))), 256, 200);
    expect(filters.some((f) => f !== 0)).toBe(true);
  });

  it('gives the same file for the same pixels', async () => {
    const a = await encodePng(gradient, 256, 200, deflate);
    const b = await encodePng(new Uint8Array(gradient), 256, 200, deflate);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('refuses a length that does not match the size', async () => {
    await expect(encodePng(new Uint8Array(10), 2, 2, deflate)).rejects.toThrow(RangeError);
    await expect(encodePng(new Uint8Array(0), 0, 0, deflate)).rejects.toThrow(RangeError);
  });
});

describe('the CRC-32 a PNG chunk carries', () => {
  it('is 0xAE426082 for IEND with no data', () => {
    expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
  });

  it('matches the CRC in a PNG written by another tool', () => {
    // The IHDR of the 2 by 2 truecolour fixture in png.test.ts.
    const typed = Buffer.from('494844520000000200000002080200000000', 'hex').subarray(0, 17);
    expect(crc32(new Uint8Array(typed))).toBe(0xfdd49a73);
  });
});
