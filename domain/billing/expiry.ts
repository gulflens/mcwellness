/**
 * When a prepaid package runs out of time, and when to say so
 * (docs/SPEC/billing.md section 4.3; the operator's decision 9 of
 * 2026-09-10, docs/PLAN/package-terms.md: a programme runs six months from
 * purchase, extendable twice by exactly three months each with a reason;
 * warnings at sixty and thirty days). The extension's arithmetic lives
 * beside this file, in `extension.ts`.
 *
 * The warning thresholds are data, not a rule buried in a screen: the
 * numbers sit here as named constants, and the screens ask this file rather
 * than counting days themselves.
 *
 * Pure: no I/O, and "today" is always an argument (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';

/** Six months from purchase — the operator's decision 9 of 2026-09-10 (docs/PLAN/package-terms.md); twelve until then. The package row carries its own term; this is the default a new one takes. */
export const DEFAULT_EXPIRY_MONTHS = 6;

/**
 * How long a session sold on its own can be used: twelve months from the day
 * it was bought. Fixed, not read from a package's own term — a single credit
 * has no package behind it to take a term from, and package terms are free to
 * move (they did, from twelve months to six, in the operator's decision 9
 * above) without pulling a one-off sale's expiry along with them. The
 * operator's decision of 10 September 2026 to sell one session ahead of its
 * visit set this figure at twelve months
 * (.superpowers/sdd/2026-09-10-walk-fixes-3-sell-session/task-2-brief.md).
 */
export const SINGLE_SESSION_MONTHS = 12;

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
 * The day a package bought on `purchasedOn` stops being usable: the same day
 * of the month, `months` later. A day that does not exist in the target month
 * (31 August plus six months) falls back to that month's last day, which is
 * the reading that never gives the client less time than the calendar allows.
 */
export function expiryOn(purchasedOn: IsoDate, months: number): IsoDate {
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new RangeError(`An expiry period must be a whole number of months, received ${months}.`);
  }
  const { year, month, day } = parts(purchasedOn);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return format(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
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
