import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { figuresNamedIn } from './figuresNamed';
import type { ComparedWith, FigureRef, QeegFollowUp, QeegInitial } from './types';

const A: FigureRef = {
  figureId: '0000000d-0000-4000-8000-000000000001',
  sha256: 'a'.repeat(64),
  widthPx: 800,
  heightPx: 600,
};
const B: FigureRef = { ...A, figureId: '0000000d-0000-4000-8000-000000000002' };
const C: FigureRef = { ...A, figureId: '0000000d-0000-4000-8000-000000000003' };

const compared: ComparedWith = {
  reportId: '0000000d-0000-4000-8000-0000000000aa',
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

describe('figuresNamedIn', () => {
  it('names nothing in a blank report of either edition', () => {
    expect(figuresNamedIn(blankInitial())).toEqual([]);
    expect(figuresNamedIn(blankFollowUp(compared, 'follow_up'))).toEqual([]);
  });

  it('names each map by the path of its entry, in the order of their keys', () => {
    const content: QeegInitial = {
      ...blankInitial(),
      maps: {
        'map-b': { ...B, condition: 'eyes_open', caption: null, position: 1 },
        'map-a': { ...A, condition: null, caption: null, position: 0 },
      },
    };
    expect(figuresNamedIn(content)).toEqual([
      { path: 'maps.map-a', ref: A, borrowed: false },
      { path: 'maps.map-b', ref: B, borrowed: false },
    ]);
  });

  it('names a follow-up’s pairs, the earlier pictures as borrowed', () => {
    const blank = blankFollowUp(compared, 'follow_up');
    const content: QeegFollowUp = {
      ...blank,
      change: {
        ...blank.change,
        pairs: {
          eyes_open: { earlier: A, later: B },
          eyes_closed: { earlier: null, later: C },
        },
      },
    };
    expect(figuresNamedIn(content)).toEqual([
      { path: 'change.pairs.eyes_closed.later', ref: C, borrowed: false },
      { path: 'change.pairs.eyes_open.earlier', ref: A, borrowed: true },
      { path: 'change.pairs.eyes_open.later', ref: B, borrowed: false },
    ]);
  });

  it('keeps only the fields of a reference, and returns new values', () => {
    const content: QeegInitial = {
      ...blankInitial(),
      maps: { 'map-a': { ...A, condition: 'eyes_closed', caption: null, position: 0 } },
    };
    const [named] = figuresNamedIn(content);
    expect(named?.ref).toEqual(A);
    expect(named?.ref).not.toBe(content.maps['map-a']);
  });
});
