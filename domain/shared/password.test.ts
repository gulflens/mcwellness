import { describe, expect, it } from 'vitest';
import { passwordProblem, passwordProblemKey } from './password';

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

  it('names the problem by key, so a page in another language can say it in its own words', () => {
    // The household's portal is bilingual (docs/SPEC/client-portal.md section
    // 3); the rule stays one rule and the sentence is the page's to choose.
    expect(passwordProblemKey('short')).toBe('short');
    expect(passwordProblemKey('x'.repeat(201))).toBe('long');
    expect(passwordProblemKey('aaaaaaaaaaaa')).toBe('variety');
    expect(passwordProblemKey(' correct-horse-battery')).toBe('edges');
    expect(passwordProblemKey('correct horse battery staple')).toBeNull();
  });
});
