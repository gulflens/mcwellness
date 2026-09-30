/**
 * How large a brain map the report will take, and the refusal for one that is
 * larger.
 *
 * **Refused, never shrunk.** A map over a cap is turned away with a reason,
 * and the person attaching it decides what to do. Quietly scaling it down is
 * how detail is lost without anyone deciding to lose it, and a map's detail is
 * the whole of what it is for.
 *
 * The caps exist because the map is decoded to raw pixels in the browser and
 * encoded again before it is stored: 12 million pixels is about 48 MB of
 * RGBA, which a phone or an older laptop can still hold, and a 4096 pixel edge
 * printed across an A4 page is well past 300 dpi, so nothing a print needs is
 * turned away. Eight maps covers every montage the practice exports with room
 * to spare, and bounds the size of one report's file.
 *
 * **Why this answers and never throws.** Everywhere else on the report's
 * pages a number that is not finite is a programming error and is refused
 * with a `RangeError` naming it. `refuseSize` is the exception, with
 * `placeImage` in `document/mapPlacement.ts`: the SCREEN asks it about what a
 * person supplied, so it answers with a refusal the screen can show, and
 * never throws.
 */

export const MAX_LONG_EDGE_PX = 4096;
export const MAX_PIXELS = 12_000_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_MAPS_PER_REPORT = 8;

/**
 * The largest FILE she may choose, checked before the browser decodes it.
 *
 * Decoding is where the memory goes, and the size in pixels is known only
 * once it is done, so a file far larger than any map is refused by its bytes
 * first. Eight times the stored cap (40 MiB) is chosen because it holds the
 * largest picture the pixel cap admits written as a 24-bit BMP with no
 * compression at all (12 million pixels is about 34.3 MiB). A 32-bit BMP of
 * that size (about 45.8 MiB) is refused by its bytes, though its pixels would
 * pass: an export that rare is asked for again at 24 bits or as a PNG. The
 * stored PNG is still held to `MAX_FILE_BYTES`.
 */
export const MAX_INPUT_BYTES = 8 * MAX_FILE_BYTES;

/** Why a chosen file cannot be read as a map, by its bytes alone, or null when it can be. */
export function refuseInputBytes(bytes: number): 'file_too_large' | 'empty' | null {
  if (!Number.isInteger(bytes) || bytes <= 0) return 'empty';
  return bytes > MAX_INPUT_BYTES ? 'file_too_large' : null;
}

export type SizeRefusal = 'too_wide' | 'too_tall' | 'too_many_pixels' | 'empty';

/**
 * Why a map of this many pixels cannot be taken, or null when it can. A size
 * that is not a positive whole number of pixels is 'empty': there is nothing
 * there to place.
 */
export function refuseSize(width: number, height: number): SizeRefusal | null {
  const isCount = (n: number): boolean => Number.isInteger(n) && n > 0;
  if (!isCount(width) || !isCount(height)) return 'empty';
  if (width > MAX_LONG_EDGE_PX) return 'too_wide';
  if (height > MAX_LONG_EDGE_PX) return 'too_tall';
  if (width * height > MAX_PIXELS) return 'too_many_pixels';
  return null;
}
