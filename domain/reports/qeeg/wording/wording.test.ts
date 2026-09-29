import { describe, expect, it } from 'vitest';
import {
  APPROACH_IDS,
  BAND_CHANGES,
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_CHANGES,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  MEASURE_IDS,
  NEXT_STAGE_IDS,
  RECOMMENDATION_IDS,
  REGION_IDS,
  TIER_IDS,
} from '../catalogue/ids';
import {
  fill,
  keysOf,
  phrase,
  WORDING,
  WORDING_STATUS,
  WORDING_VERSION,
  type Edition,
  type Locale,
  type Phrase,
} from './index';

/**
 * docs/SPEC/reports-qeeg.md, "The wording": every fixed sentence of the
 * brain-map report, in both languages, and the rules a sentence is held to
 * before a household may read it.
 */

const EDITIONS: readonly Edition[] = ['initial', 'follow-up'];
const LOCALES: readonly Locale[] = ['en', 'ar'];

/** Every phrase the file holds, with where it came from, so a failure names it. */
function everyPhrase(): Array<{ at: string; phrase: Phrase }> {
  const found: Array<{ at: string; phrase: Phrase }> = [];
  for (const key of keysOf()) {
    const entry = WORDING[key] as Record<string, Phrase | undefined>;
    for (const part of ['both', 'initial', 'followUp']) {
      const value = entry[part];
      if (value) found.push({ at: `${key} (${part})`, phrase: value });
    }
  }
  return found;
}

function everyText(locale: Locale): Array<{ at: string; text: string }> {
  return everyPhrase().map(({ at, phrase: p }) => ({ at: `${at} [${locale}]`, text: p[locale] }));
}

