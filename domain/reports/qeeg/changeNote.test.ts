import { describe, expect, it } from 'vitest';
import { blankFollowUp } from './blank';
import { changeNoteKey, figuresOf } from './changeNote';
import type { ChangeFigure, ChangeSection, ComparedWith } from './types';

/** Part 7 of brief C1: the note beneath a follow-up's figures follows from where they came from. */

const EARLIER: ComparedWith = {
  reportId: '00000001-0000-4000-8000-000000000001',
  reference: null,
  recordedOn: '2026-06-01',
  origin: 'imported',
  relation: 'initial',
};

const typed = (low: number): ChangeFigure => ({
  kind: 'percent',
  direction: 'decrease',
  low,
  high: null,
  source: 'typed',
  basis: null,
});

const calculated = (low: number): ChangeFigure => ({
  kind: 'percent',
  direction: 'increase',
  low,
  high: null,
  source: 'calculated',
  basis: {
    earlierAssessmentId: '00000001-0000-4000-8000-000000000002',
    laterAssessmentId: '00000001-0000-4000-8000-000000000003',
    unit: 'uV2',
    sitesPaired: 19,
  },
});

const empty = (): ChangeSection => blankFollowUp(EARLIER, 'follow_up').change;

describe('changeNoteKey', () => {
  it('gives no note when the page holds no figure', () => {
    expect(changeNoteKey(empty())).toBeNull();
    expect(
      changeNoteKey({
        ...empty(),
        sessionsCompleted: { count: 20, source: 'gathered' },
        table: { delta: { position: 0, eyesOpen: null, eyesClosed: null } },
      }),
    ).toBeNull();
  });

  it('gives the typed note when every figure was typed', () => {
    const change: ChangeSection = {
      ...empty(),
      tiles: {
        t: { figure: typed(20), caption: { en: 'Less slow activity', ar: null }, position: 0 },
      },
      table: { alpha_1: { position: 0, eyesOpen: typed(5), eyesClosed: null } },
    };
    expect(changeNoteKey(change)).toBe('note.figures.typed');
  });

  it('gives the calculated note when every figure was calculated', () => {
    const change: ChangeSection = {
      ...empty(),
      table: { delta: { position: 0, eyesOpen: calculated(10), eyesClosed: calculated(12) } },
    };
    expect(changeNoteKey(change)).toBe('note.figures.calculated');
  });

  it('gives the note for both when one of each is on the page', () => {
    const change: ChangeSection = {
      ...empty(),
      table: { theta: { position: 0, eyesOpen: calculated(10), eyesClosed: typed(8) } },
    };
    expect(changeNoteKey(change)).toBe('note.figures.both');
  });

  it('counts a figure of no appreciable change by where it came from', () => {
    const change: ChangeSection = {
      ...empty(),
      table: {
        beta: {
          position: 0,
          eyesOpen: { kind: 'no_appreciable_change', source: 'typed', basis: null },
          eyesClosed: null,
        },
      },
    };
    expect(changeNoteKey(change)).toBe('note.figures.typed');
  });
});

describe('figuresOf', () => {
  it('gives the tiles, then the table rows in position order, eyes open before eyes closed', () => {
    const change: ChangeSection = {
      ...empty(),
      tiles: {
        second: { figure: typed(2), caption: { en: 'B', ar: null }, position: 1 },
        first: { figure: typed(1), caption: { en: 'A', ar: null }, position: 0 },
      },
      table: {
        delta: { position: 1, eyesOpen: typed(5), eyesClosed: typed(6) },
        alpha: { position: 0, eyesOpen: null, eyesClosed: typed(3) },
        beta: { position: 2, eyesOpen: typed(7), eyesClosed: null },
      },
    };
    expect(figuresOf(change).map((figure) => (figure.kind === 'percent' ? figure.low : 0))).toEqual(
      [1, 2, 3, 5, 6, 7],
    );
  });

  it('gives nothing for an empty page', () => {
    expect(figuresOf(empty())).toEqual([]);
  });
});
