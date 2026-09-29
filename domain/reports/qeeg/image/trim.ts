/**
 * Finding and cutting away the blank border round a brain-map export.
 *
 * **Why trim at all.** Montage pages come out of the recording software with
 * a wide white margin. Printed as they are, the margin takes a share of the
 * page width and the maps themselves print smaller, and softer, than they
 * need to. Cutting the border off lets the same pixels fill more of the page.
 *
 * **A faithful port.** This is `trimWhiteBorder` from the Dart tool's
 * `storage.dart`, rule for rule, because the practice's existing reports were
 * made with it and a map attached here should print as it printed there:
 *
 * - a pixel is blank when its alpha is under 16, or all three of its channels
 *   are 247 or more (a scanner's white is rarely 255);
 * - rows and columns are sampled every second pixel, from the first;
 * - if what is left is under 20 pixels either way, the image is left whole,
 *   because that is a blank or broken export and not a map with a margin;
 * - the padding kept is 1% of the width, at least 4 and at most 16 pixels,
 *   clamped to the image.
 *
 * Where the Dart version returned a new image, this returns the rectangle to
 * keep, and `crop` makes the copy. Finding and cutting are separate so the
 * screen can show what will be kept before anything is cut.
 */

/** RGBA, four bytes a pixel, row by row from the top, as a browser canvas gives it. */
export type Pixels = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};
export type Crop = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

const WHITE_FROM = 247;
const CLEAR_BELOW = 16;
const SMALLEST_KEPT = 20;

/**
 * Refuses an image whose sides are not whole numbers above 0, or whose data
 * is not four bytes for each pixel: a programming error, since the browser
 * gives both from one decode.
 */
export function checkPixels(fn: string, image: Pixels): void {
  const { width, height, data } = image;
  const counts = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  if (!counts || data.length !== width * height * 4) {
    throw new RangeError(
      `${fn} needs an image whose sides are whole numbers above 0 with four bytes a pixel, and was given ${width} by ${height} with ${data.length} bytes.`,
    );
  }
}

/** The rectangle to keep: the content plus a little padding, or the whole image. */
export function trimWhiteBorder(image: Pixels): Crop {
  checkPixels('trimWhiteBorder', image);
  const { width, height, data } = image;
  const whole: Crop = { left: 0, top: 0, width, height };

  const blank = (x: number, y: number): boolean => {
    const at = (y * width + x) * 4;
    const alpha = data[at + 3] ?? 0;
    return (
      alpha < CLEAR_BELOW ||
      ((data[at] ?? 0) >= WHITE_FROM &&
        (data[at + 1] ?? 0) >= WHITE_FROM &&
        (data[at + 2] ?? 0) >= WHITE_FROM)
    );
  };
  const rowBlank = (y: number): boolean => {
    for (let x = 0; x < width; x += 2) if (!blank(x, y)) return false;
    return true;
  };
  const columnBlank = (x: number): boolean => {
    for (let y = 0; y < height; y += 2) if (!blank(x, y)) return false;
    return true;
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < bottom && rowBlank(top)) top += 1;
  while (bottom > top && rowBlank(bottom)) bottom -= 1;
  while (left < right && columnBlank(left)) left += 1;
  while (right > left && columnBlank(right)) right -= 1;
  if (right - left < SMALLEST_KEPT || bottom - top < SMALLEST_KEPT) return whole;

  const pad = Math.min(16, Math.max(4, Math.round(width * 0.01)));
  const clamp = (value: number, most: number): number => Math.min(most, Math.max(0, value));
  left = clamp(left - pad, width - 1);
  right = clamp(right + pad, width - 1);
  top = clamp(top - pad, height - 1);
  bottom = clamp(bottom + pad, height - 1);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** A new image holding only the pixels inside `to`. The one given is untouched. */
export function crop(image: Pixels, to: Crop): Pixels {
  checkPixels('crop', image);
  const { left, top, width, height } = to;
  const counts = [left, top, width, height].every((n) => Number.isInteger(n) && n >= 0);
  if (!counts || left + width > image.width || top + height > image.height) {
    throw new RangeError(
      `A crop of ${width} by ${height} at (${left}, ${top}) does not lie inside an image of ${image.width} by ${image.height}.`,
    );
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}
