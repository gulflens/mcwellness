import { describe, expect, it } from 'vitest';
import { compare } from './compare';
import type { Assessment, BandFigure, DerivedPayload } from './types';

/**
 * Two measurements side by side (docs/SPEC/assessment.md sections 3.3 and 5,
 * rule 3; section 11's "a comparison of mismatched units"). Every branch,
 * including each refusal.
 *
 * Ids are in the reserved synthetic shape (.claude/rules/testing.md).
 */

const CLIENT_A = '00000006-0000-4000-8000-000000000001';
const CLIENT_B = '00000006-0000-4000-8000-000000000002';
const PROVENANCE = { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' };

function map(figures: readonly BandFigure[]): DerivedPayload {
  return { kind: 'brain-map', provenance: PROVENANCE, condition: 'eyes-closed', figures };
}

function form(total: number, maximum = 12): DerivedPayload {
  return {
    kind: 'questionnaire',
    provenance: PROVENANCE,
    answers: [
      { key: 'q1', value: total },
      { key: 'q2', value: 0 },
      { key: 'q3', value: 0 },
    ],
    total,
    maximum,
  };
}

function assessment(overrides: Partial<Assessment> & { id: string }): Assessment {
  return {
    clientId: CLIENT_A,
    instrument: 'qeeg',
    instrumentVersion: '1',
    performedAt: '2026-03-01T06:00:00.000Z',
    derived: map([{ site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' }]),
    version: 1,
    supersedesId: null,
    referenceAgeYears: 9,
    referenceSex: 'female',
    ...overrides,
  };
}

const EARLIER = '0000000f-0000-4000-8000-000000000001';
const LATER = '0000000f-0000-4000-8000-000000000002';

describe('comparing two brain maps', () => {
  it('pairs each figure by site and band and shows the difference', () => {
    const result = compare(
      assessment({
        id: EARLIER,
        derived: map([
          { site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' },
          { site: 'Cz', band: 'theta', value: 8.4, unit: 'uV2' },
        ]),
      }),
      assessment({
        id: LATER,
        performedAt: '2026-05-30T06:00:00.000Z',
        derived: map([
          { site: 'Fz', band: 'alpha', value: 12.5, unit: 'uV2' },
          { site: 'Cz', band: 'theta', value: 8.1, unit: 'uV2' },
        ]),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.figures).toEqual([
      {
        key: 'Fz.alpha',
        site: 'Fz',
        band: 'alpha',
        unit: 'uV2',
        earlier: 10,
        later: 12.5,
        difference: 2.5,
      },
      {
        key: 'Cz.theta',
        site: 'Cz',
        band: 'theta',
        unit: 'uV2',
        earlier: 8.4,
        later: 8.1,
        difference: -0.3,
      },
    ]);
    expect(result.ok && result.value.unpaired).toEqual([]);
    expect(result.ok && result.value.maximum).toBeNull();
  });

  it('rounds a difference so two readers of one pair never see two answers', () => {
    const result = compare(
      assessment({
        id: EARLIER,
        derived: map([{ site: 'Fz', band: 'alpha', value: 0.1, unit: 'uV2' }]),
      }),
      assessment({
        id: LATER,
        derived: map([{ site: 'Fz', band: 'alpha', value: 0.3, unit: 'uV2' }]),
      }),
    );
    expect(result.ok && result.value.figures[0]?.difference).toBe(0.2);
  });

  it('carries the ids, the editions, what produced the figures, and the age and sex each reference was made against', () => {
    // Section 3.3: a comparison made against a nine-year-old is not the
    // comparison made against a ten-year-old, so both sides say which.
    // Section 6 of reports-v1: a report quotes all of this through ids.
    const result = compare(
      assessment({ id: EARLIER, referenceAgeYears: 9 }),
      assessment({
        id: LATER,
        performedAt: '2026-05-30T06:00:00.000Z',
        referenceAgeYears: 10,
        referenceSex: 'female',
      }),
    );
    expect(result.ok && result.value.earlier).toEqual({
      assessmentId: EARLIER,
      performedAt: '2026-03-01T06:00:00.000Z',
      instrumentVersion: '1',
      provenance: PROVENANCE,
      referenceAgeYears: 9,
      referenceSex: 'female',
      condition: 'eyes-closed',
    });
    expect(result.ok && result.value.later.referenceAgeYears).toBe(10);
  });

  it('survives being written down and read back, as a report snapshot must', () => {
    const result = compare(
      assessment({ id: EARLIER }),
      assessment({ id: LATER, performedAt: '2026-05-30T06:00:00.000Z' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
  });

  it('shows a figure only one recording has rather than dropping it', () => {
    const result = compare(
      assessment({
        id: EARLIER,
        derived: map([
          { site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' },
          { site: 'O1', band: 'beta', value: 3, unit: 'uV2' },
        ]),
      }),
      assessment({
        id: LATER,
        performedAt: '2026-05-30T06:00:00.000Z',
        derived: map([
          { site: 'Fz', band: 'alpha', value: 11, unit: 'uV2' },
          { site: 'O2', band: 'beta', value: 4, unit: 'uV2' },
        ]),
      }),
    );
    expect(result.ok && result.value.unpaired).toEqual([
      { key: 'O1.beta', site: 'O1', band: 'beta', presentIn: 'earlier' },
      { key: 'O2.beta', site: 'O2', band: 'beta', presentIn: 'later' },
    ]);
  });

  it('refuses a pair whose units disagree, and names the figure', () => {
    const result = compare(
      assessment({
        id: EARLIER,
        derived: map([{ site: 'Fz', band: 'alpha', value: 10, unit: 'uV2' }]),
      }),
      assessment({
        id: LATER,
        derived: map([{ site: 'Fz', band: 'alpha', value: 22, unit: 'percent' }]),
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'unit_mismatch', key: 'Fz.alpha' });
  });

  it('refuses two people', () => {
    expect(
      compare(assessment({ id: EARLIER }), assessment({ id: LATER, clientId: CLIENT_B })),
    ).toEqual({ ok: false, reason: 'different_clients' });
  });

  it('refuses two instruments', () => {
    expect(
      compare(
        assessment({ id: EARLIER }),
        assessment({ id: LATER, instrument: 'questionnaire.sample', derived: form(3) }),
      ),
    ).toEqual({ ok: false, reason: 'different_instruments' });
  });

  it('refuses one assessment against itself', () => {
    expect(compare(assessment({ id: EARLIER }), assessment({ id: EARLIER }))).toEqual({
      ok: false,
      reason: 'same_assessment',
    });
  });

  it('refuses a pair given the wrong way round', () => {
    expect(
      compare(
        assessment({ id: EARLIER, performedAt: '2026-05-30T06:00:00.000Z' }),
        assessment({ id: LATER, performedAt: '2026-03-01T06:00:00.000Z' }),
      ),
    ).toEqual({ ok: false, reason: 'out_of_order' });
  });

  it('accepts two recordings made on the same day', () => {
    const result = compare(
      assessment({ id: EARLIER }),
      assessment({
        id: LATER,
        derived: map([{ site: 'Fz', band: 'alpha', value: 11, unit: 'uV2' }]),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('comparing two questionnaires', () => {
  it('sets the two totals side by side and says what the most was', () => {
    const result = compare(
      assessment({
        id: EARLIER,
        instrument: 'questionnaire.sample',
        derived: form(3),
        referenceAgeYears: null,
        referenceSex: null,
      }),
      assessment({
        id: LATER,
        instrument: 'questionnaire.sample',
        performedAt: '2026-05-30T06:00:00.000Z',
        derived: form(1),
        referenceAgeYears: null,
        referenceSex: null,
      }),
    );
    expect(result.ok && result.value.kind).toBe('questionnaire');
    expect(result.ok && result.value.figures).toEqual([
      {
        key: 'total',
        site: null,
        band: null,
        unit: 'points',
        earlier: 3,
        later: 1,
        difference: -2,
      },
    ]);
    expect(result.ok && result.value.maximum).toBe(12);
    expect(result.ok && result.value.earlier.condition).toBeNull();
  });

  it('refuses two totals scored out of different maximums', () => {
    expect(
      compare(
        assessment({ id: EARLIER, instrument: 'questionnaire.sample', derived: form(3) }),
        assessment({
          id: LATER,
          instrument: 'questionnaire.sample',
          performedAt: '2026-05-30T06:00:00.000Z',
          derived: form(3, 15),
        }),
      ),
    ).toEqual({ ok: false, reason: 'maximum_mismatch', key: 'maximum' });
  });

  it('refuses a questionnaire against a brain map recorded under the same instrument name', () => {
    // The instruments agree and the payloads do not: a row whose derived
    // payload does not match its own instrument cannot be compared with one
    // that does.
    expect(
      compare(
        assessment({ id: EARLIER, instrument: 'questionnaire.sample', derived: form(3) }),
        assessment({
          id: LATER,
          instrument: 'questionnaire.sample',
          performedAt: '2026-05-30T06:00:00.000Z',
        }),
      ),
    ).toEqual({ ok: false, reason: 'different_instruments' });
  });
});
