import { describe, expect, it } from 'vitest';
import { ARABIC_STEMS, ENGLISH_STEMS } from '../reports/qeeg/testing/vocabulary';
import { normaliseForCheck, wellnessWords } from './announcementWords';

/**
 * The announcements' own word check (docs/SPEC/client-portal.md section 5,
 * rule 10, as amended in round 72's fix round; CLAUDE.md rule 1): clearly
 * clinical words are refused, ambiguous ones are a warning the writer
 * confirms, and the text is normalised first so a mark or a joiner cannot
 * slip a word past.
 */

describe('normaliseForCheck', () => {
  it('folds case and drops the invisible joiners', () => {
    expect(normaliseForCheck('THERA‌py‍')).toBe('therapy');
  });

  it('drops Arabic diacritics and the elongation mark, and folds the letter forms', () => {
    expect(normaliseForCheck('عِلـــاج')).toBe('علاج');
    expect(normaliseForCheck('أعراض إآ')).toBe('اعراض اا');
    expect(normaliseForCheck('مستشفى')).toBe('مستشفي');
  });
});

describe('wellnessWords: refused', () => {
  it('refuses the clinical words in English, whatever their ending or case', () => {
    for (const [text, term] of [
      ['A diagnosis in a day', 'diagnos'],
      ['No prescription needed', 'prescri'],
      ['Our clinical team', 'clinic'],
      ['Therapy at home', 'therap'],
      ['For every disorder', 'disorder'],
      ['Disease-free living', 'disease'],
      ['Fewer symptoms', 'symptom'],
      ['A cure for stress', 'cure'],
      ['Healing sessions', 'heal'],
      ['Our doctor joins', 'doctor'],
      ['Dr Rowan joins', 'doctor'],
      ['Hospital-grade sensors', 'hospital'],
      ['A medical device', 'medical'],
      ['Help with ADHD', 'condition name'],
      ['Calm for anxiety', 'condition name'],
      ['After depression', 'condition name'],
      ['Beat insomnia', 'condition name'],
      ['Autism support', 'condition name'],
    ] as const) {
      expect(wellnessWords(text).refused, text).toContain(term);
    }
  });

  it('refuses them in Arabic', () => {
    for (const [text, term] of [
      ['تشخيص سريع', 'تشخيص'],
      ['عيادة الاستوديو', 'عيادة'],
      ['علاج في المنزل', 'علاج'],
      ['للمرضى فقط', 'مريض'],
      ['تخفيف الأعراض', 'اعراض'],
      ['اضطراب فرط الحركة', 'اضطراب'],
      ['طبيب جديد', 'طبيب'],
      ['جهاز طبي', 'طبي'],
      ['خارج المستشفى', 'مستشفى'],
      ['الشفاء التام', 'شفاء'],
      ['المعالج يزورك', 'معالج'],
      ['تشتت الانتباه', 'condition name'],
      ['مع القلق', 'condition name'],
      ['الاكتئاب', 'condition name'],
      ['الأرق ليلًا', 'condition name'],
      ['دكتور الأسرة', 'دكتور'],
      ['الدكتورة تزورك', 'دكتور'],
      ['مرض مزمن', 'مرض'],
      ['الأمراض الموسمية', 'مرض'],
      ['تجنب الانتكاس', 'انتكاس'],
    ] as const) {
      expect(wellnessWords(text).refused, text).toContain(term);
    }
  });

  it('is not slipped past by a diacritic, an elongation mark, a joiner or capitals', () => {
    for (const text of ['عِلَاج', 'علــــاج', 'تَشْخِيص', 'ther‌apy', 'DIAGNOSIS', 'أَعْراض']) {
      expect(wellnessWords(text).refused.length, text).toBeGreaterThan(0);
    }
  });
});

describe('wellnessWords: warnings', () => {
  it('warns, and does not refuse, on the ambiguous words', () => {
    for (const [text, term] of [
      ['A treat for Eid', 'treat'],
      ['Thank you for being patient', 'patient'],
      ['A new session protocol', 'protocol'],
      ['For your condition', 'condition'],
      ['الراحة النفسية', 'نفسي'],
      ['نعالج طلبك', 'عالج'],
    ] as const) {
      const found = wellnessWords(text);
      expect(found.refused, text).toEqual([]);
      expect(found.warnings, text).toContain(term);
    }
  });
});

describe('wellnessWords: ordinary words pass', () => {
  it('passes practice news in both languages', () => {
    for (const text of [
      'The studio is closed for Eid. Sessions resume on Monday.',
      'A new practitioner has joined the practice.',
      'Healthy routines, secure booking, and our new app.',
      'Terms and conditions apply.',
      'الاستوديو مغلق في العيد. تستأنف الجلسات يوم الاثنين.',
      'تطبيق جديد للحجز',
      'نتائج مرضية',
      'لا تقلق، الزيارة كما هي',
      'طبيعي',
    ]) {
      expect(wellnessWords(text), text).toEqual({ refused: [], warnings: [] });
    }
  });
});

describe("wellnessWords: no drift from the reports' list", () => {
  // The brain-map report's list (domain/reports/qeeg/testing/vocabulary.ts) is
  // the house's record of rule 1's words. Every stem on it is refused or
  // warned here too, so the two lists cannot drift apart unseen.
  const stems = (pattern: RegExp): string[] =>
    (/\(([^)]*)\)/.exec(pattern.source)?.[1] ?? '').split('|').filter(Boolean);

  it('reads the stems it checks, so it can never pass empty', () => {
    expect(stems(ENGLISH_STEMS).length).toBeGreaterThan(10);
    expect(stems(ARABIC_STEMS).length).toBeGreaterThan(10);
  });

  it('catches every English stem the reports refuse', () => {
    for (const stem of stems(ENGLISH_STEMS)) {
      const found = wellnessWords(`about ${stem}`);
      expect([...found.refused, ...found.warnings], stem).not.toEqual([]);
    }
  });

  it('catches every Arabic stem the reports refuse', () => {
    for (const stem of stems(ARABIC_STEMS)) {
      const found = wellnessWords(`عن ${stem}`);
      expect([...found.refused, ...found.warnings], stem).not.toEqual([]);
    }
  });
});
