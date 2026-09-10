import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_MONTHS,
  daysBetween,
  expiryOn,
  expiryWarningFor,
  isUsableOn,
} from './expiry';

/**
 * The specification for package expiry (docs/SPEC/billing.md section 4.3 and
 * the founder's decision of 2026-09-03: twelve months, warned at sixty days
 * and again at thirty).
 */

describe('expiryOn', () => {
  it('is six months from purchase by default', () => {
    expect(DEFAULT_EXPIRY_MONTHS).toBe(6);
    expect(expiryOn('2026-09-03', DEFAULT_EXPIRY_MONTHS)).toBe('2027-03-03');
  });

  it('crosses the year end without losing a day', () => {
    expect(expiryOn('2026-11-30', 3)).toBe('2027-02-28');
    expect(expiryOn('2026-12-31', 1)).toBe('2027-01-31');
  });

  it('falls back to the last day of a month too short to hold the same date', () => {
    expect(expiryOn('2026-08-31', 6)).toBe('2027-02-28');
    expect(expiryOn('2027-08-31', 6)).toBe('2028-02-29');
  });

  it('keeps a leap day when the target year has one', () => {
    expect(expiryOn('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('refuses a period that is not a whole number of months', () => {
    expect(() => expiryOn('2026-09-03', 0)).toThrow(RangeError);
    expect(() => expiryOn('2026-09-03', 1.5)).toThrow(RangeError);
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
