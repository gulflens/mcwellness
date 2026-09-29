import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { QEEG_ONLY } from './catalogue/ids';
import { chooseSessions, figureText, isSessionCount, typedFigure } from './choices';
import { validateQeegContent } from './shape';
import { LIMITS, type ComparedWith } from './types';

const COMPARED: ComparedWith = {
  reportId: '00000006-0000-4000-8000-000000000001',
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

describe('a figure she estimates', () => {
  it('is a typed percentage, alone or as a range', () => {
    expect(typedFigure('increase', 25, null)).toEqual({
      kind: 'percent',
      direction: 'increase',
      low: 25,
      high: null,
      source: 'typed',
      basis: null,
    });
    expect(typedFigure('decrease', 25, 30)).toMatchObject({ high: 30 });
  });

  it('is no appreciable change, with no number', () => {
    expect(typedFigure('none', null, null)).toEqual({
      kind: 'no_appreciable_change',
      source: 'typed',
      basis: null,
    });
  });

  it('is none while a number is missing or outside what the shape takes', () => {
    expect(typedFigure('increase', null, null)).toBeNull();
    expect(typedFigure('increase', 0, null)).toBeNull();
    expect(typedFigure('increase', LIMITS.percentMost + 1, null)).toBeNull();
    expect(typedFigure('increase', 2.5, null)).toBeNull();
  });

  it('is none when the top of a range is not above its bottom', () => {
    expect(typedFigure('increase', 30, 30)).toBeNull();
    expect(typedFigure('increase', 30, 25)).toBeNull();
    expect(typedFigure('increase', 30, LIMITS.percentMost + 1)).toBeNull();
  });
});

describe('a typed number of sessions', () => {
  it('is a whole number the shape takes', () => {
    expect(isSessionCount(1)).toBe(true);
    expect(isSessionCount(LIMITS.sessionsMost)).toBe(true);
    expect(isSessionCount(0)).toBe(false);
    expect(isSessionCount(LIMITS.sessionsMost + 1)).toBe(false);
    expect(isSessionCount(1.5)).toBe(false);
  });
});

describe('choosing the number of sessions', () => {
  it('clears the approach when a first report is a brain map alone, and the result validates', () => {
    const chosen = { ...blankInitial(), plan: { sessions: 20, approach: 'calming' as const } };
    const next = chooseSessions(chosen, QEEG_ONLY);
    expect(next.plan).toEqual({ sessions: QEEG_ONLY, approach: null });
    expect(validateQeegContent(next).ok).toBe(true);
    expect(chosen.plan.approach).toBe('calming');
  });

  it('keeps the approach for a number', () => {
    const chosen = { ...blankInitial(), plan: { sessions: 20, approach: 'calming' as const } };
    expect(chooseSessions(chosen, 30).plan).toEqual({ sessions: 30, approach: 'calming' });
  });

  it('sets a follow-up’s number and never the brain-map-only choice', () => {
    const follow = { ...blankFollowUp(COMPARED, 'follow_up'), plan: { sessions: 20, next: null } };
    expect(chooseSessions(follow, 15).plan).toEqual({ sessions: 15, next: null });
    expect(chooseSessions(follow, QEEG_ONLY)).toBe(follow);
  });
});

describe('a figure in words', () => {
  it('reads from the wording', () => {
    expect(figureText(typedFigure('increase', 25, null)!, 'en')).toBe('about 25% higher');
    expect(figureText(typedFigure('decrease', 25, 30)!, 'en')).toBe('about 25–30% lower');
    expect(figureText(typedFigure('none', null, null)!, 'en')).toBe('No appreciable change');
  });
});
