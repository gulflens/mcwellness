/**
 * A map's RGBA pixels laid onto white paper, as three bytes a pixel.
 *
 * **Why flatten rather than keep the alpha.** The document engine embeds
 * truecolour without a mask (`domain/shared/document/png.ts` refuses alpha),
 * and the page under every map is white. Compositing onto white here gives
 * the picture exactly as it would print over the page, with nothing left for
 * a reader or a printer to interpret differently.
 *
 * `channel = round(alpha/255 * value + (1 - alpha/255) * 255)`.
 */

import { checkPixels } from './trim';
import type { Pixels } from './trim';
export function flattenOverWhite(image: Pixels): Uint8Array {
  checkPixels('flattenOverWhite', image);
  const count = image.width * image.height;
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const a = (image.data[i * 4 + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c += 1) {
      const value = image.data[i * 4 + c] ?? 0;
      out[i * 3 + c] = Math.round(a * value + (1 - a) * 255);
    }
  }
  return out;
}
