import { z } from 'zod';
import { EMIRATES } from '../practice/schema';

/**
 * What the practitioners screen sends and is answered
 * (docs/SPEC/route-planning.md section 5.4, migration 913).
 *
 * **A name and a coordinate, and nothing else.** A home base is where a
 * member of staff lives, so the shape itself is the boundary: there is no
 * field here for a display address, an access note or a Makani number, and
 * the database never writes those on to a base row either
 * (`app.set_practitioner_base`). A screen cannot leak what the contract has
 * no room for.
 */

/** A coordinate, in the shape the routing answers already use. */
export const GeoPoint = z.object({ lat: z.number(), lng: z.number() });
export type GeoPoint = z.infer<typeof GeoPoint>;

export { EMIRATES } from '../practice/schema';
export type { Emirate } from '../practice/schema';

/**
 * A recorded base. `locationId` and `point` are `PracticeDayPractitioner`'s
 * own `homeBase` (app/api/routing/schema.ts), so the two answers describe the
 * same thing the same way; `emirate` is here because the ledger's row prints
 * it and the drawer opens on it, and it is the one fact about the row besides
 * the point that the practice keeps at all.
 */
export const PractitionerBase = z.object({
  locationId: z.uuid(),
  point: GeoPoint,
  emirate: z.enum(EMIRATES),
});
export type PractitionerBase = z.infer<typeof PractitionerBase>;

export const PractitionerRow = z.object({
  id: z.uuid(),
  displayName: z.string(),
  /** Whether this row is the person reading it, so the screen can say "You". */
  isYou: z.boolean(),
  base: PractitionerBase.nullable(),
});
export type PractitionerRow = z.infer<typeof PractitionerRow>;

export const PractitionerListResponse = z.object({
  practitioners: z.array(PractitionerRow),
  /**
   * `own` when the caller is being shown themselves and nobody else, so the
   * screen can say why the table has one row rather than leaving it looking
   * like a practice of one. Null for the office, who see everybody.
   */
  scope: z.enum(['own']).nullable(),
});
export type PractitionerListResponse = z.infer<typeof PractitionerListResponse>;

/**
 * Setting a base: two numbers and an emirate.
 *
 * The bounds are the world's, not the Emirates': a coordinate outside the
 * country is a mistake to be corrected on the screen, and a route that refused
 * one on geography would be a route deciding where a person is allowed to
 * live. `finite` rather than a plain number, so a body carrying a null,
 * an infinity or a NaN is a 400 rather than a point at the origin.
 */
export const SetBaseInput = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  emirate: z.enum(EMIRATES),
});
export type SetBaseInput = z.infer<typeof SetBaseInput>;

export const PractitionerBaseResponse = z.object({ practitioner: PractitionerRow });
export type PractitionerBaseResponse = z.infer<typeof PractitionerBaseResponse>;
