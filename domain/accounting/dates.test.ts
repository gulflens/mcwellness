import { describe, expect, it } from 'vitest';
import { addDays, isWithin, isoDateOf, yearBoundsContaining, yearOf } from './dates';

describe('addDays', () => {
  it('crosses a month and a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('yearBoundsContaining', () => {
  it('gives the calendar year for a 31 December year end', () => {
    expect(yearBoundsContaining('2026-09-07', 12, 31)).toEqual({
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    expect(yearBoundsContaining('2026-12-31', 12, 31).endsOn).toBe('2026-12-31');
    expect(yearBoundsContaining('2027-01-01', 12, 31).startsOn).toBe('2027-01-01');
  });
  it('gives a year that straddles two calendar years for a 30 June year end', () => {
    expect(yearBoundsContaining('2026-09-07', 6, 30)).toEqual({
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
    });
    expect(yearBoundsContaining('2026-06-30', 6, 30)).toEqual({
      startsOn: '2025-07-01',
      endsOn: '2026-06-30',
    });
  });
});

describe('isWithin', () => {
  it('is inclusive at both ends', () => {
    expect(isWithin('2026-01-01', '2026-01-01', '2026-12-31')).toBe(true);
    expect(isWithin('2026-12-31', '2026-01-01', '2026-12-31')).toBe(true);
    expect(isWithin('2027-01-01', '2026-01-01', '2026-12-31')).toBe(false);
  });
});

describe('isoDateOf and yearOf', () => {
  it('pad and read back', () => {
    expect(isoDateOf(2026, 2, 3)).toBe('2026-02-03');
    expect(yearOf('2026-02-03')).toBe(2026);
  });
});
