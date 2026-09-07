import { describe, expect, it } from 'vitest';
import { readPng } from './png';

/**
 * Reading a PNG into the shape a PDF embeds, and refusing every shape it
 * cannot.
 *
 * **Fixture-free and file-free.** The two images below are complete PNG files
 * written out as hexadecimal here in the test: eight bytes of signature, an
 * `IHDR`, one `IDAT` and an `IEND`, each with its real length and its real
 * CRC. Nothing here reads the practice's own logo — `domain/` opens no file,
 * and the proof that a real photograph-sized mark survives the trip is
 * `tests/billing/db/practice_logo_document.test.ts`, which has a database and
 * a store to read it through.
 *
 * The refusals are made by patching one byte of `IHDR` in the valid file, so
 * each case differs from a working image in exactly the way it is named for.
 */

/** A 2 by 2 truecolour PNG: red, blue over green, yellow. Bit depth 8, not interlaced. */
const RGB_2X2 =
  '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a7300' +
  '0000124944415478da63f8cf0004ff41e8ff7f06001eef04fc132417c20000000049454e44ae426082';

/** The same picture in greys. */
const GREY_2X2 =
  '89504e470d0a1a0a0000000d494844520000000200000002080000000057dd52f800' +
  '00000e4944415478da63e03ac120f70b00048e01eb1557fff90000000049454e44ae426082';

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

/** Where each byte of `IHDR` sits: eight of signature, four of length, four of name. */
const BIT_DEPTH_AT = 8 + 4 + 4 + 8;
const COLOUR_TYPE_AT = BIT_DEPTH_AT + 1;
const INTERLACE_AT = BIT_DEPTH_AT + 4;

/** The valid file with one byte of its header changed. The CRC is not what is under test. */
function patched(at: number, value: number): Uint8Array {
  const image = bytes(RGB_2X2);
  image[at] = value;
  return image;
}

describe('reading a PNG the writer can embed', () => {
  it('reports the picture’s own width, height and colour space', () => {
    const image = readPng(bytes(RGB_2X2));
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(image.colours).toBe('rgb');
  });

  it('hands back the compressed scanlines unchanged, because a PDF wants exactly those', () => {
    // The whole design of this reader: PNG's zlib-deflated, predictor-prefixed
    // scanlines are what /FlateDecode with /Predictor 15 consumes, so nothing
    // is decoded, nothing is recompressed, and the document renders to the
    // same bytes for as long as the practice keeps that file.
    const image = readPng(bytes(RGB_2X2));
    expect(Buffer.from(image.data).toString('hex')).toBe('78da63f8cf0004ff41e8ff7f06001eef04fc');
  });

  it('reads a greyscale picture as one colour component rather than three', () => {
    const image = readPng(bytes(GREY_2X2));
    expect(image.colours).toBe('grey');
    expect(image.width).toBe(2);
  });

  it('joins every IDAT chunk in the order they were written', () => {
    // A PNG writer may split the compressed stream across any number of
    // chunks, and the stream is only a stream once they are put back together.
    const one = bytes(RGB_2X2);
    const split = splitTheIdat(one);
    expect(Buffer.from(readPng(split).data)).toEqual(Buffer.from(readPng(one).data));
  });

  it('walks past a chunk it has no use for rather than stopping at it', () => {
    // A colour profile, a physical size, a comment: the practice's logo will
    // come out of whatever tool made it, carrying whatever that tool writes.
    const withExtra = insertBeforeIdat(bytes(RGB_2X2), 'pHYs', new Uint8Array(9));
    expect(readPng(withExtra).width).toBe(2);
  });
});

describe('a file this writer will not embed', () => {
  it('refuses something that is not a PNG at all', () => {
    expect(() => readPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toThrow(RangeError);
    expect(() => readPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toThrow(
      /not a PNG/,
    );
  });

  it('refuses a bit depth other than eight, naming the depth it found', () => {
    expect(() => readPng(patched(BIT_DEPTH_AT, 16))).toThrow(/bit depth 16/);
  });

  it('refuses a palette, because its pixels are indices and not colours', () => {
    expect(() => readPng(patched(COLOUR_TYPE_AT, 3))).toThrow(/colour type 3/);
  });

  it('refuses an image with an alpha channel, which this writer draws no mask for', () => {
    expect(() => readPng(patched(COLOUR_TYPE_AT, 6))).toThrow(/colour type 6/);
    expect(() => readPng(patched(COLOUR_TYPE_AT, 4))).toThrow(/colour type 4/);
  });

  it('refuses an interlaced image, whose scanlines are not scanlines', () => {
    // Adam7 stores seven reduced pictures rather than rows of the whole one,
    // so PDF's predictor would decode it into confetti.
    expect(() => readPng(patched(INTERLACE_AT, 1))).toThrow(/interlaced/);
  });

  it('refuses a file with no image data in it', () => {
    expect(() => readPng(withoutTheIdat(bytes(RGB_2X2)))).toThrow(/no image data/);
  });

  it('refuses a truncated file rather than reading past the end of it', () => {
    const short = bytes(RGB_2X2).slice(0, 30);
    expect(() => readPng(short)).toThrow(RangeError);
  });
});

// --------------------------------------------------------------------------
// Rewriting the fixture, chunk by chunk
// --------------------------------------------------------------------------

type Chunk = { type: string; data: Uint8Array };

/** Every chunk of a PNG, in order. The test's own reader, so it proves nothing about the real one. */
function chunksOf(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

/** A PNG back out of chunks. The CRC is written as zero: this reader does not check it. */
function rebuild(chunks: readonly Chunk[]): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const chunk of chunks) {
    const length = chunk.data.length;
    parts.push(
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    );
    for (const character of chunk.type) parts.push(character.charCodeAt(0));
    parts.push(...chunk.data);
    parts.push(0, 0, 0, 0);
  }
  return new Uint8Array(parts);
}

function splitTheIdat(png: Uint8Array): Uint8Array {
  return rebuild(
    chunksOf(png).flatMap((chunk) =>
      chunk.type === 'IDAT'
        ? [
            { type: 'IDAT', data: chunk.data.subarray(0, 4) },
            { type: 'IDAT', data: chunk.data.subarray(4) },
          ]
        : [chunk],
    ),
  );
}

function withoutTheIdat(png: Uint8Array): Uint8Array {
  return rebuild(chunksOf(png).filter((chunk) => chunk.type !== 'IDAT'));
}

function insertBeforeIdat(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
  return rebuild(
    chunksOf(png).flatMap((chunk) => (chunk.type === 'IDAT' ? [{ type, data }, chunk] : [chunk])),
  );
}
