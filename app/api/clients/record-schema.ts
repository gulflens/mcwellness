import { z } from 'zod';
import { KNOWN_MIME_TYPES } from '../../../domain/client';
import { isoDateIn } from '../../../domain/shared';

/**
 * Request and response shapes for the client-record routes (GET/POST/PATCH
 * on a client and its contacts, locations, goals and consents). Zod at the
 * boundary: every route parses with these before touching the database.
 */

// E.164, matching the check constraint on app_user.phone and contact.phone
// (db/migrations/020_app_user.sql, 060_client.sql).
const E164 = /^\+[1-9][0-9]{6,14}$/;
// Ten digits, Dubai only (db/migrations/030_location.sql); the emirate itself
// is checked separately, since a body can name any emirate.
const MAKANI = /^[0-9]{10}$/;

export const RELATIONSHIPS = ['self', 'mother', 'father', 'guardian', 'spouse', 'other'] as const;
export const EMIRATES = ['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'] as const;
export const LOCATION_LABELS = ['home', 'work', 'school', 'studio', 'base', 'other'] as const;
export const CONSENT_PURPOSES = [
  'participation',
  'minor_participation',
  'home_visit',
  'photo_video',
  'research',
  'marketing',
] as const;
export const CONSENT_METHODS = ['app_signature', 'paper_scan', 'verbal_witnessed'] as const;
export const GOAL_STATUSES = ['active', 'achieved', 'dropped'] as const;
export const CLIENT_RECORD_STATUSES = ['lead', 'active', 'paused', 'closed'] as const;

const Name = z.string().min(1).max(100);
const FreeText = z.string().min(1).max(2000);
const Phone = z.string().regex(E164, 'A phone number is E.164, e.g. +971500001234.');
// Raw form, digits and hyphens: validated and normalised server-side by
// domain/client's validateEmiratesId (15 digits, starts 784, Luhn check
// digit), never required (docs/SPEC/00-data-model.md section 3).
const EmiratesIdInput = z.string().min(1).max(40);

/**
 * A date of birth is in the past. Format alone was not enough: a date in the
 * future passed, and `isMinor` then read it as an age below zero — a minor,
 * silently, with the guardian consent that implies. Judged against the
 * practice's own day, so a client born today in Dubai is not refused because
 * the server is still on yesterday. The upper bound is deliberately soft (no
 * "oldest plausible person" rule): a wrong century is a typo for the practice
 * to see and fix, not a body of policy for a schema to hold.
 */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const DateOfBirth = z.iso
  .date()
  .refine((value) => value <= isoDateIn(new Date(), PRACTICE_TIME_ZONE), {
    message: 'A date of birth is in the past.',
  });

export const Contact = z.object({
  id: z.uuid(),
  // Nullable throughout: a contact known only by its relationship predates the
  // name columns (db/migrations/101_contact_name.sql) and a lead is still one
  // name and one phone (docs/SPEC/client-record.md section 3).
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  givenNameAr: z.string().nullable(),
  familyNameAr: z.string().nullable(),
  relationship: z.enum(RELATIONSHIPS),
  isLegalGuardian: z.boolean(),
  canConsent: z.boolean(),
  canReceiveReports: z.boolean(),
  canPay: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  whatsappOptIn: z.boolean(),
  // Never the identity number itself, only whether one is on file.
  hasEmiratesId: z.boolean(),
});
export type Contact = z.infer<typeof Contact>;

