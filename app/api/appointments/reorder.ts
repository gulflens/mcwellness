import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
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
  type AppointmentDbRow,
  type MoveContext,
} from './move-one';
import {
  ReorderRequest,
  ReorderResponse,
  type AppointmentRow,
  type ReorderActionCode,
} from './schema';

/**
 * `POST /api/appointments/reorder` — several visits of one practitioner's day
 * moved to new windows in one transaction, which is how the day map applies
 * an optimised order (docs/SPEC/route-planning.md section 5.7).
 *
 * **Every old row is retired before any new one is inserted.** The exclusion
 * constraints in 200_appointment.sql hold every live appointment apart, so
 * inserting the first new row while the second old one still held its slot
 * would refuse most reorders for clashing with themselves. `rescheduled` is
 * outside the constraint's own WHERE, so retiring frees the slot.
 *
 * **Every check that can refuse happens before the first write.** A refusal
 * this route *returns* commits its transaction (the rule
 * app/api/_middleware/request-context.ts states); only one it *raises* rolls
 * back. So the reads and their refusals come first, and anything that goes
 * wrong after the first retire is raised as an HTTPException carrying the
 * same 409 body — the shape `timedOut()` uses in
 * app/api/_middleware/security.ts.
 *
 * **It moves and nothing else.** It does not book, cancel, reassign, or move
 * a visit a household has been told about: every row it touches is
 * `proposed`, which is the whole of what the plan is allowed to reorder.
 * The households still have to be told nothing, because nobody has been told
 * anything: that is what `proposed` means (scheduling-manual.md section 3).
 */

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: ReorderActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

function stale(c: Context<ApiEnv>, requestId: string | null) {
  return c.json(
    { error: 'conflict', code: 'stale_plan' satisfies ReorderActionCode, requestId },
    409,
  );
}

export function mountAppointmentReorder(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post('/api/appointments/reorder', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // The calendar role, before a single row is read: a refused caller must
    // never cause a client to be looked at.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // A reorder rewrites several windows at once, so the trail should be able
    // to explain it rather than merely record it.
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
      return badRequest(c, requestId, 'reason_required');
    }

    const body = ReorderRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return badRequest(c, requestId, 'invalid_request');
    }
    const { moves, practitionerId } = body.data;
    if (new Set(moves.map((move) => move.appointmentId)).size !== moves.length) {
      // The same visit twice would retire it once and then insert two rows
      // against one retirement, which is not a reorder of anything.
      return badRequest(c, requestId, 'invalid_request');
    }

    const db = c.get('db');

    // Phase one, reads only. Every refusal that can be made is made here,
    // where returning it rolls nothing back because nothing has been written.
    const planned: {
      move: (typeof moves)[number];
      appointment: AppointmentDbRow;
      context: MoveContext;
    }[] = [];
    for (const move of moves) {
      const appointment = await readAppointment(db, move.appointmentId);
      if (!appointment) {
        return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
      }
      if (appointment.practitioner_id !== practitionerId) {
        // A plan is one practitioner's day; a visit of somebody else's is not
        // a stale plan but a request that was never coherent.
        return badRequest(c, requestId, 'invalid_request');
      }
      // The three ways the day can have moved out from under the plan.
      if (appointment.status !== 'proposed') return stale(c, requestId);
      if (appointment.window_start.toISOString() !== new Date(move.wasWindowStart).toISOString()) {
        return stale(c, requestId);
      }
      if (await hasOpenSession(db, move.appointmentId)) return stale(c, requestId);

      const context = await readMoveContext(db, appointment, new Date(move.windowStart));
      if (context === null) {
        return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
      }
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
      planned.push({ move, appointment, context });
    }

    // Phase two, writes only. Every failure from here is raised, so the
    // transaction rolls back whole rather than committing half a plan.
    const conflictBody = (code: 'client_overlap' | 'practitioner_overlap') => ({
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
    });
    /** After the first write, a refusal must roll the transaction back, so it is raised. */
    function raise(status: 409, payload: unknown): never {
      throw new HTTPException(status, {
        res: new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      });
    }

    for (const { move } of planned) {
      if (!(await retire(db, move.appointmentId))) {
        raise(409, { error: 'conflict', code: 'stale_plan', requestId });
      }
    }

    const appointments: AppointmentRow[] = [];
    const movedFrom: { id: string; windowStart: string }[] = [];
    for (const { move, appointment } of planned) {
      const windowStart = new Date(move.windowStart);
      const { end: windowEnd } = windowFor(windowStart);
      // The other live rows are re-read per visit, so each new row is checked
      // against the ones already inserted in this same transaction as well as
      // against everything outside the plan. The retired rows are `rescheduled`
      // and so are already out of the way.
      const fresh = await readMoveContext(db, appointment, windowStart);
      if (fresh === null) raise(409, { error: 'conflict', code: 'stale_plan', requestId });
      const report = checkConflicts(
        {
          practitionerId: appointment.practitioner_id,
          clientId: appointment.client_id,
          serviceTypeId: appointment.service_type_id,
          windowStart,
          windowEnd,
          travelBufferMinutes: move.travelBufferMinutes,
          on: fresh.on,
        },
        {
          practitionerAppointments: fresh.practitionerAppointments,
          clientAppointments: fresh.clientAppointments,
          practitionerCredentials: fresh.assigneeCapabilities,
          clientActive: fresh.client.status === 'active',
          requiredConsentPurposes: requiredConsentPurposes(
            appointment.delivery_mode,
            fresh.client.date_of_birth,
            fresh.on,
          ),
          activeConsentPurposes: fresh.activeConsentPurposes,
        },
      );
      if (report.blocking.length > 0) {
        raise(409, {
          error: 'conflict',
          issues: report.blocking.map((issue) => ({
            code: issue.code,
            message: issue.message,
            conflictsWithAppointmentId: issue.conflictsWithAppointmentId ?? null,
          })),
          requestId,
        });
      }
      let created;
      try {
        created = await insertMoved(db, {
          tenantId: actor.tenantId,
          appointment,
          windowStart,
          windowEnd,
          travelBufferMinutes: move.travelBufferMinutes,
          status: 'proposed',
          rescheduledFromId: move.appointmentId,
          createdBy: actor.userId,
        });
      } catch (error) {
        const code = exclusionConflict(error);
        if (code === null) throw error;
        raise(409, conflictBody(code));
      }
      if (!created) raise(409, { error: 'conflict', code: 'stale_plan', requestId });
      appointments.push(appointmentRow(appointment, fresh.client, created));
      movedFrom.push({
        id: move.appointmentId,
        windowStart: appointment.window_start.toISOString(),
      });
    }
    return c.json(ReorderResponse.parse({ appointments, movedFrom }));
  });
}
