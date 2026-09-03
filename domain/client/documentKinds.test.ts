import { describe, expect, it } from 'vitest';
import {
  CLIENT_UPLOAD_KINDS,
  CONSENT_SCAN_KIND,
  CONSENT_SIGNATURE_KIND,
  IDENTITY_DOCUMENT_KINDS,
  SYSTEM_WRITTEN_KINDS,
  documentUploadRefusal,
  isIdentityDocumentKind,
} from './documentKinds';

describe('documentUploadRefusal', () => {
  it('accepts every kind the Documents tab offers', () => {
    for (const kind of CLIENT_UPLOAD_KINDS) {
      expect(documentUploadRefusal(kind)).toBeNull();
    }
  });

  it('refuses every identity document by name', () => {
    for (const kind of IDENTITY_DOCUMENT_KINDS) {
      expect(documentUploadRefusal(kind)).toBe('identity_document');
    }
  });

  it('refuses what the platform writes for itself', () => {
    for (const kind of SYSTEM_WRITTEN_KINDS) {
      expect(documentUploadRefusal(kind)).toBe('system_written');
    }
  });

  it('refuses a kind it has never heard of', () => {
    expect(documentUploadRefusal('scan_of_something')).toBe('unknown_kind');
    expect(documentUploadRefusal('')).toBe('unknown_kind');
  });

  it('names an identity document as one even when it is also unknown', () => {
    expect(documentUploadRefusal('passport')).toBe('identity_document');
  });

  it('files the consent evidence kinds among the ones nobody uploads by hand', () => {
    expect(documentUploadRefusal(CONSENT_SIGNATURE_KIND)).toBe('system_written');
    expect(documentUploadRefusal(CONSENT_SCAN_KIND)).toBe('system_written');
  });

  it('keeps the three lists disjoint', () => {
    const all = [...CLIENT_UPLOAD_KINDS, ...IDENTITY_DOCUMENT_KINDS, ...SYSTEM_WRITTEN_KINDS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('isIdentityDocumentKind', () => {
  it('is true only for the named identity documents', () => {
    expect(isIdentityDocumentKind('emirates_id')).toBe(true);
    expect(isIdentityDocumentKind('referral')).toBe(false);
  });
});
