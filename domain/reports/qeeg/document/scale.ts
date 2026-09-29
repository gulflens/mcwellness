/**
 * Zooming a finished block of ops, and moving it, by rewriting the numbers.
 *
 * **Why on the numbers and not with a matrix.** The Dart tool's `ScaledBlock`
 * laid a block out at one width and painted it through a transform, so the
 * dashboard filled the text width as a true zoom. That works on paper but
 * hides where anything lands: the op says one place and the page shows
 * another. Here every coordinate's distance from the origin is multiplied,
 * and so is every length — a font size, a rule's width, rise and thickness,
 * an image's box, a stroke's width, every number in a path — so each op stays
 * flat and a test can measure exactly where it will print.
 *
 * Every `switch` over `op.kind` ends in a `never` check, so the day the
 * engine learns a new op the compiler points here. It did for `rect`, which
 * the practice's invoice brought: a rectangle's line is a rule's, half a
 * point when it names none, and is scaled as a rule's is.
 */

import type { Op } from '@domain/shared/document';
import type { PathOp, PathSegment } from './shapes';

export type LayoutOp = Op | PathOp;

/**
 * The rule thickness the engine draws when an op names none
 * (`domain/shared/document/pdf.ts`, `op.thickness ?? 0.5`). A scaled rule
 * must carry it explicitly, or a block zoomed down would keep full-weight
 * hairlines.
 */
export const ENGINE_RULE_THICKNESS = 0.5;

/**
 * The line width PDF itself starts every page with. The path op does not yet
 * exist in the engine, so this is the only default a stroke with no width can
 * be said to have; a scaled stroke carries it explicitly for the same reason
 * a rule does.
 */
export const PDF_LINE_WIDTH = 1;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`scaleOps needs a finite ${name}, and was given ${String(value)}.`);
  }
}

function mapPoints(
  segments: readonly PathSegment[],
  fx: (x: number) => number,
  fy: (y: number) => number,
): PathSegment[] {
  return segments.map((segment): PathSegment => {
    switch (segment[0]) {
      case 'M':
        return ['M', fx(segment[1]), fy(segment[2])];
      case 'L':
        return ['L', fx(segment[1]), fy(segment[2])];
      case 'C':
        return [
          'C',
          fx(segment[1]),
          fy(segment[2]),
          fx(segment[3]),
          fy(segment[4]),
          fx(segment[5]),
          fy(segment[6]),
        ];
      case 'Z':
        return ['Z'];
      default: {
        const unknown: never = segment;
        throw new RangeError(`A path segment of an unknown kind: ${String(unknown)}.`);
      }
    }
  });
}

/**
 * A copy of an op, written out by hand: every object and array inside it is
 * new, so a caller changing the copy changes nothing it was made from. By
 * hand rather than with the host's `structuredClone`, which Safari lacks
 * before 15.4.
 *
 * **Only a copy at a scale of one is made this way.** An op that is scaled
 * or moved is a new op with new numbers, and carries the very paints of its
 * source. That is deliberate. A block is moved once for every box it is set
 * inside, so a page of cards moves each op a handful of times, and copying
 * a colour each time would buy nothing: the palette's paints are frozen and
 * cannot be changed by whoever holds them (`palette.test.ts`).
 */
function copyOf(op: LayoutOp): LayoutOp {
  switch (op.kind) {
    case 'text':
      return { ...op, style: copyPaint(op.style) };
    case 'rule':
      return op.rgb ? { ...op, rgb: [...op.rgb] } : { ...op };
    case 'image':
      return { ...op };
    case 'path': {
      const segments = mapPoints(
        op.segments,
        (x) => x,
        (y) => y,
      );
      return {
        ...op,
        segments,
        ...(op.fill ? { fill: copyPaint(op.fill) } : {}),
        ...(op.stroke ? { stroke: copyPaint(op.stroke) } : {}),
      };
    }
    case 'rect':
      return {
        ...op,
        ...(op.fill ? { fill: copyFill(op.fill) } : {}),
        ...(op.stroke ? { stroke: copyPaint(op.stroke) } : {}),
      };
    default: {
      const unknown: never = op;
      throw new RangeError(`scaleOps does not know the op ${String(unknown)}.`);
    }
  }
}

