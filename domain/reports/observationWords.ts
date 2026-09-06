import type { ReportLocale } from './types';

/**
 * The structured observations a visit recorded, in words a household reads
 * (docs/SPEC/reports-v1.md section 5).
 *
 * **Quoted, not imported.** The keys are the session module's
 * (`domain/session/events.ts`, `OBSERVATION_CHIPS`), and `OWNERSHIP.md` rule 3
 * forbids one module importing another module's `domain/` — so they are
 * restated here, the same discipline the brain-map columns are read with. A
 * key this file does not know is dropped rather than printed raw: a household
 * reading "irritability_2" would be reading a database, not a report.
 *
 * The words are the practice's own, in both languages, because a report's
 * fixed vocabulary prints in the locale the narrative was written in.
 */
const WORDS: Record<string, Record<ReportLocale, string>> = {
  none: { en: 'Nothing to note', ar: 'لا شيء يُذكر' },
  headache: { en: 'Headache', ar: 'صداع' },
  fatigue: { en: 'Fatigue', ar: 'إرهاق' },
  irritability: { en: 'Irritability', ar: 'انفعال' },
  other: { en: 'Something else', ar: 'شيء آخر' },
};

/** The chips a visit recorded, in words, in the report's own language. */
export function observationWords(
  chips: readonly unknown[],
  locale: ReportLocale,
): readonly string[] {
  const said: string[] = [];
  for (const chip of chips) {
    if (typeof chip !== 'string') continue;
    const word = WORDS[chip]?.[locale];
    if (word !== undefined && !said.includes(word)) said.push(word);
  }
  return said;
}
