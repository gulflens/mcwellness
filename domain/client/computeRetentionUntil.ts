import type { IsoDate } from '../shared/actor';

const RETENTION_YEARS = 5;

/** The number of days in a given year and (one-indexed) calendar month. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the month after `month` (0-indexed) is the last day of `month` (1-indexed).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Five years on from a date, by calendar arithmetic rather than a millisecond
 * offset, so leap years land correctly: a 29 February retention date becomes
 * 28 February when the fifth year is not itself a leap year, never 1 March
 * (docs/SPEC/client-record.md rule 7, docs/SPEC/00-data-model.md section 7).
 */
export function computeRetentionUntil(lastActivityAt: IsoDate): IsoDate {
  const [year, month, day] = lastActivityAt.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year + month + day)
  ) {
    throw new Error('Bad date.');
  }

  const targetYear = year + RETENTION_YEARS;
  const targetDay = Math.min(day, daysInMonth(targetYear, month));
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}
