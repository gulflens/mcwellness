import { describe, expect, it } from 'vitest';
import type { FiscalYear } from './types';
import {
  landingDayFor,
  lockMove,
  mayChangeYearEnd,
  mayCloseYear,
  mayLockThrough,
  mayPostOn,
  yearContaining,
} from './years';

const Y2025: FiscalYear = {
  id: '0000000e-0000-4000-8000-000000002025',
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  status: 'closed',
};
const Y2026: FiscalYear = {
  id: '0000000e-0000-4000-8000-000000002026',
  startsOn: '2026-01-01',
  endsOn: '2026-12-31',
  status: 'open',
};
const YEARS = [Y2025, Y2026];

describe('mayPostOn (rule 3)', () => {
  it('refuses a day in a closed year', () => {
    expect(mayPostOn('2025-06-01', YEARS, null)).toBe(false);
  });
  it('refuses a day on or before the lock date, even in an open year', () => {
    expect(mayPostOn('2026-03-31', YEARS, '2026-03-31')).toBe(false);
    expect(mayPostOn('2026-04-01', YEARS, '2026-03-31')).toBe(true);
  });
  it('accepts a day in an open year, and a day no year row exists for yet', () => {
    expect(mayPostOn('2026-09-07', YEARS, null)).toBe(true);
    expect(mayPostOn('2027-02-01', YEARS, null)).toBe(true);
  });
});

describe('landingDayFor (rule 4)', () => {
  it('leaves an open, unlocked day alone', () => {
    expect(landingDayFor('2026-09-07', YEARS, null)).toBe('2026-09-07');
  });
  it('moves a closed-year day to the first day of the next open year', () => {
    expect(landingDayFor('2025-06-01', YEARS, null)).toBe('2026-01-01');
  });
  it('moves a locked day to the day after the lock', () => {
    expect(landingDayFor('2026-02-10', YEARS, '2026-03-31')).toBe('2026-04-01');
  });
  it('applies both when the day after the lock is still in a closed year', () => {
    const closed2026 = { ...Y2026, status: 'closed' as const };
    expect(landingDayFor('2025-06-01', [Y2025, closed2026], '2026-03-31')).toBe('2027-01-01');
  });
});

describe('mayCloseYear (rule 11)', () => {
  it('closes an open year whose last day has passed and nothing is unposted', () => {
    expect(mayCloseYear(Y2026, '2027-01-01', 0)).toBe(true);
    expect(mayCloseYear(Y2026, '2026-12-31', 0)).toBe(true);
  });
  it('refuses a year still running, an unposted event, or a closed year', () => {
    expect(mayCloseYear(Y2026, '2026-12-30', 0)).toBe(false);
    expect(mayCloseYear(Y2026, '2027-01-01', 1)).toBe(false);
    expect(mayCloseYear(Y2025, '2027-01-01', 0)).toBe(false);
  });
});

describe('mayChangeYearEnd (rule 10)', () => {
  it('only while the journal is empty', () => {
    expect(mayChangeYearEnd(0)).toBe(true);
    expect(mayChangeYearEnd(1)).toBe(false);
  });
});

describe('the lock date (rule 14)', () => {
  it('is never in the future', () => {
    expect(mayLockThrough('2026-09-07', '2026-09-07')).toBe(true);
    expect(mayLockThrough('2026-09-08', '2026-09-07')).toBe(false);
  });
  it('names the direction of a move', () => {
    expect(lockMove(null, '2026-03-31')).toBe('forward');
    expect(lockMove('2026-03-31', '2026-06-30')).toBe('forward');
    expect(lockMove('2026-06-30', '2026-03-31')).toBe('backward');
    expect(lockMove('2026-06-30', '2026-06-30')).toBe('unchanged');
  });
});

describe('yearContaining', () => {
  it('finds the row or nothing', () => {
    expect(yearContaining('2026-05-05', YEARS)).toBe(Y2026);
    expect(yearContaining('2028-05-05', YEARS)).toBeUndefined();
  });
});