const placeholdersOf = (text: string) =>
  [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();

describe('what the wording covers', () => {
  it('is version 1', () => {
    expect(WORDING_VERSION).toBe(1);
  });

  it('holds a good many sentences, so an empty file cannot pass', () => {
    expect(keysOf().length).toBeGreaterThan(250);
  });

  const expected: string[] = [
    ...FINDING_IDS.map((id) => `finding.${id}`),
    ...FOCUS_IDS.map((id) => `focus.${id}`),
    ...REGION_IDS.flatMap((id) => [`region.${id}.label`, `region.${id}.phrase`]),
    ...BAND_IDS.flatMap((id) => [
      `band.${id}.name`,
      `band.${id}.associated`,
      `band.${id}.influence`,
    ]),
    ...INITIAL_BAND_LEVELS.flatMap((id) => [`level.band.${id}.label`, `level.band.${id}.word`]),
    ...BAND_CHANGES.flatMap((id) => [`change.band.${id}.label`, `change.band.${id}.sentence`]),
    ...CONNECTIVITY_IDS.flatMap((id) => [
      `connectivity.${id}.title`,
      `connectivity.${id}.description`,
      `sentence.${id}`,
      ...INITIAL_CONNECTIVITY_LEVELS[id].flatMap((level) => [
        `level.${id}.${level}.label`,
        `level.${id}.${level}.word`,
      ]),
      ...CONNECTIVITY_CHANGES.flatMap((change) => [
        `change.${id}.${change}.label`,
        `change.${id}.${change}.sentence`,
      ]),
    ]),
    ...TIER_IDS.map((id) => `tier.${id}`),
    ...DIMENSION_IDS.flatMap((id) => [
      `dimension.${id}.title`,
      ...TIER_IDS.flatMap((tier) => [
        `dimension.${id}.${tier}.summary`,
        `dimension.${id}.${tier}.point.1`,
        `dimension.${id}.${tier}.point.2`,
        `dimension.${id}.${tier}.point.3`,
        `dimension.${id}.${tier}.advice`,
      ]),
    ]),
    ...RECOMMENDATION_IDS.flatMap((id) => [
      `recommendation.${id}.name`,
      `recommendation.${id}.text`,
    ]),
    ...BENEFIT_IDS.map((id) => `benefit.${id}`),
    ...APPROACH_IDS.flatMap((id) => [`approach.${id}.label`, `approach.${id}.text`]),
    ...NEXT_STAGE_IDS.flatMap((id) => [`next.${id}.label`, `next.${id}.text`]),
    ...MEASURE_IDS.map((id) => `measure.${id}`),
  ];

  it.each(expected)('has words for %s', (key) => {
    expect(WORDING[key], key).toBeDefined();
  });

  it('has words for nothing the lists do not hold', () => {
    // A sentence for an id nobody can choose is a sentence nobody approved on purpose.
    const listed = new Set(expected);
    const prefixes = [
      'finding.',
      'focus.',
      'region.',
      'band.',
      'level.',
      'change.',
      'connectivity.',
      'tier.',
      'dimension.',
      'recommendation.',
      'benefit.',
      'approach.',
      'next.',
      'measure.',
    ];
    const stray = keysOf().filter(
      (key) =>
        prefixes.some((prefix) => key.startsWith(prefix)) &&
        !listed.has(key) &&
        // The few keys under these prefixes that are about the list and not an item of it.
        !['band.with_range', 'measure.with_range'].includes(key),
    );
    expect(stray).toEqual([]);
  });
});

describe('both languages, always', () => {
  it('gives every sentence in English and in Arabic', () => {
    const empty = everyPhrase()
      .filter(({ phrase: p }) => p.en.trim() === '' || p.ar.trim() === '')
      .map(({ at }) => at);
    expect(empty).toEqual([]);
  });

  it('writes the Arabic in Arabic', () => {
    // A sentence is Arabic when it holds an Arabic letter. The exceptions are
    // the few that are a sign and nothing else.
    const signsOnly = /^[\s\d.,:;/()%{}a-z_*–-]*$/;
    const latin = everyText('ar')
      .filter(({ text }) => !/[؀-ۿ]/.test(text) && !signsOnly.test(text))
      .map(({ at }) => at);
    expect(latin).toEqual([]);
  });

  it('writes the English without an Arabic letter', () => {
    const mixed = everyText('en')
      .filter(({ text }) => /[؀-ۿ]/.test(text))
      .map(({ at }) => at);
    expect(mixed).toEqual([]);
  });

  it('leaves the same gaps to fill in both languages', () => {
    const uneven = everyPhrase()
      .filter(({ phrase: p }) => placeholdersOf(p.en).join() !== placeholdersOf(p.ar).join())
      .map(({ at }) => at);
    expect(uneven).toEqual([]);
  });

  it('opens and closes every bold mark', () => {
    const odd = LOCALES.flatMap((locale) => everyText(locale))
      .filter(({ text }) => (text.match(/\*\*/g) ?? []).length % 2 === 1)
      .map(({ at }) => at);
    expect(odd).toEqual([]);
  });
});

describe('what no sentence may say', () => {
  /**
   * CLAUDE.md rule 1. The practice is a wellness practice, and the page a
   * household signed says so. The standing sentences that say what
   * the practice is NOT are quoted from that page by the layout and are not in
   * this file, which is why the list below can be absolute.
   */
  const ENGLISH =
    /\b(patient|treat|therap|cure|symptom|clinic|diagnos|protocol|prescri|disorder|disease|medical|medicine|illness)/i;

  /** The same ideas in Arabic, by stem. */
  const ARABIC =
    /(مريض|مرضى|علاج|سريري|عيادة|أعراض|تشخيص|اضطراب|شفاء|دواء|طبي|يعالج|نعالج|تعالج|عولج|نفسي|انتكاس)/;

  /**
   * The one who gives what a clinic gives, as a whole word. "معالجة" is the
   * ordinary Arabic for processing, as in "معالجة المعلومات", and is a
   * different word that happens to begin the same way; it ends in a letter
   * this pattern does not allow.
   */
  const ARABIC_WHOLE_WORD = /(^|[^؀-ۿ])(ال|و|وال|لل|بال)?معالج(ك|ه|ها|ين|ون)?(?![؀-ۿ])/;

  /**
   * "طبيعي", "الطبيعية" and "بطبيعته" (natural, normal, by its nature) begin
   * with the letters of the word for what a clinic is, and are not it: the
   * limits a band is measured against are "normal limits".
   */
  const withoutNatural = (text: string) => text.replaceAll('طبيع', '');

  it('uses no word of another kind of practice, in English', () => {
    const found = everyText('en')
      .filter(({ text }) => ENGLISH.test(text))
      .map(({ at, text }) => `${at}: ${text}`);
    expect(found).toEqual([]);
  });

  it('uses no word of another kind of practice, in Arabic', () => {
    const found = everyText('ar')
      .filter(({ text }) => ARABIC.test(withoutNatural(text)) || ARABIC_WHOLE_WORD.test(text))
      .map(({ at, text }) => `${at}: ${text}`);
    expect(found).toEqual([]);
  });

  it('would catch the words it is there to catch', () => {
    // A guard that cannot fail guards nothing. These are the old tool's own
    // words for the things this file now says another way.
    for (const word of [
      'العلاج',
      'خطتك العلاجية',
      'تاريخك السريري',
      'الأعراض',
      'تشخيصية',
      'المرونة النفسية',
      'الانتكاسات',
    ]) {
      expect(ARABIC.test(withoutNatural(word)), word).toBe(true);
    }
    for (const word of ['المعالج', 'معالجك', 'مع المعالج.']) {
      expect(ARABIC_WHOLE_WORD.test(word), word).toBe(true);
    }
    for (const word of ['معالجة المعلومات', 'المعالجة الذهنية', 'الحدود الطبيعية', 'بطبيعته']) {
      expect(ARABIC.test(withoutNatural(word)) || ARABIC_WHOLE_WORD.test(word), word).toBe(false);
    }
    for (const word of ['history of treatment', 'Clinical note', 'a diagnostic tool']) {
      expect(ENGLISH.test(word), word).toBe(true);
    }
    expect(ENGLISH.test('a secure, accurate recording')).toBe(false);
  });
});

describe('what the page can print', () => {
  it('writes the Arabic without vowel marks', () => {
    // The document writer places a mark roughly, not over its letter
    // (domain/shared/document/arabic.ts carries no mark positioning). Fixed
    // wording is written without them, as modern Arabic print is.
    const marked = everyText('ar')
      .filter(({ text }) => /[ً-ْٰ]/.test(text))
      .map(({ at }) => at);
    expect(marked).toEqual([]);
  });

  it('writes no Arabic word that reads as another once its marks are gone', () => {
    // Found by the first review, in seven sentences. A command such as "build"
    // is, without its marks, the word for "son of"; "challenge" is "it limits",
    // which is the opposite sense; "I recommend" and "it was recommended" are
    // one spelling. Advice is written as a verbal noun, and a recommendation in
    // the form that reads one way.
    const AMBIGUOUS =
      /(^|[^\u0600-\u06FF])(ابن|تحد|قيم|حسن|درب|أوصي|عزز|راقب|قلل)(?![\u0600-\u06FF])/;
    const found = everyText('ar')
      .filter(({ text }) => AMBIGUOUS.test(text))
      .map(({ at, text }) => `${at}: ${text}`);
    expect(found).toEqual([]);
    expect(AMBIGUOUS.test('ابن عادات تركيز ثابتة')).toBe(true);
    expect(AMBIGUOUS.test('بناء عادات تركيز ثابتة')).toBe(false);
  });

  it('writes a range in an Arabic line in words, never with a dash between two figures', () => {
    // A dash between two figures in a right-to-left line can be read either way round.
    const found = everyText('ar')
      .filter(({ text }) => /(\d|\})\s*[–-]\s*(\d|\{)/.test(text))
      .map(({ at, text }) => `${at}: ${text}`);
    expect(found).toEqual([]);
  });

  it('uses no sign the typeface cannot draw', () => {
    // The installed faces have no glyph for these, and a glyph that cannot be
    // drawn is dropped without a word. "about" is written as a word.
    const found = LOCALES.flatMap((locale) => everyText(locale))
      .filter(({ text }) => /[≈▲▼◆•·→←]/.test(text))
      .map(({ at }) => at);
    expect(found).toEqual([]);
  });

  it('sets no label in capitals', () => {
    // docs/DESIGN-BRIEF.md section 4.5. The name of the recording is the one
    // word the practice writes in capitals.
    const shouted = everyText('en')
      .filter(({ text }) => (text.match(/\b[A-Z]{4,}\b/g) ?? []).some((word) => word !== 'QEEG'))
      .map(({ at, text }) => `${at}: ${text}`);
    expect(shouted).toEqual([]);
  });
});

describe('how many sessions, in Arabic', () => {
  it('has one form for one, one for two, one for three to ten, and one for the rest', () => {
    const ar = (key: string) => phrase(key, 'initial', 'ar');
    expect(ar('sessions.one')).toBe('جلسة واحدة');
    expect(ar('sessions.two')).toBe('جلستان');
    expect(ar('sessions.few')).toBe('{count} جلسات');
    expect(ar('sessions.many')).toBe('{count} جلسة');
  });
});

describe('who has approved it', () => {
  it('is a draft in both languages until a person approves it', () => {
    // This test is a tripwire, and changing it is the act of approval: the pull
    // request that turns it over names who approved the words, and when.
    expect(WORDING_STATUS).toEqual({ en: 'draft', ar: 'draft' });
  });
});

describe('phrase', () => {
  it('gives the sentence both editions share', () => {
    expect(phrase('heading.summary', 'initial', 'en')).toBe('Summary:');
    expect(phrase('heading.summary', 'follow-up', 'en')).toBe('Summary:');
  });

  it('gives a first report the first report’s heading, and a follow-up its own', () => {
    expect(phrase('heading.approach', 'initial', 'en')).toBe('Initial Training Approach');
    expect(phrase('heading.approach', 'follow-up', 'en')).toBe('Next Stage of Training');
  });

  it('answers in the language it is asked for', () => {
    expect(phrase('label.name', 'initial', 'en')).toBe('Name');
    expect(phrase('label.name', 'initial', 'ar')).toBe('الاسم');
  });

  it('refuses a key it does not hold, by name', () => {
    expect(() => phrase('no.such.key', 'initial', 'en')).toThrow(/no\.such\.key/);
  });

  it('refuses a sentence that belongs to the other edition', () => {
    expect(() => phrase('text.summary_lead', 'initial', 'en')).toThrow(/text\.summary_lead/);
    expect(phrase('text.summary_lead', 'follow-up', 'en')).toContain('follow-up');
  });

  it.each(EDITIONS)('has every sentence a %s report asks for, in both languages', (edition) => {
    for (const key of keysOf()) {
      const entry = WORDING[key] as Record<string, unknown>;
      const belongs =
        'both' in entry || (edition === 'initial' ? 'initial' in entry : 'followUp' in entry);
      if (!belongs) continue;
      for (const locale of LOCALES) expect(phrase(key, edition, locale)).not.toBe('');
    }
  });
});

describe('fill', () => {
  it('puts each value in its gap', () => {
    expect(fill('Page {page} of {total}', { page: 2, total: 9 })).toBe('Page 2 of 9');
  });

  it('fills a gap that appears twice', () => {
    expect(fill('{a} and {a}', { a: 'x' })).toBe('x and x');
  });

  it('leaves a sentence with no gap as it is', () => {
    expect(fill('Summary:', {})).toBe('Summary:');
  });

  it('never fills a gap from a name it was not given', () => {
    // `constructor` and `toString` are names every object answers to.
    expect(() => fill('{constructor}', {})).toThrow(/constructor/);
    expect(() => fill('{to_string}', {})).toThrow(/to_string/);
  });

  it('names the gap and nothing else when it refuses', () => {
    // What fills a gap may be something a person typed. An error reaches a log.
    let message = '';
    try {
      fill('A sentence about {who} and {what}', { who: 'somebody' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('what');
    expect(message).not.toContain('somebody');
    expect(message).not.toContain('A sentence about');
  });

  it('refuses to print a gap nobody filled', () => {
    // A brace on a household's page is worse than an error on the practitioner's.
    expect(() => fill('Page {page} of {total}', { page: 2 })).toThrow(/total/);
  });
});
