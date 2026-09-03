import type { Emirate } from '../../api/practice/schema';

/**
 * The seven emirates as a person reads them. The codes themselves are the
 * Postgres `emirate` enum (030_location.sql) and never appear on screen: a
 * settings form asking somebody to choose "AUH" is a form written for the
 * database rather than for the person filling it in.
 */
export const EMIRATE_LABELS: Record<Emirate, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};
