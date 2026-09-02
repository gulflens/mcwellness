import { z } from 'zod';

/**
 * The shapes POST /api/sessions/:id/events accepts and returns. Imported by
 * the route now; by the check-in screen from the second pull request
 * (docs/CHANGE-REQUESTS/session-capture-01.md).
 */

export const SessionEventInput = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  // Widened to z.enum(SESSION_EVENT_KINDS) as later pull requests implement
  // the rest of the vocabulary (docs/SPEC/session-capture.md section 2).
  kind: z.literal('session_started'),
  deviceAt: z.iso.datetime(),
  payload: z.object({
    clientId: z.uuid(),
    serviceTypeId: z.uuid(),
    deliveryMode: z.enum(['home', 'studio', 'remote']),
    locationId: z.uuid().nullable(),
    point: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  }),
});
export type SessionEventInput = z.infer<typeof SessionEventInput>;

export const CheckInRequest = z.object({
  // A batch, matching the outbox's own shape, even though this pull request
  // only ever expects one event in it.
  events: z.array(SessionEventInput).min(1).max(20),
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
