/**
 * Preparing a decoded brain map for a report in one call: the size check,
 * the trim, the crop, flattening onto white, the PNG, and the file-size
 * check, in that order, answering with a refusal rather than an error for
 * anything a person supplied. Node's zlib stands in for the browser's
 * `CompressionStream('deflate')`, in this file only.
 */

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readPng } from '@domain/shared/document';
import type { Deflate } from './encodePng';
import { MAX_FILE_BYTES } from './limits';
import { prepareMap } from './prepare';
import type { Pixels } from './trim';

const deflate: Deflate = (bytes) => Promise.resolve(new Uint8Array(deflateSync(bytes)));

/** A compressor that must never be reached. */
const never: Deflate = () => Promise.reject(new Error('the compressor was reached'));

/**
 * A zlib stream of stored blocks, written out by hand: no compression, so a
 * picture's file is as large as its filtered rows.
 */
const stored: Deflate = (bytes) => {
  const out: number[] = [0x78, 0x01];
  for (let at = 0; at < bytes.length; at += 65535) {
    const piece = bytes.subarray(at, at + 65535);
    out.push(at + 65535 >= bytes.length ? 1 : 0, piece.length & 0xff, piece.length >> 8);
    out.push(~piece.length & 0xff, (~piece.length >> 8) & 0xff);
    for (const byte of piece) out.push(byte);
  }
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % 65521;
    high = (high + low) % 65521;
  }
  out.push(high >> 8, high & 0xff, low >> 8, low & 0xff);
  return Promise.resolve(new Uint8Array(out));
};

function picture(
  width: number,
  height: number,
  at: (x: number, y: number) => readonly [number, number, number, number],
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(at(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

/** Blank of the given size, never touched: the size alone must refuse it. */
const blank = (width: number, height: number): Pixels => ({
  width,
  height,
  data: new Uint8ClampedArray(Math.max(0, width * height * 4) || 0),
});

describe('preparing a map for a report', () => {
  it('trims a white border, and hands back a PNG of what is left', async () => {
    const map = picture(400, 300, (x, y) =>
      x >= 100 && x < 300 && y >= 50 && y < 250 ? [30, 60, 200, 255] : [255, 255, 255, 255],
    );
    const prepared = await prepareMap(map, deflate);
    if (!prepared.ok) throw new Error(`refused: ${prepared.refusal}`);
    expect(prepared.trimmed).toBe(true);
    // Padding is 4 pixels a side at this width.
    expect([prepared.width, prepared.height]).toEqual([208, 208]);
    const image = readPng(prepared.png);
    expect([image.width, image.height]).toEqual([208, 208]);
  });

  it('leaves a map with no border whole, and says so', async () => {
    const map = picture(64, 48, (x, y) => [x * 4, y * 5, 90, 255]);
    const prepared = await prepareMap(map, deflate);
    if (!prepared.ok) throw new Error(`refused: ${prepared.refusal}`);
    expect(prepared.trimmed).toBe(false);
    expect([prepared.width, prepared.height]).toEqual([64, 48]);
  });

  it('refuses a map over each size cap, or with nothing in it, before touching a pixel', async () => {
    await expect(prepareMap(blank(4097, 10), never)).resolves.toEqual({
      ok: false,
      refusal: 'too_wide',
    });
    await expect(prepareMap(blank(10, 4097), never)).resolves.toEqual({
      ok: false,
      refusal: 'too_tall',
    });
    await expect(prepareMap(blank(4000, 3001), never)).resolves.toEqual({
      ok: false,
      refusal: 'too_many_pixels',
    });
    await expect(prepareMap(blank(0, 0), never)).resolves.toEqual({
      ok: false,
      refusal: 'empty',
    });
    await expect(
      prepareMap({ width: Number.NaN, height: 10, data: new Uint8ClampedArray(0) }, never),
    ).resolves.toEqual({ ok: false, refusal: 'empty' });
  });

  it('refuses a map whose file would pass the file cap, rather than shrinking it', async () => {
    // 1400 by 1400 of grain, stored uncompressed: about 5.9 MB, over the 5 MiB cap.
    const map = picture(1400, 1400, (x, y) => [(x * 7 + y * 13) & 0xff, (x * y) & 0xff, 40, 255]);
    const prepared = await prepareMap(map, stored);
    expect(prepared).toEqual({ ok: false, refusal: 'too_many_bytes' });
    expect(1400 * (1 + 3 * 1400)).toBeGreaterThan(MAX_FILE_BYTES);
  });
});
