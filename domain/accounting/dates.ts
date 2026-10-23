import type { IsoDate } from '../shared';

/**
 * Calendar arithmetic on YYYY-MM-DD strings. Every function is pure and reads
 * no clock. ISO dates compare correctly as strings, which the statements rely
 * on throughout; nothing here ever constructs a local-time Date.
 */

function parts(day: IsoDate): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new RangeError(`Not a YYYY-MM-DD date: ${day}`);
  }
  return [y, m, d];
}

export function isoDateOf(year: number, month: number, dayOfMonth: number): IsoDate {
  return new Date(Date.UTC(year, month - 1, dayOfMonth)).toISOString().slice(0, 10);
}

export function addDays(day: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(day);
  return isoDateOf(y, m, d + days);
}

export function yearOf(day: IsoDate): number {
  return parts(day)[0];
}

/** Inclusive at both ends. */
export function isWithin(day: IsoDate, startsOn: IsoDate, endsOn: IsoDate): boolean {
  return day >= startsOn && day <= endsOn;
}

/**
 * The financial year containing `day` for a practice whose year ends on
 * `yearEndMonth`/`yearEndDay` (docs/SPEC/accounting.md section 4.4): the end
 * is the first such month-day on or after `day`; the start is the day after
 * the previous year end.
 */
export function yearBoundsContaining(
  day: IsoDate,
  yearEndMonth: number,
  yearEndDay: number,
): { startsOn: IsoDate; endsOn: IsoDate } {
  let endsOn = isoDateOf(yearOf(day), yearEndMonth, yearEndDay);
  if (endsOn < day) {
    endsOn = isoDateOf(yearOf(day) + 1, yearEndMonth, yearEndDay);
  }
  const startsOn = addDays(isoDateOf(yearOf(endsOn) - 1, yearEndMonth, yearEndDay), 1);
  return { startsOn, endsOn };
}

/**
 * The period the statements and an account's ledger open on before anyone
 * picks dates: the financial year that contains `today`, to `today` — never
 * the calendar year, so a practice with a 30 June year end is not shown half
 * of two years. `today` is the practice's own day (Asia/Dubai), not UTC's.
 */
export function defaultStatementPeriod(
  today: IsoDate,
  yearEndMonth: number,
  yearEndDay: number,
): { from: IsoDate; to: IsoDate } {
  // Year to date, as the statements' own route defaults (app/api/accounting/
  // statements.ts): a balance sheet is never dated after today.
  return { from: yearBoundsContaining(today, yearEndMonth, yearEndDay).startsOn, to: today };
}
