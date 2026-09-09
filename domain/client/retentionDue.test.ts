import { describe, expect, it } from 'vitest';
import { retentionDue, type RetainedDocument } from './retentionDue';

const TODAY = '2026-09-09';

function held(overrides: Partial<RetainedDocument> = {}): RetainedDocument {
  return {
    clientId: '00000008-0000-4000-8000-000000000001',
    documentId: '0000000a-0000-4000-8000-000000000001',
    kind: 'report',
    retentionUntil: '2031-09-09',
    ...overrides,
  };
}

describe('retentionDue', () => {
  it('names nothing while every document is still inside its five years', () => {
    expect(retentionDue([held(), held({ retentionUntil: '2026-09-10' })], TODAY)).toEqual([]);
  });

  it('names a document whose retention date has passed', () => {
    const due = retentionDue([held({ retentionUntil: '2026-09-08' })], TODAY);
    expect(due).toHaveLength(1);
    expect(due[0]?.documentId).toBe('0000000a-0000-4000-8000-000000000001');
  });

  it('does not name one that falls due today', () => {
    // "Five years after the last session, then it is deleted": the fifth
    // anniversary is the last day it is kept, not the first day it is gone.
    expect(retentionDue([held({ retentionUntil: TODAY })], TODAY)).toEqual([]);
  });

  it('never names a document on no clock at all', () => {
    // Consent evidence and the wording itself carry a null retention_until,
    // meaning "not on an upload clock" — never "nobody computed it"
    // (app/api/clients/document-store.ts). A signature must outlive the
    // record it proves, so this function must never sweep one up.
    expect(
      retentionDue([held({ retentionUntil: null, kind: 'consent_signature' })], TODAY),
    ).toEqual([]);
  });

  it('groups what is due by the household it belongs to, oldest first', () => {
    const a = '00000008-0000-4000-8000-00000000000a';
    const b = '00000008-0000-4000-8000-00000000000b';
    const due = retentionDue(
      [
        held({ clientId: b, documentId: 'd1', retentionUntil: '2025-01-01' }),
        held({ clientId: a, documentId: 'd2', retentionUntil: '2024-06-30' }),
        held({ clientId: b, documentId: 'd3', retentionUntil: '2026-01-01' }),
        held({ clientId: a, documentId: 'd4', retentionUntil: '2031-01-01' }),
      ],
      TODAY,
    );
    // Two households, the one waiting longest first, and each household's own
    // oldest date is the one that decides its place.
    expect(due.map((row) => row.clientId)).toEqual([a, b, b]);
    expect(due.map((row) => row.documentId)).toEqual(['d2', 'd1', 'd3']);
  });
});
