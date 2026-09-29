import { describe, expect, it } from 'vitest';
import { CHANGE } from './geometry';
import { limitsFor, pageBottom, reflow } from './paginate';
import { planFollowUp } from './planFollowUp';
import type { PlanPart } from './planFollowUp';

/**
 * Plan note N7, "Follow-up section": the height of a map in a before-and-after
 * pair is shared out of the room the page has, from a least of 96 points to a
 * preferred 190, so the page of what has changed fits one sheet when it can.
 */

const LIMITS = limitsFor(500, 700);

function partOf(id: string, height: number, mapRows = 0, flags: Partial<PlanPart> = {}): PlanPart {
  return {
    id,
    height,
    mapRows,
    marginTop: 0,
    marginBottom: 10,
    keep: false,
    newPage: false,
    gapBefore: false,
    sectionStart: false,
    pinBottom: false,
    fit: false,
    ...flags,
  };
}

/** How tall the parts stand on one page with each map `mapHeight` tall, as `paginate` stacks them. */
function standing(parts: readonly PlanPart[], mapHeight: number): number {
  return pageBottom(
    reflow(parts, (part) => part.height + part.mapRows * mapHeight, new Map(), LIMITS),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('planFollowUp', () => {
  it('draws the maps at the preferred height when the page holds them so', () => {
    const parts = [partOf('heading', 30), partOf('pair.1', 20, 1), partOf('pair.2', 20, 1)];
    expect(planFollowUp(parts, LIMITS)).toEqual({ mapHeight: CHANGE.mapPreferred, onePage: true });
  });

  it('shares the room left between the rows of maps, so the page ends at its foot', () => {
    const parts = [
      partOf('heading', 30),
      partOf('tiles', 90),
      partOf('pair.1', 24, 1),
      partOf('pair.2', 24, 1),
      partOf('table', 120),
    ];
    const plan = planFollowUp(parts, LIMITS);
    expect(plan.onePage).toBe(true);
    expect(plan.mapHeight).toBeLessThan(CHANGE.mapPreferred);
    expect(plan.mapHeight).toBeGreaterThanOrEqual(CHANGE.mapLeast);
    expect(standing(parts, plan.mapHeight)).toBeCloseTo(LIMITS.bodyHeight, 9);
  });

  it('counts the gaps between the parts as the pages count them, a section’s included', () => {
    const parts = [
      partOf('heading', 30, 0, { marginBottom: 6 }),
      partOf('pairs.heading', 20, 0, { sectionStart: true, marginTop: 0, marginBottom: 4 }),
      partOf('pair.1', 24, 1, { marginBottom: 12 }),
      partOf('table', 450),
    ];
    const plan = planFollowUp(parts, LIMITS);
    expect(standing(parts, plan.mapHeight)).toBeCloseTo(LIMITS.bodyHeight, 9);
  });

  it('never draws a map below the least height: a page that cannot hold them takes more than one', () => {
    const parts = [
      partOf('heading', 30),
      partOf('pair.1', 24, 1),
      partOf('pair.2', 24, 1),
      partOf('summary', 500),
    ];
    const plan = planFollowUp(parts, LIMITS);
    expect(plan.onePage).toBe(false);
    // The page is not one sheet whatever the maps are, so they keep the size they are best at.
    expect(plan.mapHeight).toBe(CHANGE.mapPreferred);
    expect(standing(parts, CHANGE.mapLeast)).toBeGreaterThan(LIMITS.bodyHeight);
  });

  it('draws the maps at the least height when that is exactly what the page holds', () => {
    const fixed = LIMITS.bodyHeight - 2 * CHANGE.mapLeast - 10;
    const parts = [partOf('pair.1', 0, 1), partOf('rest', fixed, 1)];
    expect(planFollowUp(parts, LIMITS).mapHeight).toBeCloseTo(CHANGE.mapLeast, 9);
    expect(planFollowUp(parts, LIMITS).onePage).toBe(true);
  });

  it('says whether a page with no maps fits one sheet, and names the preferred height', () => {
    expect(planFollowUp([partOf('heading', 30), partOf('table', 200)], LIMITS)).toEqual({
      mapHeight: CHANGE.mapPreferred,
      onePage: true,
    });
    expect(planFollowUp([partOf('heading', 30), partOf('summary', 900)], LIMITS)).toEqual({
      mapHeight: CHANGE.mapPreferred,
      onePage: false,
    });
    expect(planFollowUp([], LIMITS)).toEqual({ mapHeight: CHANGE.mapPreferred, onePage: true });
  });

  it('refuses a part whose height or count of rows is no such thing, by name', () => {
    expect(() => planFollowUp([partOf('a', Number.NaN)], LIMITS)).toThrow(
      /^planFollowUp needs a finite height/,
    );
    expect(() => planFollowUp([partOf('a', -1)], LIMITS)).toThrow(
      /^planFollowUp needs a height of zero or more, and was given -1/,
    );
    expect(() => planFollowUp([partOf('a', 10, 1.5)], LIMITS)).toThrow(
      /^planFollowUp needs a count of map rows that is a whole number of 0 or more, and was given 1.5/,
    );
    expect(() => planFollowUp([partOf('a', 10, -1)], LIMITS)).toThrow(
      /^planFollowUp needs a count of map rows/,
    );
  });

  it('changes nothing it was given, and gives the same plan twice', () => {
    const parts = deepFreeze([partOf('heading', 30), partOf('pair.1', 24, 1), partOf('t', 400)]);
    expect(planFollowUp(parts, deepFreeze({ ...LIMITS }))).toEqual(planFollowUp(parts, LIMITS));
  });
});
