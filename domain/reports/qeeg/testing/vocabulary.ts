/**
 * The words of another kind of practice, by stem, in English and in Arabic:
 * what no sentence of the brain-map report may say (CLAUDE.md rule 1).
 *
 * **For tests only.** Two guards hold a report to these lists: the wording's
 * (`wording/wording.test.ts`), which reads every fixed sentence, and the
 * pages' (`tests/reports/qeeg-pages.test.ts`), which reads every word a
 * rendered report draws. One list, so the two can never disagree about
 * which words they are looking for. A test file cannot be imported by
 * another without running its tests twice, so the lists live here, as
 * `drawsNothing.ts` does. Nothing outside a test imports it.
 *
 * `legacy/vocabulary.test.ts` lets off the lines of this file that hold a
 * pattern, and holds every other line, these comments included.
 */

export const ENGLISH_STEMS =
  /\b(patient|treat|therap|cure|symptom|clinic|diagnos|protocol|prescri|disorder|disease|medical|medicine|illness)/i;

/** The same ideas in Arabic, by stem. */
export const ARABIC_STEMS =
  /(مريض|مرضى|علاج|سريري|عيادة|أعراض|تشخيص|اضطراب|شفاء|دواء|طبي|يعالج|نعالج|تعالج|عولج|نفسي|انتكاس)/;

/**
 * The one who works in another kind of practice, as a whole word. "معالجة"
 * is the ordinary Arabic for processing, as in "معالجة المعلومات", and is a
 * different word that happens to begin the same way; it ends in a letter
 * this pattern does not allow.
 */
export const ARABIC_WHOLE_WORD = /(^|[^؀-ۿ])(ال|و|وال|لل|بال)?معالج(ك|ه|ها|ين|ون)?(?![؀-ۿ])/;

/**
 * "طبيعي", "الطبيعية" and "بطبيعته" (natural, normal, by its nature) begin
 * with the letters of a word on the Arabic list, and are not it: the limits
 * a band is measured against are "normal limits".
 */
export const withoutNatural = (text: string): string => text.replaceAll('طبيع', '');

/** Whether a text says a word of another kind of practice, in either language. */
export function speaksOfAnotherPractice(text: string): boolean {
  return (
    ENGLISH_STEMS.test(text) ||
    ARABIC_STEMS.test(withoutNatural(text)) ||
    ARABIC_WHOLE_WORD.test(text)
  );
}
