import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_MONTHS,
  daysBetween,
  expiryOn,
  expiryWarningFor,
  isUsableOn,
} from './expiry';
import type { ExpiryTerm } from './expiry';

/**
 * The specification for package expiry (docs/SPEC/billing.md section 4.3) as
 * the operator's ruling of 12 September 2026 leaves it
 * (docs/superpowers/plans/2026-09-12-optional-terms.md): a term is optional,
 * and where there is one it is a whole number with a unit beside it. No term
 * means the credits never expire, and the rule says so by returning null
 * rather than a date, which is what the catalogue and the sale then write.
 * The warnings at sixty and thirty days are unchanged.
 */

describe('expiryOn', () => {
  it('gives no date at all to a programme sold without a term', () => {
    expect(expiryOn('2026-09-03', null)).toBeNull();
  });

  describe('a term counted in months', () => {
    it('lands on the same day of the month, the stated number of months later', () => {
      expect(DEFAULT_EXPIRY_MONTHS).toBe(6);
      expect(expiryOn('2026-09-03', { amount: DEFAULT_EXPIRY_MONTHS, unit: 'month' })).toBe(
        '2027-03-03',
      );
    });

    it('crosses the year end without losing a day', () => {
      expect(expiryOn('2026-11-30', { amount: 3, unit: 'month' })).toBe('2027-02-28');
      expect(expiryOn('2026-12-31', { amount: 1, unit: 'month' })).toBe('2027-01-31');
    });

    it('falls back to the last day of a month too short to hold the same date', () => {
      expect(expiryOn('2026-08-31', { amount: 6, unit: 'month' })).toBe('2027-02-28');
      expect(expiryOn('2027-08-31', { amount: 6, unit: 'month' })).toBe('2028-02-29');
    });

    it('keeps a leap day when the target year has one', () => {
      expect(expiryOn('2028-02-29', { amount: 12, unit: 'month' })).toBe('2029-02-28');
    });

    it('refuses a term that is not a whole number of months', () => {
      expect(() => expiryOn('2026-09-03', { amount: 0, unit: 'month' })).toThrow(RangeError);
      expect(() => expiryOn('2026-09-03', { amount: 1.5, unit: 'month' })).toThrow(RangeError);
      expect(() => expiryOn('2026-09-03', { amount: -3, unit: 'month' })).toThrow(RangeError);
    });
  });

  describe('a term counted in days', () => {
    it('adds the days and nothing else', () => {
      expect(expiryOn('2026-09-03', { amount: 1, unit: 'day' })).toBe('2026-09-04');
      expect(expiryOn('2026-09-03', { amount: 14, unit: 'day' })).toBe('2026-09-17');
    });

    it('runs straight through the end of a month, with no clamp to shorten it', () => {
      expect(expiryOn('2026-08-31', { amount: 1, unit: 'day' })).toBe('2026-09-01');
      // Where three months from 30 November is pulled back to 28 February,
      // thirty days from 31 January simply runs on to 2 March: the clamp is
      // the month branch's, and the day branch has nothing to clamp.
      expect(expiryOn('2026-01-31', { amount: 30, unit: 'day' })).toBe('2026-03-02');
    });

    it('runs through the end of a year', () => {
      expect(expiryOn('2026-12-31', { amount: 1, unit: 'day' })).toBe('2027-01-01');
      expect(expiryOn('2026-12-20', { amount: 30, unit: 'day' })).toBe('2027-01-19');
    });

    it('counts the leap day as a day, and does not invent one', () => {
      expect(expiryOn('2028-02-28', { amount: 2, unit: 'day' })).toBe('2028-03-01');
      expect(expiryOn('2027-02-28', { amount: 2, unit: 'day' })).toBe('2027-03-02');
    });

    it('refuses a term that is not a whole number of days', () => {
      expect(() => expiryOn('2026-09-03', { amount: 0, unit: 'day' })).toThrow(RangeError);
      expect(() => expiryOn('2026-09-03', { amount: 2.5, unit: 'day' })).toThrow(RangeError);
      expect(() => expiryOn('2026-09-03', { amount: -1, unit: 'day' })).toThrow(RangeError);
    });
  });

  it('refuses a unit the practice does not count in', () => {
    const weeks = { amount: 6, unit: 'week' } as unknown as ExpiryTerm;
    expect(() => expiryOn('2026-09-03', weeks)).toThrow(RangeError);
  });

  it('refuses something that is not a calendar date, in either unit', () => {
    expect(() => expiryOn('not-a-date', { amount: 1, unit: 'month' })).toThrow(RangeError);
    expect(() => expiryOn('not-a-date', { amount: 1, unit: 'day' })).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts whole days, forwards and backwards', () => {
    expect(daysBetween('2026-09-03', '2026-09-03')).toBe(0);
    expect(daysBetween('2026-09-03', '2026-09-04')).toBe(1);
    expect(daysBetween('2026-09-04', '2026-09-03')).toBe(-1);
    expect(daysBetween('2026-09-03', '2027-09-03')).toBe(365);
  });

  it('counts across a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('refuses something that is not a date', () => {
    expect(() => daysBetween('not-a-date', '2026-09-03')).toThrow(RangeError);
  });
});

describe('expiryWarningFor', () => {
  const expires = '2026-12-31';

  it('says nothing while there is plenty of time', () => {
    expect(expiryWarningFor(expires, '2026-06-01')).toBe('none');
  });

  it('speaks first at sixty days', () => {
    expect(expiryWarningFor(expires, '2026-11-01')).toBe('sixty_days'); // 60 days out
    expect(expiryWarningFor(expires, '2026-10-31')).toBe('none'); // 61 days out
  });

  it('speaks again at thirty days, and only then', () => {
    expect(expiryWarningFor(expires, '2026-12-01')).toBe('thirty_days'); // 30 days out
    expect(expiryWarningFor(expires, '2026-12-02')).toBe('thirty_days');
    expect(expiryWarningFor(expires, '2026-11-30')).toBe('sixty_days'); // 31 days out
  });

  it('counts the last day as still usable, and the next as expired', () => {
    expect(expiryWarningFor(expires, '2026-12-31')).toBe('thirty_days');
    expect(expiryWarningFor(expires, '2027-01-01')).toBe('expired');
  });

  it('never warns about a credit that does not expire', () => {
    expect(expiryWarningFor(null, '2026-12-31')).toBe('none');
  });
});

describe('isUsableOn', () => {
  it('lets a client use a credit on its very last day', () => {
    expect(isUsableOn('2026-12-31', '2026-12-31')).toBe(true);
    expect(isUsableOn('2026-12-31', '2027-01-01')).toBe(false);
  });

  it('lets a credit with no expiry date be used whenever', () => {
    expect(isUsableOn(null, '2099-01-01')).toBe(true);
  });
});
