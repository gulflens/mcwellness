import { describe, expect, it } from 'vitest';
import { DraftInput, ReportRow } from '../../app/api/reports/schema';

/**
 * What the reports routes take and answer, now that a report may be a brain
 * map (`qeeg`) or a past record (`imported`) (docs/SPEC/reports-qeeg.md
 * sections 13 and 14; migrations 602 and 603).
 *
 * The draft door writes the two kinds whose figures it gathers from the
 * record. A brain-map draft sent to it is refused at the edge, so nothing
 * reads one as a session report; the brain map's own door is its own route.
 * A row read back may be any kind and any status the database holds.
 */

const CLIENT = '00000006-0000-4000-8000-000000000021';
const REPORT = '00000006-0000-4000-8000-000000000022';

describe('the draft door', () => {
  it('takes a session or a progress draft as before', () => {
    for (const kind of ['session', 'progress']) {
      expect(DraftInput.safeParse({ clientId: CLIENT, kind, content: {} }).success, kind).toBe(
        true,
      );
    }
  });

  it('refuses a brain-map draft, which is not this door’s to write', () => {
    expect(DraftInput.safeParse({ clientId: CLIENT, kind: 'qeeg', content: {} }).success).toBe(
      false,
    );
  });
});

describe('a report row as the practice reads it', () => {
  it('reads back a brain-map report and a past record', () => {
    const row = {
      id: REPORT,
      clientId: CLIENT,
      kind: 'qeeg',
      status: 'imported',
      locale: 'en',
      reference: null,
      issuedOn: null,
      coverageFrom: null,
      coverageTo: null,
      signedByName: null,
      version: 1,
      supersedesId: null,
      amendmentReason: null,
      documentId: null,
      deliveries: 0,
      createdAt: '2026-09-30T02:00:00+04:00',
    };
    expect(ReportRow.safeParse(row).success).toBe(true);
  });
});
