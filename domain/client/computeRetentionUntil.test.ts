import { describe, expect, it } from 'vitest';
import { computeRetentionUntil } from './computeRetentionUntil';

describe('computeRetentionUntil', () => {
  it('adds five calendar years', () => {
    expect(computeRetentionUntil('2026-09-02')).toBe('2031-09-02');
    expect(computeRetentionUntil('2020-01-31')).toBe('2025-01-31');
  });

  it('lands a 29 February retention date on 28 February when the fifth year is not leap', () => {
    // 2024 is a leap year; 2029 (2024 + 5) is not, so 29 February does not exist.
    expect(computeRetentionUntil('2024-02-29')).toBe('2029-02-28');
  });

  it('refuses a malformed date', () => {
    expect(() => computeRetentionUntil('not-a-date')).toThrow('Bad date.');
  });
});
