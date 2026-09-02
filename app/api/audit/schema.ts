import { z } from 'zod';

/** The shapes the record timeline returns. Imported by the route and by the browser. */

export const TimelineEvent = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  sentence: z.string(),
  reason: z.string().nullable(),
  kind: z.enum(['create', 'change', 'read', 'system', 'other']),
  actor: z.object({ name: z.string().nullable(), roles: z.array(z.string()) }).nullable(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TimelineResponse = z.object({
  events: z.array(TimelineEvent),
  /** Pass back as `before` to load the page before this one; null when this was the last. */
  nextBefore: z.string().nullable(),
  hasMore: z.boolean(),
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;
