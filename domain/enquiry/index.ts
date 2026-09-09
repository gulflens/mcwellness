/**
 * An enquiry's own rules (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 * Browser-safe, like every domain barrel: no Node built-in is reachable from
 * here, directly or through anything it imports.
 */
export { ENQUIRY_SOURCES, leadFromEnquiry, parseEnquiry, toE164 } from './parse';
export type { EnquirySource, LeadFromEnquiry, LodgedEnquiry, ParseResult } from './parse';
