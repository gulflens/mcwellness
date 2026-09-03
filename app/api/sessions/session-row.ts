import type { SessionEvent, SessionProjection } from '@domain/session';
import type { Db } from '../_middleware/request-context';

/**
 * The reads and the one write every route in this module shares: who the
 * caller's practitioner row is, the visit they are working on, its event
 * stream, and the projection that stream folds to
 * (docs/SPEC/session-capture.md section 2).
 *
 * Nothing here decides anything. The rules live in domain/session; these are
 * the statements that fetch what those rules need and store what they
 * produce.
 */

export type PractitionerRow = { id: string };

export async function resolvePractitioner(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query<PractitionerRow>(
    "select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id() and status = 'active'",
    [userId],
  );
  return rows[0]?.id ?? null;
}

export type SessionRow = {
  id: string;
  client_id: string;
  practitioner_id: string;
  service_type_id: string;
  appointment_id: string | null;
  delivery_mode: 'home' | 'studio' | 'remote';
  status: string;
  checked_in_at: Date;
  /** Whether the practitioner shared their position at the door. Never the coordinate itself. */
  has_checked_in_point: boolean;
  has_checked_out_point: boolean;
  closed_at: Date | null;
  signal_quality_score: string | null;
  setup_photo_document_id: string | null;
  /** The projection as it currently stands, so a flush that changes nothing writes nothing. */
  projection_now: unknown;
};

/**
 * The coordinates are read as booleans, never as values. Nothing in this
 * module needs to know where a practitioner stood — only whether they
 * shared it, which is what decides whether a check-out point may be recorded
 * at all (docs/SPEC/session-capture.md section 3.6). A column that is never
 * selected is a column that cannot be logged, returned or leaked by mistake.
 *
 * `projection_now` gathers the stored projection columns into one jsonb value
 * so a flush can compare what it would write against what is already there
 * without eleven separate comparisons in TypeScript.
 */
const SESSION_COLUMNS =
  'id, client_id, practitioner_id, service_type_id, appointment_id, delivery_mode, status, ' +
  'checked_in_at, checked_in_point is not null as has_checked_in_point, ' +
  'checked_out_point is not null as has_checked_out_point, ' +
  'closed_at, signal_quality_score, setup_photo_document_id, ' +
  "jsonb_build_object('startedAt', started_at, 'endedAt', ended_at, " +
  "'checkedOutAt', checked_out_at, 'preflight', preflight, 'signalCheck', signal_check, " +
  "'preRating', pre_rating, 'postRating', post_rating, 'telemetry', telemetry, " +
  "'observations', observations, 'observationFlag', observation_flag, " +
  "'signalQualityScore', signal_quality_score) as projection_now";

export async function loadSession(db: Db, sessionId: string): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `select ${SESSION_COLUMNS} from session where id = $1 and tenant_id = app.current_tenant_id()`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/** The visit this practitioner left open, if any. One at a time, by the index in 300. */
export async function loadOpenSession(db: Db, practitionerId: string): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `select ${SESSION_COLUMNS} from session where practitioner_id = $1 ` +
      "and tenant_id = app.current_tenant_id() and status = 'in_progress'",
    [practitionerId],
  );
  return rows[0] ?? null;
}

type EventRow = { id: string; seq: number; kind: string; payload: unknown; device_at: Date };

/**
 * Every event of a visit, in seq order. Read in full rather than
 * incrementally: replayEvents is a fold over the whole stream by definition
 * (a projection built from a prefix and then patched is exactly the sync
 * engine section 2 says we are not building), and a visit is tens of rows.
 */
export async function readEvents(db: Db, sessionId: string): Promise<SessionEvent[]> {
  const { rows } = await db.query<EventRow>(
    'select id, seq, kind, payload, device_at from session_event where session_id = $1 order by seq',
    [sessionId],
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId,
    seq: row.seq,
    kind: row.kind as SessionEvent['kind'],
    payload: row.payload,
    deviceAt: row.device_at.toISOString(),
  }));
}

/** The highest seq the server holds for a visit, so a device knows where it stands. */
export function lastSeqOf(events: readonly SessionEvent[]): number {
  return events.reduce((highest, event) => Math.max(highest, event.seq), 0);
}

