import { describe, expect, it } from 'vitest';
import { describeAge, describePosition } from '../../app/admin/schedule/board/positions';

/**
 * How the board says where somebody is sharing from, and how old it is
 * (docs/SPEC/dispatch.md section 15).
 */

describe('describeAge', () => {
  it('says just now for a position under a minute old', () => {
    expect(describeAge(0)).toBe('just now');
  });

  it('counts minutes under the hour', () => {
    expect(describeAge(1)).toBe('1 min ago');
    expect(describeAge(59)).toBe('59 min ago');
  });

  it('counts hours and minutes past the hour', () => {
    expect(describeAge(60)).toBe('1 h ago');
    expect(describeAge(125)).toBe('2 h 5 min ago');
  });
});

describe('describePosition', () => {
  it('says how old the position is and how sure the phone was', () => {
    expect(describePosition({ ageMinutes: 4, accuracyMetres: 12.4 })).toBe(
      'Location shared 4 min ago, within 12 m',
    );
  });

  it('says sharing is off rather than pretending to know', () => {
    expect(describePosition(undefined)).toBe('Sharing off');
  });
});
