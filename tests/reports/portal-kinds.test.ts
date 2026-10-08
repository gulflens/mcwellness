import { describe, expect, it } from 'vitest';
import { PortalReport } from '../../app/api/portal/schema';

/**
 * The household's answer names a brain-map report and never a past record
 * (docs/SPEC/reports-qeeg.md section 11, point 4, and section 19, point 11).
 * The row policy is what keeps a past record from a household; this list
 * having no word for one is why it would be refused rather than shown if it
 * ever got past.
 */

const ROW = {
  id: '00000006-0000-4000-8000-000000000011',
  clientId: '00000006-0000-4000-8000-000000000012',
  kind: 'session',
  status: 'issued',
  reference: 'RPT-000011',
  issuedOn: '2026-09-01',
  coverageFrom: null,
  coverageTo: null,
  version: 1,
  documentId: null,
};

describe('the household’s report row', () => {
  it('admits a brain-map report', () => {
    expect(PortalReport.safeParse({ ...ROW, kind: 'qeeg' }).success).toBe(true);
  });

  it('admits an uploaded report, with its title', () => {
    const parsed = PortalReport.safeParse({ ...ROW, kind: 'external', title: 'Brain map' });
    expect(parsed.success && parsed.data.title).toBe('Brain map');
  });

  it('still admits the two kinds that were there before', () => {
    expect(PortalReport.safeParse({ ...ROW, kind: 'session' }).success).toBe(true);
    expect(PortalReport.safeParse({ ...ROW, kind: 'progress' }).success).toBe(true);
  });

  it('refuses a past record brought in from the old tool', () => {
    expect(PortalReport.safeParse({ ...ROW, kind: 'qeeg', status: 'imported' }).success).toBe(
      false,
    );
  });
});