/**
 * The projection's own columns, as the database stores them. Built once and
 * used both to compare and to write, so the two can never describe different
 * shapes.
 */
export function projectionColumns(
  projection: SessionProjection,
  signalQualityScore: number | null,
  observationFlag: boolean,
): Record<string, unknown> {
  return {
    startedAt: projection.startedAt,
    endedAt: projection.endedAt,
    checkedOutAt: projection.checkedOutAt,
    preflight: projection.preflight,
    signalCheck: projection.signal,
    preRating: projection.preRating,
    postRating: projection.postRating,
    telemetry: projection.telemetry,
    observations: projection.observations,
    observationFlag,
    signalQualityScore,
  };
}

/**
 * Whether the stored projection already says what the computed one says.
 *
 * Compared through JSON so the two sides are the same shape: Postgres hands
 * a timestamptz back as a Date and a numeric back as a string, and the
 * jsonb_build_object above renders both as the strings the projection
 * carries. An identical answer means the flush changed nothing, and a write
 * that changes nothing must not happen — every update on `session` writes an
 * audit row (300_session.sql), and a log full of the same visit copied out
 * thirty times is a log nobody can read.
 */
export function projectionUnchanged(stored: unknown, next: Record<string, unknown>): boolean {
  if (stored === null || typeof stored !== 'object') return false;
  const current = stored as Record<string, unknown>;
  return Object.keys(next).every(
    (key) => JSON.stringify(current[key] ?? null) === JSON.stringify(next[key] ?? null),
  );
}

/**
 * Writes the projection onto the session row when — and only when — it says
 * something the row does not already say. Called after every flush, not only
 * at close: a phone that dies mid-visit must leave a partial record
 * server-side, not an empty one (section 2, "phone lost").
 *
 * The check-out coordinate is not written here. It is session-level, carried
 * on the request beside the batch exactly as check-in carries its own, and
 * written once by the route that receives it — never folded out of an event,
 * because it never travels inside one (domain/session/events.ts).
 *
 * Guarded by `closed_at is null` in the statement itself as well as by the
 * trigger in 302: the trigger raises, and a raise inside the request's one
 * transaction would take the whole flush down, so the ordinary path never
 * reaches it.
 *
 * Returns whether it wrote.
 */
export async function writeProjection(
  db: Db,
  session: SessionRow,
  projection: SessionProjection,
  signalQualityScore: number | null,
  observationFlag: boolean,
): Promise<boolean> {
  const next = projectionColumns(projection, signalQualityScore, observationFlag);
  if (projectionUnchanged(session.projection_now, next)) return false;
  await db.query(
    'update session set started_at = $2, ended_at = $3, checked_out_at = $4, ' +
      'preflight = $5::jsonb, signal_check = $6::jsonb, pre_rating = $7::jsonb, ' +
      'post_rating = $8::jsonb, telemetry = $9::jsonb, observations = $10::jsonb, ' +
      'observation_flag = $11, signal_quality_score = $12 ' +
      'where id = $1 and tenant_id = app.current_tenant_id() and closed_at is null',
    [
      session.id,
      projection.startedAt,
      projection.endedAt,
      projection.checkedOutAt,
      JSON.stringify(projection.preflight),
      projection.signal === null ? null : JSON.stringify(projection.signal),
      JSON.stringify(projection.preRating),
      JSON.stringify(projection.postRating),
      JSON.stringify(projection.telemetry),
      projection.observations === null ? null : JSON.stringify(projection.observations),
      observationFlag,
      signalQualityScore,
    ],
  );
  return true;
}

/**
 * Records the coordinate the practitioner was standing on when they checked
 * out (section 3.6). Written once, only when they shared one at the door —
 * "the position only if sharing was switched on at check-in" is a rule the
 * server holds, not a promise the device keeps — and never overwritten.
 */
export async function writeCheckedOutPoint(
  db: Db,
  sessionId: string,
  point: { lat: number; lng: number },
): Promise<void> {
  await db.query(
    'update session set checked_out_point = extensions.st_geogfromtext(' +
      "'SRID=4326;POINT(' || $2::float8 || ' ' || $3::float8 || ')') " +
      'where id = $1 and tenant_id = app.current_tenant_id() and closed_at is null ' +
      'and checked_in_point is not null and checked_out_point is null',
    [sessionId, point.lng, point.lat],
  );
}
