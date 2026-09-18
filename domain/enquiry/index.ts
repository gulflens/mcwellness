/**
 * An enquiry's own rules (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 * Browser-safe, like every domain barrel: no Node built-in is reachable from
 * here, directly or through anything it imports.
 */
export {
  ENQUIRING_FOR,
  ENQUIRY_SOURCES,
  INTERESTS,
  leadFromEnquiry,
  parseEnquiry,
  toE164,
} from './parse';
export type {
  EnquiringFor,
  EnquirySource,
  Interest,
  LeadFromEnquiry,
  LodgedEnquiry,
  MissingField,
  ParseResult,
} from './parse';
export {
  ENQUIRY_PAGE,
  ENQUIRY_STATUSES,
  enquiryCursor,
  readEnquiryListQuery,
  tallyEnquiries,
} from './list';
export type { EnquiryCursor, EnquiryListQuery, EnquiryStatus, EnquiryTally } from './list';
export { carriesAPerson, dismissalKeeps, isMarketable, noticeOf } from './keep';
export type { NoticeVersion } from './keep';
export { ENQUIRY_WAITING_AFTER_DAYS, enquiryWaitingDays } from './waiting';
