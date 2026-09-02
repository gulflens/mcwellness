import { describe, expect, it } from 'vitest';
import { formatMrn } from './formatMrn';

describe('formatMrn', () => {
  it('zero-pads to six digits', () => {
    expect(formatMrn(1)).toBe('MW-000001');
    expect(formatMrn(42)).toBe('MW-000042');
    expect(formatMrn(999_999)).toBe('MW-999999');
  });

  it('grows past six digits rather than truncating', () => {
    expect(formatMrn(1_000_000)).toBe('MW-1000000');
  });

  it('refuses zero, negative and non-integer numbers', () => {
    expect(() => formatMrn(0)).toThrow('positive integer');
    expect(() => formatMrn(-1)).toThrow('positive integer');
    expect(() => formatMrn(1.5)).toThrow('positive integer');
  });
});