export const Location = z.object({
  id: z.uuid(),
  label: z.enum(LOCATION_LABELS),
  emirate: z.enum(EMIRATES),
  makaniNumber: z.string().nullable(),
  entranceLng: z.number(),
  entranceLat: z.number(),
  hasParkingPoint: z.boolean(),
  hasCommunityGate: z.boolean(),
  displayAddress: z.string().nullable(),
  accessNotes: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type Location = z.infer<typeof Location>;

/** What a piece of consent wording can be: the practice's draft, or the approved text. */
export const CONSENT_TEXT_STATUSES = ['draft', 'approved'] as const;

export const Consent = z.object({
  id: z.uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(['active', 'withdrawn', 'expired', 'superseded']),
  givenByContactId: z.uuid(),
  givenAt: z.string(),
  withdrawnAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  method: z.enum(CONSENT_METHODS),
  /**
   * The evidence of what was signed: the PNG the pad rendered, or the
   * photographed paper form. Null for a `verbal_witnessed` re-confirmation,
   * which files nothing, and for the consents the seed wrote before there was
   * anywhere to keep a file.
   */
  signatureDocumentId: z.uuid().nullable(),
  /**
   * The exact wording shown, and how to say which version it was. A consent
   * that could only link the signature was half a record: the screen showed
   * what a person drew and never what they had read. The version and status
   * are the wording document's own (migration 902), read through the join
   * rather than guessed; both are nullable because `document.version` and
   * `document.status` are nullable columns and a wording filed before 902 has
   * neither.
   */
  textDocumentId: z.uuid(),
  wordingVersion: z.string().nullable(),
  wordingStatus: z.enum(CONSENT_TEXT_STATUSES).nullable(),
  /**
   * The second member of staff who confirmed a verbal re-confirmation
   * (docs/SPEC/client-record.md section 7, db/migrations/103_consent_witness.sql).
   * Null for every other method. The name travels with the id because the
   * Consent tab has no other way to say who it was.
   */
  witnessedByUserId: z.uuid().nullable(),
  witnessedByName: z.string().nullable(),
});
export type Consent = z.infer<typeof Consent>;

export const Goal = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryCode: z.string(),
  description: z.string(),
  setAt: z.string(),
  status: z.enum(GOAL_STATUSES),
  isPrimary: z.boolean(),
});
export type Goal = z.infer<typeof Goal>;

export const ClientRecordResponse = z.object({
  id: z.uuid(),
  mrn: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  givenNameAr: z.string().nullable(),
  familyNameAr: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sexAtBirth: z.enum(['female', 'male', 'unknown']).nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  referralSource: z.string().nullable(),
  status: z.enum([...CLIENT_RECORD_STATUSES, 'erased']),
  contacts: z.array(Contact),
  locations: z.array(Location),
  consents: z.array(Consent),
  goals: z.array(Goal),
});
export type ClientRecordResponse = z.infer<typeof ClientRecordResponse>;

export const CreateClientBody = z.object({
  givenName: Name,
  familyName: Name,
  givenNameAr: Name.optional(),
  familyNameAr: Name.optional(),
  dateOfBirth: DateOfBirth.optional(),
  referralSource: z.string().max(200).optional(),
  contact: z.object({
    givenName: Name.optional(),
    familyName: Name.optional(),
    givenNameAr: Name.optional(),
    familyNameAr: Name.optional(),
    relationship: z.enum(RELATIONSHIPS),
    phone: Phone,
    email: z.email().optional(),
    isLegalGuardian: z.boolean().default(false),
    canConsent: z.boolean().default(false),
    canReceiveReports: z.boolean().default(true),
    canPay: z.boolean().default(false),
    emiratesId: EmiratesIdInput.optional(),
  }),
});
export type CreateClientBody = z.infer<typeof CreateClientBody>;

export const CreateClientResponse = z.object({ id: z.uuid(), mrn: z.string() });
export type CreateClientResponse = z.infer<typeof CreateClientResponse>;

export const UpdateClientBody = z
  .object({
    givenName: Name,
    familyName: Name,
    givenNameAr: Name.nullable(),
    familyNameAr: Name.nullable(),
    dateOfBirth: DateOfBirth.nullable(),
    sexAtBirth: z.enum(['female', 'male', 'unknown']).nullable(),
    referralSource: z.string().max(200).nullable(),
  })
  .partial();
export type UpdateClientBody = z.infer<typeof UpdateClientBody>;

export const StatusChangeBody = z.object({ to: z.enum(CLIENT_RECORD_STATUSES) });
export type StatusChangeBody = z.infer<typeof StatusChangeBody>;

