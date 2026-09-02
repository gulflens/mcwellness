import { describe, expect, it } from 'vitest';
import { resolveVat } from '../../domain/billing';
import { fils } from '../../domain/shared';

describe('resolveVat', () => {
  it('computes the standard 5% rate on a realistic session price', () => {
    const result = resolveVat(fils(90_000), { rateBasisPoints: 500, version: 1 });
    expect(result).toEqual({
      treatment: 'standard',
      rateBasisPoints: 500,
      settingVersion: 1,
      vatFils: 4_500,
      grossFils: 94_500,
    });
  });

  it('charges no VAT when the rate is zero', () => {
    const result = resolveVat(fils(90_000), { rateBasisPoints: 0, version: 2 });
    expect(result.vatFils).toBe(0);
    expect(result.grossFils).toBe(90_000);
  });

  it('charges VAT on the full amount when the rate is 100%', () => {
    const result = resolveVat(fils(1_000), { rateBasisPoints: 10_000, version: 1 });
    expect(result.vatFils).toBe(1_000);
    expect(result.grossFils).toBe(2_000);
  });

  it('rounds an exact half-fils up, not down and not to even', () => {
    // 10 fils at 5% is exactly 0.5 fils.
    const result = resolveVat(fils(10), { rateBasisPoints: 500, version: 1 });
    expect(result.vatFils).toBe(1);
    expect(result.grossFils).toBe(11);
  });

  it('rounds a near-half amount to the nearer fils on both sides', () => {
    const roundsDown = resolveVat(fils(29), { rateBasisPoints: 500, version: 1 }); // 1.45 -> 1
    expect(roundsDown.vatFils).toBe(1);
    const roundsUp = resolveVat(fils(31), { rateBasisPoints: 500, version: 1 }); // 1.55 -> 2
    expect(roundsUp.vatFils).toBe(2);
  });

  it('treats a net amount of zero as zero VAT', () => {
    const result = resolveVat(fils(0), { rateBasisPoints: 500, version: 1 });
    expect(result.vatFils).toBe(0);
    expect(result.grossFils).toBe(0);
  });

  it('carries the setting version through unchanged, for the invoice trail later', () => {
    const result = resolveVat(fils(100_000), { rateBasisPoints: 500, version: 7 });
    expect(result.settingVersion).toBe(7);
    expect(result.treatment).toBe('standard');
  });

  it('returns an integer number of fils, never a float', () => {
    const result = resolveVat(fils(33), { rateBasisPoints: 500, version: 1 });
    expect(Number.isInteger(result.vatFils)).toBe(true);
    expect(Number.isInteger(result.grossFils)).toBe(true);
  });
});
