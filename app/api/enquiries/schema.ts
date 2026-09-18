import { z } from 'zod';
import {
  ENQUIRING_FOR,
  ENQUIRY_SOURCES,
  ENQUIRY_STATUSES,
  INTERESTS,
  type MissingField,
} from '@domain/enquiry';

/** What the door answers, whatever happened: a thank-you, or nothing a script can learn from. */
export const LodgeResponse = z.object({ ok: z.literal(true) });
export type LodgeResponse = z.infer<typeof LodgeResponse>;

/**
 * The one refusal a person can see: a field the form needs and did not get,
 * each named so the expo page can mark it. The website's script never reads
 * this body; the app's own page does.
 */
export const IncompleteResponse = z.object({
  error: z.literal('incomplete'),
  missing: z.array(z.enum(['name', 'phone', 'enquiring_for', 'interest'] as const)),
  requestId: z.string(),
});
export type IncompleteResponse = z.infer<typeof IncompleteResponse> & {
  missing: MissingField[];
};

/** The three an enquiry can be, from the domain, which is where the list's rules read them. */
export { ENQUIRY_STATUSES };

/**
 * One enquiry as the console lists it. A converted row's personal fields are
 * null; a dismissed row's are null unless its person was told they would be
 * kept (migration 921, the operator's decision of 19 September 2026).
 */
export const Enquiry = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime({ offset: true }),
  source: z.enum(ENQUIRY_SOURCES),
  status: z.enum(ENQUIRY_STATUSES),
  name: z.string().nullable(),
  whatsappE164: z.string().nullable(),
  email: z.string().nullable(),
  area: z.string().nullable(),
  message: z.string().nullable(),
  concern: z.string().nullable(),
  preferredTime: z.string().nullable(),
  contactMethod: z.string().nullable(),
  consent: z.boolean().nullable(),
  /** The expo form's two answers (migration 919); null from the website, and once actioned. */
  enquiringFor: z.enum(ENQUIRING_FOR).nullable(),
  interest: z.enum(INTERESTS).nullable(),
  /** Which wording the person read: 1 promised the enquiry keeps nothing; 2 said the details are kept. */
  noticeVersion: z.union([z.literal(1), z.literal(2)]),
  /** The second wording's optional tick for news and offers; null is never asked. */
  marketingOptIn: z.boolean().nullable(),
  actionedAt: z.iso.datetime({ offset: true }).nullable(),
  actionedByName: z.string().nullable(),
  clientId: z.uuid().nullable(),
  dismissReason: z.string().nullable(),
});
export type Enquiry = z.infer<typeof Enquiry>;

const count = z.number().int().nonnegative();
const SourceCounts = z.object({
  all: count,
  website: count,
  discovery_call: count,
  expo: count,
});

/**
 * One status's page (the operator's ask of 19 September 2026): what is
 * waiting, what became a lead and what was dismissed are three lists, each
 * asked for by name, so no volume of one can crowd out another.
 */
export const EnquiryListResponse = z.object({
  enquiries: z.array(Enquiry),
  /** Every status by every source, whichever list was asked for: the tabs' and the filter's own numbers. */
  counts: z.object({ new: SourceCounts, converted: SourceCounts, dismissed: SourceCounts }),
  /** Where this page stopped, to ask for the next with; null when it reached the end. */
  older: z.string().nullable(),
  /** How many people asked for the practice's news and are still on a row: the news list's length. */
  marketable: count,
});
export type EnquiryListResponse = z.infer<typeof EnquiryListResponse>;

export const DismissBody = z.object({
  reason: z.string().trim().min(1).max(200),
  /** Chosen by the person dismissing: spam, a wrong number, somebody who asked to be forgotten. */
  erase: z.boolean().optional(),
});
export type DismissBody = z.infer<typeof DismissBody>;

/** What the dismissal did with the person: kept only where they were told they would be, and nobody chose to erase. */
export const DismissResponse = z.object({ ok: z.literal(true), kept: z.boolean() });
export type DismissResponse = z.infer<typeof DismissResponse>;

export const ConvertResponse = z.object({ clientId: z.uuid(), mrn: z.string() });
export type ConvertResponse = z.infer<typeof ConvertResponse>;
