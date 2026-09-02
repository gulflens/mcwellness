import { z } from 'zod';

/**
 * The shapes POST /api/sessions/:id/events accepts and returns. Imported by
 * the route now; by the check-in screen from the second pull request
 * (docs/CHANGE-REQUESTS/session-capture-01.md).
 */

// A coordinate on the earth, bounded at the boundary: a device with a bad
// fix (a stray zero, a swapped axis) fails validation once, here, rather
// than throwing deep in PostGIS and being retried forever by the outbox.
export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const SessionEventInput = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  // Widened to z.enum(SESSION_EVENT_KINDS) as later pull requests implement
  // the rest of the vocabulary (docs/SPEC/session-capture.md section 2).
  kind: z.literal('session_started'),
  deviceAt: z.iso.datetime(),
  // No clientId, no point: those are session-level facts recorded once, on
  // the session row itself, never duplicated into the event log (see
  // domain/session/types.ts's SessionStartedPayload).
  payload: z.object({
    serviceTypeId: z.uuid(),
    deliveryMode: z.enum(['home', 'studio', 'remote']),
    locationId: z.uuid().nullable(),
  }),
});
export type SessionEventInput = z.infer<typeof SessionEventInput>;

// A client record number (docs/SPEC/00-data-model.md: "MW-000001, allocated
// by domain/client"), typed by a practitioner who does not already have the
// client's id to hand — the walk-up case the check-in screen (pull request
// 24) adds alongside picking a client from a list.
export const ClientMrn = z.string().regex(/^MW-\d{6,}$/, 'Not a valid record number');

export const CheckInRequest = z
  .object({
    // The client and the door coordinate: session-level, carried once here
    // rather than inside each event's payload. Exactly one of clientId and
    // clientMrn is given — never both, never neither — and
    // app.checkin_context (db/migrations/301_checkin_context.sql) resolves
    // whichever the caller sent; the refine below is the edge that catches a
    // caller mixing or omitting both before either reaches the database.
    clientId: z.uuid().optional(),
    clientMrn: ClientMrn.optional(),
    point: GeoPoint.nullable(),
    // A batch, matching the outbox's own shape, even though this pull request
    // only ever expects one event in it.
    events: z.array(SessionEventInput).min(1).max(20),
  })
  .refine((value) => (value.clientId === undefined) !== (value.clientMrn === undefined), {
    message: 'Provide exactly one of clientId or clientMrn.',
    path: ['clientId'],
  });
export type CheckInRequest = z.infer<typeof CheckInRequest>;

// The domain's CheckInBlockReason plus reasons only the route can discover:
// 'already_checked_in' comes from the one-open-visit constraint at insert
// time, not from the pure gate.
export const CHECK_IN_BLOCK_REASONS = [
  'not_authorised',
  'consent_missing_participation',
  'consent_missing_minor_participation',
  'consent_missing_home_visit',
  'date_of_birth_unknown',
  'already_checked_in',
] as const;
export type CheckInResponseReason = (typeof CHECK_IN_BLOCK_REASONS)[number];

export const CheckInResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('checked_in'),
    sessionId: z.uuid(),
    checkedInAt: z.iso.datetime(),
  }),
  z.object({
    status: z.literal('blocked'),
    reasons: z.array(z.enum(CHECK_IN_BLOCK_REASONS)),
  }),
]);
export type CheckInResponse = z.infer<typeof CheckInResponse>;
