import { describe, expect, it } from 'vitest';
import { ageOn } from './dates';

describe('ageOn', () => {
  it('counts whole years the way a person does', () => {
    expect(ageOn('2008-09-02', '2026-09-02')).toBe(18);
    expect(ageOn('2008-09-03', '2026-09-02')).toBe(17);
    expect(ageOn('1990-01-31', '2026-01-30')).toBe(35);
  });

  it('refuses a malformed date', () => {
    expect(() => ageOn('yesterday', '2026-09-02')).toThrow('Bad date of birth');
    expect(() => ageOn('2008-09-02', 'today')).toThrow('Bad date.');
  });
});
