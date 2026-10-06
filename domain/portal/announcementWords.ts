/**
 * The words an announcement may not say, and the ones it may say only on
 * purpose (CLAUDE.md rule 1; the push memo's decision 3, "no medical claim,
 * ever"; docs/SPEC/client-portal.md section 5, rule 10, as amended in round
 * 72's fix round).
 *
 * **Made for announcements, and owned here.** The first build borrowed the
 * brain-map report's list, which was written to check fixed sentences a
 * developer wrote, and it both refused ordinary words a practice types
 * ("thank you for being patient", "بنفسي") and missed the words an offer
 * would use to make a claim ("healing", "doctor", "ADHD"). The review of
 * round 72 (finding 5.1) asked for a list of the portal's own, in three parts:
 *
 * - **Refused**: words that are clinical in every ordinary use, and the names
 *   of conditions, in English and Arabic. An announcement carrying one is not
 *   published.
 * - **Warned**: words that are clinical in one sense and ordinary in another —
 *   treat, patient, protocol, "your condition", نفسي, and the Arabic verb
 *   "to treat". The writer confirms at preview that the word is not a medical
 *   claim, and the confirmation goes on the trail with the publication.
 * - **Normalised first**: case is folded, and the Arabic diacritics, the
 *   elongation mark (tatweel) and the invisible joiners are dropped, and the
 *   letter forms folded (أ إ آ ٱ to ا, ى to ي), so none of them slips a word
 *   past.
 *
 * Pure. The terms answered are the list's own labels, never the writer's
 * text, so a finding can go on the trail without carrying what was typed.
 */

// Diacritics (U+064B to U+065F), the superscript alef (U+0670), the tatweel
// (U+0640), the zero-width space and joiners (U+200B to U+200D), the word
// joiner (U+2060), the byte-order mark (U+FEFF) and the soft hyphen (U+00AD).
// Built from code points, as app/api/_middleware/text.ts does, so this file
// holds none of the characters it removes.
const cp = (n: number): string => String.fromCodePoint(n);
const INVISIBLE = new RegExp(
  `[${cp(0x064b)}-${cp(0x065f)}${cp(0x0670)}${cp(0x0640)}${cp(0x200b)}-${cp(0x200d)}${cp(0x2060)}${cp(0xfeff)}${cp(0x00ad)}]`,
  'g',
);

export function normaliseForCheck(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

/** An Arabic word standing on its own, with the prefixes a word takes. */
const ARABIC_LETTER = '\\u0600-\\u06FF';
function arabicWord(core: string, prefixes = '(?:و|ف|ب|ل|ال|وال|بال|لل|فال)?'): RegExp {
  return new RegExp(`(^|[^${ARABIC_LETTER}])${prefixes}${core}(?![${ARABIC_LETTER}])`);
}
/** The same, where the word is only the condition's name with the article. */
const withArticle = '(?:و|ب|ف)?(?:ال|لل)';

type Term = { term: string; pattern: RegExp };

const REFUSED: readonly Term[] = [
  { term: 'diagnos', pattern: /\bdiagnos/ },
  { term: 'prescri', pattern: /\bprescri/ },
  { term: 'clinic', pattern: /\bclinic/ },
  { term: 'therap', pattern: /\btherap/ },
  { term: 'disorder', pattern: /\bdisorders?\b/ },
  { term: 'disease', pattern: /\bdiseases?\b/ },
  { term: 'symptom', pattern: /\bsymptom/ },
  { term: 'cure', pattern: /\bcur(?:e|es|ed|ing|ative)\b/ },
  { term: 'heal', pattern: /\bheal(?:s|ed|ing|er|ers)?\b/ },
  { term: 'doctor', pattern: /\bdoctors?\b|\bdr\b/ },
  { term: 'hospital', pattern: /\bhospital/ },
  { term: 'medical', pattern: /\bmedic(?:al|ally|ine|ines|ation|ations)\b/ },
  { term: 'illness', pattern: /\billness/ },
  {
    term: 'condition name',
    pattern:
      /\b(?:adhd|add\/adhd|autism|autistic|asperger|anxiety|depression|depressive|insomnia|ocd|ptsd|dyslexia|dyspraxia|epilepsy|epileptic|bipolar|schizophrenia|dementia|alzheimer|migraines?|concussion)\b/,
  },
  { term: 'تشخيص', pattern: /تشخيص|يشخص|نشخص/ },
  { term: 'عيادة', pattern: /عياد(?:ة|ات)/ },
  { term: 'علاج', pattern: /علاج/ },
  { term: 'مريض', pattern: /مريض|مرضي(?=$|[^؀-ۿ])/ },
  { term: 'اعراض', pattern: /اعراض/ },
  { term: 'اضطراب', pattern: /اضطراب/ },
  { term: 'دواء', pattern: /دواء|ادوية/ },
  { term: 'طبيب', pattern: /طبيب|اطباء/ },
  { term: 'طبي', pattern: arabicWord('طبي(?:ة)?') },
  { term: 'مستشفى', pattern: /مستشفي|مستشفيات/ },
  { term: 'شفاء', pattern: /شفاء|يشفي/ },
  { term: 'سريري', pattern: /سريري/ },
  { term: 'معالج', pattern: arabicWord('معالج(?:ون|ين|ك|ه|ها)?') },
  { term: 'دكتور', pattern: arabicWord('دكتور(?:ة|ه)?') },
  { term: 'مرض', pattern: arabicWord('(?:مرض|امراض)') },
  { term: 'انتكاس', pattern: arabicWord('انتكاس(?:ة)?') },
  {
    term: 'condition name',
    pattern: new RegExp(
      [
        'فرط الحركة',
        'تشتت الانتباه',
        'اكتئاب',
        'زهايمر',
        'صداع نصفي',
        arabicWord('توحد', withArticle).source,
        arabicWord('قلق', withArticle).source,
        arabicWord('ارق', withArticle).source,
        arabicWord('صرع', withArticle).source,
        arabicWord('خرف', withArticle).source,
      ].join('|'),
    ),
  },
];

const WARNED: readonly Term[] = [
  { term: 'treat', pattern: /\btreat(?:s|ed|ing|ment|ments)?\b/ },
  { term: 'patient', pattern: /\bpatients?\b/ },
  { term: 'protocol', pattern: /\bprotocols?\b/ },
  { term: 'condition', pattern: /\b(?:your|his|her|their|my|a|this|the child's) conditions?\b/ },
  { term: 'نفسي', pattern: /نفسي/ },
  { term: 'عالج', pattern: /[ينت]عالج|عولج/ },
];

export type WellnessFindings = { refused: string[]; warnings: string[] };

function matching(terms: readonly Term[], text: string): string[] {
  const found: string[] = [];
  for (const { term, pattern } of terms) {
    if (pattern.test(text) && !found.includes(term)) found.push(term);
  }
  return found;
}

/** What a text says that an announcement may not, or may only on purpose. */
export function wellnessWords(text: string): WellnessFindings {
  // "طبيعي" (natural, normal) begins with the letters of "طبي" and is not it.
  const normal = normaliseForCheck(text).replaceAll('طبيع', '');
  return { refused: matching(REFUSED, normal), warnings: matching(WARNED, normal) };
}
