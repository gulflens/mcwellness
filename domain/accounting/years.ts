import type { IsoDate } from '../shared';
import { addDays, isWithin } from './dates';
import type { FiscalYear } from './types';

/**
 * Financial years, the close and the lock date (docs/SPEC/accounting.md
 * section 4.4; rules 3, 4, 10, 11, 14). A year that has no row yet is open:
 * rows are created on demand by app.fiscal_year_for (migration 452), so their
 * absence says only that nothing has been posted there.
 */

export function yearContaining(day: IsoDate, years: readonly FiscalYear[]): FiscalYear | undefined {
  return years.find((year) => isWithin(day, year.startsOn, year.endsOn));
}

/** Rule 3. */
export function mayPostOn(
  day: IsoDate,
  years: readonly FiscalYear[],
  lockedThrough: IsoDate | null,
): boolean {
  if (lockedThrough !== null && day <= lockedThrough) {
    return false;
  }
  return yearContaining(day, years)?.status !== 'closed';
}

/**
 * Rule 4: the day itself when it may be posted on; otherwise the first day
 * after the lock that falls in an open year. Each step forward is either the
 * day after the lock or the day after a closed year's end, so it terminates.
 */
export function landingDayFor(
  occurredOn: IsoDate,
  years: readonly FiscalYear[],
  lockedThrough: IsoDate | null,
): IsoDate {
  let candidate = occurredOn;
  if (lockedThrough !== null && candidate <= lockedThrough) {
    candidate = addDays(lockedThrough, 1);
  }
  for (;;) {
    const year = yearContaining(candidate, years);
    if (year === undefined || year.status !== 'closed') {
      return candidate;
    }
    candidate = addDays(year.endsOn, 1);
  }
}

/** Rule 11. */
export function mayCloseYear(year: FiscalYear, today: IsoDate, unpostedInYear: number): boolean {
  return year.status === 'open' && year.endsOn <= today && unpostedInYear === 0;
}

/** Rule 10. */
export function mayChangeYearEnd(entryCount: number): boolean {
  return entryCount === 0;
}

/** Rule 14, first half. */
export function mayLockThrough(date: IsoDate, today: IsoDate): boolean {
  return date <= today;
}

export type LockMove = 'forward' | 'backward' | 'unchanged';

/** Rule 14, second half: which way the lock moved, so the route asks why and the feed says which. */
export function lockMove(current: IsoDate | null, next: IsoDate): LockMove {
  if (current === null || next > current) {
    return 'forward';
  }
  return next < current ? 'backward' : 'unchanged';
}
