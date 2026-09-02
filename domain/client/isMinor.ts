import { ageOn } from '../shared/dates';
import type { IsoDate } from '../shared/actor';

const MINOR_AGE_LIMIT = 18;

/** True while the client has not yet turned eighteen on `atDate` (docs/SPEC/client-record.md rule 2). */
export function isMinor(dateOfBirth: IsoDate, atDate: IsoDate): boolean {
  return ageOn(dateOfBirth, atDate) < MINOR_AGE_LIMIT;
}
