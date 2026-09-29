/**
 * The head of every page: the practice's logo, centred, and the room under
 * it before the body begins.
 *
 * **Not mirrored.** A logo is a picture of a mark and reads the same in
 * either language, so the Arabic header is the English one exactly. It is
 * centred, so it stands in the same place whichever edge is the start.
 *
 * **A key, not a picture.** The piece draws one image op naming the key the
 * engine looks the picture up by; which picture that is, and its bytes, are
 * the caller's business.
 */

import type { Block } from '../block';
import { boxLeft } from '../frame';
import type { Frame } from '../frame';
import { HEADER } from '../geometry';
import { finite } from '../metrics';
import type { Drawing } from '../typeset';

export type PageHeaderInput = {
  /** The key the engine looks the logo up by. */
  readonly image: string;
};

export function pageHeader(input: PageHeaderInput, width: number, drawing: Drawing): Block {
  finite('pageHeader', 'width', width);
  const { width: logoWidth, height: logoHeight } = HEADER.logo;
  if (width < logoWidth) {
    throw new RangeError(
      `pageHeader needs a width of at least ${logoWidth}, and was given ${width}.`,
    );
  }
  if (input.image === '') {
    throw new RangeError('pageHeader needs the key of an image, and was given none.');
  }
  const frame: Frame = { direction: drawing.direction, left: 0, width };
  return {
    width,
    height: HEADER.height,
    overhang: 0,
    baseline: null,
    ops: [
      {
        kind: 'image',
        image: input.image,
        x: boxLeft(frame, (width - logoWidth) / 2, logoWidth),
        y: -logoHeight,
        width: logoWidth,
        height: logoHeight,
      },
    ],
  };
}
