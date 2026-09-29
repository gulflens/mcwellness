/**
 * How large a brain map is drawn, and how sharp it will print there.
 *
 * **What decides print quality.** Nothing on the way into the report loses
 * detail: a map is stored and embedded at its own pixel size, losslessly. What
 * decides how it looks on paper is how many of its pixels land on each inch
 * of the page. A print shop wants 300; below about 220 a map looks soft, and
 * below 140 it looks plainly pixelated and should be exported again. The
 * person attaching the map can only act on that before the report goes out,
 * so the screen shows it on the map rather than leaving it to be found on the
 * printed page.
 *
 * **Why a box and not the page width.** The Dart tool copied the page's body
 * width by hand and considered width alone. This takes the box the map is
 * placed in, because the same map is drawn full-page in one place and at half
 * width in another, and prints twice as sharp there; and because a tall map
 * in a short box is bound by its height, which a width-only estimate misses.
 *
 * A stored map is measured in CSS pixels at 96 to the inch, as the original
 * web build wrote them, so its natural size in points is `pixels * 72 / 96`.
 * It is never magnified past `MAX_MAP_SCALE`, so a small capture is not blown
 * up into a blur.
 *
 * **Why this answers and never throws.** Everywhere else on the report's
 * pages a number that is not finite is a programming error and is refused
 * with a `RangeError` naming it. `placeImage` is the exception, with
 * `refuseSize` in `image/limits.ts`: the SCREEN asks it about what a person
 * supplied, a map half attached or a slot not yet filled, so it answers with
 * a value the screen can show, and never throws.
 */

export const GOOD_PRINT_DPI = 220;
export const POOR_PRINT_DPI = 140;
export const MAX_MAP_SCALE = 2.5;

export type Placed = { width: number; height: number; scale: number; dpi: number };
export type PrintQuality = 'good' | 'fair' | 'poor';

const POINTS_PER_INCH = 72;
const CSS_PIXELS_PER_INCH = 96;

const NOTHING: Placed = { width: 0, height: 0, scale: 0, dpi: 0 };

/**
 * The size a map of `pixels` is drawn at in `box`, the scale that took it
 * there, and the dots per inch it prints at. A size of nothing, or a box of
 * nothing, gives a zero placement and 0 dpi rather than an error: the screen
 * asks this of whatever it has, including a slot not yet filled.
 */
export function placeImage(
  pixels: { width: number; height: number },
  box: { maxWidth: number; maxHeight: number },
  maxScale: number = MAX_MAP_SCALE,
): Placed {
  const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
  if (!positive(pixels.width) || !positive(pixels.height)) return NOTHING;
  if (!positive(box.maxWidth) || !positive(box.maxHeight) || !positive(maxScale)) return NOTHING;

  const naturalWidth = (pixels.width * POINTS_PER_INCH) / CSS_PIXELS_PER_INCH;
  const naturalHeight = (pixels.height * POINTS_PER_INCH) / CSS_PIXELS_PER_INCH;
  const scale = Math.min(maxScale, box.maxWidth / naturalWidth, box.maxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { width, height, scale, dpi: pixels.width / (width / POINTS_PER_INCH) };
}

/** Good from 220 dpi, fair from 140, poor below. */
export function printQualityOf(dpi: number): PrintQuality {
  if (dpi >= GOOD_PRINT_DPI) return 'good';
  if (dpi >= POOR_PRINT_DPI) return 'fair';
  return 'poor';
}

/**
 * The wording key for the note a map of this quality carries, or null when it
 * prints well. A key and never a sentence: the words live with the rest of
 * the report's wording, where a person approves them.
 */
export function printQualityKey(quality: PrintQuality): 'map.print.fair' | 'map.print.poor' | null {
  switch (quality) {
    case 'good':
      return null;
    case 'fair':
      return 'map.print.fair';
    case 'poor':
      return 'map.print.poor';
    default: {
      const unknown: never = quality;
      throw new RangeError(`An unknown print quality: ${String(unknown)}.`);
    }
  }
}
