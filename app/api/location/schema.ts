import { z } from 'zod';

/**
 * The wire for live location (docs/SPEC/dispatch.md section 15). Shared by
 * the routes in ./routes.ts, the practitioner's switch
 * (app/therapist/location/) and the board (app/admin/schedule/board/).
 */

/** What the practitioner's own app needs to draw the switch and the band. */
export const LocationMeResponse = z.object({
  /**
   * Whether this person can share at all: somebody with a working practitioner
   * row of their own. An admin with no day of visits has nothing to share.
   */
  eligible: z.boolean(),
  /** The notice version a consent must name. */
  noticeVersion: z.string(),
  /** The standing consent, or null when there is none. */
  consent: z.object({ noticeVersion: z.string(), givenAt: z.iso.datetime() }).nullable(),
  sharingOn: z.boolean(),
  /** Whether the shift is open now, so the band can say whether anything is being sent. */
  shiftOpen: z.boolean(),
  /**
   * Sent to a helper alone (docs/SPEC/dispatch.md section 15.12): the first
   * name of the practitioner they accompany now, or null when they accompany
   * nobody. Absent for everybody else, so a practitioner's answer is as it was.
   */
  accompanies: z.string().nullable().optional(),
});
export type LocationMeResponse = z.infer<typeof LocationMeResponse>;

export const GiveConsentInput = z.object({ noticeVersion: z.string().min(1).max(20) });

export const SetSharingInput = z.object({ on: z.boolean() });

/** One fix from the browser's own geolocation, never from a vendor. */
export const PositionInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMetres: z.number().min(0).max(100_000),
});
export type PositionInput = z.infer<typeof PositionInput>;

export const POSITION_REFUSALS = [
  'no_consent',
  'notice_changed',
  'sharing_off',
  'off_shift',
] as const;

export const PositionRefused = z.object({
  error: z.literal('position_refused'),
  code: z.enum(POSITION_REFUSALS),
  requestId: z.string(),
});

/** The last position of somebody sharing now, as the board reads it. */
export const SharedPosition = z.object({
  practitionerId: z.uuid(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMetres: z.number(),
  recordedAt: z.iso.datetime(),
  /** Whole minutes old, by the server's clock. */
  ageMinutes: z.number().int().min(0),
});
export type SharedPosition = z.infer<typeof SharedPosition>;

/**
 * A helper's last position, as the board reads it (section 15.12): marked as
 * a helper's, by first name, and placed beside the practitioner they
 * accompany. Never their own row on the board: a helper has no visits.
 */
export const SharedHelperPosition = z.object({
  accompaniesPractitionerId: z.uuid(),
  firstName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMetres: z.number(),
  recordedAt: z.iso.datetime(),
  ageMinutes: z.number().int().min(0),
});
export type SharedHelperPosition = z.infer<typeof SharedHelperPosition>;

export const SharedPositionsResponse = z.object({
  positions: z.array(SharedPosition),
  /** Defaulted so an answer from before helpers existed still parses. */
  helpers: z.array(SharedHelperPosition).default([]),
});
export type SharedPositionsResponse = z.infer<typeof SharedPositionsResponse>;
