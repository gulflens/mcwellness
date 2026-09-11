/**
 * How long a prepaid credit lasts, and when the practice says something about
 * it (docs/SPEC/billing.md section 4.3; the operator's ruling of 12 September
 * 2026, docs/superpowers/plans/2026-09-12-optional-terms.md).
 *
 * A term is optional. A programme or a price may carry one — a whole number
 * with a unit beside it — and where it carries none, the credits it sells
 * never expire. That is not a very long term: it is no date at all, written
 * as null, which is exactly what `app.oldest_available_entitlement` has
 * always read as "always valid".
 *
 * The warning thresholds are data, not a rule buried in a screen: the
 * numbers sit here as named constants, and the screens ask this file rather
 * than counting days themselves.
 *
 * Pure: no I/O, and "today" is always an argument (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';

/**
 * The two units the practice counts a term in. The catalogue holds the same
 * pair on `package` and on `price` (migration 412), and nothing else is
 * accepted at either end.
 */
export type ExpiryUnit = 'day' | 'month';

/**
 * A term as the catalogue carries it: a whole number with its unit beside it.
 * Never half a term — a number with no unit is the way this goes wrong, and
 * both the database and the drawer refuse it before it reaches here.
 */
export type ExpiryTerm = { amount: number; unit: ExpiryUnit };

/** The two moments the practice says something. Both counted in whole days remaining. */
export const EXPIRY_WARNING_DAYS = { first: 60, second: 30 } as const;

export type ExpiryWarning = 'none' | 'sixty_days' | 'thirty_days' | 'expired';

function parts(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year + month + day)
  ) {
    throw new RangeError(`Not a calendar date: "${date}".`);
  }
  return { year, month, day };
}

function format(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The number of days in a month, as the calendar has them. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The day a credit bought on `purchasedOn` stops being usable, or null when
 * it never does.
 *
 * A `null` term is the whole answer on its own: no term, no date, and every
 * caller writes null rather than inventing one.
 *
 * A term in **months** lands on the same day of the month, that many months
 * later. A day that does not exist in the target month (31 August plus six
 * months) falls back to that month's last day, which is the reading that
 * never gives the household less time than the calendar allows.
 *
 * A term in **days** is plain addition and nothing else: thirty days from 31
 * January is 2 March, because there is no shorter month for it to be pulled
 * back into.
 */
export function expiryOn(purchasedOn: IsoDate, term: ExpiryTerm | null): IsoDate | null {
  if (term === null) {
    return null;
  }
  const { amount, unit } = term;
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new RangeError(`A term is a whole number of ${unit}s, received ${amount}.`);
  }
  const { year, month, day } = parts(purchasedOn);
  if (unit === 'month') {
    const total = month - 1 + amount;
    const targetYear = year + Math.floor(total / 12);
    const targetMonth = (total % 12) + 1;
    return format(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
  }
  if (unit === 'day') {
    const at = new Date(Date.UTC(year, month - 1, day + amount));
    return format(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
  }
  throw new RangeError(`A term is counted in days or in months, not in "${String(unit)}".`);
}

/** Whole days from `from` to `to`; negative when `to` is the earlier day. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parts(from);
  const b = parts(to);
  const msPerDay = 86_400_000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / msPerDay,
  );
}

/**
 * What the practice should say about an expiry date today. `expiresOn` is
 * inclusive: a package expiring today is still usable today, and expired
 * tomorrow. A credit with no expiry date never warns.
 */
export function expiryWarningFor(expiresOn: IsoDate | null, today: IsoDate): ExpiryWarning {
  if (expiresOn === null) {
    return 'none';
  }
  const remaining = daysBetween(today, expiresOn);
  if (remaining < 0) {
    return 'expired';
  }
  if (remaining <= EXPIRY_WARNING_DAYS.second) {
    return 'thirty_days';
  }
  if (remaining <= EXPIRY_WARNING_DAYS.first) {
    return 'sixty_days';
  }
  return 'none';
}

/** True while the credit may still be used: no expiry date, or one not yet past. */
export function isUsableOn(expiresOn: IsoDate | null, today: IsoDate): boolean {
  return expiresOn === null || daysBetween(today, expiresOn) >= 0;
}
