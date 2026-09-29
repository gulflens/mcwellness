/**
 * A decoded brain map made ready for a report, in one call.
 *
 * **Why one entry point.** Taking a map is six steps: check its size, find
 * its blank border, cut it off, lay the pixels onto white, write the PNG,
 * and check the file is not too large to store. Each step lives in its own
 * module and is tested there; this puts them in their one right order, so no
 * screen can forget one or run two the wrong way round. The size check comes
 * first, before a single pixel is read, because a map over the caps is
 * refused, never shrunk (`limits.ts` says why).
 *
 * **It answers, and never throws, for what a person supplied.** A map too
 * wide, too tall, too many pixels, empty, or too large a file is a refusal
 * the screen shows, as `refuseSize` and `placeImage` answer. Data that does
 * not match its own size, or a compressor that writes no zlib stream, is the
 * program's mistake and still throws.
 */

import { encodePng } from './encodePng';
import type { Deflate } from './encodePng';
import { flattenOverWhite } from './flatten';
import { MAX_FILE_BYTES, refuseSize } from './limits';
import type { SizeRefusal } from './limits';
import { crop, trimWhiteBorder } from './trim';
import type { Pixels } from './trim';

/** Why a map cannot be taken: one of the size refusals, or a file over `MAX_FILE_BYTES`. */
export type MapRefusal = SizeRefusal | 'too_many_bytes';

export type PreparedMap =
  | {
      readonly ok: true;
      /** The PNG the engine embeds, byte for byte. */
      readonly png: Uint8Array;
      readonly width: number;
      readonly height: number;
      /** Whether a blank border was cut away. */
      readonly trimmed: boolean;
    }
  | { readonly ok: false; readonly refusal: MapRefusal };

export async function prepareMap(pixels: Pixels, deflate: Deflate): Promise<PreparedMap> {
  const refusal = refuseSize(pixels.width, pixels.height);
  if (refusal !== null) return { ok: false, refusal };

  const keep = trimWhiteBorder(pixels);
  const trimmed = keep.width !== pixels.width || keep.height !== pixels.height;
  const cut = trimmed ? crop(pixels, keep) : pixels;
  const png = await encodePng(flattenOverWhite(cut), cut.width, cut.height, deflate);
  if (png.length > MAX_FILE_BYTES) return { ok: false, refusal: 'too_many_bytes' };
  return { ok: true, png, width: cut.width, height: cut.height, trimmed };
}
