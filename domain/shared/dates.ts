import type { IsoDate } from './actor';

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
