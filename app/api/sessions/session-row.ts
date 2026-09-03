import { replayEvents, type SessionEvent, type SessionProjection } from '@domain/session';
import type { Db } from '../_middleware/request-context';

/**
 * The reads and the one write every route in this module shares: who the
 * caller's practitioner row is, the visit they are working on, its event
 * stream, and the projection that stream folds to
 * (docs/SPEC/session-capture.md section 2).
 *
 * Nothing here decides anything. The rules live in domain/session; these are
 * the four statements that fetch what those rules need and store what they
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
  closed_at: Date | null;
  signal_quality_score: string | null;
  setup_photo_document_id: string | null;
};

const SESSION_COLUMNS =
  'id, client_id, practitioner_id, service_type_id, appointment_id, delivery_mode, status, ' +
  'checked_in_at, closed_at, signal_quality_score, setup_photo_document_id';

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

export async function replaySession(
  db: Db,
  sessionId: string,
): Promise<{ events: SessionEvent[]; projection: SessionProjection | null }> {
  const events = await readEvents(db, sessionId);
  return { events, projection: replayEvents(events) };
}

/** The highest seq the server holds for a visit, so a device knows where it stands. */
export function lastSeqOf(events: readonly SessionEvent[]): number {
  return events.reduce((highest, event) => Math.max(highest, event.seq), 0);
}

/**
 * Writes the projection onto the session row. Called after every flush, not
 * only at close: a phone that dies mid-visit must leave a partial record
 * server-side, not an empty one (section 2, "phone lost").
 *
 * Guarded by `closed_at is null` in the statement itself as well as by the
 * trigger in 302: the trigger raises, and a raise inside the request's one
 * transaction would take the whole flush down, so the ordinary path never
 * reaches it.
 */
export async function writeProjection(
  db: Db,
  sessionId: string,
  projection: SessionProjection,
  signalQualityScore: number | null,
  observationFlag: boolean,
): Promise<void> {
  await db.query(
    'update session set started_at = $2, ended_at = $3, checked_out_at = $4, ' +
      'checked_out_point = case when $5::float8 is null then null else ' +
      "extensions.st_geogfromtext('SRID=4326;POINT(' || $5::float8 || ' ' || $6::float8 || ')') end, " +
      'preflight = $7::jsonb, signal_check = $8::jsonb, pre_rating = $9::jsonb, ' +
      'post_rating = $10::jsonb, telemetry = $11::jsonb, observations = $12::jsonb, ' +
      'observation_flag = $13, signal_quality_score = $14 ' +
      'where id = $1 and tenant_id = app.current_tenant_id() and closed_at is null',
    [
      sessionId,
      projection.startedAt,
      projection.endedAt,
      projection.checkedOutAt,
      projection.checkedOutPoint?.lng ?? null,
      projection.checkedOutPoint?.lat ?? null,
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
}
