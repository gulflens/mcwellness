import { describe, expect, it } from 'vitest';
import { fixed, typed } from './words';

describe('words', () => {
  it('marks fixed wording as not typed by a person', () => {
    expect(fixed('Recommendations')).toEqual({ text: 'Recommendations', typed: false });
  });

  it('marks what a person typed as typed', () => {
    expect(typed('Morning walks')).toEqual({ text: 'Morning walks', typed: true });
  });

  it('keeps the words exactly as they are handed over, spaces and all', () => {
    expect(fixed('  two  spaces ').text).toBe('  two  spaces ');
    expect(typed('').text).toBe('');
  });
});
