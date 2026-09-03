import type {
  BandAmplitudes,
  ObservationChip,
  PhotoCapturedPayload,
  PreflightItem,
  RatingAnswer,
  SignalSite,
} from './events';

/**
 * Shared shapes for the session-capture module (docs/SPEC/session-capture.md).
 * A session has exactly one author — the practitioner on that device, during
 * that visit — so there is nothing here about merging two people's writes,
 * only about replaying one person's events in order (section 2).
 *
 * The payload schemas themselves live in ./events.ts. This file imports them
 * as types only, so the two files describe each other without either one
 * needing the other at run time.
 */

/** A visit's delivery setting (00-data-model.md section 2). */
export type DeliveryMode = 'home' | 'studio' | 'remote';

/** The consent purposes the check-in gate reads (00-data-model.md section 3). */
export type CheckInConsentPurpose = 'participation' | 'minor_participation' | 'home_visit';

/** The full event vocabulary from session-capture.md section 2. */
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
 * One event as replayEvents receives it: shape-compatible with a
 * session_event row. The payload is `unknown` on purpose — replay parses it
 * against ./events.ts's schema for that kind, so a row written by an older
 * or a newer device is a fact to be examined, never a type to be trusted.
 */
export type SessionEvent = {
  /** Client-generated; the idempotency key, both in the outbox and in replay. */
  id: string;
  sessionId: string;
  seq: number;
  kind: SessionEventKind;
  payload: unknown;
  /** ISO 8601 — the device's own clock, not the server's receipt time. */
  deviceAt: string;
};

/**
 * How far through the visit the event stream has carried it. Distinct from
 * `session.status` in the database on purpose: the row reaches `completed`
 * only when the server has the `checked_out` event *and* the practitioner
 * has confirmed the summary (section 2), which is the close route's
 * judgement to make, not the projection's.
 */
export type SessionPhase = 'in_progress' | 'ended' | 'checked_out';

/** One telemetry chunk as the projection holds it, in arrival order. */
export type TelemetrySample = {
  seconds: number;
  artefactPercent: number;
  timeInRewardPercent: number;
  bands: BandAmplitudes;
  threshold: number | null;
  /** The device's own clock at the moment the chunk was written. */
  at: string;
};

export type SignalReading = {
  sites: readonly SignalSite[];
  overridden: boolean;
  at: string;
};

export type PostObservations = {
  chips: readonly ObservationChip[];
  tolerance: number | null;
  engagement: number | null;
  note: string | null;
};

/**
 * The session row as a projection of its events ("the session is the
 * projection", section 2). Deterministic: the same set of events, in any
 * order and with any duplicates, always folds to exactly this.
 */
export type SessionProjection = {
  phase: SessionPhase;
  practitionerId: string;
  serviceTypeId: string;
  deliveryMode: DeliveryMode;
  locationId: string | null;
  checkedInAt: string;
  /** The pre-flight checklist as the practitioner left it, latest wins. */
  preflight: readonly PreflightItem[];
  preRating: readonly RatingAnswer[];
  postRating: readonly RatingAnswer[];
  /** The last signal check taken; earlier ones stay in the event log. */
  signal: SignalReading | null;
  telemetry: readonly TelemetrySample[];
  observations: PostObservations | null;
  photo: PhotoCapturedPayload | null;
  /**
   * When the training itself began: what `session_ended` reported, or — for a
   * visit whose end event has not arrived — the earliest telemetry chunk, so
   * a phone lost mid-run still leaves a record with a shape.
   */
  startedAt: string | null;
  endedAt: string | null;
  checkedOutAt: string | null;
};
