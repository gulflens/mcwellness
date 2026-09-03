import { z } from 'zod';
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

export const Consent = z.object({
  id: z.uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(['active', 'withdrawn', 'expired', 'superseded']),
  givenByContactId: z.uuid(),
  givenAt: z.string(),
  withdrawnAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  method: z.enum(CONSENT_METHODS),
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

export const RecordConsentBody = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  givenByContactId: z.uuid(),
  textDocumentId: z.uuid(),
  method: z.enum(CONSENT_METHODS),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type RecordConsentBody = z.infer<typeof RecordConsentBody>;

export const ErasureRequestBody = z.object({
  // 200 characters, matching erasure_request.reason's own retention boundary
  // (db/migrations/100_client_record.sql), not the general free-text ceiling.
  reason: z.string().min(1).max(200),
  requestedByContactId: z.uuid().optional(),
});
export type ErasureRequestBody = z.infer<typeof ErasureRequestBody>;

export const IdResponse = z.object({ id: z.uuid() });

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
