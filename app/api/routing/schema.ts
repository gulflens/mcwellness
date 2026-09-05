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
