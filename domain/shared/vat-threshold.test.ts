import { describe, expect, it } from 'vitest';
import {
  VAT_MANDATORY_THRESHOLD_FILS,
  VAT_VOLUNTARY_THRESHOLD_FILS,
  vatThresholdStand,
} from './vat-threshold';

describe('the two VAT registration marks', () => {
  it('names them in fils, as every figure in this codebase is', () => {
    expect(VAT_VOLUNTARY_THRESHOLD_FILS).toBe(18_750_000);
    expect(VAT_MANDATORY_THRESHOLD_FILS).toBe(37_500_000);
  });

  it('says a practice below the first mark is below both', () => {
    expect(vatThresholdStand(0)).toBe('below');
    expect(vatThresholdStand(VAT_VOLUNTARY_THRESHOLD_FILS - 1)).toBe('below');
  });

  it('says registering is a choice from the first mark', () => {
    expect(vatThresholdStand(VAT_VOLUNTARY_THRESHOLD_FILS)).toBe('voluntary');
    expect(vatThresholdStand(VAT_MANDATORY_THRESHOLD_FILS - 1)).toBe('voluntary');
  });

  it('says registering is a duty from the second', () => {
    expect(vatThresholdStand(VAT_MANDATORY_THRESHOLD_FILS)).toBe('mandatory');
    expect(vatThresholdStand(VAT_MANDATORY_THRESHOLD_FILS * 3)).toBe('mandatory');
  });
});
