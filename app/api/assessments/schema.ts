import { z } from 'zod';
import {
  ASSESSMENT_FILE_MIME_TYPE,
  INSTRUMENTS,
  MAX_CONDITION_NOTE_LENGTH,
  MAX_SUPERSEDE_REASON_LENGTH,
  REFERENCE_SEXES,
} from '@domain/assessment';

/**
 * The measurement on the wire (docs/SPEC/assessment.md sections 5, 6 and 7).
 *
 * `derived` is deliberately `z.record` here and nothing narrower: what a
 * payload may contain is the instrument's declared shape's question, answered
 * by `validateDerived` in `domain/assessment`, which refuses with the field
 * named so the drawer can say which one. A second declaration of the same
 * shape in zod would be a second thing to keep in step, and the two would
 * disagree the first time one of them changed.
 *
 * Nothing here carries a word about a figure: there is no band, no cut-off and
 * no category in any of these types, and the domain refuses a payload that
 * tries to smuggle one in.
 */

/** How long a signed link to an export lives. The seam's own default. */
export const FILE_LINK_TTL_SECONDS = 300;

/**
 * The cap on an export's bytes, and the one media type accepted
 * (spec section 10, decision 3). Twenty megabytes is a vendor's own PDF
 * report with its pictures in it; `application/pdf` alone until the operator
 * names the practice's equipment, and a new file signature is a change request
 * to `domain/client/fileSignature.ts` rather than a guess made here.
 */
export const ASSESSMENT_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export { ASSESSMENT_FILE_MIME_TYPE };

export const ASSESSMENT_FILE_ROLES = ['raw', 'vendor_report'] as const;
export type AssessmentFileRole = (typeof ASSESSMENT_FILE_ROLES)[number];

/**
 * Where the recording happened, asked because section 7.2 requires the
 * `home_visit` consent "where the recording happens at home" and no column on
 * the row says where. It is used for the gate and never stored: an assessment
 * has no delivery mode of its own, and inventing a column for one would be a
 * change to the data model this piece was not asked to make. `home` is the
 * default because it is both the practice's ordinary case and the stricter
 * gate of the two.
 */
export const DELIVERY_MODES = ['home', 'studio', 'remote'] as const;

const Derived = z.record(z.string(), z.unknown());
const ConditionNote = z.string().trim().max(MAX_CONDITION_NOTE_LENGTH).nullable().default(null);
const ReferenceAge = z.number().int().min(0).max(130).nullable().default(null);
const ReferenceSex = z.enum(REFERENCE_SEXES).nullable().default(null);

export const RecordAssessmentRequest = z.object({
  clientId: z.uuid(),
  instrument: z.enum(INSTRUMENTS),
  instrumentVersion: z.string().trim().min(1).max(32),
  performedAt: z.iso.datetime({ offset: true }),
  derived: Derived,
  conditionNote: ConditionNote,
  referenceAgeYears: ReferenceAge,
  referenceSex: ReferenceSex,
  deliveryMode: z.enum(DELIVERY_MODES).default('home'),
});
export type RecordAssessmentRequest = z.infer<typeof RecordAssessmentRequest>;

export const SupersedeAssessmentRequest = z.object({
  instrumentVersion: z.string().trim().min(1).max(32),
  performedAt: z.iso.datetime({ offset: true }),
  derived: Derived,
  conditionNote: ConditionNote,
  referenceAgeYears: ReferenceAge,
  referenceSex: ReferenceSex,
  deliveryMode: z.enum(DELIVERY_MODES).default('home'),
  reason: z.string().trim().min(1).max(MAX_SUPERSEDE_REASON_LENGTH),
});
export type SupersedeAssessmentRequest = z.infer<typeof SupersedeAssessmentRequest>;

/** One file filed against a measurement. Never the bytes, and never the key. */
export const AssessmentFile = z.object({
  documentId: z.uuid(),
  role: z.enum(ASSESSMENT_FILE_ROLES),
  filedAt: z.iso.datetime(),
});
export type AssessmentFile = z.infer<typeof AssessmentFile>;

export const AssessmentRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  instrument: z.enum(INSTRUMENTS),
  instrumentVersion: z.string(),
  performedAt: z.iso.datetime(),
  performedByPractitionerId: z.uuid(),
  /** The person's display name, so a table reads without a second request. */
  performedBy: z.string().nullable(),
  derived: Derived,
  conditionNote: z.string().nullable(),
  referenceAgeYears: z.number().int().nullable(),
  referenceSex: z.enum(REFERENCE_SEXES).nullable(),
  version: z.number().int(),
  supersedesId: z.uuid().nullable(),
  supersedeReason: z.string().nullable(),
  files: z.array(AssessmentFile),
});
export type AssessmentRow = z.infer<typeof AssessmentRow>;

/** The current version of each measurement, with what it replaced beneath it. */
export const AssessmentChain = z.object({
  current: AssessmentRow,
  superseded: z.array(AssessmentRow),
});
export type AssessmentChain = z.infer<typeof AssessmentChain>;

export const AssessmentListResponse = z.object({ assessments: z.array(AssessmentChain) });
export type AssessmentListResponse = z.infer<typeof AssessmentListResponse>;

export const AssessmentResponse = z.object({ assessment: AssessmentRow });
export type AssessmentResponse = z.infer<typeof AssessmentResponse>;

export const FileFiledResponse = z.object({
  documentId: z.uuid(),
  role: z.enum(ASSESSMENT_FILE_ROLES),
});
export type FileFiledResponse = z.infer<typeof FileFiledResponse>;

export const FileLinkResponse = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int(),
});
export type FileLinkResponse = z.infer<typeof FileLinkResponse>;

/**
 * The comparison, as `domain/assessment`'s own `compare` produces it. Declared
 * loosely on the wire on purpose: the shape is the domain's, exported and
 * documented there, and the reports stream reads that type rather than this
 * schema.
 */
export const ComparisonResponse = z.object({
  comparison: z.looseObject({}),
});
export type ComparisonResponse = z.infer<typeof ComparisonResponse>;
