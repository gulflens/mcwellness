import { describe, expect, it } from 'vitest';
import { isMinor } from './isMinor';

describe('isMinor', () => {
  it('is a minor the day before the eighteenth birthday and not on it', () => {
    // Born 2008-09-02: turns eighteen on 2026-09-02 (domain/shared/dates.test.ts uses the same pair).
    expect(isMinor('2008-09-02', '2026-09-01')).toBe(true);
    expect(isMinor('2008-09-02', '2026-09-02')).toBe(false);
  });

  it('is a minor from birth', () => {
    expect(isMinor('2026-09-02', '2026-09-02')).toBe(true);
  });

  it('is not a minor well past eighteen', () => {
    expect(isMinor('1990-01-31', '2026-01-30')).toBe(false);
  });

  it('handles a leap-day birthday: eighteen lands the day after the missing 29 February', () => {
    // Born 2008-02-29 (a leap year); 2026 is not leap, so 29 February does not exist that year.
    expect(isMinor('2008-02-29', '2026-02-28')).toBe(true);
    expect(isMinor('2008-02-29', '2026-03-01')).toBe(false);
  });
});
