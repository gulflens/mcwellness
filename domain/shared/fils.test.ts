import { describe, expect, it } from 'vitest';
import { addFils, fils } from './fils';

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
