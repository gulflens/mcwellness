import { describe, expect, it } from 'vitest';
import {
  countCompletedSessions,
  countedFigure,
  sessionWindow,
  sessionsCompletedOnSave,
  type VisitForCount,
} from './sessionsCompleted';
import { LIMITS } from './types';

const CLIENT = '0000000c-0000-4000-8000-000000000100';
const OTHER = '0000000c-0000-4000-8000-000000000200';

function visit(day: string, over: Partial<VisitForCount> = {}): VisitForCount {
  return { clientId: CLIENT, status: 'completed', closed: true, day, ...over };
}

describe('sessionWindow', () => {
  it('runs from the day after the earlier recording to the day before the new one', () => {
    expect(sessionWindow('2026-02-10', '2026-09-28', '2026-09-30')).toEqual({
      after: '2026-02-10',
      before: '2026-09-28',
      through: null,
    });
  });

  it('runs to today, taken in, while the new recording has no day', () => {
    expect(sessionWindow('2026-02-10', null, '2026-09-30')).toEqual({
      after: '2026-02-10',
      before: null,
      through: '2026-09-30',
    });
  });

  it('takes a day that is no day as none', () => {
    expect(sessionWindow('2026-02-10', '2026-02-30', '2026-09-30')).toEqual({
      after: '2026-02-10',
      before: null,
      through: '2026-09-30',
    });
  });
});

describe('countCompletedSessions', () => {
  const window = sessionWindow('2026-02-10', '2026-09-28', '2026-09-30');

  it('counts the completed, closed visits strictly between the two recording days', () => {
    const visits = [
      visit('2026-02-10'),
      visit('2026-02-11'),
      visit('2026-05-01'),
      visit('2026-09-27'),
      visit('2026-09-28'),
    ];
    expect(countCompletedSessions(visits, CLIENT, window)).toBe(3);
  });

  it('never counts a voided visit, one not completed, or one left open', () => {
    const visits = [
      visit('2026-03-01', { status: 'voided' }),
      visit('2026-03-02', { status: 'no_show' }),
      visit('2026-03-03', { status: 'cancelled_late' }),
      visit('2026-03-04', { status: 'aborted' }),
      visit('2026-03-05', { status: 'in_progress', closed: false }),
      visit('2026-03-06', { status: 'completed', closed: false }),
      visit('2026-03-07'),
    ];
    expect(countCompletedSessions(visits, CLIENT, window)).toBe(1);
  });

  it('never counts another client’s visit', () => {
    const visits = [visit('2026-03-01', { clientId: OTHER }), visit('2026-03-02')];
    expect(countCompletedSessions(visits, CLIENT, window)).toBe(1);
  });

  it('counts through today, today included, when the new recording has no day', () => {
    const open = sessionWindow('2026-02-10', null, '2026-09-30');
    const visits = [visit('2026-09-30'), visit('2026-10-01'), visit('2026-02-10')];
    expect(countCompletedSessions(visits, CLIENT, open)).toBe(1);
  });

  it('counts nothing when the two recordings are on one day', () => {
    const same = sessionWindow('2026-05-01', '2026-05-01', '2026-09-30');
    expect(countCompletedSessions([visit('2026-05-01')], CLIENT, same)).toBe(0);
  });

  it('leaves out a visit whose day is not a day', () => {
    expect(countCompletedSessions([visit('someday'), visit('2026-03-01')], CLIENT, window)).toBe(1);
  });

  it('changes nothing it is given', () => {
    const visits = Object.freeze([Object.freeze(visit('2026-03-01'))]);
    expect(countCompletedSessions(visits, CLIENT, Object.freeze(window))).toBe(1);
  });
});

describe('countedFigure', () => {
  it('is the count, said to be counted from the visits', () => {
    expect(countedFigure(12)).toEqual({ count: 12, source: 'gathered' });
  });

  it('is none when nothing was counted, or more than a figure may hold', () => {
    expect(countedFigure(0)).toBeNull();
    expect(countedFigure(LIMITS.sessionsMost + 1)).toBeNull();
    expect(countedFigure(null)).toBeNull();
  });
});

describe('sessionsCompletedOnSave', () => {
  it('works out a figure said to be counted afresh, whatever count it carried', () => {
    expect(sessionsCompletedOnSave({ count: 99, source: 'gathered' }, 7)).toEqual({
      count: 7,
      source: 'gathered',
    });
    expect(sessionsCompletedOnSave({ count: 99, source: 'gathered' }, 0)).toBeNull();
  });

  it('keeps a typed figure as she typed it', () => {
    expect(sessionsCompletedOnSave({ count: 30, source: 'typed' }, 7)).toEqual({
      count: 30,
      source: 'typed',
    });
  });

  it('keeps no figure as none: a headline left off is not put back', () => {
    expect(sessionsCompletedOnSave(null, 7)).toBeNull();
  });

  it('leaves anything else as it came, for the shape to refuse by name', () => {
    expect(sessionsCompletedOnSave({ count: 3, source: 'guessed' }, 7)).toEqual({
      count: 3,
      source: 'guessed',
    });
    expect(sessionsCompletedOnSave('x', 7)).toBe('x');
    expect(sessionsCompletedOnSave(undefined, 7)).toBeUndefined();
  });

  it('never takes a count said to be counted from the request', () => {
    const sent = { count: 5, source: 'gathered', extra: true };
    expect(sessionsCompletedOnSave(sent, 2)).toEqual({ count: 2, source: 'gathered' });
  });
});
