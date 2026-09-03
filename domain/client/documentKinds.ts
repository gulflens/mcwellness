/**
 * What may be filed against a client, and what may never be
 * (docs/SPEC/00-data-model.md section 3, docs/SPEC/client-record.md section
 * 4.2). `document.kind` is an open set in the schema on purpose — other
 * streams file reports, invoices and setup photos under kinds of their own —
 * so this is not the catalogue of every kind that exists. It is the narrower
 * question the Documents tab asks: which kinds a person may upload by hand,
 * and which the practice refuses to hold at all.
 */

/** The kinds the Documents tab offers, in the order it offers them. */
export const CLIENT_UPLOAD_KINDS = [
  'referral',
  'correspondence',
  'assessment_raw',
  'school_report',
  'other',
] as const;
export type ClientUploadKind = (typeof CLIENT_UPLOAD_KINDS)[number];

/**
 * Kinds the practice does not hold, whoever asks.
 *
 * "Never an image of an identity document" is a rule of the data model, not a
 * preference: an Emirates ID is captured as a keyed fingerprint and a sealed
 * value and never as a picture (section 3's Identifiers row), and a passport
 * or a visa page is the same class of thing. A named list refuses them with a
 * sentence that says why, which a generic "that kind is not allowed" cannot.
 */
export const IDENTITY_DOCUMENT_KINDS = [
  'emirates_id',
  'identity_card',
  'passport',
  'visa',
  'residence_permit',
  'birth_certificate',
  'driving_licence',
] as const;

/**
 * Kinds this platform writes for itself and nobody uploads by hand: the
 * practice's published consent wording (owner or admin only, and migration
 * 903 floors it in the database too), the evidence a consent route files with
 * the consent it evidences, and the documents other streams own.
 */
export const SYSTEM_WRITTEN_KINDS = [
  'consent_text',
  'consent_signature',
  'consent_scan',
  'report',
  'invoice',
  'setup_photo',
  'certificate',
  // The confirmation an erasure sends (domain/client/erasureLetter.ts). The
  // app writes it, files it against the erasure request rather than against
  // the client who has just been erased, and nobody uploads one by hand.
  'erasure_letter',
] as const;

/** The kind the consent route files a signature PNG under. */
export const CONSENT_SIGNATURE_KIND = 'consent_signature';
/** The kind the consent route files a photographed or scanned paper form under. */
export const CONSENT_SCAN_KIND = 'consent_scan';

/**
 * The evidence a consent route files: the signature the pad rendered, or the
 * photographed paper form.
 *
 * These are kept apart from every other client document for one reason, and it
 * is a retention rule rather than a filing one. An ordinary client document is
 * kept five years from the client's last activity and the clock moves on with
 * them. Consent evidence cannot be: migration 903 freezes an immutable row the
 * moment it is filed, `retention_until` with it, so a date written at filing
 * time is a date nothing can ever move — and a consent still live in year six
 * would be evidenced by a file already marked for deletion in year five.
 *
 * So it follows `consent_text`'s rule instead (903's own retention note):
 * `retention_until` is null, meaning "not on an upload clock", and the file is
 * kept while a `consent` references it and until the client's own retention
 * has expired. A deletion job must therefore ask what still references a
 * document before it removes anything, which is the rule 903 already states
 * for the wording and is now the rule for what was signed against it.
 */
export const CONSENT_EVIDENCE_KINDS = ['consent_signature', 'consent_scan'] as const;

export type DocumentUploadRefusal =
  /** An identity document: never held as an image, whatever the reason given. */
  | 'identity_document'
  /** A kind the platform writes for itself; a person does not upload one. */
  | 'system_written'
  /** Not a kind this practice files against a client at all. */
  | 'unknown_kind';

function isIn(kinds: readonly string[], kind: string): boolean {
  return kinds.includes(kind);
}

/**
 * Whether `kind` names the evidence of a consent, which is kept while the
 * consent it evidences is (see CONSENT_EVIDENCE_KINDS).
 */
export function isConsentEvidenceKind(kind: string): boolean {
  return isIn(CONSENT_EVIDENCE_KINDS, kind);
}

/** Whether `kind` names an identity document, which is never held as an image. */
export function isIdentityDocumentKind(kind: string): boolean {
  return isIn(IDENTITY_DOCUMENT_KINDS, kind);
}

/**
 * Why an upload of `kind` is refused, or null when it is one a person may
 * file. The identity check comes first and deliberately: it is the refusal
 * with a reason worth saying, and a kind that is both unknown and an identity
 * document should be refused as the second thing rather than the first.
 */
export function documentUploadRefusal(kind: string): DocumentUploadRefusal | null {
  if (isIdentityDocumentKind(kind)) return 'identity_document';
  if (isIn(SYSTEM_WRITTEN_KINDS, kind)) return 'system_written';
  if (!isIn(CLIENT_UPLOAD_KINDS, kind)) return 'unknown_kind';
  return null;
}
