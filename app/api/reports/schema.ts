import { z } from 'zod';
import {
  DELIVERY_CHANNELS,
  REPORT_KINDS,
  REPORT_LOCALES,
  REPORT_STATUSES,
} from '../../../domain/reports';

/**
 * What the reports routes take and answer (docs/SPEC/reports-v1.md section
 * 7.1). Every request is parsed before it reaches a query and every response is
 * parsed before it leaves, so a shape that drifts fails here rather than on a
 * screen.
 *
 * `content` is deliberately `unknown` at this boundary: its shape is the
 * domain's to declare per kind (`domain/reports/shapes/`) and
 * `validateContent` is what refuses it, with the field named. Parsing it twice,
 * once here and once there, would be two answers to what a report body is.
 */

export const ReportKindInput = z.enum(REPORT_KINDS);
export const ReportStatusOutput = z.enum(REPORT_STATUSES);
export const ReportLocaleInput = z.enum(REPORT_LOCALES);
export const DeliveryChannelInput = z.enum(DELIVERY_CHANNELS);

/** One row of the Reports tab (section 4.1). */
export const ReportRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  kind: ReportKindInput,
  status: ReportStatusOutput,
  locale: ReportLocaleInput,
  /** Null on a draft: a number is allocated at issue and never before. */
  reference: z.string().nullable(),
  issuedOn: z.string().nullable(),
  coverageFrom: z.string().nullable(),
  coverageTo: z.string().nullable(),
  signedByName: z.string().nullable(),
  version: z.number().int().min(1),
  supersedesId: z.uuid().nullable(),
  amendmentReason: z.string().nullable(),
  documentId: z.uuid().nullable(),
  /** How many times it has been handed to somebody. Never who, on a list. */
  deliveries: z.number().int().min(0),
  createdAt: z.string(),
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportListResponse = z.object({ reports: z.array(ReportRow) });
export type ReportListResponse = z.infer<typeof ReportListResponse>;

/** One delivery, as the practice's own screen shows it (section 4.3). */
export const DeliveryRow = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactLabel: z.string(),
  channel: DeliveryChannelInput,
  sentAt: z.string(),
});
export type DeliveryRow = z.infer<typeof DeliveryRow>;

export const ReportResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
  deliveries: z.array(DeliveryRow),
  /** Present only when the report has a filed PDF and the caller may open it. */
  url: z.string().nullable(),
  expiresInSeconds: z.number().int().positive().nullable(),
});
export type ReportResponse = z.infer<typeof ReportResponse>;

/**
 * Creating or updating a draft. `id` present is an update; absent is a new
 * draft. `gather` asks the server to fill the figures in from the record — a
 * figure a practitioner could retype is a figure that can disagree with it
 * (section 4.2) — and `content` carries only what a person writes.
 */
export const DraftInput = z.object({
  id: z.uuid().optional(),
  clientId: z.uuid(),
  kind: ReportKindInput,
  locale: ReportLocaleInput.default('en'),
  serviceTypeId: z.uuid().nullable().default(null),
  coverageFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  coverageTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /**
   * The whole body, as the editor holds it. Validated by
   * `domain/reports/validateContent` and never by this schema.
   */
  content: z.unknown(),
});
export type DraftInput = z.infer<typeof DraftInput>;

export const DraftResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
});
export type DraftResponse = z.infer<typeof DraftResponse>;

/** What the draft screen shows before a practitioner writes a word. */
export const GatherResponse = z.object({
  content: z.unknown(),
  /** True when the assessment table is on this database and was read. */
  brainMapsRead: z.boolean(),
});
export type GatherResponse = z.infer<typeof GatherResponse>;

/**
 * Issuing takes **nothing**. Who signs is the person signed in: the route
 * reads their own practitioner row and `app.issue_report` refuses any other
 * (section 10, decision 3). A field naming a signer would be a field through
 * which one person could put a colleague's name and certificate number on a
 * document, and the trail would name the actor while the document did not.
 */
export const IssueInput = z.object({});
export type IssueInput = z.infer<typeof IssueInput>;

export const IssueResponse = z.object({
  report: ReportRow,
});
export type IssueResponse = z.infer<typeof IssueResponse>;

export const SupersedeInput = z.object({
  reason: z.string(),
  /** The corrected body. The new version is a whole report, not a patch. */
  content: z.unknown(),
  locale: ReportLocaleInput.optional(),
});
export type SupersedeInput = z.infer<typeof SupersedeInput>;

export const SupersedeResponse = z.object({
  /** The new draft, ready to be read over and signed. */
  report: ReportRow,
});
export type SupersedeResponse = z.infer<typeof SupersedeResponse>;

export const DeliverInput = z.object({
  contactId: z.uuid(),
  channel: DeliveryChannelInput,
});
export type DeliverInput = z.infer<typeof DeliverInput>;

export const DeliverResponse = z.object({
  channel: DeliveryChannelInput,
  delivered: z.boolean(),
  handoffUrl: z.string().optional(),
  message: z.string(),
});
export type DeliverResponse = z.infer<typeof DeliverResponse>;

/** The declared shapes, so a screen builds its form from the same source. */
export const SchemaResponse = z.object({
  kinds: z.array(ReportKindInput),
  locales: z.array(ReportLocaleInput),
  channels: z.array(DeliveryChannelInput),
  fields: z.record(z.string(), z.array(z.string())),
});
export type SchemaResponse = z.infer<typeof SchemaResponse>;

export const DocumentLinkResponse = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponse>;
