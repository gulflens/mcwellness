import { describe, expect, it } from 'vitest';
import { comparableReports, comparedFromRow, earlierLabel } from './earlier';

/** What a follow-up holds for its comparison before the first save answers. */

const row = {
  id: '00000006-0000-4000-8000-000000000001',
  clientId: '00000008-0000-4000-8000-000000000005',
  kind: 'qeeg' as const,
  status: 'issued' as const,
  locale: 'en' as const,
  reference: 'RPT-000001',
  issuedOn: '2026-06-02',
  coverageFrom: null,
  coverageTo: null,
  signedByName: null,
  version: 1,
  supersedesId: null,
  amendmentReason: null,
  documentId: null,
  deliveries: 0,
  createdAt: '2026-06-02T08:00:00+04:00',
  twinOfId: null,
  twinId: null,
  outOfStep: false,
  pastRecord: false,
  withdrawn: false,
  recordedOn: '2026-06-01',
};

describe('the stand-in comparison', () => {
  it('calls the earlier report the previous one, which is true of any earlier report', () => {
    expect(comparedFromRow(row).relation).toBe('previous');
  });

  it('carries the reference of a signed report and none for a past record', () => {
    expect(comparedFromRow(row)).toMatchObject({ origin: 'issued', reference: 'RPT-000001' });
    expect(comparedFromRow({ ...row, status: 'imported', reference: null })).toMatchObject({
      origin: 'imported',
      reference: null,
    });
  });
});

describe('the reports a follow-up is offered to be compared with', () => {
  const past = {
    ...row,
    id: '00000006-0000-4000-8000-000000000002',
    status: 'imported' as const,
    reference: null,
    issuedOn: null,
    pastRecord: true,
    recordedOn: '2026-03-14',
    // Brought in after the signed report was signed, recorded long before it.
    createdAt: '2026-09-20T08:00:00+04:00',
  };

  it('offers kept past records beside signed reports, in the order they were recorded', () => {
    expect(comparableReports([row, past]).map((r) => r.id)).toEqual([past.id, row.id]);
  });

  it('leaves out a withdrawn past record and one with no day of recording', () => {
    const withdrawn = { ...past, id: '00000006-0000-4000-8000-000000000003', withdrawn: true };
    const undated = { ...past, id: '00000006-0000-4000-8000-000000000004', recordedOn: null };
    expect(comparableReports([row, withdrawn, undated]).map((r) => r.id)).toEqual([row.id]);
  });

  it('never offers a draft being brought in', () => {
    expect(comparableReports([{ ...past, status: 'draft' as const }])).toEqual([]);
  });

  it('names a past record by the day it was recorded', () => {
    expect(earlierLabel(past)).toBe('Past record from the old tool, recorded on 14/03/2026');
  });
});
