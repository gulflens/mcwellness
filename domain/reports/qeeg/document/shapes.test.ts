import { describe, expect, it } from 'vitest';
import {
  arc,
  bar,
  boundsOf,
  circle,
  diamond,
  roundedRect,
  sineWave,
  stadium,
  tintOver,
  triangle,
} from './shapes';
import type { PathSegment } from './shapes';

/**
 * The geometry the report's figures are drawn from, measured as numbers: where
 * a path starts, where it ends, and how far any point on it strays from the
 * curve it stands for. Nothing here is drawn; a path that is right as numbers
 * is right on paper, because the engine only strokes what it is given.
 */

type Point = { x: number; y: number };

/** Every on-curve point of a path: the ends of each segment, not its controls. */
function endpoints(segments: readonly PathSegment[]): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    if (segment[0] === 'M' || segment[0] === 'L') points.push({ x: segment[1], y: segment[2] });
    if (segment[0] === 'C') points.push({ x: segment[5], y: segment[6] });
  }
  return points;
}

/** Every number a path names, controls included. */
function everyPoint(segments: readonly PathSegment[]): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    if (segment[0] === 'M' || segment[0] === 'L') points.push({ x: segment[1], y: segment[2] });
    if (segment[0] === 'C') {
      points.push({ x: segment[1], y: segment[2] });
      points.push({ x: segment[3], y: segment[4] });
      points.push({ x: segment[5], y: segment[6] });
    }
  }
  return points;
}

/** A point on the cubic from `from` along segment `c` at parameter `t`. */
function onCubic(from: Point, c: PathSegment, t: number): Point {
  if (c[0] !== 'C') throw new Error('not a curve');
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * from.x + b * c[1] + d * c[3] + e * c[5],
    y: a * from.y + b * c[2] + d * c[4] + e * c[6],
  };
}

/** Points sampled densely along every segment of a path. */
function sampled(segments: readonly PathSegment[], perSegment = 50): Point[] {
  const points: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  for (const segment of segments) {
    if (segment[0] === 'M') {
      at = { x: segment[1], y: segment[2] };
      points.push(at);
    } else if (segment[0] === 'L') {
      at = { x: segment[1], y: segment[2] };
      points.push(at);
    } else if (segment[0] === 'C') {
      for (let i = 1; i <= perSegment; i += 1) points.push(onCubic(at, segment, i / perSegment));
      at = { x: segment[5], y: segment[6] };
    }
  }
  return points;
}

const first = (segments: readonly PathSegment[]): Point => {
  const p = endpoints(segments)[0];
  if (!p) throw new Error('empty path');
  return p;
};
const last = (segments: readonly PathSegment[]): Point => {
  const p = endpoints(segments).at(-1);
  if (!p) throw new Error('empty path');
  return p;
};
const curves = (segments: readonly PathSegment[]) => segments.filter((s) => s[0] === 'C');

describe('a circle', () => {
  it('starts and ends at the same point and is closed', () => {
    const path = circle(100, 200, 30);
    expect(path[0]?.[0]).toBe('M');
    expect(path.at(-1)).toEqual(['Z']);
    expect(last(path).x).toBeCloseTo(first(path).x, 9);
    expect(last(path).y).toBeCloseTo(first(path).y, 9);
  });

  it('keeps every point within a thousandth of its radius', () => {
    const r = 30;
    for (const p of sampled(circle(100, 200, r))) {
      expect(Math.abs(Math.hypot(p.x - 100, p.y - 200) - r)).toBeLessThan(r / 1000);
    }
  });
});

