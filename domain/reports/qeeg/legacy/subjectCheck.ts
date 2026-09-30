/**
 * Where the person an old report file typed disagrees with the client she
 * chose to bring it in against (docs/SPEC/reports-qeeg.md section 11, point
 * 2).
 *
 * **A warning, never a gate, and never stored.** The old tool typed a name,
 * an age and a sex by hand; this app gathers them from the client's record.
 * The screen shows the file's words beside the record's, and warns where they
 * disagree, so a file kept against the wrong client is caught before it is
 * kept. What she decides is hers: a name spelt differently in the old tool is
 * still the same person. Nothing here is sent: the file's words stay in the
 * browser.
 *
 * **What is compared.** The name, as the record's given and family names
 * joined, whatever its case and spacing; the Arabic name the same way; the
 * age, counted on the day of the recording (or today, when the file gives no
 * day) from the record's date of birth, as the report's own head counts it;
 * and the sex, read from the old tool's English or Arabic word. A part the
 * file left blank, or the record does not hold, is not compared. A part the
 * file filled with something this cannot read is a disagreement: a warning
 * about a word it could not read is better than a silence about a person it
 * could not check.
 *
 * Pure: no clock (`on` is handed in) and no I/O.
 */

import { ageOn } from '../../../shared/dates';
import type { AsTyped } from './read';

/** The record's facts the file is compared with. */
export type RecordFacts = {
  readonly givenName: string;
  readonly familyName: string;
  readonly givenNameAr: string | null;
  readonly familyNameAr: string | null;
  /** `YYYY-MM-DD`, or none on file. */
  readonly dateOfBirth: string | null;
  readonly sexAtBirth: 'female' | 'male' | 'unknown' | null;
};

export type Disagreement = 'name' | 'nameAr' | 'age' | 'sex';

/** A name as a person would read it: its letters, one space between words, any case. */
function nameOf(parts: readonly (string | null)[]): string {
  return parts
    .filter((part): part is string => part !== null)
    .join(' ')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const FEMALE = new Set(['female', 'f', 'woman', 'girl', 'أنثى', 'انثى']);
const MALE = new Set(['male', 'm', 'man', 'boy', 'ذكر']);

function sexOf(word: string): 'female' | 'male' | null {
  const said = word.normalize('NFC').trim().toLowerCase();
  if (FEMALE.has(said)) return 'female';
  if (MALE.has(said)) return 'male';
  return null;
}

/** The whole years the file typed: "34", "34 years", "34y". */
function yearsOf(word: string): number | null {
  const found = /^\s*(\d{1,3})\s*(?:y|yr|yrs|year|years)?\s*$/i.exec(word);
  return found?.[1] === undefined ? null : Number(found[1]);
}

/**
 * Which of the file's name, Arabic name, age and sex disagree with the
 * record, in that order. `on` is the day of the recording, or today.
 */
export function subjectDisagreements(
  typed: Pick<AsTyped, 'name' | 'nameAr' | 'age' | 'sex'>,
  record: RecordFacts,
  on: string,
): Disagreement[] {
  const found: Disagreement[] = [];

  const name = nameOf([typed.name]);
  if (name !== '' && name !== nameOf([record.givenName, record.familyName])) found.push('name');

  const nameAr = nameOf([typed.nameAr]);
  const recordAr = nameOf([record.givenNameAr, record.familyNameAr]);
  if (nameAr !== '' && recordAr !== '' && nameAr !== recordAr) found.push('nameAr');

  if (typed.age.trim() !== '' && record.dateOfBirth !== null) {
    const years = yearsOf(typed.age);
    if (years === null || years !== ageOn(record.dateOfBirth, on)) found.push('age');
  }

  if (typed.sex.trim() !== '' && (record.sexAtBirth === 'female' || record.sexAtBirth === 'male')) {
    if (sexOf(typed.sex) !== record.sexAtBirth) found.push('sex');
  }

  return found;
}
