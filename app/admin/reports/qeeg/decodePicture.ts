import type { Pixels } from '../../../../domain/reports/qeeg/image/trim';

/**
 * A chosen file opened as a picture in the browser, its pixels drawn only
 * when asked for (docs/SPEC/reports-qeeg.md section 9, point 2).
 *
 * **What this costs before the size is known.** `createImageBitmap` decodes
 * the whole file before it tells its size, so a picture far over the caps
 * still costs its decoded memory here before `refuseSize` can refuse it. The
 * file's bytes are therefore capped before it is opened at all
 * (`refuseInputBytes`, in `mapFile.ts`). What this file saves is the second
 * copy: the RGBA pixels are laid out on a canvas only for a picture inside
 * the caps. Reading the size from the file's own header first, and doing the
 * work off the main thread, are later remedies (parked in fix round 1).
 *
 * **The browser's decoder, and nothing of ours.** PNG, JPEG, BMP and the
 * rest are read by the browser, which is the one thing here that cannot be a
 * pure function; everything done to the pixels afterwards is the domain's
 * (`domain/reports/qeeg/image/`). Kept in a file of its own so the screen's
 * tests can stand in for the decoder, which a test browser does not have.
 */

export type OpenedPicture = {
  readonly width: number;
  readonly height: number;
  /** The picture's RGBA pixels, drawn once. */
  readonly pixels: () => Pixels;
  /** Lets go of the decoded picture. */
  readonly close: () => void;
};

/** The file as a picture, or null when the browser cannot read it as one. */
export async function openPicture(file: Blob): Promise<OpenedPicture | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const { width, height } = bitmap;
  return {
    width,
    height,
    pixels: () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('This browser gave no canvas to read a picture with.');
      context.drawImage(bitmap, 0, 0);
      return { width, height, data: context.getImageData(0, 0, width, height).data };
    },
    close: () => bitmap.close(),
  };
}