describe('an arc', () => {
  it('ends where its angle says, to a thousandth of a point', () => {
    const end = last(arc(10, 20, 50, 0.3, 1.9));
    expect(Math.abs(end.x - (10 + 50 * Math.cos(2.2)))).toBeLessThan(0.001);
    expect(Math.abs(end.y - (20 + 50 * Math.sin(2.2)))).toBeLessThan(0.001);
  });

  it('runs clockwise when its sweep is negative: a quarter from the top ends at the right-hand side', () => {
    const path = arc(0, 0, 10, Math.PI / 2, -Math.PI / 2);
    expect(first(path).x).toBeCloseTo(0, 9);
    expect(first(path).y).toBeCloseTo(10, 9);
    expect(last(path).x).toBeCloseTo(10, 9);
    expect(last(path).y).toBeCloseTo(0, 9);
  });

  it('is cut into quarter turns or less when it runs more than a quarter turn', () => {
    const path = arc(0, 0, 10, 0, (3 * Math.PI) / 2 + 0.1);
    expect(curves(path)).toHaveLength(4);
    const quarter = arc(0, 0, 10, 0, Math.PI / 2);
    expect(curves(quarter)).toHaveLength(1);
  });

  it('uses the control distance (4/3) tan(step/4) r', () => {
    const r = 10;
    const [, c] = arc(0, 0, r, 0, Math.PI / 2);
    if (!c || c[0] !== 'C') throw new Error('expected a curve');
    const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
    expect(c[1]).toBeCloseTo(r, 9);
    expect(c[2]).toBeCloseTo(k, 9);
  });

  it('meets its own start when it runs a full turn', () => {
    const path = arc(5, 5, 12, Math.PI / 2, -2 * Math.PI);
    expect(last(path).x).toBeCloseTo(first(path).x, 9);
    expect(last(path).y).toBeCloseTo(first(path).y, 9);
  });

  it('keeps every point of a long clockwise arc on its circle', () => {
    for (const p of sampled(arc(0, 0, 40, Math.PI / 2, -1.7 * Math.PI))) {
      expect(Math.abs(Math.hypot(p.x, p.y) - 40)).toBeLessThan(40 / 1000);
    }
  });

  it('is a single point when it sweeps nothing', () => {
    expect(arc(0, 0, 10, 1, 0)).toEqual([['M', 10 * Math.cos(1), 10 * Math.sin(1)]]);
  });
});

describe('a rounded rectangle', () => {
  it('is four straight sides when it has no radius', () => {
    const path = roundedRect(10, 20, 100, 50, 0);
    expect(path).toEqual([['M', 10, 20], ['L', 110, 20], ['L', 110, 70], ['L', 10, 70], ['Z']]);
  });

  it('has four quarter-circle corners when it has a radius', () => {
    const path = roundedRect(0, 0, 100, 50, 8);
    expect(curves(path)).toHaveLength(4);
    expect(path.at(-1)).toEqual(['Z']);
    const box = boundsOf(path);
    expect(box).toEqual({ left: 0, bottom: 0, right: 100, top: 50 });
  });

  it('clamps a radius larger than half the shorter side', () => {
    const clamped = roundedRect(0, 0, 100, 40, 500);
    expect(clamped).toEqual(roundedRect(0, 0, 100, 40, 20));
  });
});

describe('a stadium', () => {
  it('has ends that are half circles', () => {
    const x = 10;
    const y = 30;
    const w = 120;
    const h = 24;
    const path = stadium(x, y, w, h);
    const r = h / 2;
    const leftCentre = { x: x + r, y: y + r };
    const rightCentre = { x: x + w - r, y: y + r };
    for (const p of sampled(path)) {
      if (p.x < leftCentre.x - 1e-9) {
        expect(Math.abs(Math.hypot(p.x - leftCentre.x, p.y - leftCentre.y) - r)).toBeLessThan(
          r / 1000,
        );
      }
      if (p.x > rightCentre.x + 1e-9) {
        expect(Math.abs(Math.hypot(p.x - rightCentre.x, p.y - rightCentre.y) - r)).toBeLessThan(
          r / 1000,
        );
      }
    }
    // The ends reach out to the full width and nothing further.
    expect(boundsOf(path)).toEqual({ left: x, bottom: y, right: x + w, top: y + h });
  });

  it('is the rounded rectangle whose radius is half its height', () => {
    expect(stadium(0, 0, 80, 10)).toEqual(roundedRect(0, 0, 80, 10, 5));
  });
});

describe('a sine wave', () => {
  it('stays within two hundredths of its amplitude of the true curve', () => {
    const x0 = 11;
    const x1 = 37;
    const yMid = 24;
    const amplitude = 6;
    for (const cycles of [1, 2.5, 3, 0.7]) {
      const path = sineWave(x0, x1, yMid, amplitude, cycles);
      for (const p of sampled(path, 200)) {
        const t = (p.x - x0) / (x1 - x0);
        const truth = yMid + amplitude * Math.sin(2 * Math.PI * cycles * t);
        expect(Math.abs(p.y - truth)).toBeLessThan(0.02 * amplitude);
      }
    }
  });

  it('uses four curves per cycle', () => {
    expect(curves(sineWave(0, 100, 0, 5, 3))).toHaveLength(12);
  });

  it('begins and ends on the middle line for a whole number of cycles', () => {
    const path = sineWave(0, 100, 40, 5, 3);
    expect(first(path)).toEqual({ x: 0, y: 40 });
    expect(last(path).x).toBeCloseTo(100, 9);
    expect(last(path).y).toBeCloseTo(40, 9);
  });

  it('rises first, as the wave on the band icons does', () => {
    const path = sineWave(0, 100, 0, 5, 1);
    const peak = endpoints(path)[1];
    expect(peak?.x).toBeCloseTo(25, 9);
    expect(peak?.y).toBeCloseTo(5, 9);
  });
});

