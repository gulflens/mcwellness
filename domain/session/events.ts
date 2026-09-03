import { z } from 'zod';
import { SESSION_EVENT_KINDS, type SessionEventKind } from './types';

/**
 * The event vocabulary of a visit (docs/SPEC/session-capture.md section 2),
 * one payload schema per kind. These are the shapes the device writes into
 * its outbox, the shapes POST /api/sessions/:id/events accepts, and the
 * shapes replayEvents folds — one definition, not three.
 *
 * Two of the eight kinds carry more than their name suggests, and both
 * choices are deliberate rather than convenient:
 *
 * - `observation_recorded` covers both the pre-flight checklist (section
 *   3.2) and the after-session observations (section 3.5). Both are the
 *   practitioner recording a structured judgement about the visit; the
 *   `topic` field says which. The alternative — a ninth event kind — would
 *   mean altering session_event_kind, and section 2's vocabulary is fixed.
 * - `rating_recorded` carries the 0-10 sliders for both phases, `pre` and
 *   `post`, because they are literally the same questions asked twice
 *   (section 3.5: "same questions as pre").
 *
 * Nothing here carries a name, a phone number, a record number or a
 * coordinate except `checked_out`'s own point, which section 3.6 asks for
 * and section 7 governs. The client is a fact of the session row, recorded
 * once at check-in, never repeated into the append-only log.
 */

/** A coordinate, bounded at the boundary so a bad fix fails once rather than being retried forever. */
export const EventGeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const SessionStartedPayload = z.object({
  practitionerId: z.uuid(),
  serviceTypeId: z.uuid(),
  deliveryMode: z.enum(['home', 'studio', 'remote']),
  locationId: z.uuid().nullable(),
});
export type SessionStartedPayload = z.infer<typeof SessionStartedPayload>;

/**
 * One electrode placement and the quality the practitioner read off the
 * amplifier's own software (section 3.3: manual entry in Phase 1). `site` is
 * a placement label such as Cz or C3 — equipment, not a person.
 */
export const SignalSite = z.object({
  site: z.string().min(1).max(16),
  quality: z.number().min(0).max(1),
});
export type SignalSite = z.infer<typeof SignalSite>;

export const SignalCheckedPayload = z.object({
  sites: z.array(SignalSite).min(1).max(32),
  /** True when the practitioner chose to carry on below the threshold (section 3.3). */
  overridden: z.boolean(),
});
export type SignalCheckedPayload = z.infer<typeof SignalCheckedPayload>;

/** The five bands, slow to fast (docs/DESIGN-BRIEF.md section 3.1). */
export const BAND_KEYS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

/**
 * Per-band amplitude, every band optional: Phase 1 accepts whatever the
 * practitioner has to hand, and an amplifier that exports three bands is not
 * a malformed reading (section 3.4).
 */
export const BandAmplitudes = z.object({
  delta: z.number().min(0).optional(),
  theta: z.number().min(0).optional(),
  alpha: z.number().min(0).optional(),
  beta: z.number().min(0).optional(),
  gamma: z.number().min(0).optional(),
});
export type BandAmplitudes = z.infer<typeof BandAmplitudes>;

/**
 * A minute of the run, or — where per-minute data is not available — the
 * single end-of-session summary section 3.4 explicitly allows. `seconds` is
 * what the chunk covers, so the two forms weigh correctly in the same mean
 * (scoreSignalQuality) rather than a summary counting the same as a minute.
 */
export const TelemetryChunkPayload = z.object({
  seconds: z.number().int().min(1).max(21_600),
  /** Share of the window rejected as artefact, 0-100. */
  artefactPercent: z.number().min(0).max(100),
  /** Share of the window spent in the reward state, 0-100. */
  timeInRewardPercent: z.number().min(0).max(100),
  bands: BandAmplitudes.default({}),
  threshold: z.number().min(0).nullable().default(null),
});
export type TelemetryChunkPayload = z.infer<typeof TelemetryChunkPayload>;

export const RatingAnswer = z.object({
  /** The question's own key from service_type.rating_questions. */
  key: z.string().min(1).max(64),
  value: z.number().int().min(0).max(10),
});
export type RatingAnswer = z.infer<typeof RatingAnswer>;

export const RatingRecordedPayload = z.object({
  phase: z.enum(['pre', 'post']),
  answers: z.array(RatingAnswer).max(12),
});
export type RatingRecordedPayload = z.infer<typeof RatingRecordedPayload>;

/** The after-session chips (section 3.5). `none` is a real answer, not an absence. */
export const OBSERVATION_CHIPS = ['none', 'headache', 'fatigue', 'irritability', 'other'] as const;
export type ObservationChip = (typeof OBSERVATION_CHIPS)[number];

export const PreflightItem = z.object({
  key: z.string().min(1).max(64),
  done: z.boolean(),
});
export type PreflightItem = z.infer<typeof PreflightItem>;

