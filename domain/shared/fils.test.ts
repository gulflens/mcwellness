import { describe, expect, it } from 'vitest';
import { addFils, fils, formatFils } from './fils';

describe('fils', () => {
  it('accepts an integer number of fils', () => {
    expect(fils(1250)).toBe(1250);
  });

  it('accepts zero and negative amounts', () => {
    expect(fils(0)).toBe(0);
    expect(fils(-250)).toBe(-250);
  });

  it('refuses a fractional amount', () => {
    expect(() => fils(12.5)).toThrow(RangeError);
  });

  it('refuses NaN and infinity', () => {
    expect(() => fils(Number.NaN)).toThrow(RangeError);
    expect(() => fils(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('refuses an amount beyond the safe integer range', () => {
    expect(() => fils(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('addFils', () => {
  it('adds two amounts', () => {
    expect(addFils(fils(1250), fils(250))).toBe(1500);
  });

  it('refuses a sum that leaves the safe integer range', () => {
    expect(() => addFils(fils(Number.MAX_SAFE_INTEGER), fils(1))).toThrow(RangeError);
  });
});

describe('formatFils', () => {
  /**
   * The one formatter, now that it is here rather than in a stream's path
   * (docs/CHANGE-REQUESTS/scheduling-04.md section 4). The billing screens
   * keep their own tests against the re-export; these are the arithmetic's.
   */
  it('formats a zero amount as a bare figure', () => {
    expect(formatFils(0)).toBe('0.00');
  });

  it('groups thousands the en-GB way and never says the currency', () => {
    expect(formatFils(123_456)).toBe('1,234.56');
    expect(formatFils(1_234_567_89)).toBe('1,234,567.89');
  });

  it('keeps the two fils places on a whole amount', () => {
    expect(formatFils(90_000)).toBe('900.00');
    expect(formatFils(5)).toBe('0.05');
  });

  it('puts the sign in front of the figure for a credit', () => {
    expect(formatFils(-123_456)).toBe('-1,234.56');
  });

  it('refuses a figure that is not a finite number of fils', () => {
    expect(() => formatFils(Number.NaN)).toThrow(RangeError);
    expect(() => formatFils(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
