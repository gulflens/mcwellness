import { describe, expect, it } from 'vitest';
import { RecordConsentBody } from '../../app/api/clients/record-schema';
import { OFFERED_CONSENT_PURPOSES } from '../../domain/client';

/**
 * The console records the four consents a household gives at the studio and
 * never the marketing consent, which is the adult's own switch on their portal
 * (the push memo's decision 1; PR 247's review, finding 1). The shape the
 * console's consent route parses says so, as the bundle route's already did.
 */
const BODY = {
  givenByContactId: '00000001-0000-4000-8000-0000000000c1',
  textDocumentId: '00000001-0000-4000-8000-0000000000c2',
  method: 'paper_scan',
};

describe('RecordConsentBody', () => {
  it('admits every purpose the console offers', () => {
    for (const purpose of OFFERED_CONSENT_PURPOSES) {
      expect(RecordConsentBody.safeParse({ ...BODY, purpose }).success, purpose).toBe(true);
    }
  });

  it('refuses marketing, and the retired purposes, by any method', () => {
    for (const purpose of ['marketing', 'photo_video', 'research']) {
      for (const method of ['app_signature', 'paper_scan', 'verbal_witnessed', 'portal_switch']) {
        expect(
          RecordConsentBody.safeParse({ ...BODY, purpose, method }).success,
          `${purpose} ${method}`,
        ).toBe(false);
      }
    }
  });
});