export const CreateContactBody = z.object({
  givenName: Name.optional(),
  familyName: Name.optional(),
  givenNameAr: Name.optional(),
  familyNameAr: Name.optional(),
  relationship: z.enum(RELATIONSHIPS),
  isLegalGuardian: z.boolean().default(false),
  canConsent: z.boolean().default(false),
  canReceiveReports: z.boolean().default(true),
  canPay: z.boolean().default(false),
  phone: Phone.optional(),
  email: z.email().optional(),
  whatsappOptIn: z.boolean().default(false),
  emiratesId: EmiratesIdInput.optional(),
});
export type CreateContactBody = z.infer<typeof CreateContactBody>;

export const UpdateContactBody = z
  .object({
    givenName: Name.nullable(),
    familyName: Name.nullable(),
    givenNameAr: Name.nullable(),
    familyNameAr: Name.nullable(),
    relationship: z.enum(RELATIONSHIPS),
    isLegalGuardian: z.boolean(),
    canConsent: z.boolean(),
    canReceiveReports: z.boolean(),
    canPay: z.boolean(),
    phone: Phone.nullable(),
    email: z.email().nullable(),
    whatsappOptIn: z.boolean(),
    // Absent: unchanged. null: clears the identity number. A string: replaces it.
    emiratesId: EmiratesIdInput.nullable(),
  })
  .partial();
export type UpdateContactBody = z.infer<typeof UpdateContactBody>;

export const CreateLocationBody = z.object({
  label: z.enum(LOCATION_LABELS),
  emirate: z.enum(EMIRATES),
  makaniNumber: z.string().regex(MAKANI, 'A Makani number is ten digits.').optional(),
  entranceLng: z.number().min(-180).max(180),
  entranceLat: z.number().min(-90).max(90),
  displayAddress: z.string().max(400).optional(),
  accessNotes: z.string().max(1000).optional(),
  isPrimary: z.boolean().default(false),
});
export type CreateLocationBody = z.infer<typeof CreateLocationBody>;

export const UpdateLocationBody = z
  .object({
    label: z.enum(LOCATION_LABELS),
    makaniNumber: z.string().regex(MAKANI, 'A Makani number is ten digits.').nullable(),
    displayAddress: z.string().max(400).nullable(),
    accessNotes: z.string().max(1000).nullable(),
    isPrimary: z.boolean(),
  })
  .partial();
export type UpdateLocationBody = z.infer<typeof UpdateLocationBody>;

export const VerifyPinBody = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type VerifyPinBody = z.infer<typeof VerifyPinBody>;

export const CreateGoalBody = z.object({
  categoryId: z.uuid(),
  description: FreeText,
  isPrimary: z.boolean().default(false),
});
export type CreateGoalBody = z.infer<typeof CreateGoalBody>;

export const UpdateGoalBody = z
  .object({
    categoryId: z.uuid(),
    description: FreeText,
    status: z.enum(GOAL_STATUSES),
    isPrimary: z.boolean(),
  })
  .partial();
export type UpdateGoalBody = z.infer<typeof UpdateGoalBody>;

/**
 * The bytes a document upload may carry, and why the number is what it is.
 *
 * Every body on this API is JSON (app/api/_middleware/security.ts's jsonOnly)
 * and capped at `BODY_LIMIT_BYTES`, 64 KiB, in the shared zone
 * (app/api/create-api.ts). Base64 costs four characters for every three
 * bytes, so the file itself can be three quarters of whatever the envelope —
 * the ids, the kind, the media type — leaves behind. `document-limits.test.ts`
 * imports both constants and pins the arithmetic, so raising the body cap
 * without raising this, or the reverse, fails rather than silently wastes the
 * room.
 *
 * 45 KiB is enough for a signature drawn on screen several times over and
 * tight for a photographed A4 form, which is why the console compresses an
 * image before it sends one and says so.
 * docs/CHANGE-REQUESTS/client-record-03.md asks for the larger cap this
 * really wants.
 */
export const DOCUMENT_ENVELOPE_ALLOWANCE_BYTES = 4 * 1024;
export const MAX_DOCUMENT_BYTES = 45 * 1024;
/** The longest `bytesBase64` may be, padding included. */
export const MAX_DOCUMENT_BASE64_LENGTH = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;