export const ObservationRecordedPayload = z.discriminatedUnion('topic', [
  z.object({
    topic: z.literal('preflight'),
    items: z.array(PreflightItem).max(20),
  }),
  z.object({
    topic: z.literal('post'),
    chips: z.array(z.enum(OBSERVATION_CHIPS)).max(OBSERVATION_CHIPS.length),
    /** 0-10, or null when the practitioner left it alone. */
    tolerance: z.number().int().min(0).max(10).nullable(),
    engagement: z.number().int().min(0).max(10).nullable(),
    note: z.string().max(1000).nullable(),
  }),
]);
export type ObservationRecordedPayload = z.infer<typeof ObservationRecordedPayload>;

/**
 * The setup photo's metadata only. The bytes never travel inside an event:
 * the API's body cap is 64 KB (app/api/create-api.ts) and a compressed photo
 * is up to 1 MB, so the device holds the bytes in its own outbox and the
 * upload door is its own request. Until the trunk's StorageProvider lands
 * (round 14), the close route writes the document row and the bytes follow —
 * see docs/CHANGE-REQUESTS/session-capture-02.md.
 *
 * No storage key here on purpose. A key supplied by a caller is a key that
 * can name another visit's object; the server derives it from the session's
 * own id and this mime type instead, so the only thing a device can say
 * about where its photo goes is nothing at all.
 */
export const PhotoCapturedPayload = z.object({
  mimeType: z.enum(['image/jpeg', 'image/webp', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Not a sha256 digest'),
});
export type PhotoCapturedPayload = z.infer<typeof PhotoCapturedPayload>;

/**
 * The run has stopped. When it stopped is the event's own device_at; when it
 * began is carried here, because the run screen is the only thing that knows
 * — the visit opened at check-in, minutes earlier, and section 3.4's elapsed
 * timer starts when the practitioner starts training, not when they arrived.
 */
export const SessionEndedPayload = z.object({
  startedAt: z.iso.datetime(),
});
export type SessionEndedPayload = z.infer<typeof SessionEndedPayload>;

/**
 * The practitioner has confirmed the summary and is leaving (section 3.6).
 * The point rides only when sharing was switched on at check-in; a decline
 * is a null, never a block (section 7).
 */
export const CheckedOutPayload = z.object({
  point: EventGeoPoint.nullable(),
});
export type CheckedOutPayload = z.infer<typeof CheckedOutPayload>;

/** Every payload schema, by kind. One table, so nothing can drift out of step. */
export const EVENT_PAYLOAD_SCHEMAS = {
  session_started: SessionStartedPayload,
  signal_checked: SignalCheckedPayload,
  telemetry_chunk: TelemetryChunkPayload,
  rating_recorded: RatingRecordedPayload,
  observation_recorded: ObservationRecordedPayload,
  photo_captured: PhotoCapturedPayload,
  session_ended: SessionEndedPayload,
  checked_out: CheckedOutPayload,
} as const satisfies Record<SessionEventKind, z.ZodType>;

/** Proof the table above covers the whole vocabulary, checked at module load, not by eye. */
const MISSING = SESSION_EVENT_KINDS.filter((kind) => !(kind in EVENT_PAYLOAD_SCHEMAS));
if (MISSING.length > 0) {
  throw new Error(`No payload schema for session event kind(s): ${MISSING.join(', ')}`);
}

/**
 * One event as the device queues it. Written out one call per kind rather
 * than mapped over SESSION_EVENT_KINDS: a mapped array is a `ZodObject[]`,
 * and a union built from it infers every payload as `unknown`, which is the
 * checking this exists to do. The MissingKind line below is what keeps the
 * list honest — a kind added to the vocabulary and forgotten here fails to
 * compile.
 */
const envelopeFor = <K extends SessionEventKind>(kind: K) =>
  z.object({
    /** Client-generated; the idempotency key, in the outbox and in replay alike. */
    id: z.uuid(),
    seq: z.number().int().positive(),
    kind: z.literal(kind),
    /** ISO 8601 from the device's own clock, never the server's receipt time. */
    deviceAt: z.iso.datetime(),
    payload: EVENT_PAYLOAD_SCHEMAS[kind],
  });

export const SessionEventEnvelope = z.discriminatedUnion('kind', [
  envelopeFor('session_started'),
  envelopeFor('signal_checked'),
  envelopeFor('telemetry_chunk'),
  envelopeFor('rating_recorded'),
  envelopeFor('observation_recorded'),
  envelopeFor('photo_captured'),
  envelopeFor('session_ended'),
  envelopeFor('checked_out'),
]);
export type SessionEventEnvelope = z.infer<typeof SessionEventEnvelope>;

type MissingKind = Exclude<SessionEventKind, SessionEventEnvelope['kind']>;
const NO_MISSING_KIND: MissingKind[] = [];
void NO_MISSING_KIND;

/**
 * Parses one event of a known kind, returning null rather than throwing: a
 * malformed payload is a fact about one row in an append-only log, and
 * replaying the rest of the visit is more useful than refusing to project it
 * at all.
 */
export function parseEventPayload<K extends SessionEventKind>(
  kind: K,
  payload: unknown,
): z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[K]> | null {
  const parsed = EVENT_PAYLOAD_SCHEMAS[kind].safeParse(payload);
  return parsed.success ? (parsed.data as z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[K]>) : null;
}
