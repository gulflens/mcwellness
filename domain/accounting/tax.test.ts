import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { corporateTaxEstimate, reliefWatch } from './tax';
import type { BooksSetting } from './types';

/**
 * docs/SPEC/accounting.md rules 15 and 16, with the defaults of section 8: a
 * rate of 9 percent above AED 375,000, and Small Business Relief elected up to
 * AED 3,000,000 of revenue in the financial year.
 */
const SETTING: Pick<
  BooksSetting,
  | 'corporateTaxRateBasisPoints'
  | 'corporateTaxThresholdFils'
  | 'smallBusinessReliefElected'
  | 'smallBusinessReliefThresholdFils'
> = {
  corporateTaxRateBasisPoints: 900,
  corporateTaxThresholdFils: fils(37_500_000),
  smallBusinessReliefElected: true,
  smallBusinessReliefThresholdFils: fils(300_000_000),
};

describe('corporateTaxEstimate (rule 15)', () => {
  it('is zero while the relief is elected and revenue is at or below the threshold', () => {
    expect(corporateTaxEstimate(fils(80_000_000), fils(299_999_999), SETTING)).toBe(0);
    expect(corporateTaxEstimate(fils(80_000_000), fils(300_000_000), SETTING)).toBe(0);
  });

  it('charges the rate above the taxable threshold once revenue passes the relief line', () => {
    // Result AED 500,000; taxable AED 125,000; 9 percent is AED 11,250.
    expect(corporateTaxEstimate(fils(50_000_000), fils(300_000_001), SETTING)).toBe(1_125_000);
  });

  it('charges the rate when the relief is not elected, whatever the revenue', () => {
    const notElected = { ...SETTING, smallBusinessReliefElected: false };
    expect(corporateTaxEstimate(fils(50_000_000), fils(10_000_000), notElected)).toBe(1_125_000);
  });

  it('is zero and never negative when the result is at or below the taxable threshold', () => {
    const notElected = { ...SETTING, smallBusinessReliefElected: false };
    expect(corporateTaxEstimate(fils(37_500_000), fils(10_000_000), notElected)).toBe(0);
    expect(corporateTaxEstimate(fils(-4_000_000), fils(10_000_000), notElected)).toBe(0);
  });

  it('rounds the estimate down to whole fils', () => {
    const notElected = {
      ...SETTING,
      smallBusinessReliefElected: false,
      corporateTaxThresholdFils: fils(0),
    };
    // 9 percent of 101 fils is 9.09 fils.
    expect(corporateTaxEstimate(fils(101), fils(10), notElected)).toBe(9);
  });
});

describe('reliefWatch (rule 16)', () => {
  const threshold = fils(300_000_000);

  it('is clear below 80 percent of the threshold', () => {
    expect(reliefWatch(fils(239_999_999), threshold)).toBe('clear');
  });

  it('warns from 80 percent up to the threshold itself', () => {
    expect(reliefWatch(fils(240_000_000), threshold)).toBe('approaching');
    expect(reliefWatch(fils(300_000_000), threshold)).toBe('approaching');
  });

  it('says the relief is gone past the threshold', () => {
    expect(reliefWatch(fils(300_000_001), threshold)).toBe('exceeded');
  });
});
