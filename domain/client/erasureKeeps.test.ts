import { describe, expect, it } from 'vitest';
import { KEPT_THROUGH_ERASURE_KINDS, isKeptThroughErasure } from './erasureKeeps';

describe('what an erasure keeps', () => {
  it('keeps a tax invoice and the credit note that corrects one', () => {
    expect(isKeptThroughErasure('invoice')).toBe(true);
    expect(isKeptThroughErasure('credit_note')).toBe(true);
  });

  it('keeps nothing else the practice holds about a person', () => {
    for (const kind of [
      'referral',
      'correspondence',
      'assessment_raw',
      'school_report',
      'other',
      'report',
      'setup_photo',
      'consent_signature',
      'consent_scan',
    ]) {
      expect(isKeptThroughErasure(kind)).toBe(false);
    }
  });

  it('does not keep a kind nobody has named', () => {
    expect(isKeptThroughErasure('')).toBe(false);
    expect(isKeptThroughErasure('payment_receipt')).toBe(false);
  });

  it('names the kinds the erasure migration mirrors in SQL', () => {
    expect([...KEPT_THROUGH_ERASURE_KINDS]).toEqual(['invoice', 'credit_note']);
  });
});
