/**
 * A term in words, for the sale drawers and the invoice line.
 *
 * This is not expiry arithmetic — `expiry.ts` counts the days — and it is not
 * extension arithmetic either, though it lived in `extension.ts` until that
 * file was deleted with the feature (the controller's ruling of 12 September
 * 2026, .superpowers/sdd/2026-09-12-optional-terms/progress.md). It does one
 * thing: says how long a programme or a session runs, in the two languages
 * the practice writes documents in.
 *
 * **A termless sale is worded as nothing at all.** Null in, null out, and the
 * caller prints no term rather than a sentence about not having one: an
 * invoice for credits that never expire simply names what was bought
 * (docs/superpowers/plans/2026-09-12-optional-terms.md).
 *
 * Pure: no I/O, no clock (.claude/rules/testing.md).
 */

import type { ExpiryTerm } from './expiry';

/**
 * The Arabic forms, per unit. The language counts one, two, a few and many
 * differently, and from a hundred upward it agrees with the number's last two
 * digits rather than with the whole of it — so each unit needs five forms, not
 * four. The two units are written out side by side rather than assembled from
 * fragments, because a reader of this file should be able to see every word
 * the practice puts on a document.
 */
const WORDS = {
  month: {
    one: 'شهر واحد',
    two: 'شهران',
    /** Last two digits three to ten: the plural of paucity. */
    few: (amount: number) => `${amount} أشهر`,
    /** Last two digits eleven to ninety-nine: the singular in the accusative. */
    many: (amount: number) => `${amount} شهرًا`,
    /** An exact hundred, or one or two above one: the singular in the genitive. */
    hundred: (amount: number) => `${amount} شهر`,
    en: (amount: number) => (amount === 1 ? '1 month' : `${amount} months`),
  },
  day: {
    one: 'يوم واحد',
    two: 'يومان',
    few: (amount: number) => `${amount} أيام`,
    many: (amount: number) => `${amount} يومًا`,
    hundred: (amount: number) => `${amount} يوم`,
    en: (amount: number) => (amount === 1 ? '1 day' : `${amount} days`),
  },
} as const;

/**
 * Which of the five forms an amount takes, the same for either unit so the two
 * cannot drift apart.
 *
 * One and two have words of their own. Past them the form follows the last two
 * digits: three to ten take the plural (`103 أيام`), eleven to ninety-nine the
 * accusative singular (`365 يومًا`), and what is left — an exact hundred, or a
 * hundred and one or two — the genitive singular (`100 يوم`). A term in days
 * runs to 1,825, so this is a document's everyday case; a term in months stops
 * at sixty and never reaches it, and follows the same rule regardless.
 */
function arabicForm(amount: number): 'one' | 'two' | 'few' | 'many' | 'hundred' {
  if (amount === 1) {
    return 'one';
  }
  if (amount === 2) {
    return 'two';
  }
  const lastTwo = amount % 100;
  if (lastTwo >= 3 && lastTwo <= 10) {
    return 'few';
  }
  if (lastTwo >= 11) {
    return 'many';
  }
  return 'hundred';
}

/**
 * A term's length in words, or null when there is no term.
 *
 * Refuses an amount that is not a whole number of one or more, and a unit the
 * practice does not count in — the second is unreachable from typed code and
 * guards a row read out of the database, where a loud refusal is better than
 * quietly wording a term nobody could honour.
 */
export function termWords(term: ExpiryTerm | null): { en: string; ar: string } | null {
  if (term === null) {
    return null;
  }
  const { amount, unit } = term;
  const words = WORDS[unit];
  if (words === undefined) {
    throw new RangeError(`A term is counted in days or in months, not in "${String(unit)}".`);
  }
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new RangeError(`A term is a whole number of ${unit}s, received ${amount}.`);
  }
  const form = arabicForm(amount);
  const ar = form === 'one' ? words.one : form === 'two' ? words.two : words[form](amount);
  return { en: words.en(amount), ar };
}
