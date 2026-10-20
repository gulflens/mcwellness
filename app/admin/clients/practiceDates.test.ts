import { describe, expect, it } from 'vitest';
import { practiceDate, practiceDateLong, practiceToday } from './activation';

// 21:30 UTC on 3 September is already 01:30 on 4 September in Dubai, and
// still the afternoon of 3 September on the US west coast, where the suite runs.
const LATE_EVENING_UTC = '2026-09-03T21:30:00Z';

describe('dates drawn in the practice zone, wherever the computer is', () => {
  it('runs on a clock far from Dubai, so these tests can tell the zones apart', () => {
    // vite.config.ts pins the suite to the US west coast; if that ever stops
    // reaching the workers, every test below would pass for the wrong reason.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
  });

  it('writes an instant as the day it was in Dubai', () => {
    expect(practiceDate(LATE_EVENING_UTC)).toBe('04/09/2026');
  });

  it('writes an instant in words as the day it was in Dubai', () => {
    expect(practiceDateLong(LATE_EVENING_UTC)).toBe('4 September 2026');
  });

  it('writes a calendar day such as a birthday as that same day, never the one before', () => {
    expect(practiceDate('2015-04-01')).toBe('01/04/2015');
    expect(practiceDateLong('2015-04-01')).toBe('1 April 2015');
  });

  it('draws a dash for a malformed date rather than failing the screen', () => {
    expect(practiceDate('not a date')).toBe('—');
    expect(practiceDateLong('')).toBe('—');
  });

  it("takes today from Dubai's clock, not the computer's", () => {
    expect(practiceToday(new Date(LATE_EVENING_UTC))).toBe('2026-09-04');
  });
});
