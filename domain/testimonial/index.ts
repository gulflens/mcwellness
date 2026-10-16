/**
 * A website review's own rules (docs/SPEC/testimonials.md). Browser-safe, like
 * every domain barrel: no Node built-in is reachable from here.
 */
export {
  TESTIMONIAL_LANGUAGES,
  TESTIMONIAL_LIMITS,
  carriesContactDetails,
  parseTestimonial,
} from './parse';
export type {
  SubmittedTestimonial,
  TestimonialField,
  TestimonialLanguage,
  TestimonialParseResult,
} from './parse';
export { moveTestimonial } from './order';
export type { MoveDirection } from './order';
export { DECLINED_KEPT_DAYS, PENDING_KEPT_DAYS, testimonialRetentionCutoffs } from './retention';
export type { TestimonialCutoffs } from './retention';

/** The three a review can be: waiting for the office, on the website, or not. */
export const TESTIMONIAL_STATUSES = ['pending', 'approved', 'declined'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** The most the website's page is ever sent: one page of cards, never the archive. */
export const PUBLISHED_TESTIMONIALS_MAX = 30;
