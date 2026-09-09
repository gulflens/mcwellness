import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password';

describe('what a password may be', () => {
  it('needs twelve characters, of at least four kinds, with no space at either end', () => {
    expect(passwordProblem('short')).toBe('At least 12 characters.');
    expect(passwordProblem('aaaaaaaaaaaa')).toBe(
      'More variety than that: at least four different characters.',
    );
    expect(passwordProblem(' correct-horse-battery')).toBe('No space at the start or the end.');
    expect(passwordProblem('x'.repeat(201))).toBe('At most 200 characters.');
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });
});
