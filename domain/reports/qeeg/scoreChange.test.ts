import { describe, expect, it } from 'vitest';
import { classifyScoreChange, type ScoreMovement } from './scoreChange';

/** docs/SPEC/reports-qeeg.md section 16, rule 8. */

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MOVEMENTS: readonly ScoreMovement[] = ['higher', 'lower', 'steady'];

describe('classifyScoreChange: what holds whatever rule the practice sets', () => {
  it('answers with one of three names, for every pair of scores', () => {
    for (const earlier of SCORES) {
      for (const later of SCORES) {
        expect(MOVEMENTS).toContain(classifyScoreChange(earlier, later));
      }
    }
  });

  it('calls a score that did not move steady', () => {
    for (const score of SCORES) expect(classifyScoreChange(score, score)).toBe('steady');
  });

  it('never calls a score that fell higher', () => {
    for (const earlier of SCORES) {
      for (const later of SCORES.filter((s) => s < earlier)) {
        expect(classifyScoreChange(earlier, later)).not.toBe('higher');
      }
    }
  });

  it('never calls a score that rose lower', () => {
    for (const earlier of SCORES) {
      for (const later of SCORES.filter((s) => s > earlier)) {
        expect(classifyScoreChange(earlier, later)).not.toBe('lower');
      }
    }
  });

  it('calls the whole of the scale, from nothing to ten, a change', () => {
    // Whatever margin is chosen, a rule that calls 0 to 10 steady has no margin left to choose.
    expect(classifyScoreChange(0, 10)).toBe('higher');
    expect(classifyScoreChange(10, 0)).toBe('lower');
  });

  it('refuses a score that is not a whole number from 0 to 10', () => {
    for (const bad of [-1, 11, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => classifyScoreChange(bad, 5)).toThrow(RangeError);
      expect(() => classifyScoreChange(5, bad)).toThrow(RangeError);
    }
  });
});

/**
 * The rule as it stands. **These are the tests to change when the practice
 * sets its rule**, and changing them is how the change is made on purpose.
 */
describe('classifyScoreChange: the rule as it stands, until the practice sets its own', () => {
  it('counts any difference as a change', () => {
    expect(classifyScoreChange(6, 7)).toBe('higher');
    expect(classifyScoreChange(7, 6)).toBe('lower');
  });

  it('treats a rise and a fall alike', () => {
    for (const earlier of SCORES) {
      for (const later of SCORES) {
        const there = classifyScoreChange(earlier, later);
        const back = classifyScoreChange(later, earlier);
        const mirror = there === 'higher' ? 'lower' : there === 'lower' ? 'higher' : 'steady';
        expect(back).toBe(mirror);
      }
    }
  });
});
