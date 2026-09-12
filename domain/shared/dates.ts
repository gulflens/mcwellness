import type { IsoDate } from './actor';
import { toLatinDigits } from './emirates-id';

/** Whole years between a date of birth and a day, as a person would count them. Pure. */
export function ageOn(dateOfBirth: IsoDate, today: IsoDate): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (by === undefined || bm === undefined || bd === undefined || Number.isNaN(by + bm + bd)) {
    throw new Error('Bad date of birth.');
  }
  if (ty === undefined || tm === undefined || td === undefined || Number.isNaN(ty + tm + td)) {
    throw new Error('Bad date.');
  }
  const before = tm < bm || (tm === bm && td < bd);
  return ty - by - (before ? 1 : 0);
}

const DATE_DIGITS = 8;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Every digit in the input, Arabic-Indic folded, capped at the eight a date has. */
function dateDigitsOf(input: string): string {
  return toLatinDigits(input)
    .replace(/[^0-9]/g, '')
    .slice(0, DATE_DIGITS);
}

/**
 * The typed form, grouped as far as the digits reach: `12`, `12/0`, `12/09/1988`.
 * Total — it never throws, because it formats a date that is still being typed.
 */
export function groupDateDigits(input: string): string {
  const d = dateDigitsOf(input);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Whether the calendar actually has that day, leap years included. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= limit;
}

/** `12/09/1988` to `1988-09-12`, and null while it is incomplete or impossible. */
export function isoFromDisplay(display: string): string | null {
  const d = dateDigitsOf(display);
  if (d.length !== DATE_DIGITS) return null;
  const day = Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const year = Number(d.slice(4));
  if (!isRealDate(year, month, day)) return null;
  return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
}

/** `1988-09-12` to `12/09/1988`. An empty value stays empty. */
export function displayFromIso(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}
