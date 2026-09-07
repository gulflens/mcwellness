import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { canActor, hasRole } from '@domain/shared';
import {
  checkConflicts,
  windowFor,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
} from '@domain/scheduling';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { requiredConsentPurposes } from './create';
import {
  appointmentRow,
  exclusionConflict,
  hasOpenSession,
  insertMoved,
  readAppointment,
  readMoveContext,
  retire,
  REASON_MAX,
} from './move-one';
import {
  ConflictResponse,
  MoveAppointmentRequest,
  MoveAppointmentResponse,
  type MoveActionCode,
} from './schema';

/**
 * `POST /api/appointments/:id/move` — the same visit, a new arrival window,
 * on the same day or another one (docs/SPEC/scheduling-manual.md sections 2
 * and 3).
 *
 * **A move is two rows, never an edited one.** Section 3 is explicit: "Never
 * edit times on a confirmed appointment in place." So the appointment that
 * was agreed becomes `rescheduled` and keeps the window and the practitioner
 * the household was actually promised, and a new appointment stands beside it
 * carrying `rescheduled_from_id`. The client's record can then show what was
 * arranged as well as what happened, which is the whole reason the data model
 * prefers a link between two rows to a status on one.
 *
 * **The order of the two writes matters.** The old row is retired first. The
 * exclusion constraints in 200_appointment.sql hold every live appointment
 * apart, so inserting the new row while the old one still holds its slot
 * would refuse any move small enough to overlap itself — which is most of
 * them. `rescheduled` is outside the constraint's own WHERE, so retiring the
 * old row frees the slot for its replacement. Both writes are in the
 * request's one transaction (app/api/_middleware/request-context.ts), so
 * either both happen or neither does.
 *
 * **The new row keeps the old one's status**, rather than dropping back to
 * `proposed`. Telling the household is the same manual step it was before the
 * move (section 3), and nothing in this phase can move a row back to
 * `confirmed`, so downgrading would take a moved visit off its practitioner's
 * day sheet with no way to put it back. The drawer that calls this says so on
 * the face of it: the household still has to be told.
 *
 * **What a move does not do.** It does not reassign. Section 2 lists "move,
 * cancel, reassign" as three things, and this is the first; a visit that has
 * to change hands as well as time is a second action, not a wider version of
 * this one.
 *
 * **The reads and the writes are `./move-one.ts`**, which the day map's own
 * `POST /api/appointments/reorder` composes differently: several visits in one
 * transaction, all retired before any is taken. Nothing about this route's
 * behaviour changed when they moved there.
 */

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: MoveActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

export function mountAppointmentMove(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/appointments/:id/move', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // The calendar role, before a single row is read: a refused caller must
    // never cause a client to be looked at. A practitioner is deliberately
    // not here — section 2 gives them "request a change (Stage 2)", not a
    // move — and the row policy on appointment says the same underneath.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // A move rewrites a promise made to a household, so it is one of the
    // things the trail should be able to explain rather than merely record
    // (docs/SPEC/scheduling-manual.md section 9). The middleware has already
    // scrubbed this header and stamped it on the transaction; the route's
    // only job is to insist there was one.
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
      return badRequest(c, requestId, 'reason_required');
    }

    const body = MoveAppointmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return badRequest(c, requestId, 'invalid_request');
    }

    // An id off the path, proved a uuid before it reaches a query: without
    // this, a typed path lands in Postgres as a cast error and comes back a
    // 500 rather than the plain refusal it is.
    const appointmentId = c.req.param('id');
    if (!z.uuid().safeParse(appointmentId).success) {
      return badRequest(c, requestId, 'invalid_request');
    }

    const db = c.get('db');
    const appointment = await readAppointment(db, appointmentId);
    // Row security has already hidden another practice's appointment, so
    // "not found" is the same answer for a row that does not exist and one
    // this caller may not see. That is the intended answer to both.
    if (!appointment) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    if (appointment.status !== 'proposed' && appointment.status !== 'confirmed') {
      // A visit checked in, delivered, missed, called off or already moved is
      // not one to move: what happened to it has happened.
      return badRequest(c, requestId, 'appointment_settled');
    }

    if (await hasOpenSession(db, appointmentId)) {
      return badRequest(c, requestId, 'session_open');
    }

    const windowStart = new Date(body.data.windowStart);
    const { end: windowEnd } = windowFor(windowStart);
    const travelBufferMinutes = body.data.travelBufferMinutes ?? appointment.travel_buffer_minutes;

    const context = await readMoveContext(db, appointment, windowStart);
    if (context === null) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }

    // The same credential-bound rule booking runs, against the new date. A
    // practitioner certified in September and not in October may not simply
    // be carried into October by a move.
    if (
      !canActor(
        actor,
        {
          type: 'appointment.create',
          practitionerId: appointment.practitioner_id,
          serviceTypeId: appointment.service_type_id,
          on: context.on,
        },
        { assigneeCapabilities: context.assigneeCapabilities },
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const report = checkConflicts(
      {
        practitionerId: appointment.practitioner_id,
        clientId: appointment.client_id,
        serviceTypeId: appointment.service_type_id,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        on: context.on,
      },
      {
        practitionerAppointments: context.practitionerAppointments,
        clientAppointments: context.clientAppointments,
        practitionerCredentials: context.assigneeCapabilities,
        clientActive: context.client.status === 'active',
        requiredConsentPurposes: requiredConsentPurposes(
          appointment.delivery_mode,
          context.client.date_of_birth,
          context.on,
        ),
        activeConsentPurposes: context.activeConsentPurposes,
      },
    );
    if (report.blocking.length > 0) {
      return c.json(
        ConflictResponse.parse({
          error: 'conflict',
          issues: report.blocking.map((issue) => ({
            code: issue.code,
            message: issue.message,
            conflictsWithAppointmentId: issue.conflictsWithAppointmentId ?? null,
          })),
          requestId,
        }),
        409,
      );
    }

    // Retire first, insert second: see the note at the top of this file.
    if (!(await retire(db, appointmentId))) {
      return badRequest(c, requestId, 'appointment_settled');
    }

    let created;
    try {
      created = await insertMoved(db, {
        tenantId: actor.tenantId,
        appointment,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        status: appointment.status,
        rescheduledFromId: appointmentId,
        createdBy: actor.userId,
      });
    } catch (error) {
      // A booking that slipped in between the conflict read and this insert
      // is caught by the database's own exclusion constraints and answered
      // the same way a checkConflicts refusal is, not as a raw 500. The
      // transaction rolls back, so the retired row is not left retired.
      const code = exclusionConflict(error);
      if (code === null) throw error;
      return c.json(
        ConflictResponse.parse({
          error: 'conflict',
          issues: [
            {
              code,
              message:
                code === 'client_overlap' ? CLIENT_OVERLAP_MESSAGE : PRACTITIONER_OVERLAP_MESSAGE,
              conflictsWithAppointmentId: null,
            },
          ],
          requestId,
        }),
        409,
      );
    }
    if (!created) {
      return c.json({ error: 'internal', requestId }, 500);
    }

    return c.json(
      MoveAppointmentResponse.parse({
        appointment: appointmentRow(appointment, context.client, created),
        movedFrom: {
          id: appointmentId,
          windowStart: appointment.window_start.toISOString(),
          windowEnd: appointment.window_end.toISOString(),
        },
      }),
      201,
    );
  });
}