type RectFill = NonNullable<Extract<Op, { kind: 'rect' }>['fill']>;

/** A rectangle's fill is a colour or a grey and never both, so each is copied as what it is. */
function copyFill(fill: RectFill): RectFill {
  if ('rgb' in fill) {
    const [red, green, blue] = fill.rgb;
    return { rgb: [red, green, blue] };
  }
  return { grey: fill.grey };
}

/** A paint, or anything carrying one, with its colour triple copied too. */
function copyPaint<T extends { readonly rgb?: readonly [number, number, number] }>(paint: T): T {
  return paint.rgb ? { ...paint, rgb: [...paint.rgb] } : { ...paint };
}

/**
 * Every op scaled by `k` about `origin`. `k` must be finite and above 0; a
 * scale of 1 gives back equal ops, copied, rather than ops pushed through
 * arithmetic that could move a number by a rounding error.
 */
export function scaleOps(
  ops: readonly LayoutOp[],
  k: number,
  origin: { x: number; y: number },
): LayoutOp[] {
  finite('scale k', k);
  if (k <= 0) throw new RangeError(`scaleOps needs a scale above 0, and was given ${k}.`);
  finite('origin x', origin.x);
  finite('origin y', origin.y);
  if (k === 1) return ops.map(copyOf);

  const sx = (x: number): number => origin.x + (x - origin.x) * k;
  const sy = (y: number): number => origin.y + (y - origin.y) * k;

  return ops.map((op): LayoutOp => {
    switch (op.kind) {
      case 'text':
        return { ...op, x: sx(op.x), y: sy(op.y), style: { ...op.style, size: op.style.size * k } };
      case 'rule': {
        const scaled = {
          ...op,
          x: sx(op.x),
          y: sy(op.y),
          width: op.width * k,
          thickness: (op.thickness ?? ENGINE_RULE_THICKNESS) * k,
        };
        return op.dy === undefined ? scaled : { ...scaled, dy: op.dy * k };
      }
      case 'image':
        return { ...op, x: sx(op.x), y: sy(op.y), width: op.width * k, height: op.height * k };
      case 'path': {
        const segments = mapPoints(op.segments, sx, sy);
        if (!op.stroke) return { ...op, segments };
        return {
          ...op,
          segments,
          stroke: { ...op.stroke, width: (op.stroke.width ?? PDF_LINE_WIDTH) * k },
        };
      }
      case 'rect':
        return {
          ...op,
          x: sx(op.x),
          y: sy(op.y),
          width: op.width * k,
          height: op.height * k,
          ...(op.radius === undefined ? {} : { radius: op.radius * k }),
          ...(op.stroke
            ? {
                stroke: {
                  ...op.stroke,
                  thickness: (op.stroke.thickness ?? ENGINE_RULE_THICKNESS) * k,
                },
              }
            : {}),
        };
      default: {
        const unknown: never = op;
        throw new RangeError(`scaleOps does not know the op ${String(unknown)}.`);
      }
    }
  });
}

/** Every op moved by `dx` across and `dy` up. Lengths are untouched. */
export function translateOps(ops: readonly LayoutOp[], dx: number, dy: number): LayoutOp[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    const name = Number.isFinite(dx) ? 'dy' : 'dx';
    throw new RangeError(
      `translateOps needs a finite ${name}, and was given ${String(name === 'dx' ? dx : dy)}.`,
    );
  }
  return ops.map((op): LayoutOp => {
    switch (op.kind) {
      case 'text':
      case 'rule':
      case 'image':
      case 'rect':
        return { ...op, x: op.x + dx, y: op.y + dy };
      case 'path':
        return {
          ...op,
          segments: mapPoints(
            op.segments,
            (x) => x + dx,
            (y) => y + dy,
          ),
        };
      default: {
        const unknown: never = op;
        throw new RangeError(`translateOps does not know the op ${String(unknown)}.`);
      }
    }
  });
}
