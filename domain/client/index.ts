export { canActivate } from './canActivate';
export type { Missing } from './canActivate';
export { canGiveConsent } from './canGiveConsent';
export type { ConsentGiver, ConsentRefusal, ConsentSubject } from './canGiveConsent';
export { canTransition } from './canTransition';
export { canViewClient } from './canViewClient';
export { computeRetentionUntil } from './computeRetentionUntil';
export { KEPT_THROUGH_ERASURE_KINDS, isKeptThroughErasure } from './erasureKeeps';
export {
  ERASURE_LETTER_KIND,
  ERASURE_LETTER_MIME_TYPE,
  formatLetterDate,
  parseErasureLetterTemplate,
  renderErasureLetter,
  REPORTS_ERASED_SENTENCE,
} from './erasureLetter';
export type { ErasureLetterLocale, ErasureLetterTemplate } from './erasureLetter';
export {
  CLIENT_UPLOAD_KINDS,
  CONSENT_EVIDENCE_KINDS,
  CONSENT_SCAN_KIND,
  CONSENT_SIGNATURE_KIND,
  IDENTITY_DOCUMENT_KINDS,
  SYSTEM_WRITTEN_KINDS,
  documentUploadRefusal,
  isConsentEvidenceKind,
  isIdentityDocumentKind,
} from './documentKinds';
export type { ClientUploadKind, DocumentUploadRefusal } from './documentKinds';
// Moved to domain/shared in the trunk's round 31, because three streams need
// the same question and only one of them could import it (OWNERSHIP.md rule
// 3). Re-exported here so no caller moved with it, exactly as
// domain/billing/money.ts re-exports formatFils.
export {
  KNOWN_MIME_TYPES,
  bytesMatchMimeType,
  isKnownMimeType,
  type KnownMimeType,
} from '../shared/fileSignature';
export { formatMrn } from './formatMrn';
export { isMinor } from './isMinor';
export { nextMrn } from './nextMrn';
export { parseMrn } from './parseMrn';
export { requiredConsents } from './requiredConsents';
export * from './types';
export { validateEmiratesId } from './validateEmiratesId';
export type { EmiratesIdValidation } from './validateEmiratesId';
