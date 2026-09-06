import { describe, expect, it } from 'vitest';
import {
  compareBrainMaps,
  dominantBand,
  gatherProgress,
  ribbonFor,
  type AssessmentRow,
  type VisitRow,
} from './gatherProgress';

/**
 * Rule 3 (docs/SPEC/reports-v1.md section 8): the arithmetic a progress report
 * quotes, and the ribbon's slices among it. Tested here, in the domain; the
 * absent-table case is proved through the route (tests/reports/db).
 */

const A = '00000000-0000-4000-8000-00000000c001';
const B = '00000000-0000-4000-8000-00000000c002';
const C = '00000000-0000-4000-8000-00000000c003';
const MAP_ONE = '00000000-0000-4000-8000-0000000005a1';
const MAP_TWO = '00000000-0000-4000-8000-0000000005a2';
const MAP_THREE = '00000000-0000-4000-8000-0000000005a3';

function visit(over: Partial<VisitRow> & { id: string; on: string }): VisitRow {
  return { signalQuality: 0.8, bands: {}, ...over };
}

function map(over: Partial<AssessmentRow> & { id: string; performedOn: string }): AssessmentRow {
  return {
    instrument: 'qeeg',
    figures: [],
    referenceAgeYears: null,
    referenceSex: null,
    ...over,
  };
}

describe('dominantBand', () => {
  it('answers the largest band', () => {
    expect(dominantBand({ delta: 3, theta: 9, alpha: 4 })).toBe('theta');
  });

  it('answers nothing where the visit recorded no band at all', () => {
    expect(dominantBand({})).toBeNull();
  });

  it('breaks a tie towards the slower band, so two renders colour alike', () => {
    expect(dominantBand({ theta: 5, beta: 5 })).toBe('theta');
  });

  it('ignores a figure that is not a number', () => {
    expect(dominantBand({ alpha: Number.NaN, beta: 2 })).toBe('beta');
  });
});

describe('ribbonFor', () => {
  it('draws one slice per visit, in the order they were delivered', () => {
    const ribbon = ribbonFor(
      [
        visit({ id: B, on: '2026-08-02', signalQuality: 0.6, bands: { beta: 4 } }),
        visit({ id: A, on: '2026-08-01', signalQuality: 0.9, bands: { alpha: 7 } }),
      ],
      [],
      2,
    );
    expect(ribbon.slices.map((slice) => slice.index)).toEqual([1, 2]);
    expect(ribbon.slices[0]).toEqual({ index: 1, quality: 0.9, band: 'alpha', mapMark: false });
    expect(ribbon.slices[1]).toEqual({ index: 2, quality: 0.6, band: 'beta', mapMark: false });
    expect(ribbon.remaining).toBe(2);
  });

  it('orders two visits on the same day by their id, so the figure is stable', () => {
    const ribbon = ribbonFor(
      [visit({ id: C, on: '2026-08-01' }), visit({ id: A, on: '2026-08-01' })],
      [],
      0,
    );
    expect(ribbon.slices).toHaveLength(2);
  });

  it('keeps a visit with no quality score as a slice rather than a gap', () => {
    const ribbon = ribbonFor([visit({ id: A, on: '2026-08-01', signalQuality: null })], [], 0);
    expect(ribbon.slices[0]?.quality).toBeNull();
  });

  it('marks the first visit at or after a brain map, and only that one', () => {
    const ribbon = ribbonFor(
      [
        visit({ id: A, on: '2026-08-01' }),
        visit({ id: B, on: '2026-08-08' }),
        visit({ id: C, on: '2026-08-15' }),
      ],
      [map({ id: MAP_ONE, performedOn: '2026-08-05' })],
      0,
    );
    expect(ribbon.slices.map((slice) => slice.mapMark)).toEqual([false, true, false]);
  });

  it('marks the first visit where the map was taken on or before it', () => {
    const ribbon = ribbonFor(
      [visit({ id: A, on: '2026-08-01' }), visit({ id: B, on: '2026-08-08' })],
      [map({ id: MAP_ONE, performedOn: '2026-08-01' })],
      0,
    );
    expect(ribbon.slices.map((slice) => slice.mapMark)).toEqual([true, false]);
  });

  it('marks nothing for a map taken after the last visit', () => {
    const ribbon = ribbonFor(
      [visit({ id: A, on: '2026-08-01' })],
      [map({ id: MAP_ONE, performedOn: '2026-09-01' })],
      0,
    );
    expect(ribbon.slices[0]?.mapMark).toBe(false);
  });

  it('never counts a negative number of sessions still to come', () => {
    expect(ribbonFor([], [], -3).remaining).toBe(0);
  });

  it('is empty where nothing has been delivered and nothing is bought', () => {
    expect(ribbonFor([], [], 0)).toEqual({ slices: [], remaining: 0 });
  });
});

