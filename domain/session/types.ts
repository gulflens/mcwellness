/**
 * Shared shapes for the session-capture module (docs/SPEC/session-capture.md).
 * A session has exactly one author — the practitioner on that device, during
 * that visit — so there is nothing here about merging two people's writes,
 * only about replaying one person's events in order (section 2).
 */

/** A visit's delivery setting (00-data-model.md section 2). */
export type DeliveryMode = 'home' | 'studio' | 'remote';

/** The consent purposes the check-in gate reads (00-data-model.md section 3). */
export type CheckInConsentPurpose = 'participation' | 'minor_participation' | 'home_visit';

/**
 * The full event vocabulary from session-capture.md section 2. This pull
 * request implements only 'session_started'; the rest are reserved so the
 * event store's shape does not need a migration when each later screen
 * (pre-flight, signal check, run, end, summary) arrives.
 */
export const SESSION_EVENT_KINDS = [
  'session_started',
  'signal_checked',
  'telemetry_chunk',
  'rating_recorded',
  'observation_recorded',
  'photo_captured',
  'session_ended',
  'checked_out',
] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

export type GeoPoint = { lat: number; lng: number };

/**
 * The payload of a 'session_started' event — everything replayEvents needs
 * to open a visit, except the client and the door coordinate. Those are
 * session-level facts, not event history: the session row is their one
 * record (checked in by the route directly, never through this payload),
 * so they are never duplicated into the append-only event log.
 */
export type SessionStartedPayload = {
  practitionerId: string;
  serviceTypeId: string;
  deliveryMode: DeliveryMode;
  locationId: string | null;
};

/** One event as replayEvents receives it: shape-compatible with a session_event row. */
export type SessionEvent = {
  /** Client-generated; the idempotency key, both in the outbox and in replay. */
  id: string;
  sessionId: string;
  seq: number;
  kind: SessionEventKind;
  payload: SessionStartedPayload | Record<string, unknown>;
  /** ISO 8601 — the device's own clock, not the server's receipt time. */
  deviceAt: string;
};

/**
 * The session row as a projection of its events ("the session is the
 * projection", section 2). This pull request's replay can only ever reach
 * 'in_progress': the states beyond it need events this module does not yet
 * write.
 */
export type SessionProjection = {
  status: 'in_progress';
  practitionerId: string;
  serviceTypeId: string;
  deliveryMode: DeliveryMode;
  locationId: string | null;
  checkedInAt: string;
};
