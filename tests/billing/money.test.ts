import { describe, expect, it } from 'vitest';
import {
  AED_MAX_FILS,
  formatFils,
  isAedAmountTooLarge,
  parseAedToFils,
  previewVat,
} from '../../app/admin/billing/money';

describe('formatFils', () => {
  it('formats a zero amount as a bare figure', () => {
    expect(formatFils(0)).toBe('0.00');
  });

  it('formats whole AED, with no currency word', () => {
    expect(formatFils(90_000)).toBe('900.00');
  });

  it('formats fils below one AED, padded to two digits', () => {
    expect(formatFils(5)).toBe('0.05');
  });

  it('groups thousands with en-GB grouping', () => {
    expect(formatFils(1_234_56)).toBe('1,234.56');
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

  it('reads back a grouped figure, which is what formatFils writes', () => {
    // The bug this test pins: the package drawer offers the contents' total
    // as the list price and the payment drawer offers the outstanding
    // amount, both through formatFils, and both were then refused on submit
    // because the parser would not read its own output. A founder building
    // the practice's Silver programme was told to "enter both prices in AED"
    // about the figure the screen had just handed her.
    expect(parseAedToFils('1,234.56')).toBe(123_456);
    expect(parseAedToFils('12,150.00')).toBe(1_215_000);
    expect(parseAedToFils('1,215,000')).toBe(121_500_000);
  });

  it('reads back every figure formatFils writes, exactly', () => {
    for (const amountFils of [0, 5, 999, 90_000, 123_456, 1_032_500, 1_997_500, 3_130_000]) {
      expect(parseAedToFils(formatFils(amountFils))).toBe(amountFils);
    }
  });

  it('refuses grouping that is not grouping', () => {
    // A European decimal comma must never be read as a separator and paid a
    // hundredfold: "12,34" is not AED 1,234.
    expect(parseAedToFils('12,34')).toBeNull();
    expect(parseAedToFils('1,23,456')).toBeNull();
    expect(parseAedToFils('1,2345')).toBeNull();
    expect(parseAedToFils(',123')).toBeNull();
    expect(parseAedToFils('1,')).toBeNull();
    expect(parseAedToFils('0,123')).toBeNull();
  });

  it('accepts the int4 column maximum exactly', () => {
    expect(parseAedToFils('21474836.47')).toBe(AED_MAX_FILS);
  });

  it('refuses one fils above the int4 column maximum', () => {
    expect(parseAedToFils('21474836.48')).toBeNull();
  });

  it('refuses an amount far above the column maximum, even though it is a safe integer', () => {
    expect(parseAedToFils('999999999999')).toBeNull();
  });
});

describe('isAedAmountTooLarge', () => {
  it('is false for a well-formed amount at or under the maximum', () => {
    expect(isAedAmountTooLarge('21474836.47')).toBe(false);
    expect(isAedAmountTooLarge('120.00')).toBe(false);
  });

  it('is true for a well-formed amount over the maximum', () => {
    expect(isAedAmountTooLarge('21474836.48')).toBe(true);
    expect(isAedAmountTooLarge('999999999999')).toBe(true);
  });

  it('is false for input that is not a well-formed amount at all', () => {
    expect(isAedAmountTooLarge('')).toBe(false);
    expect(isAedAmountTooLarge('abc')).toBe(false);
    expect(isAedAmountTooLarge('-5')).toBe(false);
    expect(isAedAmountTooLarge('12,34')).toBe(false);
  });

  it('reads a grouped figure the same way the parser does', () => {
    expect(isAedAmountTooLarge('21,474,836.47')).toBe(false);
    expect(isAedAmountTooLarge('21,474,836.48')).toBe(true);
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
