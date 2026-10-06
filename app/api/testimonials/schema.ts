import { z } from 'zod';
import { TESTIMONIAL_LANGUAGES, TESTIMONIAL_STATUSES } from '@domain/testimonial';

/**
 * The wire shapes for the website's reviews (docs/SPEC/testimonials.md).
 * The two public ones are a contract with the website, which is built and
 * hosted separately: their field names are the form's own (snake_case, as
 * the enquiry door's are), and changing one breaks the live page.
 */

/** A form the website must correct: each field named by what the form posts it as. */
export const TestimonialInvalidResponse = z.object({
  error: z.literal('invalid'),
  fields: z.array(
    z.enum(['display_name', 'context', 'rating', 'body', 'language', 'consent_to_publish']),
  ),
  requestId: z.string(),
});
export type TestimonialInvalidResponse = z.infer<typeof TestimonialInvalidResponse>;

/** One published review as the website's page shows it: no id, no date. */
export const PublishedTestimonial = z.object({
  display_name: z.string(),
  context: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  body: z.string(),
});
export const PublishedTestimonialsResponse = z.object({
  testimonials: z.array(PublishedTestimonial),
});
export type PublishedTestimonialsResponse = z.infer<typeof PublishedTestimonialsResponse>;

/** One review as the console lists it. */
export const Testimonial = z.object({
  id: z.uuid(),
  submittedAt: z.iso.datetime({ offset: true }),
  displayName: z.string(),
  context: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  body: z.string(),
  language: z.enum(TESTIMONIAL_LANGUAGES),
  status: z.enum(TESTIMONIAL_STATUSES),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedByName: z.string().nullable(),
});
export type Testimonial = z.infer<typeof Testimonial>;

const count = z.number().int().nonnegative();

export const TestimonialListResponse = z.object({
  testimonials: z.array(Testimonial),
  /** Every status, whichever list was asked for: the tabs' own numbers. */
  counts: z.object({ pending: count, approved: count, declined: count }),
  /**
   * Whether a practice-wide limit has turned a new review away in the last
   * day (migration 978): the screen says the queue needs deciding.
   */
  turningAway: z.boolean().default(false),
});
export type TestimonialListResponse = z.infer<typeof TestimonialListResponse>;

/** How many are waiting, for the rail's badge. */
export const TestimonialCountResponse = z.object({ pending: count });

export const MoveTestimonialBody = z.object({ direction: z.enum(['up', 'down']) });

/** Decline all shown: the ids on the Pending table, as many as it lists at most. */
export const DeclineAllBody = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