// Standard base64, padded, no line breaks: what btoa and Buffer.toString('base64')
// produce. The URL-safe alphabet is deliberately not accepted — one encoding in,
// so a caller cannot smuggle bytes past a length check by choosing the other.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Bytes on their way in: what they are, and the file itself. */
export const DocumentBytes = z.object({
  mimeType: z.enum(KNOWN_MIME_TYPES),
  bytesBase64: z
    .string()
    .min(1)
    .max(MAX_DOCUMENT_BASE64_LENGTH, 'That file is too large to file here.')
    .regex(BASE64, 'That file did not arrive intact.'),
});
export type DocumentBytes = z.infer<typeof DocumentBytes>;

/**
 * A link the storage seam signed. Two shapes, both legitimate: the bucket
 * hands back its own absolute `https:` URL, and the folder implementation
 * hands back an app-relative path at this API's own `/api/storage` route,
 * which is what a laptop and every test see (docs/SEAMS.md). Anything else —
 * `javascript:`, `data:`, a bare host — is refused rather than rendered.
 *
 * A key is made of ids and nothing else, so a signed link never carries a
 * name, a record number or what a document says (.claude/rules/ui.md, no
 * personal data in a URL).
 */
const SignedUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('https://') || value.startsWith('/api/'), {
    message: "A signed link is the store's own URL or this API's own path.",
  });

/**
 * The wording a person is about to sign (docs/SPEC/client-record.md section
 * 7). The text itself is fetched from `textUrl`, a short-lived signed link
 * through the storage seam, never inlined here and never in an audit payload.
 */
export const ConsentWordingResponse = z.object({
  id: z.uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  locale: z.enum(['en', 'ar']),
  version: z.string(),
  status: z.enum(CONSENT_TEXT_STATUSES),
  mimeType: z.string(),
  textUrl: SignedUrl,
  /** Seconds the link is good for, so the screen can say when it went stale. */
  expiresInSeconds: z.number().int().positive(),
});
export type ConsentWordingResponse = z.infer<typeof ConsentWordingResponse>;

export const ClientDocument = z.object({
  id: z.uuid(),
  kind: z.string(),
  mimeType: z.string(),
  uploadedAt: z.string(),
  uploadedByName: z.string().nullable(),
  retentionUntil: z.string().nullable(),
  isImmutable: z.boolean(),
});
export type ClientDocument = z.infer<typeof ClientDocument>;

export const ClientDocumentListResponse = z.object({ documents: z.array(ClientDocument) });
export type ClientDocumentListResponse = z.infer<typeof ClientDocumentListResponse>;

export const DocumentLinkResponse = z.object({
  url: SignedUrl,
  expiresInSeconds: z.number().int().positive(),
});
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponse>;

export const UploadDocumentBody = z.object({
  /**
   * Deliberately a string rather than an enum of the kinds the tab offers.
   * `documentUploadRefusal` in domain/client is the rule — it separates an
   * identity document, which is refused with a reason worth saying, from a
   * kind the platform writes for itself, from one it has never heard of — and
   * an enum here would refuse all three as the same shape error before that
   * rule was ever consulted. One gate, and it always answers precisely.
   */
  kind: z.string().min(1).max(64),
  file: DocumentBytes,
});
export type UploadDocumentBody = z.infer<typeof UploadDocumentBody>;

