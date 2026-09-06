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

/**
 * The activity feed and the access report (docs/SPEC/audit.md section 9.2 and
 * 9.4). Imported by the routes and by the Audit screen.
 */

/** One line of the practice's whole trail. The sentence is composed server-side. */
export const ActivityEvent = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  sentence: z.string(),
  reason: z.string().nullable(),
  kind: z.enum(['create', 'change', 'read', 'system', 'other']),
  actor: z
    .object({ id: z.uuid().nullable(), name: z.string().nullable(), roles: z.array(z.string()) })
    .nullable(),
  entityType: z.string(),
  /** The record it touched, by its opaque id and its record number. Never a name. */
  clientId: z.uuid().nullable(),
  clientMrn: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ActivityResponse = z.object({
  events: z.array(ActivityEvent),
  nextBefore: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ActivityResponse = z.infer<typeof ActivityResponse>;

/** What the feed can be narrowed by, as the screen offers it. */
export const ActivityFilters = z.object({
  actors: z.array(z.object({ id: z.uuid(), name: z.string() })),
  entityTypes: z.array(z.string()),
  actions: z.array(z.string()),
});
export type ActivityFilters = z.infer<typeof ActivityFilters>;

/** One person who has read a record, and how much of it. */
export const AccessReportReader = z.object({
  actorId: z.uuid().nullable(),
  name: z.string().nullable(),
  roles: z.array(z.string()),
  reads: z.number().int().nonnegative(),
  firstAt: z.iso.datetime(),
  lastAt: z.iso.datetime(),
  /** Which kinds of row they opened, in the trail's own words. */
  entityTypes: z.array(z.string()),
});
export type AccessReportReader = z.infer<typeof AccessReportReader>;

export const AccessReportResponse = z.object({
  client: z.object({ id: z.uuid(), mrn: z.string() }),
  readers: z.array(AccessReportReader),
  /** When this answer was put together, so a printed copy says what it is. */
  generatedAt: z.iso.datetime(),
});
export type AccessReportResponse = z.infer<typeof AccessReportResponse>;