describe('the markers', () => {
  it('draws a triangle pointing down as the one pointing up, turned over', () => {
    const up = triangle(50, 60, 10, 'up');
    const down = triangle(50, 60, 10, 'down');
    const flipped = endpoints(up).map((p) => ({ x: p.x, y: 2 * 60 - p.y }));
    expect(endpoints(down)).toEqual(flipped);
    expect(first(up).y).toBeGreaterThan(60);
    expect(down.at(-1)).toEqual(['Z']);
  });

  it('draws a diamond as a square turned on its point, its side the size given', () => {
    const path = diamond(0, 0, 10);
    const [top, right, bottom, left] = endpoints(path);
    const half = (10 * Math.SQRT2) / 2;
    expect(top).toEqual({ x: 0, y: half });
    expect(right).toEqual({ x: half, y: 0 });
    expect(bottom).toEqual({ x: 0, y: -half });
    expect(left).toEqual({ x: -half, y: 0 });
    expect(
      Math.hypot((top?.x ?? 0) - (right?.x ?? 0), (top?.y ?? 0) - (right?.y ?? 0)),
    ).toBeCloseTo(10, 9);
  });

  it('draws a bar centred on its point, as wide and as thick as asked', () => {
    expect(boundsOf(bar(50, 20, 30, 4))).toEqual({ left: 35, bottom: 18, right: 65, top: 22 });
  });
});

describe('the bounds of a path', () => {
  it('hold every point of the path', () => {
    const paths = [
      circle(10, 10, 5),
      arc(0, 0, 20, 0.2, -4),
      sineWave(0, 50, 10, 3, 2.3),
      roundedRect(-5, -5, 30, 10, 3),
      triangle(0, 0, 7, 'down'),
    ];
    for (const path of paths) {
      const box = boundsOf(path);
      for (const p of sampled(path)) {
        expect(p.x).toBeGreaterThanOrEqual(box.left - 1e-9);
        expect(p.x).toBeLessThanOrEqual(box.right + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(box.bottom - 1e-9);
        expect(p.y).toBeLessThanOrEqual(box.top + 1e-9);
      }
      for (const p of everyPoint(path)) {
        expect(p.x).toBeGreaterThanOrEqual(box.left);
        expect(p.y).toBeLessThanOrEqual(box.top);
      }
    }
  });

  it('refuses a path with no points in it', () => {
    expect(() => boundsOf([['Z']])).toThrow(RangeError);
  });
});

describe('a tint over white', () => {
  it('is white at nothing and the colour itself at everything', () => {
    expect(tintOver([0.2, 0.4, 0.6], 0)).toEqual([1, 1, 1]);
    const full = tintOver([0.2, 0.4, 0.6], 1);
    expect(full[0]).toBeCloseTo(0.2, 12);
    expect(full[1]).toBeCloseTo(0.4, 12);
    expect(full[2]).toBeCloseTo(0.6, 12);
  });

  it('is one minus alpha times the distance from white, per channel', () => {
    const a = 0x14 / 255;
    const [r, g, b] = tintOver([0, 0.5, 1], a);
    expect(r).toBeCloseTo(1 - a, 12);
    expect(g).toBeCloseTo(1 - a * 0.5, 12);
    expect(b).toBeCloseTo(1, 12);
  });
});

describe('a number a shape cannot be built from', () => {
  it('is refused by name when it is not finite', () => {
    expect(() => circle(Number.NaN, 0, 5)).toThrow(RangeError);
    expect(() => circle(Number.NaN, 0, 5)).toThrow(/cx/);
    expect(() => arc(0, 0, 5, 0, Number.POSITIVE_INFINITY)).toThrow(/sweep/);
    expect(() => roundedRect(0, 0, Number.NaN, 5, 1)).toThrow(/width/);
    expect(() => sineWave(0, 10, 0, 1, Number.NaN)).toThrow(/cycles/);
    expect(() => tintOver([0, Number.NaN, 0], 0.5)).toThrow(/green/);
  });

  it('is refused when a radius is negative', () => {
    expect(() => circle(0, 0, -1)).toThrow(RangeError);
    expect(() => circle(0, 0, -1)).toThrow(/radius/);
    expect(() => roundedRect(0, 0, 10, 10, -2)).toThrow(/radius/);
  });
});
