/**
 * The shapes the qEEG report's figures are drawn from, built as paths and
 * never drawn here: a band icon's ring and wave, the score ring, list
 * diamonds, the up and down markers, rounded panels.
 *
 * **Why numbers and not a canvas.** The Dart tool painted each figure straight
 * onto a PDF canvas, so the only way to check one was to look at it. Here a
 * shape is a list of segments, and a test can measure where it starts, where
 * it ends and how far any point strays from the curve it stands for. The
 * engine only strokes and fills what it is handed, so a path that is right as
 * numbers is right on paper.
 *
 * **Why the path types are declared here.** The document engine in
 * `domain/shared/document` has no path op yet; a later change adds one. The
 * types below are written exactly as that op will be, so the day it lands the
 * only change in this file is where `PathOp` is imported from.
 *
 * PDF coordinates throughout: `y` grows UPWARD, and an angle is in radians,
 * anticlockwise from the positive x axis, as PDF draws. A NEGATIVE sweep runs
 * clockwise, which is how the score ring runs from the top.
 *
 * A bad number is a programming error, not data, so it is refused with a
 * `RangeError` that names the argument, rather than drawn as nothing.
 */

export type Rgb = readonly [number, number, number];
export type Paint = { readonly grey?: number; readonly rgb?: Rgb };
export type PathSegment =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];
export type Stroke = Paint & {
  readonly width?: number;
  readonly cap?: 'butt' | 'round' | 'square';
  readonly join?: 'miter' | 'round' | 'bevel';
};
export type PathOp = {
  readonly kind: 'path';
  readonly segments: readonly PathSegment[];
  readonly fill?: Paint;
  readonly stroke?: Stroke;
  readonly evenOdd?: boolean;
};

const QUARTER = Math.PI / 2;
const FULL_TURN = 2 * Math.PI;

/**
 * The most cycles a wave may hold. A band icon's wave has two or three; the
 * cap keeps a slip of a number from building millions of segments.
 */
const MAX_CYCLES = 64;

/**
 * The control distance, as a fraction of the radius, of a cubic standing for
 * a quarter circle: (4/3) tan(pi/8). Written out so a corner of a rounded
 * rectangle lands exactly on its box, with no sine or cosine to leave a
 * rounding error at the edge.
 */
const QUARTER_KAPPA = (4 / 3) * Math.tan(Math.PI / 8);

