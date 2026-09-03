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
] as const;

/** The kind the consent route files a signature PNG under. */
export const CONSENT_SIGNATURE_KIND = 'consent_signature';
/** The kind the consent route files a photographed or scanned paper form under. */
export const CONSENT_SCAN_KIND = 'consent_scan';

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
