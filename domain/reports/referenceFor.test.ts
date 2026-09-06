import { describe, expect, it } from 'vitest';
import { referenceFor, sequenceOf } from './referenceFor';

/** Rule 5 (docs/SPEC/reports-v1.md section 8). */

describe('referenceFor', () => {
  it('prints the first report as RPT-000001', () => {
    expect(referenceFor(1)).toBe('RPT-000001');
  });

  it('pads to six digits and then grows rather than wrapping', () => {
    expect(referenceFor(42)).toBe('RPT-000042');
    expect(referenceFor(999_999)).toBe('RPT-999999');
    expect(referenceFor(1_000_000)).toBe('RPT-1000000');
  });

  it('refuses a number no report was ever allocated', () => {
    // A report with no number has not been issued; asking for its reference is
    // a bug, not a blank to render.
    expect(() => referenceFor(0)).toThrow();
    expect(() => referenceFor(-1)).toThrow();
    expect(() => referenceFor(1.5)).toThrow();
  });
});

describe('sequenceOf', () => {
  it('reads the number back out of a reference', () => {
    expect(sequenceOf('RPT-000001')).toBe(1);
    expect(sequenceOf('RPT-123456')).toBe(123456);
  });

  it('answers nothing for a reference that is not one of ours', () => {
    expect(sequenceOf('INV-000001')).toBeNull();
    expect(sequenceOf('RPT-')).toBeNull();
    expect(sequenceOf('RPT-nope')).toBeNull();
    expect(sequenceOf('RPT-000000')).toBeNull();
  });

  it('round-trips every reference it prints', () => {
    for (const n of [1, 2, 99, 100, 999_999]) {
      expect(sequenceOf(referenceFor(n))).toBe(n);
    }
  });
});