/** The ways a document upload is refused, each with its own sentence on screen. */
export const DOCUMENT_ERROR_CODES = [
  'identity_document',
  'system_written',
  'unknown_kind',
  'bytes_do_not_match_type',
  'document_too_large',
  'storage_unavailable',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/** The ways recording a consent is refused beyond a plain bad request. */
export const CONSENT_ERROR_CODES = [
  'wording_not_found',
  'wording_retired',
  'wording_superseded',
  'wording_wrong_purpose',
  'wording_wrong_locale',
  'contact_may_not_consent',
  'guardian_required',
  'evidence_required',
  'evidence_not_accepted',
  'bytes_do_not_match_type',
  'storage_unavailable',
  // A verbal re-confirmation, and the four ways it is refused: nothing to
  // re-confirm, no witness, the person recording it standing in as their own
  // witness, and a witness who is not this practice's staff.
  'no_consent_to_reconfirm',
  'witness_required',
  'witness_not_accepted',
  'witness_is_actor',
  'witness_not_staff',
] as const;
export type ConsentErrorCode = (typeof CONSENT_ERROR_CODES)[number];

export const RecordConsentBody = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  givenByContactId: z.uuid(),
  textDocumentId: z.uuid(),
  method: z.enum(CONSENT_METHODS),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  /**
   * What was signed: the PNG the pad rendered for `app_signature`, the
   * photographed or scanned form for `paper_scan`. Optional in the shape and
   * required by the route for both of those methods
   * (docs/CHANGE-REQUESTS/client-record-02.md, "What the fourth pull request
   * must add"): a consent recorded with nothing attached would attest to
   * evidence that does not exist. `verbal_witnessed` carries none, and is
   * refused if it tries.
   */
  evidence: DocumentBytes.optional(),
  /**
   * The second member of staff who heard a verbal re-confirmation given
   * (docs/SPEC/client-record.md section 7). Optional in the shape and required
   * by the route for `verbal_witnessed`, refused for every other method: a
   * signature and a scanned form are their own evidence, and a witness beside
   * one would be a fact about a conversation that did not happen.
   */
  witnessedByUserId: z.uuid().optional(),
});
export type RecordConsentBody = z.infer<typeof RecordConsentBody>;

/**
 * Who may stand as a witness to a verbal re-confirmation: this practice's own
 * staff, other than the person recording it. A name and an id and nothing
 * else — the screen needs to say who, not to show a staff directory.
 */
export const ConsentWitness = z.object({ id: z.uuid(), name: z.string() });
export type ConsentWitness = z.infer<typeof ConsentWitness>;

export const ConsentWitnessListResponse = z.object({ witnesses: z.array(ConsentWitness) });
export type ConsentWitnessListResponse = z.infer<typeof ConsentWitnessListResponse>;

export const ErasureRequestBody = z.object({
  // 200 characters, matching erasure_request.reason's own retention boundary
  // (db/migrations/100_client_record.sql), not the general free-text ceiling.
  reason: z.string().min(1).max(200),
  requestedByContactId: z.uuid().optional(),
});
export type ErasureRequestBody = z.infer<typeof ErasureRequestBody>;

export const IdResponse = z.object({ id: z.uuid() });

/**
 * What a withdrawal did beyond stopping the consent. Withdrawing
 * `photo_video` takes back the permission a setup photograph exists under, so
 * the photographs go with it (app/api/clients/withdrawal.ts) — and the console
 * says how many, because a withdrawal that quietly removed a family's
 * photographs, or quietly failed to, is the same screen either way.
 *
 * `photographsStillOnFile` is not always zero: a store that is unreachable
 * cannot be made to forget anything, and saying so is better than a number
 * that implies it did.
 */
export const WithdrawConsentResponse = z.object({
  id: z.uuid(),
  photographsRemoved: z.number().int().nonnegative(),
  photographsStillOnFile: z.number().int().nonnegative(),
});
export type WithdrawConsentResponse = z.infer<typeof WithdrawConsentResponse>;

// The Goals tab and the enrolment wizard's goals step choose a category
// from this owner-editable reference table (docs/SPEC/client-record.md
// section 6); never a free-text field standing in for it.
export const GoalCategory = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
});
export type GoalCategory = z.infer<typeof GoalCategory>;

export const GoalCategoryListResponse = z.object({ categories: z.array(GoalCategory) });
export type GoalCategoryListResponse = z.infer<typeof GoalCategoryListResponse>;

/** The two ways a captured Emirates ID can fail, distinct from a plain `bad_request`. */
export const EMIRATES_ID_ERROR_CODES = ['invalid_emirates_id', 'emirates_id_in_use'] as const;
export type EmiratesIdErrorCode = (typeof EMIRATES_ID_ERROR_CODES)[number];
