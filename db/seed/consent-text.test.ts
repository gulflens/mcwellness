import { describe, expect, it } from 'vitest';
import { loadConsentTexts, purposesOf } from './consent-text';

/**
 * The wording files themselves (docs/CONSENT). This test reads what is really
 * in the repository rather than a fixture: the point of the loader is that the
 * practice's own texts, and their front matter, are the source of what the seed
 * files and what a person signs.
 */

/**
 * The purposes the practice asks a household for, since the legal advisor's
 * recommendations of 9 September 2026. `photo_video` is absent: no photograph
 * is taken, so none is agreed to. Its superseded wording is kept under
 * `docs/CONSENT/superseded/`, out of the loader's reach, because consents
 * recorded on staging name it.
 */
const PURPOSES = ['health_data', 'home_visit', 'minor_participation', 'participation'];

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

  it('offers no wording for a purpose the practice has retired', () => {
    for (const retired of ['photo_video', 'research', 'marketing']) {
      expect(texts.some((text) => text.purpose === retired)).toBe(false);
    }
  });

  it('reads the version and the status from the front matter of each file', () => {
    for (const text of texts) {
      // The versions are asymmetric and each step is recorded in
      // docs/CONSENT/README.md. A filed wording is never edited, so every
      // correction on 2026-09-09 — all of them before any household saw a
      // word — is a new version: the Arabic was corrected once for saying
      // المعالج where the practice says الممارس, and the health-data page
      // again, in both languages, when the operator restated the retention
      // rule as a floor rather than a timer.
      const expected: Record<string, string> = {
        'participation.en': '1.0',
        'participation.ar': '1.1',
        'minor_participation.en': '1.0',
        'minor_participation.ar': '1.1',
        'home_visit.en': '1.0',
        'home_visit.ar': '1.1',
        'health_data.en': '1.1',
        'health_data.ar': '1.2',
      };
      expect(text.version, `${text.purpose}.${text.locale}`).toBe(
        expected[`${text.purpose}.${text.locale}`],
      );
      // Approved by the practice's legal advisor on 2026-09-09, subject to the
      // four changes this round carries (docs/CONSENT/README.md).
      expect(text.status).toBe('approved');
    }
  });

  it('fingerprints the whole file, front matter included', () => {
    for (const text of texts) {
      expect(text.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(text.bytes.toString('utf8').startsWith('---\n')).toBe(true);
      expect(text.bytes.byteLength).toBeGreaterThan(200);
    }
    // Four files behind eight texts: the agreement is one page shown for three
    // purposes, so three of the eight share its bytes by design.
    expect(new Set(texts.map((text) => text.sha256Hex)).size).toBe(4);
  });

  it('reads them in the same order every time, so the seeded ids never move', () => {
    expect(loadConsentTexts().map((text) => text.file)).toEqual(texts.map((text) => text.file));
    expect(texts.map((text) => text.file)).toEqual([
      'agreement.ar.md',
      'agreement.ar.md',
      'agreement.ar.md',
      'agreement.en.md',
      'agreement.en.md',
      'agreement.en.md',
      'health-data.ar.md',
      'health-data.en.md',
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

/**
 * One page may be shown for several purposes: the practice's plain agreement
 * is the text a person meets whether they are agreeing to take part, agreeing
 * for their child, or agreeing to be visited at home. Each purpose still files
 * its own document, because a recorded consent names exactly one.
 */
describe('the purposes a wording is shown for', () => {
  it('reads a single purpose as a list of one', () => {
    expect(purposesOf('participation')).toEqual(['participation']);
  });

  it('reads several purposes from one field', () => {
    expect(purposesOf('participation, minor_participation, home_visit')).toEqual([
      'participation',
      'minor_participation',
      'home_visit',
    ]);
  });

  it('does not mind untidy spacing', () => {
    expect(purposesOf('  participation ,home_visit  ')).toEqual(['participation', 'home_visit']);
  });

  it('refuses a field that names nothing', () => {
    expect(() => purposesOf(' , ')).toThrow(/at least one/);
  });
});
