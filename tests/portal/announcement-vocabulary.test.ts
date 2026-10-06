import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_VOCABULARY } from '../../domain/portal';
import {
  ARABIC_STEMS,
  ARABIC_WHOLE_WORD,
  ENGLISH_STEMS,
} from '../../domain/reports/qeeg/testing/vocabulary';

/**
 * The announcements' wording check restates the brain-map report's list of
 * words of another kind of practice (CLAUDE.md rule 1), because one module
 * does not import another's `domain/` (docs/SPEC/OWNERSHIP.md rule 3). A test
 * may read both, and this one fails the day the two lists drift apart, so a
 * word the reports learn to refuse is refused on the household's home too.
 */
describe('the announcements vocabulary', () => {
  it("is the brain-map report's list, word for word", () => {
    expect(ANNOUNCEMENT_VOCABULARY.english.source).toBe(ENGLISH_STEMS.source);
    expect(ANNOUNCEMENT_VOCABULARY.english.flags).toBe(ENGLISH_STEMS.flags);
    expect(ANNOUNCEMENT_VOCABULARY.arabic.source).toBe(ARABIC_STEMS.source);
    expect(ANNOUNCEMENT_VOCABULARY.arabicWholeWord.source).toBe(ARABIC_WHOLE_WORD.source);
  });
});
