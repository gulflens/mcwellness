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
 * The Arabic forms, per unit. The language counts one, two, three-to-ten and
 * eleven-upwards differently, so each unit needs all four; the two units are
 * written out side by side rather than assembled from fragments, because a
 * reader of this file should be able to see every word the practice puts on a
 * document.
 */
const WORDS = {
  month: {
    one: 'شهر واحد',
    two: 'شهران',
    /** Three to ten: the plural of paucity. */
    few: (amount: number) => `${amount} أشهر`,
    /** Eleven upwards: the singular in the accusative. */
    many: (amount: number) => `${amount} شهرًا`,
    en: (amount: number) => (amount === 1 ? '1 month' : `${amount} months`),
  },
  day: {
    one: 'يوم واحد',
    two: 'يومان',
    few: (amount: number) => `${amount} أيام`,
    many: (amount: number) => `${amount} يومًا`,
    en: (amount: number) => (amount === 1 ? '1 day' : `${amount} days`),
  },
} as const;

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
  const ar =
    amount === 1
      ? words.one
      : amount === 2
        ? words.two
        : amount <= 10
          ? words.few(amount)
          : words.many(amount);
  return { en: words.en(amount), ar };
}
