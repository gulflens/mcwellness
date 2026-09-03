import { describe, expect, it } from 'vitest';
import { deriveObservationFlag } from './deriveObservationFlag';

describe('deriveObservationFlag', () => {
  it('does not flag a visit with no observations recorded', () => {
    expect(deriveObservationFlag(null)).toBe(false);
  });

  it('does not flag a visit whose only chip is none', () => {
    expect(
      deriveObservationFlag({ chips: ['none'], tolerance: 9, engagement: 9, note: null }),
    ).toBe(false);
  });

  it('flags a visit where any other chip was ticked', () => {
    expect(
      deriveObservationFlag({
        chips: ['none', 'headache'],
        tolerance: null,
        engagement: null,
        note: null,
      }),
    ).toBe(true);
  });

  it('does not flag a free-text note on its own: the chips are the structured answer', () => {
    expect(
      deriveObservationFlag({
        chips: [],
        tolerance: null,
        engagement: null,
        note: 'Ran ten minutes late.',
      }),
    ).toBe(false);
  });
});
