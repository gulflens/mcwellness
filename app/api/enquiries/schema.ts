import { z } from 'zod';
import { ENQUIRING_FOR, ENQUIRY_SOURCES, INTERESTS, type MissingField } from '@domain/enquiry';

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

export const ENQUIRY_STATUSES = ['new', 'converted', 'dismissed'] as const;

/** One enquiry as the console lists it. Personal fields are null once actioned. */
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
  actionedAt: z.iso.datetime({ offset: true }).nullable(),
  actionedByName: z.string().nullable(),
  clientId: z.uuid().nullable(),
  dismissReason: z.string().nullable(),
});
export type Enquiry = z.infer<typeof Enquiry>;

export const EnquiryListResponse = z.object({ enquiries: z.array(Enquiry) });
export type EnquiryListResponse = z.infer<typeof EnquiryListResponse>;

export const DismissBody = z.object({ reason: z.string().trim().min(1).max(200) });
export type DismissBody = z.infer<typeof DismissBody>;

export const ConvertResponse = z.object({ clientId: z.uuid(), mrn: z.string() });
export type ConvertResponse = z.infer<typeof ConvertResponse>;
