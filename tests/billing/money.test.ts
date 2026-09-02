import { describe, expect, it } from 'vitest';
import { formatFils, parseAedToFils, previewVat } from '../../app/admin/billing/money';

describe('formatFils', () => {
  it('formats a zero amount', () => {
    expect(formatFils(0)).toBe('AED 0.00');
  });

  it('formats whole AED', () => {
    expect(formatFils(90_000)).toBe('AED 900.00');
  });

  it('formats fils below one AED, padded to two digits', () => {
    expect(formatFils(5)).toBe('AED 0.05');
  });

  it('groups thousands', () => {
    expect(formatFils(1_234_56)).toBe('AED 1,234.56');
  });
});

describe('parseAedToFils', () => {
  it('converts a plain amount exactly', () => {
    expect(parseAedToFils('12.34')).toBe(1234);
  });

  it('converts 0.1 and 0.2 exactly', () => {
    expect(parseAedToFils('0.1')).toBe(10);
    expect(parseAedToFils('0.2')).toBe(20);
  });

  it('never drifts the way naive `amount * 100` floating-point multiplication can', () => {
    // 0.29 * 100 is 28.999999999999996 in IEEE 754, not 29 — the failure
    // mode this function avoids entirely by never multiplying a decimal.
    expect(0.29 * 100).not.toBe(29);
    expect(parseAedToFils('0.29')).toBe(29);
  });

  it('accepts a whole number with no decimal point', () => {
    expect(parseAedToFils('900')).toBe(90_000);
  });

  it('accepts a single-digit fraction, treating it as tenths', () => {
    expect(parseAedToFils('12.3')).toBe(1230);
  });

  it('accepts zero', () => {
    expect(parseAedToFils('0')).toBe(0);
    expect(parseAedToFils('0.00')).toBe(0);
  });

  it('trims surrounding whitespace', () => {
    expect(parseAedToFils(' 12.50 ')).toBe(1250);
  });

  it('refuses an empty or non-numeric amount', () => {
    expect(parseAedToFils('')).toBeNull();
    expect(parseAedToFils('abc')).toBeNull();
  });

  it('refuses a negative amount', () => {
    expect(parseAedToFils('-5')).toBeNull();
  });

  it('refuses more than two decimal places', () => {
    expect(parseAedToFils('12.345')).toBeNull();
  });

  it('refuses a thousands separator', () => {
    expect(parseAedToFils('1,234.56')).toBeNull();
  });
});

describe('previewVat', () => {
  it('matches the server-resolved figures for a 90,000-fils price at the standard 5% rate', () => {
    // The same amount and rate tests/billing/db/prices.test.ts posts and asserts
    // domain/billing's resolveVat produces: 4,500 fils VAT, 94,500 fils gross.
    expect(previewVat(90_000, 500)).toEqual({ vatFils: 4_500, grossFils: 94_500 });
  });

  it('rounds half up to the nearest fils', () => {
    // 999 * 500 / 10000 = 49.95, rounds up to 50.
    expect(previewVat(999, 500)).toEqual({ vatFils: 50, grossFils: 1_049 });
  });

  it('is zero on a zero net amount', () => {
    expect(previewVat(0, 500)).toEqual({ vatFils: 0, grossFils: 0 });
  });
});
