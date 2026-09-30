import { describe, expect, it } from 'vitest';
import { IMPORT_NOTE_CODES } from '../../../../domain/reports/qeeg/types';
import {
  IMPORT_REFUSALS,
  noteSentence,
  PAST_RECORD_CODES,
  pastRecordRefusalSentence,
  readRefusalSentence,
} from './pastRecordWords';

/**
 * The words of the "Bring in a past record" screen and the past record's own
 * page (docs/SPEC/reports-qeeg.md section 11; brief R, item 7): a sentence for
 * every refusal code the three doors answer, and for every note of what could
 * not be carried.
 */

describe('the sentences for a past record', () => {
  it('has a sentence for every code the import, keep and withdraw doors answer', () => {
    for (const code of PAST_RECORD_CODES) {
      expect(IMPORT_REFUSALS[code], code).toMatch(/\.$/);
    }
  });

  it('says where a record of the same file already is', () => {
    expect(
      pastRecordRefusalSentence(409, {
        code: 'already_imported',
        status: 'imported',
        withdrawn: false,
      }),
    ).toMatch(/already kept/);
    expect(
      pastRecordRefusalSentence(409, {
        code: 'already_imported',
        status: 'imported',
        withdrawn: true,
      }),
    ).toMatch(/withdrawn/);
  });

  it('says how many follow-ups compare with a record she tried to withdraw', () => {
    expect(
      pastRecordRefusalSentence(409, { code: 'in_comparison', reportIds: ['a', 'b'] }),
    ).toMatch(/2 follow-up reports/);
  });

  it('falls back to a plain sentence for an answer it does not know', () => {
    expect(pastRecordRefusalSentence(500, null)).toMatch(/try again/i);
  });

  it('has a sentence for every note the reader and the keep write, naming the place', () => {
    for (const code of IMPORT_NOTE_CODES) {
      expect(noteSentence({ code, at: 'dashboard.sleep' }), code).toMatch(/\.$/);
    }
    expect(noteSentence({ code: 'map_not_brought_in', at: 'images.map-1' })).toBe(
      'A picture was not brought in: the picture in place 2 of the file.',
    );
    expect(noteSentence({ code: 'score_defaulted', at: 'dashboard.sleep' })).toContain(
      'dashboard, sleep',
    );
  });

  it('says why a file could not be read', () => {
    for (const reason of ['not_json', 'not_an_object', 'not_a_report_file', 'unknown_version']) {
      expect(readRefusalSentence(reason), reason).toMatch(/\.$/);
    }
  });
});
