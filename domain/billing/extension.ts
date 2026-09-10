import type { IsoDate } from '../shared';
import { expiryOn } from './expiry';

/**
 * An extension is always exactly three months from the current end, and a
 * programme may have two — so it runs twelve months at most, the ceiling it
 * had before this round, reached only by asking (docs/PLAN/package-terms.md,
 * defaults 1 and 2). The count is the database's to keep (migration 410);
 * this is the arithmetic the route and the drawer both read.
 */
export const EXTENSION_MONTHS = 3;
export const MAX_EXTENSIONS = 2;

export type Extension = { ordinal: 1 | 2; fromOn: IsoDate; toOn: IsoDate };

/**
 * The extension a programme would get next, or null when it has had its two.
 * `currentEnd` is the end as it stands today (the last extension's end, or
 * the sale's); `used` is how many extensions it already has.
 */
export function nextExtension(currentEnd: IsoDate, used: number): Extension | null {
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new RangeError(`A count of extensions is a whole number, received ${used}.`);
  }
  if (used >= MAX_EXTENSIONS) {
    return null;
  }
  return {
    ordinal: (used + 1) as 1 | 2,
    fromOn: currentEnd,
    toOn: expiryOn(currentEnd, EXTENSION_MONTHS),
  };
}

/**
 * A term's length in words, for the sale and the invoice line. Arabic counts
 * one, two, three to ten and eleven upwards differently; the practice's own
 * terms are six and, until this round, twelve.
 */
export function termWords(months: number): { en: string; ar: string } {
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new RangeError(`A term is a whole number of months, received ${months}.`);
  }
  const en = months === 1 ? '1 month' : `${months} months`;
  const ar =
    months === 1
      ? 'شهر واحد'
      : months === 2
        ? 'شهران'
        : months <= 10
          ? `${months} أشهر`
          : `${months} شهرًا`;
  return { en, ar };
}
