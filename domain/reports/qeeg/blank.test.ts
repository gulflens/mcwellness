import { describe, expect, it } from 'vitest';
import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from './catalogue/ids';
import { blankFollowUp, blankInitial, EMPTY_RICH, NOTHING_PICKED } from './blank';
import { validateQeegContent } from './shape';
import type { ComparedWith } from './types';

/** Part 1 of brief C1: a report nobody has filled in yet. */

const EARLIER: ComparedWith = {
  reportId: '0000000A-0000-4000-8000-000000000001',
  reference: 'RPT-000001',
  recordedOn: '2026-06-01',
  origin: 'issued',
  relation: 'initial',
};

/** Every object and array reachable from a value, so sharing can be looked for. */
function objectsIn(value: unknown, found: Set<object> = new Set()): Set<object> {
  if (value !== null && typeof value === 'object') {
    found.add(value);
    for (const inner of Object.values(value)) objectsIn(inner, found);
  }
  return found;
}

describe('blankInitial', () => {
  it('has every band, measure and dimension, with no choice made', () => {
    const blank = blankInitial();
    expect(Object.keys(blank.bands)).toEqual([...BAND_IDS]);
    expect(Object.keys(blank.connectivity)).toEqual([...CONNECTIVITY_IDS]);
    expect(Object.keys(blank.dashboard)).toEqual([...DIMENSION_IDS]);
    for (const band of BAND_IDS) expect(blank.bands[band]).toEqual({ level: null, regions: [] });
    for (const measure of CONNECTIVITY_IDS) {
      expect(blank.connectivity[measure]).toEqual({ level: null, regions: [] });
    }
    for (const picked of [blank.findings, blank.focus, blank.recommendations, blank.benefits]) {
      expect(picked).toEqual({ chosen: [], custom: {} });
    }
    expect(blank.maps).toEqual({});
    expect(blank.plan).toEqual({ sessions: null, approach: null });
    expect(blank.recording).toEqual({ recordedOn: null, eyes: null, handedness: null });
    expect(blank.subject).toEqual({ nameAr: null, ageYears: null, sex: null });
    expect(blank.summary).toEqual({ en: { text: '', marks: [] }, ar: null });
  });

  it('is a first report written in this app against the first schema and wording', () => {
    const blank = blankInitial();
    expect(blank.kind).toBe('qeeg');
    expect(blank.edition).toBe('initial');
    expect(blank.stage).toBe('initial');
    expect(blank.schema).toBe(1);
    expect(blank.wording).toBe(1);
    expect(blank.provenance).toEqual({ origin: 'app' });
  });

  it('sets no score, not even a middling one', () => {
    for (const dimension of DIMENSION_IDS) {
      expect(blankInitial().dashboard[dimension]).toEqual({ score: null, evidence: null });
    }
  });
});

describe('blankFollowUp', () => {
  it('carries what it is compared with, and the stage it was given', () => {
    const blank = blankFollowUp(EARLIER, 'final');
    expect(blank.edition).toBe('follow-up');
    expect(blank.stage).toBe('final');
    expect(blank.comparedWith).toEqual(EARLIER);
    expect(blank.comparedWith).not.toBe(EARLIER);
  });

  it('has every band, measure and dimension, with no change chosen and no score set', () => {
    const blank = blankFollowUp(EARLIER, 'follow_up');
    for (const band of BAND_IDS) expect(blank.bands[band]).toEqual({ change: null, regions: [] });
    for (const measure of CONNECTIVITY_IDS) {
      expect(blank.connectivity[measure]).toEqual({ change: null, regions: [] });
    }
    for (const dimension of DIMENSION_IDS) {
      expect(blank.dashboard[dimension]).toEqual({
        score: null,
        evidence: null,
        earlierScore: null,
      });
    }
    expect(blank.plan).toEqual({ sessions: null, next: null });
  });

  it('has an empty page of what has changed', () => {
    expect(blankFollowUp(EARLIER, 'follow_up').change).toEqual({
      tiles: {},
      sessionsCompleted: null,
      pairs: {
        eyes_open: { earlier: null, later: null },
        eyes_closed: { earlier: null, later: null },
      },
      table: {},
      summary: { en: { text: '', marks: [] }, ar: null },
    });
  });
});

describe('two blanks', () => {
  it('share no object, so changing one cannot change the other', () => {
    const pairs: Array<[unknown, unknown]> = [
      [blankInitial(), blankInitial()],
      [blankFollowUp(EARLIER, 'follow_up'), blankFollowUp(EARLIER, 'follow_up')],
    ];
    for (const [one, other] of pairs) {
      const inOne = objectsIn(one);
      for (const object of objectsIn(other)) expect(inOne.has(object)).toBe(false);
    }
  });

  it('share nothing with the constants either', () => {
    const inBlank = objectsIn(blankInitial());
    expect(inBlank.has(EMPTY_RICH)).toBe(false);
    expect(inBlank.has(NOTHING_PICKED)).toBe(false);
  });
});

describe('a blank', () => {
  it('passes the shape, in either edition and at either later stage', () => {
    expect(validateQeegContent(blankInitial()).ok).toBe(true);
    expect(validateQeegContent(blankFollowUp(EARLIER, 'follow_up')).ok).toBe(true);
    expect(validateQeegContent(blankFollowUp(EARLIER, 'final')).ok).toBe(true);
  });
});

describe('the constants', () => {
  it('are empty and cannot be changed', () => {
    expect(EMPTY_RICH).toEqual({ text: '', marks: [] });
    expect(NOTHING_PICKED).toEqual({ chosen: [], custom: {} });
    expect(Object.isFrozen(EMPTY_RICH)).toBe(true);
    expect(Object.isFrozen(EMPTY_RICH.marks)).toBe(true);
    expect(Object.isFrozen(NOTHING_PICKED)).toBe(true);
    expect(Object.isFrozen(NOTHING_PICKED.chosen)).toBe(true);
    expect(Object.isFrozen(NOTHING_PICKED.custom)).toBe(true);
  });
});
