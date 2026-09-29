import { describe, expect, it } from 'vitest';
import {
  APPROACH_IDS,
  BAND_CHANGES,
  BAND_IDS,
  BAND_RANGES,
  BENEFIT_IDS,
  CALCULABLE_MEASURES,
  CONNECTIVITY_CHANGES,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  MEASURE_IDS,
  MEASURE_RANGES,
  NEXT_STAGE_IDS,
  RECOMMENDATION_IDS,
  REGION_IDS,
  SESSION_OPTIONS,
  TIER_IDS,
  tierOf,
} from './ids';

/** docs/SPEC/reports-qeeg.md, "The lists": what a brain-map report may choose from. */

const LISTS: ReadonlyArray<readonly [string, readonly string[], number]> = [
  ['findings', FINDING_IDS, 10],
  ['areas of focus', FOCUS_IDS, 11],
  ['regions', REGION_IDS, 9],
  ['bands', BAND_IDS, 5],
  ['connectivity measures', CONNECTIVITY_IDS, 3],
  ['dimensions', DIMENSION_IDS, 6],
  ['tiers', TIER_IDS, 3],
  ['recommendations', RECOMMENDATION_IDS, 6],
  ['benefits', BENEFIT_IDS, 9],
  ['approaches', APPROACH_IDS, 3],
  ['next stages', NEXT_STAGE_IDS, 6],
  ['levels of a band on a first report', INITIAL_BAND_LEVELS, 3],
  ['levels of connectivity on a first report', INITIAL_CONNECTIVITY_LEVELS.connectivity, 3],
  ['levels of asymmetry on a first report', INITIAL_CONNECTIVITY_LEVELS.asymmetry, 3],
  ['levels of phase lag on a first report', INITIAL_CONNECTIVITY_LEVELS.phase_lag, 3],
  ['changes of a band on a follow-up', BAND_CHANGES, 5],
  ['changes of connectivity on a follow-up', CONNECTIVITY_CHANGES, 5],
  ['measures of the change table', MEASURE_IDS, 10],
];

describe('the lists a report chooses from', () => {
  it.each(LISTS)('holds every one of the %s', (_name, list, count) => {
    expect(list).toHaveLength(count);
  });

  it.each(LISTS)('names each of the %s in lower snake case', (_name, list) => {
    for (const id of list) expect(id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it.each(LISTS)('names none of the %s twice', (_name, list) => {
    expect(new Set(list).size).toBe(list.length);
  });

  it.each(LISTS)('cannot have the %s changed by a caller', (_name, list) => {
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('never lets a level of a first report pass for a change on a follow-up', () => {
    // The two editions validate against their own lists. An id in both would let
    // a choice made in one be read as a choice made in the other.
    const levels = new Set<string>([
      ...INITIAL_BAND_LEVELS,
      ...INITIAL_CONNECTIVITY_LEVELS.connectivity,
      ...INITIAL_CONNECTIVITY_LEVELS.asymmetry,
      ...INITIAL_CONNECTIVITY_LEVELS.phase_lag,
    ]);
    const changes = [...BAND_CHANGES, ...CONNECTIVITY_CHANGES];
    expect(changes.filter((id) => levels.has(id))).toEqual([]);
  });

  it('never lets a first approach pass for a next stage', () => {
    const first = new Set<string>(APPROACH_IDS);
    expect(NEXT_STAGE_IDS.filter((id) => first.has(id))).toEqual([]);
  });

  it('offers the four programme lengths the practice offers', () => {
    expect([...SESSION_OPTIONS]).toEqual([15, 20, 30, 40]);
  });
});

describe('the five bands of the report', () => {
  it('runs from delta to high beta, and has no gamma', () => {
    expect([...BAND_IDS]).toEqual(['delta', 'theta', 'alpha', 'beta', 'high_beta']);
  });

  it('gives each band the range the practice reports it in', () => {
    expect(BAND_RANGES).toEqual({
      delta: { from: 1, to: 4 },
      theta: { from: 4, to: 8 },
      alpha: { from: 8, to: 12 },
      beta: { from: 12, to: 25 },
      high_beta: { from: 25, to: 30 },
    });
  });

  it('leaves no gap between one band and the next', () => {
    const ranges = BAND_IDS.map((id) => BAND_RANGES[id]);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]?.from).toBe(ranges[i - 1]?.to);
    }
  });
});

describe('the measures of the change table', () => {
  it('holds the five bands and the five narrower ones inside them', () => {
    expect([...MEASURE_IDS].sort()).toEqual(
      [
        'alpha',
        'alpha_1',
        'alpha_2',
        'beta',
        'beta_1',
        'beta_2',
        'beta_3',
        'delta',
        'high_beta',
        'theta',
      ].sort(),
    );
  });

  it('keeps every narrower measure inside the band it belongs to', () => {
    for (const id of MEASURE_IDS) {
      const measure = MEASURE_RANGES[id];
      expect(measure, id).toBeDefined();
      if (!measure || measure.within === null) continue;
      const parent = BAND_RANGES[measure.within];
      expect(parent, `${id} names a band that exists`).toBeDefined();
      expect(measure.from).toBeGreaterThanOrEqual(parent?.from ?? Infinity);
      expect(measure.to).toBeLessThanOrEqual(parent?.to ?? -Infinity);
    }
  });

  it('splits alpha in two and beta in three, with nothing left over', () => {
    const inside = (band: string) =>
      MEASURE_IDS.map((id) => MEASURE_RANGES[id])
        .filter((m) => m?.within === band)
        .sort((a, b) => (a?.from ?? 0) - (b?.from ?? 0));
    const alpha = inside('alpha');
    const beta = inside('beta');
    expect(alpha.map((m) => [m?.from, m?.to])).toEqual([
      [8, 10],
      [10, 12],
    ]);
    expect(beta.map((m) => [m?.from, m?.to])).toEqual([
      [12, 15],
      [15, 18],
      [18, 25],
    ]);
  });

  it('can calculate only the four measures the app already records', () => {
    // The assessment records delta, theta, alpha, beta and gamma. High beta and
    // the narrower bands have no figure to calculate from, so they are typed.
    expect([...CALCULABLE_MEASURES].sort()).toEqual(['alpha', 'beta', 'delta', 'theta']);
  });
});

describe('tierOf', () => {
  it('reads 0 to 4 as the low tier', () => {
    for (const score of [0, 1, 2, 3, 4]) expect(tierOf(score)).toBe('low');
  });

  it('reads 5 to 7 as the middle tier', () => {
    for (const score of [5, 6, 7]) expect(tierOf(score)).toBe('middle');
  });

  it('reads 8 to 10 as the high tier', () => {
    for (const score of [8, 9, 10]) expect(tierOf(score)).toBe('high');
  });

  it('refuses a score that is not a whole number from 0 to 10', () => {
    for (const score of [-1, 11, 4.5, Number.NaN]) expect(() => tierOf(score)).toThrow(RangeError);
  });
});
