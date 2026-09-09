import type { Hono } from 'hono';
import { z } from 'zod';
import {
  deriveObservationFlag,
  replayEvents,
  scoreSignalQuality,
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
 * 2. `visit_actuals` — the drive, the crossings, the parking and the access
 *    sentence the practitioner recorded at the door;
 * 3. the appointment's own status, through the one narrow door
 *    app.complete_appointment_for_session (302_session_close.sql);
 * 4. the audit rows: the triggers write what changed, and `session_closed`
 *    is written here as the sensitive action it is, carrying the request id.
 *
 * `setupPhotoDocumentId` on the response is history and nothing else. A visit
 * photographed before 2026-09-09 still names its picture; nothing can set the
 * column now, because the practice takes no photographs and the routes that
 * filed one are gone. **A closed visit admits no change at all**: the
 * photograph's link was migration 306's single exception to that, and
 * migration 960 removed it along with the capability.
 *
 * The check-out coordinate is not written here either. It is recorded when
 * the check-out event arrives (./events.ts), session-level and once, and it
 * never travels inside an event payload where the audit trail's redaction
 * could not see it.
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

const Params = z.object({ id: z.uuid() });

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
    // Validated before anything is written or logged: an id that is not a
    // uuid reaches audit_log.entity_id, fails on its type, aborts the
    // transaction and takes the refusal it was meant to record down with it.
    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const sessionId = params.data.id;

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
      return c.json(closedAnswer(session, projection), 200);
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

    // One update, not two: the immutability trigger (302) refuses any update
    // to a row that is already closed, so the projection and the close land
    // in the same statement or the second would be refused by the first.
    //
    // `closed_at is null` in the predicate is what makes closing
    // exactly-once. Two requests racing each other both read an open visit;
    // only one of them updates a row, and the other must not go on to write
    // a second audit row and answer with a close time it invented.
    const updated = await db.query(
      "update session set status = 'completed', closed_at = $2, closed_by = $3, " +
        'started_at = $4, ended_at = $5, checked_out_at = $6, ' +
        'preflight = $7::jsonb, signal_check = $8::jsonb, pre_rating = $9::jsonb, ' +
        'post_rating = $10::jsonb, telemetry = $11::jsonb, observations = $12::jsonb, ' +
        'observation_flag = $13, signal_quality_score = $14 ' +
        'where id = $1 and tenant_id = app.current_tenant_id() and closed_at is null',
      [
        sessionId,
        closedAt.toISOString(),
        actor.userId,
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
        score,
      ],
    );
    if (updated.rowCount !== 1) {
      // Somebody else closed it between the read above and this write. Read
      // back what they wrote and answer with that, exactly as the idempotent
      // branch does — never a second close, never a second audit row.
      const already = await loadSession(db, sessionId);
      if (!already?.closed_at) {
        return c.json({ error: 'conflict', requestId, detail: 'session_not_open' }, 409);
      }
      return c.json(closedAnswer(already, projection), 200);
    }

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
        setupPhotoDocumentId: null,
      }),
      200,
    );
  });
}

/** The answer for a visit that is already closed: what the row says, never a fresh reading. */
function closedAnswer(session: SessionRow, projection: SessionProjection | null): CloseResponse {
  return CloseResponse.parse({
    status: 'closed',
    sessionId: session.id,
    closedAt: session.closed_at?.toISOString() ?? null,
    signalQualityScore:
      session.signal_quality_score === null ? null : Number(session.signal_quality_score),
    durationSeconds: projection ? durationSeconds(projection) : null,
    observationFlag: deriveObservationFlag(projection?.observations ?? null),
    setupPhotoDocumentId: session.setup_photo_document_id,
  });
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
