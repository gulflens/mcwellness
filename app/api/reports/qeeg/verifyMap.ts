import { inflateSync } from 'node:zlib';
import { readPng } from '../../../../domain/shared/document/png';
import { MAX_FILE_BYTES, refuseSize } from '../../../../domain/reports/qeeg/image/limits';
import type { FigureRefusalCode } from './figureSchema';

/**
 * Whether the bytes a browser sent are exactly the one kind of picture a
 * brain-map report prints (docs/SPEC/reports-qeeg.md section 9, point 2): an
 * opaque 8-bit RGB PNG, not interlaced, within the caps of point 3, whose
 * image data inflates to exactly the rows its header promises.
 *
 * **Why the server looks at all.** The browser normalises every map before it
 * sends it, and a normalised map passes here untouched. But the door is a
 * door: whatever reaches it is filed as the client's document and, once the
 * report is signed, embedded byte for byte into a PDF a household keeps. The
 * writer takes a PNG's compressed rows as they stand (`readPng`), so a file
 * whose rows are short would print as noise and one whose rows are long, or
 * endless, is a way to make the server inflate far more than it was sent.
 *
 * **In this order, and why.** The header first, through the writer's own
 * reader, so a file the writer would refuse is refused for the same reason
 * here. The caps next, from the header alone, so a picture of 12 million
 * pixels is refused before a byte of it is inflated. Then the inflate, with a
 * ceiling one byte above what the header promises: longer and the inflate
 * stops there and is refused; shorter and the length disagrees. Each row's
 * filter byte is then one of the five PNG defines, because the writer's
 * predictor reads it.
 *
 * Under `app/api`, never `domain/`: the inflate is Node's (the plan's own
 * words, "never in domain/"). Nothing here logs, and no refusal carries a byte
 * or a length of the file.
 */

export type MapCheck =
  | { readonly ok: true; readonly widthPx: number; readonly heightPx: number }
  | { readonly ok: false; readonly code: FigureRefusalCode };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_AT = 8;
/** Where the header's own fields sit: 8 bytes of signature, 8 of length and type. */
const DEPTH_AT = 24;
const COLOUR_TYPE_AT = 25;
const INTERLACE_AT = 28;
const BYTES_PER_PIXEL = 3;

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, at) => bytes[at] === byte);
}

/** The header's own words for what is wrong, read before the writer's reader throws. */
function headerRefusal(bytes: Uint8Array): FigureRefusalCode | null {
  if (bytes.length < IHDR_AT + 8 + 13) return 'damaged';
  const type = String.fromCharCode(...bytes.subarray(IHDR_AT + 4, IHDR_AT + 8));
  if (type !== 'IHDR') return 'damaged';
  if (bytes[DEPTH_AT] !== 8) return 'not_8_bit';
  if (bytes[COLOUR_TYPE_AT] !== 2) return 'not_rgb';
  if (bytes[INTERLACE_AT] !== 0) return 'interlaced';
  return null;
}

export function verifyMap(bytes: Uint8Array): MapCheck {
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, code: 'too_many_bytes' };
  if (!isPng(bytes)) return { ok: false, code: 'not_a_png' };
  const header = headerRefusal(bytes);
  if (header !== null) return { ok: false, code: header };

  let image: ReturnType<typeof readPng>;
  try {
    image = readPng(bytes);
  } catch {
    // The writer's reader refused what the header check let through: a chunk
    // that runs past the end, no image data, a method PNG does not define.
    return { ok: false, code: 'damaged' };
  }
  if (image.colours !== 'rgb') return { ok: false, code: 'not_rgb' };

  const size = refuseSize(image.width, image.height);
  if (size === 'empty') return { ok: false, code: 'damaged' };
  if (size !== null) return { ok: false, code: size };

  const rowBytes = 1 + image.width * BYTES_PER_PIXEL;
  const expected = rowBytes * image.height;
  let raw: Buffer;
  try {
    raw = inflateSync(image.data, { maxOutputLength: expected + 1 });
  } catch {
    // Not a zlib stream, or one that goes on past what the header promises.
    return { ok: false, code: 'damaged' };
  }
  if (raw.length !== expected) return { ok: false, code: 'damaged' };
  for (let row = 0; row < image.height; row += 1) {
    if ((raw[row * rowBytes] ?? 255) > 4) return { ok: false, code: 'damaged' };
  }
  return { ok: true, widthPx: image.width, heightPx: image.height };
}