describe('compareBrainMaps', () => {
  const earlier = map({
    id: MAP_ONE,
    performedOn: '2026-06-02',
    figures: [
      { label: 'Frontal ratio', labelAr: 'النسبة الأمامية', unit: 'ratio', value: 2.4 },
      { label: 'Peak frequency', labelAr: null, unit: 'Hz', value: 9.1 },
    ],
    referenceAgeYears: 9,
    referenceSex: 'female',
  });
  const later = map({
    id: MAP_TWO,
    performedOn: '2026-08-30',
    figures: [
      { label: 'Frontal ratio', labelAr: 'النسبة الأمامية', unit: 'ratio', value: 2.1 },
      { label: 'Peak frequency', labelAr: null, unit: 'Hz', value: 9.8 },
    ],
    referenceAgeYears: 10,
    referenceSex: 'female',
  });

  it('pairs the figures and gives their difference, later minus earlier', () => {
    const comparison = compareBrainMaps([later, earlier]);
    expect(comparison?.earlierAssessmentId).toBe(MAP_ONE);
    expect(comparison?.laterAssessmentId).toBe(MAP_TWO);
    expect(comparison?.lines).toEqual([
      {
        label: 'Frontal ratio',
        labelAr: 'النسبة الأمامية',
        unit: 'ratio',
        earlier: 2.4,
        later: 2.1,
        difference: -0.3,
      },
      {
        label: 'Peak frequency',
        labelAr: null,
        unit: 'Hz',
        earlier: 9.1,
        later: 9.8,
        difference: 0.7,
      },
    ]);
  });

  it('rounds a difference so a household never reads a floating-point tail', () => {
    const comparison = compareBrainMaps([
      map({
        id: MAP_ONE,
        performedOn: '2026-06-02',
        figures: [{ label: 'x', labelAr: null, unit: 'u', value: 0.1 }],
      }),
      map({
        id: MAP_TWO,
        performedOn: '2026-08-30',
        figures: [{ label: 'x', labelAr: null, unit: 'u', value: 0.4 }],
      }),
    ]);
    expect(comparison?.lines[0]?.difference).toBe(0.3);
  });

  it('takes the two ends of the stretch where there are three maps', () => {
    const middle = map({
      id: MAP_THREE,
      performedOn: '2026-07-15',
      figures: [{ label: 'Frontal ratio', labelAr: null, unit: 'ratio', value: 2.3 }],
    });
    const comparison = compareBrainMaps([earlier, middle, later]);
    expect(comparison?.earlierAssessmentId).toBe(MAP_ONE);
    expect(comparison?.laterAssessmentId).toBe(MAP_TWO);
  });

  it('carries the age and sex the later comparison was made against', () => {
    const comparison = compareBrainMaps([earlier, later]);
    expect(comparison?.referenceAgeYears).toBe(10);
    expect(comparison?.referenceSex).toBe('female');
  });

  it('answers nothing where there are fewer than two maps', () => {
    expect(compareBrainMaps([])).toBeNull();
    expect(compareBrainMaps([earlier])).toBeNull();
  });

  it('refuses two measurements of different instruments', () => {
    expect(compareBrainMaps([earlier, map({ ...later, instrument: 'vendor-two' })])).toBeNull();
  });

  it('leaves out a figure whose units disagree, and one only half the pair carries', () => {
    const odd = map({
      id: MAP_TWO,
      performedOn: '2026-08-30',
      figures: [
        { label: 'Frontal ratio', labelAr: null, unit: 'percent', value: 2.1 },
        { label: 'Peak frequency', labelAr: null, unit: 'Hz', value: 9.8 },
        { label: 'Something new', labelAr: null, unit: 'Hz', value: 1 },
      ],
    });
    const comparison = compareBrainMaps([earlier, odd]);
    expect(comparison?.lines.map((line) => line.label)).toEqual(['Peak frequency']);
  });

  it('answers nothing where no figure survives the pairing', () => {
    const nothingInCommon = map({
      id: MAP_TWO,
      performedOn: '2026-08-30',
      figures: [{ label: 'Something else', labelAr: null, unit: 'Hz', value: 1 }],
    });
    expect(compareBrainMaps([earlier, nothingInCommon])).toBeNull();
  });
});

