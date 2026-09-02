import { describe, expect, it } from 'vitest';
import { parseMrn } from './parseMrn';

describe('parseMrn', () => {
  it('reads the number back from a well-formed MRN', () => {
    expect(parseMrn('MW-000001')).toBe(1);
    expect(parseMrn('MW-042')).toBe(42);
    expect(parseMrn('MW-1000000')).toBe(1_000_000);
  });

  it('is strict: MW- followed by digits only', () => {
    expect(parseMrn('mw-000001')).toBeNull();
    expect(parseMrn('MW000001')).toBeNull();
    expect(parseMrn('MW-')).toBeNull();
    expect(parseMrn('MW-1a')).toBeNull();
    expect(parseMrn('MW- 1')).toBeNull();
    expect(parseMrn('MW-000001 ')).toBeNull();
    expect(parseMrn('X-MW-000001')).toBeNull();
    expect(parseMrn('')).toBeNull();
  });

  it('refuses a number too large to represent exactly', () => {
    expect(parseMrn('MW-99999999999999999999')).toBeNull();
  });
});
