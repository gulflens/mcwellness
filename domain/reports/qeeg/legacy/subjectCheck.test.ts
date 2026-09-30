import { describe, expect, it } from 'vitest';
import { LEGACY_NAME } from '../testing/legacyFile';
import { subjectDisagreements, type RecordFacts } from './subjectCheck';

/**
 * Whether the person the old file typed is the client she chose
 * (docs/SPEC/reports-qeeg.md section 11, point 2). The file's words are shown
 * beside the record's and never stored; this says where they disagree.
 */

const [GIVEN = '', FAMILY = ''] = LEGACY_NAME.en.split(' ');
const [GIVEN_AR = '', FAMILY_AR = ''] = LEGACY_NAME.ar.split(' ');

const RECORD: RecordFacts = {
  givenName: GIVEN,
  familyName: FAMILY,
  givenNameAr: GIVEN_AR,
  familyNameAr: FAMILY_AR,
  dateOfBirth: '1991-08-01',
  sexAtBirth: 'female',
};

const TYPED = { name: LEGACY_NAME.en, nameAr: LEGACY_NAME.ar, age: '34', sex: 'Female' };

describe('the file’s person beside the chosen client', () => {
  it('finds nothing to warn of when the file and the record agree', () => {
    expect(subjectDisagreements(TYPED, RECORD, '2026-03-14')).toEqual([]);
  });

  it('reads a name the same whatever its case and spacing', () => {
    const typed = { ...TYPED, name: `  ${LEGACY_NAME.en.toUpperCase()} ` };
    expect(subjectDisagreements(typed, RECORD, '2026-03-14')).toEqual([]);
  });

  it('warns of a name, an Arabic name, an age and a sex that are not the record’s', () => {
    const typed = { name: 'Amber Bay', nameAr: 'عنبر خليج', age: '40', sex: 'Male' };
    expect(subjectDisagreements(typed, RECORD, '2026-03-14')).toEqual([
      'name',
      'nameAr',
      'age',
      'sex',
    ]);
  });

  it('counts the age on the day of the recording, not today', () => {
    // Born 1 August 1991: 34 on 14 March 2026, 35 from 1 August 2026.
    expect(subjectDisagreements(TYPED, RECORD, '2026-08-02')).toEqual(['age']);
    expect(subjectDisagreements({ ...TYPED, age: '35 years' }, RECORD, '2026-08-02')).toEqual([]);
  });

  it('asks nothing of what the file left blank or the record does not hold', () => {
    expect(
      subjectDisagreements({ name: '', nameAr: '', age: '', sex: '' }, RECORD, '2026-03-14'),
    ).toEqual([]);
    const bare: RecordFacts = {
      ...RECORD,
      givenNameAr: null,
      familyNameAr: null,
      dateOfBirth: null,
      sexAtBirth: 'unknown',
    };
    expect(subjectDisagreements(TYPED, bare, '2026-03-14')).toEqual([]);
  });

  it('warns of an age or a sex it cannot read, rather than passing it', () => {
    expect(
      subjectDisagreements({ ...TYPED, age: 'thirty', sex: 'X' }, RECORD, '2026-03-14'),
    ).toEqual(['age', 'sex']);
  });

  it('reads the Arabic words for female and male the old tool offered', () => {
    expect(subjectDisagreements({ ...TYPED, sex: 'أنثى' }, RECORD, '2026-03-14')).toEqual([]);
    expect(subjectDisagreements({ ...TYPED, sex: 'ذكر' }, RECORD, '2026-03-14')).toEqual(['sex']);
  });
});
