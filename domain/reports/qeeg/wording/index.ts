/**
 * The door to the brain-map report's fixed wording.
 *
 * **A report prints the words it was signed with.** The words live in a file
 * per version (`v1.ts`), a stored report records which version it was written
 * against, and a version that has been approved is never edited: a sentence
 * that needs altering is altered in the next file. Without that, mending a
 * sentence would silently change every report already in a household's hands,
 * and the check that a signed report re-renders to the bytes it was filed as
 * (`app/api/reports/get.ts`) would refuse them all.
 *
 * **One sentence, two editions.** Most wording is the same in a first report
 * and a follow-up. Where it differs, the entry says so, and `phrase` is asked
 * which edition it is printing for. A sentence that belongs to one edition is
 * refused to the other by name, because a missing sentence must fail at the
 * practitioner's desk and never print as a blank on a household's page.
 *
 * **Draft until approved, language by language.** `WORDING_STATUS` is what the
 * issue route reads before it signs. It is a constant and not a setting: the
 * approval is a person's, given once, and the pull request that carries the
 * approved text is what turns it over. A column would let a screen do it.
 *
 * Pure and browser-safe: the editor shows a practitioner the same sentences
 * the page will print.
 */

import { V1 } from './v1';

export type Locale = 'en' | 'ar';
export type Edition = 'initial' | 'follow-up';
export type Phrase = { readonly en: string; readonly ar: string };

/** Where a sentence belongs: both editions, each in its own words, or one only. */
export type Entry =
  | { readonly both: Phrase }
  | { readonly initial: Phrase; readonly followUp: Phrase }
  | { readonly initial: Phrase }
  | { readonly followUp: Phrase };

export const WORDING_VERSION = 1;

export const WORDING: Readonly<Record<string, Entry>> = V1;

/**
 * Whether a person has approved the words, per language. See
 * `wording.test.ts`, "who has approved it": changing this is the act of
 * approval, and the test is there so that it is never done in passing.
 */
export const WORDING_STATUS: Readonly<Record<Locale, 'draft' | 'approved'>> = Object.freeze({
  en: 'draft',
  ar: 'draft',
});

/** Every key, in the order the file holds them. */
export function keysOf(): string[] {
  return Object.keys(WORDING);
}

function phraseFor(entry: Entry, edition: Edition): Phrase | undefined {
  if ('both' in entry) return entry.both;
  const parts = entry as { initial?: Phrase; followUp?: Phrase };
  return edition === 'initial' ? parts.initial : parts.followUp;
}

/** The sentence for a key, in the edition and the language asked for. */
export function phrase(key: string, edition: Edition, locale: Locale): string {
  const entry = WORDING[key];
  if (!entry) throw new Error(`The wording holds no sentence named ${key}.`);
  const found = phraseFor(entry, edition);
  if (!found) {
    throw new Error(`The sentence ${key} does not belong to the ${edition} report.`);
  }
  return found[locale];
}

/**
 * Fills the gaps in a sentence. A gap nobody filled is refused: a brace on a
 * household's page is worse than an error at the practitioner's desk.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Nothing was given for ${name} in "${template}".`);
    }
    return String(value);
  });
}
