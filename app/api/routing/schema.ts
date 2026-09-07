import { z } from 'zod';

/**
 * What `GET /api/routing/day` answers (docs/SPEC/practitioner-phone.md
 * sections 5.2 and 5.4).
 *
 * **Nothing here names anybody.** A leg is two opaque location ids, the
 * appointment id of the stop it arrives at, a duration, a distance and where
 * the figure came from. The day sheet already holds the household's own line;
 * this answer is about the road between them.
 */

/** Where an estimate came from, and the word the screen prints beside it. */
export const DRIVE_SOURCES = ['traffic', 'straight-line'] as const;
export type DriveSourceName = (typeof DRIVE_SOURCES)[number];

export const DayLegRow = z.object({
  /** The stop this leg arrives at: the day sheet renders the line above that card. */
  toStopId: z.uuid(),
  fromLocationId: z.uuid(),
  toLocationId: z.uuid(),
  /** When the practitioner can set off. Rendered nowhere: it is the estimate's own hour. */
  departAt: z.iso.datetime(),
  seconds: z.number().int().min(0),
  metres: z.number().int().min(0),
  source: z.enum(DRIVE_SOURCES),
});
export type DayLegRow = z.infer<typeof DayLegRow>;

export const RoutingDayResponse = z.object({
  /** In stop order. Empty on a day with no stops, and on a single stop with no home base. */
  legs: z.array(DayLegRow),
  /**
   * Where the day's picture can be fetched, or null when this deployment draws
   * none. A path on this API's own origin, never a vendor's: the content
   * security policy is untouched and the key never reaches a browser
   * (spec section 3.6, decision 2).
   */
  pictureUrl: z.string().nullable(),
  /**
   * Whether every figure above came from the fallback. The screen says the map
   * needs the practice's key when it did, rather than showing an empty frame.
   */
  mapAvailable: z.boolean(),
});
export type RoutingDayResponse = z.infer<typeof RoutingDayResponse>;

/**
 * A coordinate, declared here rather than imported from the appointments
 * schema: this file is the routing answer's own contract and a screen that
 * draws a map should not have to depend on the booking shapes to read it.
 */
const GeoPoint = z.object({ lat: z.number(), lng: z.number() });

/** One stop on the practice's day map: opaque ids, a coordinate and a window. Never a name. */
export const PracticeDayStop = z.object({
  appointmentId: z.uuid(),
  locationId: z.uuid(),
  point: GeoPoint,
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.string(),
});
export type PracticeDayStop = z.infer<typeof PracticeDayStop>;

export const PracticeDayPractitioner = z.object({
  practitionerId: z.uuid(),
  /** Where their day starts, when the practice records one. */
  homeBase: z.object({ locationId: z.uuid(), point: GeoPoint }).nullable(),
  /** In window order. */
  stops: z.array(PracticeDayStop),
  /** One per drive between consecutive places, in the same order. */
  legs: z.array(DayLegRow),
});
export type PracticeDayPractitioner = z.infer<typeof PracticeDayPractitioner>;

export const PracticeDayResponse = z.object({
  practitioners: z.array(PracticeDayPractitioner),
});
export type PracticeDayResponse = z.infer<typeof PracticeDayResponse>;

export const OptimiseDayRequest = z.object({
  date: z.iso.date(),
  practitionerId: z.uuid(),
});
export type OptimiseDayRequest = z.infer<typeof OptimiseDayRequest>;

export const PLAN_SOURCES = ['traffic', 'straight-line', 'mixed'] as const;
export const PLAN_REFUSALS = [
  'nothing_to_move',
  'no_improvement',
  'infeasible',
  'too_many_stops',
] as const;

export const PlanTotals = z.object({
  driveSeconds: z.number().int().min(0),
  driveMetres: z.number().int().min(0),
  dayEnd: z.iso.datetime(),
});

/** One visit in the plan, in the new order. `wasWindowStart` is what the reorder is checked against. */
export const PlannedStopRow = z.object({
  appointmentId: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  wasWindowStart: z.iso.datetime(),
  travelBufferMinutes: z.number().int().min(15).max(90),
  moved: z.boolean(),
  anchor: z.boolean(),
});
export type PlannedStopRow = z.infer<typeof PlannedStopRow>;

export const OptimiseDayResponse = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plan'),
    stops: z.array(PlannedStopRow),
    before: PlanTotals,
    after: PlanTotals,
    savedSeconds: z.number().int(),
    source: z.enum(PLAN_SOURCES),
  }),
  z.object({ kind: z.literal('refusal'), reason: z.enum(PLAN_REFUSALS) }),
]);
export type OptimiseDayResponse = z.infer<typeof OptimiseDayResponse>;
