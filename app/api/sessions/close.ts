import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import {
  deriveObservationFlag,
  replayEvents,
  scoreSignalQuality,
  type PhotoCapturedPayload,
  type SessionProjection,
} from '@domain/session';
import { hasRole } from '@domain/shared';
import { logRefusal, logSensitive } from './audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { CloseRequest, CloseResponse, type VisitActualsInput } from './schema';
import { loadSession, readEvents, resolvePractitioner, type SessionRow } from './session-row';

/**
 * POST /api/sessions/:id/close — the end of the visit
 * (docs/SPEC/session-capture.md section 4).
 *
 * One transaction, and it is the request's own: every route below
 * app/api/_middleware/request-context.ts already runs inside a single
 * transaction as the API role, fenced and stamped, and rolls it back on a
 * thrown error or a 5xx. So there is no `begin` here and no compensating
 * write anywhere: either the whole close lands or none of it does.
 *
 * What lands, in order:
 *
 * 1. the session's own row — status `completed`, `closed_at`, `closed_by`,
 *    and the projection of every event the server holds, including the
 *    signal quality score computed by domain/session/scoreSignalQuality.ts;
 * 2. the setup photo's `document` row, when one was taken and `photo_video`
 *    consent is active;
 * 3. `visit_actuals` — the drive, the crossings, the parking and the access
 *    sentence the practitioner recorded at the door;
 * 4. the appointment's own status, through the one narrow door
 *    app.complete_appointment_for_session (302_session_close.sql);
 * 5. the audit rows: the triggers write what changed, and `session_closed`
 *    is written here as the sensitive action it is, carrying the request id.
 *
 * What deliberately does not land: the entitlement. Section 4.2 has
 * completing a session consume exactly one credit, and that is the billing
 * stream's own trigger on the transition this route makes — built in
 * parallel, against the same `session.status = 'completed'` change. This
 * route's whole obligation to billing is that the transition is atomic and
 * happens once.
 *
 * The route is idempotent: closing an already-closed visit answers with the
 * close that already happened rather than refusing, because a device that
 * lost its connection halfway through the response will ask again.
 */

const PRACTITIONER_ROLES = ['practitioner', 'lead_practitioner'] as const;

const PHOTO_EXTENSIONS: Record<PhotoCapturedPayload['mimeType'], string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

/** Five years from the close, the retention floor for a client's record (CLAUDE.md rule 8). */
const RETENTION_YEARS = 5;

/**
 * Where the setup photo lives. Derived from the session's own id, never from
 * anything the device said: a caller-supplied key is a key that can name
 * another visit's object.
 */
export function setupPhotoKey(sessionId: string, mimeType: PhotoCapturedPayload['mimeType']) {
  return `sessions/${sessionId}/setup-photo.${PHOTO_EXTENSIONS[mimeType]}`;
}

