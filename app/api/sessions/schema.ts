import { z } from 'zod';
import { EVENT_PAYLOAD_SCHEMAS } from '@domain/session';

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
// time, not from the pure gate. 'not_booked_today' is the one generic reason
// app.checkin_context's found = false stands for — an unknown client, a
// foreign-tenant client, or a real client with no qualifying appointment
// today, all indistinguishable on purpose (checkin.ts) — surfaced as a
// 400 with this detail, not a 422 'blocked' response, but named here
// alongside every other reason this module can cite rather than left as a
// bare string literal.
export const CHECK_IN_BLOCK_REASONS = [
  'not_authorised',
  'consent_missing_participation',
  'consent_missing_minor_participation',
  'consent_missing_home_visit',
  'date_of_birth_unknown',
  'already_checked_in',
  'not_booked_today',
  'kit_calibration_overdue',
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

// GET /api/sessions/service-types (app/api/sessions/service-types.ts): the
// service types the caller may run a session for today, driving the check-in
// screen's own picker. Same shape as app/api/billing/service-types.ts's
// ServiceTypeOption — a different door reading the same table for a
// different audience (every active service in the catalogue there; only the
// caller's own credentialed ones here) — kept as its own type in this
// module's own schema file rather than a shared import, matching how this
// stream keeps to app/api/sessions/**.
export const ChecklistItem = z.object({
  key: z.string().min(1).max(64),
  labelEn: z.string(),
  labelAr: z.string(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const RatingQuestion = ChecklistItem.extend({
  min: z.number().int(),
  max: z.number().int(),
});
export type RatingQuestion = z.infer<typeof RatingQuestion>;

export const ServiceTypeOption = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  /**
   * The pre-flight toggles and the 0-10 questions this service asks
   * (docs/SPEC/session-capture.md sections 3.2 and 3.5). Settings, not code:
   * they live on service_type as jsonb, edited by the practice.
   *
   * Both arrive empty until the trunk's shared-zone round 14 adds the two
   * columns; see ./service-types.ts for how this route reads them either way.
   */
  preflightChecklist: z.array(ChecklistItem).default([]),
  ratingQuestions: z.array(RatingQuestion).default([]),
});
export type ServiceTypeOption = z.infer<typeof ServiceTypeOption>;

export const ServiceTypesResponse = z.object({
  serviceTypes: z.array(ServiceTypeOption),
});
export type ServiceTypesResponse = z.infer<typeof ServiceTypesResponse>;

// ---------------------------------------------------------------------------
// The rest of the visit: everything POST /api/sessions/:id/events accepts
// after the opening event, and the two routes that read and close a session
// (docs/SPEC/session-capture.md sections 3 and 4).
// ---------------------------------------------------------------------------

/**
 * The seven kinds a device appends to a visit already open. `session_started`
 * is not among them: it opens the visit, it is the one event the check-in
 * route writes, and its wire shape (SessionEventInput above) deliberately
 * omits the practitioner id — the server fills that in from who is calling,
 * never from what the caller claims.
 */
export const APPEND_EVENT_KINDS = [
  'signal_checked',
  'telemetry_chunk',
  'rating_recorded',
  'observation_recorded',
  'photo_captured',
  'session_ended',
  'checked_out',
] as const;
export type AppendEventKind = (typeof APPEND_EVENT_KINDS)[number];

const appendEventSchema = <K extends AppendEventKind>(kind: K) =>
  z.object({
    id: z.uuid(),
    seq: z.number().int().positive(),
    kind: z.literal(kind),
    deviceAt: z.iso.datetime(),
    payload: EVENT_PAYLOAD_SCHEMAS[kind],
  });

/**
 * One event on the wire. The payload schemas are the domain's own
 * (domain/session/events.ts), so the shape the device queues, the shape the
 * route accepts and the shape replayEvents folds are one definition rather
 * than three that drift.
 *
 * Written out one call per kind rather than mapped over APPEND_EVENT_KINDS:
 * a mapped array is a `ZodObject[]`, and the union built from it would infer
 * every payload as `unknown`, which is precisely the checking this exists to
 * do. The `satisfies` below is what keeps the list honest — a kind added to
 * APPEND_EVENT_KINDS and forgotten here fails to compile.
 */
export const SessionEventWire = z.discriminatedUnion('kind', [
  SessionEventInput,
  appendEventSchema('signal_checked'),
  appendEventSchema('telemetry_chunk'),
  appendEventSchema('rating_recorded'),
  appendEventSchema('observation_recorded'),
  appendEventSchema('photo_captured'),
  appendEventSchema('session_ended'),
  appendEventSchema('checked_out'),
]);
export type SessionEventWire = z.infer<typeof SessionEventWire>;

/**
 * A flush from the outbox. Deliberately permissive about the client fields:
 * only the check-in branch reads them, and CheckInRequest above is what
 * holds that branch to exactly one of clientId and clientMrn. An append
 * carries neither, because the visit already knows whose it is.
 *
 * Fifty events is a whole visit and then some — a 45-minute run writes 45
 * telemetry chunks — so a device that has been offline all afternoon still
 * flushes in a handful of requests rather than a hundred.
 */
/** Proof the union above lists every append kind, checked by the compiler. */
type WireKinds = SessionEventWire['kind'];
type MissingWireKind = Exclude<AppendEventKind, WireKinds>;
const NO_MISSING_WIRE_KIND: MissingWireKind[] = [];
void NO_MISSING_WIRE_KIND;

export const SessionEventsRequest = z.object({
  clientId: z.uuid().optional(),
  clientMrn: ClientMrn.optional(),
  point: GeoPoint.nullable().optional(),
  events: z.array(SessionEventWire).min(1).max(50),
});
export type SessionEventsRequest = z.infer<typeof SessionEventsRequest>;

/**
 * Why one event of a batch was not stored. The outbox needs to tell a
 * refusal it should stop retrying from a failure it should retry: everything
 * named here is the former, and the device drops the event and carries on.
 */
export const EVENT_REFUSAL_REASONS = [
  'duplicate_seq',
  'device_clock_out_of_range',
  'consent_missing_photo_video',
  // Nowhere to put a photograph's bytes yet — see ./photo-availability.ts.
  // Temporary by design; it goes when the storage seam lands.
  'photo_storage_unavailable',
  // A check-out coordinate on a visit the practitioner declined to share at
  // the door. Section 3.6's rule, held by the server rather than the device.
  'location_not_shared_at_check_in',
] as const;
export type EventRefusalReason = (typeof EVENT_REFUSAL_REASONS)[number];

/** How far the visit has got, as the server sees it after a flush. */
export const SessionState = z.object({
  id: z.uuid(),
  phase: z.enum(['in_progress', 'ended', 'checked_out']),
  checkedInAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  checkedOutAt: z.iso.datetime().nullable(),
  signalQualityScore: z.number().min(0).max(1).nullable(),
  closed: z.boolean(),
  /** The highest seq the server holds, so a device knows where it stands. */
  lastSeq: z.number().int().min(0),
});
export type SessionState = z.infer<typeof SessionState>;

export const EventsResponse = z.object({
  status: z.literal('stored'),
  /** Ids the server now holds. The outbox deletes exactly these. */
  acknowledged: z.array(z.uuid()),
  /** Ids the server will never hold, with the reason. The outbox drops these too. */
  refused: z.array(z.object({ id: z.uuid(), reason: z.enum(EVENT_REFUSAL_REASONS) })),
  session: SessionState,
});
export type EventsResponse = z.infer<typeof EventsResponse>;

/**
 * The visit the practitioner left open, offered on the next load as "Resume
 * session for Client L., started 14:32" (section 2). One given name and one
 * family initial: the same reduction the day sheet already makes
 * (app/api/appointments/schema.ts), so a full family name never reaches the
 * browser for this either.
 */
export const OpenSession = z.object({
  id: z.uuid(),
  clientGivenName: z.string(),
  clientFamilyInitial: z.string().nullable(),
  serviceTypeId: z.uuid(),
  serviceName: z.string(),
  deliveryMode: z.enum(['home', 'studio', 'remote']),
  checkedInAt: z.iso.datetime(),
  phase: z.enum(['in_progress', 'ended', 'checked_out']),
  /** N of M (domain/session/sessionNumber.ts). `of` is null when unknown. */
  number: z.number().int().positive(),
  of: z.number().int().positive().nullable(),
  lastSeq: z.number().int().min(0),
});
export type OpenSession = z.infer<typeof OpenSession>;

export const OpenSessionResponse = z.object({ session: OpenSession.nullable() });
export type OpenSessionResponse = z.infer<typeof OpenSessionResponse>;

/**
 * What the practitioner records at the door on the way out (section 3.6).
 * Money in integer fils; Salik as the count of gantries crossed, because
 * that is what a person can actually count, with the cost resolved from a
 * tariff elsewhere.
 */
export const VisitActualsInput = z.object({
  driveSeconds: z.number().int().min(0).max(86_400).nullable().default(null),
  walkSeconds: z.number().int().min(0).max(7_200).nullable().default(null),
  salikCrossings: z.number().int().min(0).max(50).default(0),
  parkingCostFils: z.number().int().min(0).max(100_000).default(0),
  accessIssues: z.string().max(1000).nullable().default(null),
});
export type VisitActualsInput = z.infer<typeof VisitActualsInput>;

/**
 * `PUT /api/sessions/:id/photo` (app/api/sessions/photo.ts). 201 the first
 * time, 200 on an idempotent retry of the same digest; the body is the same
 * either way, because the device only wants to know it may drop the blob.
 */
export const PhotoFiledResponse = z.object({
  status: z.literal('filed'),
  documentId: z.uuid(),
});
export type PhotoFiledResponse = z.infer<typeof PhotoFiledResponse>;

/** `GET /api/sessions/photo/:documentId/link` (app/api/sessions/photo-link.ts). */
export const PhotoLinkResponse = z.object({
  url: z.string(),
  /**
   * The document's own media type. The pre-flight step fetches the bytes and
   * shows them inline rather than opening a link (section 4.5), and a blob
   * needs its type named: the local store answers `application/octet-stream`
   * with `content-disposition: attachment`, which is a download, not a
   * picture.
   */
  mimeType: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type PhotoLinkResponse = z.infer<typeof PhotoLinkResponse>;

export const CloseRequest = z.object({ visitActuals: VisitActualsInput });
export type CloseRequest = z.infer<typeof CloseRequest>;

export const CLOSE_REFUSAL_REASONS = ['not_checked_out', 'session_not_open'] as const;
export type CloseRefusalReason = (typeof CLOSE_REFUSAL_REASONS)[number];

export const CloseResponse = z.object({
  status: z.literal('closed'),
  sessionId: z.uuid(),
  closedAt: z.iso.datetime(),
  signalQualityScore: z.number().min(0).max(1).nullable(),
  durationSeconds: z.number().int().min(0).nullable(),
  observationFlag: z.boolean(),
  /** Null when no photo was taken, or when consent did not allow one. */
  setupPhotoDocumentId: z.uuid().nullable(),
});
export type CloseResponse = z.infer<typeof CloseResponse>;
