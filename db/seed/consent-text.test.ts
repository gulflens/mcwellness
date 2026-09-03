import { describe, expect, it } from 'vitest';
import { loadConsentTexts } from './consent-text';

/**
 * The wording files themselves (docs/CONSENT). This test reads what is really
 * in the repository rather than a fixture: the point of the loader is that the
 * practice's own texts, and their front matter, are the source of what the seed
 * files and what a person signs.
 */

const PURPOSES = ['home_visit', 'minor_participation', 'participation', 'photo_video'];

describe('the consent wording files', () => {
  const texts = loadConsentTexts();

  it('gives four purposes in two languages, and nothing else', () => {
    expect(texts).toHaveLength(8);
    expect([...new Set(texts.map((text) => text.purpose))].sort()).toEqual(PURPOSES);
    for (const purpose of PURPOSES) {
      const languages = texts.filter((text) => text.purpose === purpose).map((t) => t.locale);
      expect(languages.sort()).toEqual(['ar', 'en']);
    }
  });

  it('reads the version and the status from the front matter of each file', () => {
    for (const text of texts) {
      expect(text.version).toMatch(/^\d+\.\d+/);
      // Drafts until the practice's lawyer approves them (docs/CONSENT/README.md).
      expect(text.status).toBe('draft');
    }
  });

  it('fingerprints the whole file, front matter included', () => {
    for (const text of texts) {
      expect(text.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(text.bytes.toString('utf8').startsWith('---\n')).toBe(true);
      expect(text.bytes.byteLength).toBeGreaterThan(200);
    }
    // Eight different texts: no file is a copy of another.
    expect(new Set(texts.map((text) => text.sha256Hex)).size).toBe(8);
  });

  it('reads them in the same order every time, so the seeded ids never move', () => {
    expect(loadConsentTexts().map((text) => text.file)).toEqual(texts.map((text) => text.file));
    expect(texts.map((text) => text.file)).toEqual([
      'home-visit.ar.md',
      'home-visit.en.md',
      'minor-participation.ar.md',
      'minor-participation.en.md',
      'participation.ar.md',
      'participation.en.md',
      'photo-video.ar.md',
      'photo-video.en.md',
    ]);
  });

  it('is real wording in both languages, not a translation stub', () => {
    for (const text of texts.filter((candidate) => candidate.locale === 'ar')) {
      // Arabic is a first-class text the practice's clients sign, not a summary.
      expect(/[؀-ۿ]/.test(text.bytes.toString('utf8'))).toBe(true);
      expect(text.bytes.byteLength).toBeGreaterThan(1000);
    }
  });
});
