import { describe, expect, it } from 'vitest';
import type { ReportRow } from '../../../api/reports/schema';
import { languageWord, twinLines } from './twinWords';

/**
 * What the list and the report's page say of a brain map's other language
 * (brief Q, item 7): its language, the report it was made from or the one
 * made from it, and whether it is out of step.
 */

const ID = (n: number) => `0000000a-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: ID(1),
    clientId: ID(9),
    kind: 'qeeg',
    status: 'issued',
    locale: 'en',
    reference: 'RPT-000001',
    issuedOn: '2026-09-01',
    coverageFrom: null,
    coverageTo: null,
    signedByName: 'Hazel Harbour',
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: null,
    deliveries: 0,
    createdAt: '2026-09-01T08:00:00+04:00',
    twinOfId: null,
    twinId: null,
    outOfStep: false,
    pastRecord: false,
    withdrawn: false,
    recordedOn: null,
    ...over,
  };
}

describe('languageWord', () => {
  it('names a brain map’s language in English, and nothing for the other kinds', () => {
    expect(languageWord(row({ locale: 'ar' }))).toBe('Arabic');
    expect(languageWord(row({ locale: 'en' }))).toBe('English');
    expect(languageWord(row({ kind: 'progress' }))).toBeNull();
  });
});

describe('twinLines', () => {
  const first = row({ twinId: ID(2) });
  const second = row({ id: ID(2), locale: 'ar', reference: 'RPT-000002', twinOfId: ID(1) });

  it('names the other language made from a report, by its reference', () => {
    expect(twinLines(first, [first, second])).toEqual(['Arabic version: RPT-000002']);
  });

  it('says a draft of the other language is a draft', () => {
    const draft = { ...second, status: 'draft' as const, reference: null };
    expect(twinLines(first, [first, draft])).toEqual(['Arabic version: a draft']);
  });

  it('names the report the other language was made from', () => {
    expect(twinLines(second, [first, second])).toEqual(['Made from RPT-000001, in English']);
  });

  it('says plainly when the report it was made from has been corrected since', () => {
    const late = { ...second, outOfStep: true };
    expect(twinLines(late, [{ ...first, status: 'superseded' }, late])).toEqual([
      'Made from RPT-000001, in English',
      'Out of step: RPT-000001 has been corrected since, so this report no longer matches it.',
    ]);
  });

  it('says nothing of a report with no other language', () => {
    expect(twinLines(row(), [row()])).toEqual([]);
  });
});
