import { describe, expect, it } from 'vitest';
import { nextMrn } from './nextMrn';

describe('nextMrn', () => {
  it('starts the sequence at MW-000001 when there is no prior MRN', () => {
    expect(nextMrn(null)).toBe('MW-000001');
  });

  it('advances by one', () => {
    expect(nextMrn('MW-000001')).toBe('MW-000002');
    expect(nextMrn('MW-000999')).toBe('MW-001000');
  });

  it('grows a seventh digit rather than reusing a number', () => {
    expect(nextMrn('MW-999999')).toBe('MW-1000000');
  });

  it('refuses a string that is not an MRN', () => {
    expect(() => nextMrn('not-an-mrn')).toThrow('Not an MRN');
  });
});