function durationSeconds(projection: SessionProjection): number | null {
  if (!projection.startedAt || !projection.endedAt) return null;
  const seconds = Math.round(
    (Date.parse(projection.endedAt) - Date.parse(projection.startedAt)) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

export function mountClose(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/sessions/:id/close', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const sessionId = c.req.param('id');

    if (!hasRole(actor, ...PRACTITIONER_ROLES)) {
      await logRefusal(db, 'session', sessionId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const parsed = CloseRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const practitionerId = await resolvePractitioner(db, actor.userId);
    if (!practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['no_practitioner_row']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const session = await loadSession(db, sessionId);
    if (!session) {
      await logRefusal(db, 'session', sessionId, null, ['session_not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (session.practitioner_id !== practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['session_not_yours']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const events = await readEvents(db, sessionId);
    const projection = replayEvents(events);

    if (session.closed_at !== null) {
      // Already closed. The device asking again is a retry of a response it
      // never saw, not a second close, so it gets the first one's answer.
      return c.json(
        CloseResponse.parse({
          status: 'closed',
          sessionId,
          closedAt: session.closed_at.toISOString(),
          signalQualityScore:
            session.signal_quality_score === null ? null : Number(session.signal_quality_score),
          durationSeconds: projection ? durationSeconds(projection) : null,
          observationFlag: deriveObservationFlag(projection?.observations ?? null),
          setupPhotoDocumentId: session.setup_photo_document_id,
        }),
        200,
      );
    }
    if (session.status !== 'in_progress') {
      await logRefusal(db, 'session', sessionId, session.client_id, ['session_not_open']);
      return c.json({ error: 'conflict', requestId, detail: 'session_not_open' }, 409);
    }
    // Section 2: closed only when the server has the checked_out event *and*
    // the practitioner has confirmed the summary. This request is the second
    // half; without the first, there is nothing to close.
    if (!projection || projection.phase !== 'checked_out') {
      await logRefusal(db, 'session', sessionId, session.client_id, ['not_checked_out']);
      return c.json({ error: 'conflict', requestId, detail: 'not_checked_out' }, 409);
    }

    // One reading of the clock for the whole close: the row's closed_at and
    // the answer the device is given have to be the same instant, or a
    // repeated close would look like a different one.
    const closedAt = now();
    const score = scoreSignalQuality(projection.telemetry);
    const observationFlag = deriveObservationFlag(projection.observations);
    const photoDocumentId = await filePhoto(db, session, projection, actor.userId, closedAt);

    // One update, not two: the immutability trigger (302) refuses any update
    // to a row that is already closed, so the projection and the close land
    // in the same statement or the second would be refused by the first.
    await db.query(
      "update session set status = 'completed', closed_at = $2, closed_by = $3, " +
        'started_at = $4, ended_at = $5, checked_out_at = $6, ' +
        'checked_out_point = case when $7::float8 is null then null else ' +
        "extensions.st_geogfromtext('SRID=4326;POINT(' || $7::float8 || ' ' || $8::float8 || ')') end, " +
        'preflight = $9::jsonb, signal_check = $10::jsonb, pre_rating = $11::jsonb, ' +
        'post_rating = $12::jsonb, telemetry = $13::jsonb, observations = $14::jsonb, ' +
        'observation_flag = $15, signal_quality_score = $16, setup_photo_document_id = $17 ' +
        'where id = $1 and tenant_id = app.current_tenant_id() and closed_at is null',
      [
        sessionId,
        closedAt.toISOString(),
        actor.userId,
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
        score,
        photoDocumentId,
      ],
    );

    await writeVisitActuals(db, session, parsed.data.visitActuals, actor.userId);

    // The appointment this visit fulfilled. False here is not a failure: a
    // walk-up visit has no appointment, and one already marked completed by
    // the coordinator is already where it needs to be.
    await db.query('select app.complete_appointment_for_session($1)', [sessionId]);

    await logSensitive(db, 'session_closed', 'session', sessionId, session.client_id);

    return c.json(
      CloseResponse.parse({
        status: 'closed',
        sessionId,
        closedAt: closedAt.toISOString(),
        signalQualityScore: score,
        durationSeconds: durationSeconds(projection),
        observationFlag,
        setupPhotoDocumentId: photoDocumentId,
      }),
      200,
    );
  });
}

/**
 * Files the setup photo as a `document` (00-data-model.md section 3) and
 * returns its id, or null when no photo was taken or consent does not allow
 * one.
 *
 * Consent is checked here as well as at append time (./events.ts), because
 * it may have been withdrawn between the two and section 4's rule is that
 * every use is checked at the moment of use, not once at the start.
 *
 * The bytes are not here. The API's body cap is 64 KB and a compressed photo
 * is up to 1 MB, so the device holds them in its own outbox until the upload
 * door exists; this writes the row, against the key convention the trunk's
 * StorageProvider will put them under (`put(key, bytes, mimeType)`, landing
 * in shared-zone round 14). The change request for that door, and for the
 * body-cap exemption it needs, is docs/CHANGE-REQUESTS/session-capture-02.md;
 * the database test for this path is marked accordingly.
 */
async function filePhoto(
  db: Db,
  session: SessionRow,
  projection: SessionProjection,
  userId: string,
  at: Date,
): Promise<string | null> {
  const photo = projection.photo;
  if (!photo) return null;

  const { rows } = await db.query<{ active: boolean }>(
    "select app.session_consent_active($1, 'photo_video') as active",
    [session.id],
  );
  if (rows[0]?.active !== true) return null;

  const documentId = randomUUID();
  const retentionUntil = new Date(at);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + RETENTION_YEARS);

  await db.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      'uploaded_by, retention_until, is_immutable, created_by) values ' +
      "($1, app.current_tenant_id(), $2, 'setup_photo', $3, $4, decode($5, 'hex'), $6, $7, true, $6)",
    [
      documentId,
      session.client_id,
      setupPhotoKey(session.id, photo.mimeType),
      photo.mimeType,
      photo.sha256,
      userId,
      retentionUntil.toISOString(),
    ],
  );
  return documentId;
}

async function writeVisitActuals(
  db: Db,
  session: SessionRow,
  actuals: VisitActualsInput,
  userId: string,
): Promise<void> {
  // On conflict do nothing: the table has one row per session, and a second
  // close never reaches here anyway (the idempotent branch above answers
  // first). This is the belt to that braces.
  await db.query(
    'insert into visit_actuals (tenant_id, session_id, client_id, actual_drive_seconds, ' +
      'actual_walk_seconds, salik_crossings, parking_cost_fils, access_issues, created_by) ' +
      'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8) ' +
      'on conflict (session_id) do nothing',
    [
      session.id,
      session.client_id,
      actuals.driveSeconds,
      actuals.walkSeconds,
      actuals.salikCrossings,
      actuals.parkingCostFils,
      actuals.accessIssues,
      userId,
    ],
  );
}