describe('gatherProgress', () => {
  const coverage = { from: '2026-06-01', to: '2026-09-01' };

  it('counts the visits inside the coverage and the credits the programme bought', () => {
    const content = gatherProgress({
      visits: [
        visit({ id: A, on: '2026-05-30' }),
        visit({ id: B, on: '2026-06-15' }),
        visit({ id: C, on: '2026-09-02' }),
      ],
      entitlements: [
        { id: '1', status: 'consumed' },
        { id: '2', status: 'available' },
        { id: '3', status: 'available' },
      ],
      goals: [],
      assessments: [],
      coverage,
    });
    expect(content.sessionsDelivered).toBe(1);
    expect(content.sessionsEntitled).toBe(3);
    expect(content.ribbon.slices).toHaveLength(1);
    expect(content.ribbon.remaining).toBe(2);
  });

  it('says nothing about brain maps where there are none', () => {
    const content = gatherProgress({
      visits: [visit({ id: A, on: '2026-06-15' })],
      entitlements: [],
      goals: [],
      assessments: [],
      coverage,
    });
    expect(content.comparison).toBeNull();
  });

  it('leaves a brain map outside the coverage out of the comparison and the marks', () => {
    const content = gatherProgress({
      visits: [visit({ id: A, on: '2026-06-15' })],
      entitlements: [],
      goals: [],
      assessments: [
        map({
          id: MAP_ONE,
          performedOn: '2026-05-01',
          figures: [{ label: 'x', labelAr: null, unit: 'u', value: 1 }],
        }),
        map({
          id: MAP_TWO,
          performedOn: '2026-06-10',
          figures: [{ label: 'x', labelAr: null, unit: 'u', value: 2 }],
        }),
      ],
      coverage,
    });
    expect(content.comparison).toBeNull();
    expect(content.ribbon.slices[0]?.mapMark).toBe(true);
  });

  it('carries the narrative through untouched and leaves a goal without one empty', () => {
    const content = gatherProgress({
      visits: [],
      entitlements: [],
      goals: [
        { id: 'g1', description: 'Sleep through the night', status: 'active' },
        { id: 'g2', description: 'Settle at homework', status: 'active' },
      ],
      assessments: [],
      coverage,
      narrative: {
        summary: 'Sleeping longer.',
        suggestion: 'Three more sessions.',
        movementByGoal: { g1: 'Two hours longer.' },
      },
    });
    expect(content.summary).toBe('Sleeping longer.');
    expect(content.suggestion).toBe('Three more sessions.');
    // Paired by id, and the id travels with the line: a goal added between the
    // gathering and the save must not push a sentence about sleep onto a goal
    // about homework (reports-01.md, the reversal of default 6).
    expect(content.goals).toEqual([
      {
        id: 'g1',
        description: 'Sleep through the night',
        status: 'active',
        movement: 'Two hours longer.',
      },
      { id: 'g2', description: 'Settle at homework', status: 'active', movement: '' },
    ]);
  });

  it('leaves the narrative empty where the practitioner has written nothing yet', () => {
    const content = gatherProgress({
      visits: [],
      entitlements: [],
      goals: [],
      assessments: [],
      coverage,
    });
    expect(content.summary).toBe('');
    expect(content.suggestion).toBe('');
  });

  it('shows no empty slices where a programme has been delivered past its entitlement', () => {
    const content = gatherProgress({
      visits: [visit({ id: A, on: '2026-06-15' }), visit({ id: B, on: '2026-06-22' })],
      entitlements: [{ id: '1', status: 'consumed' }],
      goals: [],
      assessments: [],
      coverage,
    });
    expect(content.sessionsDelivered).toBe(2);
    expect(content.sessionsEntitled).toBe(1);
    expect(content.ribbon.remaining).toBe(0);
  });

  it('answers a body the shape accepts, so the draft can be saved as it is', () => {
    const content = gatherProgress({
      visits: [visit({ id: A, on: '2026-06-15', bands: { alpha: 4 } })],
      entitlements: [{ id: '1', status: 'available' }],
      goals: [{ id: 'g1', description: 'Sleep', status: 'active' }],
      assessments: [],
      coverage,
    });
    expect(content.kind).toBe('progress');
    expect(content.coverageFrom).toBe('2026-06-01');
    expect(content.coverageTo).toBe('2026-09-01');
  });
});
