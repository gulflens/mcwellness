import { describe, expect, it } from 'vitest';
import { comparedFromRow } from './earlier';

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