function finite(shape: string, name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${shape} needs a finite ${name}, and was given ${String(value)}.`);
  }
}

function notNegative(shape: string, name: string, value: number): void {
  finite(shape, name, value);
  if (value < 0) {
    throw new RangeError(`${shape} needs a ${name} of zero or more, and was given ${value}.`);
  }
}

/** A whole circle, anticlockwise from the rightmost point, closed. */
export function circle(cx: number, cy: number, r: number): PathSegment[] {
  finite('circle', 'cx', cx);
  finite('circle', 'cy', cy);
  notNegative('circle', 'radius r', r);
  return [...arc(cx, cy, r, 0, 2 * Math.PI), ['Z']];
}

/**
 * An open arc: a move to its start, then cubic segments of at most a quarter
 * turn each, the control distance `(4/3) tan(step / 4) r`. Past a quarter
 * turn one cubic drifts visibly off the circle; at a quarter it stays within
 * about three ten-thousandths of the radius.
 */
export function arc(
  cx: number,
  cy: number,
  r: number,
  start: number,
  sweep: number,
): PathSegment[] {
  finite('arc', 'cx', cx);
  finite('arc', 'cy', cy);
  notNegative('arc', 'radius r', r);
  finite('arc', 'start', start);
  finite('arc', 'sweep', sweep);
  if (Math.abs(sweep) > FULL_TURN) {
    throw new RangeError(
      `arc needs a sweep of at most one full turn either way, and was given ${sweep}.`,
    );
  }

  const segments: PathSegment[] = [['M', cx + r * Math.cos(start), cy + r * Math.sin(start)]];
  if (sweep === 0) return segments;

  // The small allowance keeps an exact quarter, half or full turn from being
  // cut into one piece more than it needs by a rounding error in the division.
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER - 1e-9));
  const step = sweep / count;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  for (let i = 0; i < count; i += 1) {
    // Each angle from the start rather than by adding steps, so a full turn
    // closes on its own start with no drift carried along the way.
    const a = start + step * i;
    const b = start + step * (i + 1);
    const p0x = cx + r * Math.cos(a);
    const p0y = cy + r * Math.sin(a);
    const p3x = cx + r * Math.cos(b);
    const p3y = cy + r * Math.sin(b);
    segments.push([
      'C',
      p0x - k * Math.sin(a),
      p0y + k * Math.cos(a),
      p3x + k * Math.sin(b),
      p3y - k * Math.cos(b),
      p3x,
      p3y,
    ]);
  }
  return segments;
}

/**
 * A rectangle with quarter-circle corners, `x`, `y` its bottom-left. The
 * radius is clamped to half the shorter side, so a large radius gives a
 * stadium or a circle rather than corners that cross. Radius 0 is four
 * straight sides and no curve. A side the corners use up entirely is left out
 * rather than drawn as a line of no length.
 */
export function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): PathSegment[] {
  finite('roundedRect', 'x', x);
  finite('roundedRect', 'y', y);
  notNegative('roundedRect', 'width', width);
  notNegative('roundedRect', 'height', height);
  notNegative('roundedRect', 'radius', radius);

  const r = Math.min(radius, width / 2, height / 2);
  const right = x + width;
  const top = y + height;
  if (r === 0) {
    return [['M', x, y], ['L', right, y], ['L', right, top], ['L', x, top], ['Z']];
  }

  const k = QUARTER_KAPPA * r;
  const segments: PathSegment[] = [['M', x + r, y]];
  const lineTo = (toX: number, toY: number, fromX: number, fromY: number): void => {
    if (toX !== fromX || toY !== fromY) segments.push(['L', toX, toY]);
  };
  // Anticlockwise from the bottom edge, one straight side and one corner at a time.
  lineTo(right - r, y, x + r, y);
  segments.push(['C', right - r + k, y, right, y + r - k, right, y + r]);
  lineTo(right, top - r, right, y + r);
  segments.push(['C', right, top - r + k, right - r + k, top, right - r, top]);
  lineTo(x + r, top, right - r, top);
  segments.push(['C', x + r - k, top, x, top - r + k, x, top - r]);
  lineTo(x, y + r, x, top - r);
  segments.push(['C', x, y + r - k, x + r - k, y, x + r, y]);
  segments.push(['Z']);
  return segments;
}

/** A rounded rectangle whose ends are half circles: its radius is half its height. */
export function stadium(x: number, y: number, width: number, height: number): PathSegment[] {
  finite('stadium', 'height', height);
  return roundedRect(x, y, width, height, height / 2);
}

/**
 * The list bullet: a square of side `size` turned on its point, centred on
 * `cx`, `cy`, as the Dart tool drew its 2.4 mm diamond. Its box is therefore
 * `size * sqrt(2)` across.
 */
export function diamond(cx: number, cy: number, size: number): PathSegment[] {
  finite('diamond', 'cx', cx);
  finite('diamond', 'cy', cy);
  notNegative('diamond', 'size', size);
  const half = (size * Math.SQRT2) / 2;
  return [
    ['M', cx, cy + half],
    ['L', cx + half, cy],
    ['L', cx, cy - half],
    ['L', cx - half, cy],
    ['Z'],
  ];
}

/**
 * A marker filling a `size` by `size` box centred on `cx`, `cy`: its apex at
 * the middle of one edge, its base along the opposite one. Pointing down is
 * pointing up turned over about the centre line, point for point.
 */
export function triangle(
  cx: number,
  cy: number,
  size: number,
  points: 'up' | 'down',
): PathSegment[] {
  finite('triangle', 'cx', cx);
  finite('triangle', 'cy', cy);
  notNegative('triangle', 'size', size);
  const half = size / 2;
  const toward = points === 'up' ? 1 : -1;
  return [
    ['M', cx, cy + toward * half],
    ['L', cx + half, cy - toward * half],
    ['L', cx - half, cy - toward * half],
    ['Z'],
  ];
}

/** A level marker: a horizontal bar with round ends, centred on `cx`, `cy`. */
export function bar(cx: number, cy: number, width: number, thickness: number): PathSegment[] {
  finite('bar', 'cx', cx);
  finite('bar', 'cy', cy);
  notNegative('bar', 'width', width);
  notNegative('bar', 'thickness', thickness);
  return stadium(cx - width / 2, cy - thickness / 2, width, thickness);
}

/**
 * The wave inside a band icon: `yMid + amplitude * sin(2 pi cycles t)` for
 * `t` from 0 at `x0` to 1 at `x1`, rising first.
 *
 * FOUR cubic segments per cycle, each matching the sine's value and slope at
 * both of its ends, with its controls a third of the way along in x. That
 * keeps the curve within about 1.1 percent of the amplitude of the true sine
 * (the rule allows 2), where the Dart tool's 72 straight pieces were both
 * heavier and visibly faceted at a large size. A part cycle gets proportionally fewer
 * segments, none longer than a quarter.
 */
export function sineWave(
  x0: number,
  x1: number,
  yMid: number,
  amplitude: number,
  cycles: number,
): PathSegment[] {
  finite('sineWave', 'x0', x0);
  finite('sineWave', 'x1', x1);
  finite('sineWave', 'yMid', yMid);
  finite('sineWave', 'amplitude', amplitude);
  finite('sineWave', 'cycles', cycles);
  if (Math.abs(cycles) > MAX_CYCLES) {
    throw new RangeError(
      `sineWave needs at most ${MAX_CYCLES} cycles either way, and was given ${cycles}.`,
    );
  }

  const segments: PathSegment[] = [['M', x0, yMid]];
  if (cycles === 0 || amplitude === 0 || x0 === x1) {
    segments.push(['L', x1, yMid]);
    return segments;
  }

  const count = Math.max(1, Math.ceil(Math.abs(cycles) * 4 - 1e-9));
  const phaseStep = (2 * Math.PI * cycles) / count;
  const xStep = (x1 - x0) / count;
  // Slope times a third of the step, in terms of phase: no division by the
  // width, so a very narrow wave is still exact.
  const lift = (amplitude * phaseStep) / 3;
  for (let i = 0; i < count; i += 1) {
    const a = phaseStep * i;
    const b = phaseStep * (i + 1);
    const xa = x0 + xStep * i;
    const xb = x0 + xStep * (i + 1);
    const ya = yMid + amplitude * Math.sin(a);
    const yb = yMid + amplitude * Math.sin(b);
    segments.push([
      'C',
      xa + xStep / 3,
      ya + lift * Math.cos(a),
      xb - xStep / 3,
      yb - lift * Math.cos(b),
      xb,
      yb,
    ]);
  }
  return segments;
}

/**
 * Where along a cubic, between its ends, one of its coordinates turns: the
 * roots between 0 and 1 of the slope, which is a quadratic in `t`.
 */
function turnsOf(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const under = b * b - 4 * a * c;
    if (under >= 0) {
      const root = Math.sqrt(under);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * The box round a path's ink: every point it names, and for a curve the
 * points where it turns, NOT the points that steer it. A cubic's controls
 * stand outside the curve they shape, by a tenth of the radius for an
 * eighth of a circle each side of its top, so a box round them called a
 * ring that fits its square too large for it. A curve's furthest reach
 * is at an end or where its slope is nothing, and the slope of a cubic is a
 * quadratic, so the reach is found and not estimated.
 */
export function boundsOf(segments: readonly PathSegment[]): {
  left: number;
  bottom: number;
  right: number;
  top: number;
} {
  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  const take = (x: number, y: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  };
  let here: readonly [number, number] | null = null;
  let began: readonly [number, number] | null = null;
  for (const segment of segments) {
    switch (segment[0]) {
      case 'M':
        here = [segment[1], segment[2]];
        began = here;
        take(segment[1], segment[2]);
        break;
      case 'L':
        here = [segment[1], segment[2]];
        take(segment[1], segment[2]);
        break;
      case 'C': {
        if (!here) throw new RangeError('boundsOf needs a point before a curve.');
        const [x0, y0] = here;
        const [, x1, y1, x2, y2, x3, y3] = segment;
        take(x3, y3);
        for (const t of turnsOf(x0, x1, x2, x3)) {
          take(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
        }
        for (const t of turnsOf(y0, y1, y2, y3)) {
          take(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
        }
        here = [x3, y3];
        break;
      }
      case 'Z':
        here = began;
        break;
      default: {
        const unknown: never = segment;
        throw new RangeError(`boundsOf does not know the segment ${String(unknown)}.`);
      }
    }
  }
  if (left === Number.POSITIVE_INFINITY) {
    throw new RangeError('boundsOf needs a path with at least one point in it.');
  }
  return { left, bottom, right, top };
}

/**
 * The colour seen when `rgb` is laid at opacity `alpha` over white paper:
 * `1 - alpha * (1 - channel)` per channel. The Dart tool's `tint8` is this at
 * 0x14 / 255; it is computed rather than drawn with transparency because the
 * engine writes no transparency, and a flat colour prints the same everywhere.
 */
export function tintOver(rgb: Rgb, alpha: number): Rgb {
  const [r, g, b] = rgb;
  finite('tintOver', 'red', r);
  finite('tintOver', 'green', g);
  finite('tintOver', 'blue', b);
  finite('tintOver', 'alpha', alpha);
  if (alpha < 0 || alpha > 1) {
    throw new RangeError(`tintOver needs an alpha from 0 to 1, and was given ${alpha}.`);
  }
  return [1 - alpha * (1 - r), 1 - alpha * (1 - g), 1 - alpha * (1 - b)];
}
