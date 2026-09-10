import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { canActor, hasRole, isoDateIn, type Capability } from '@domain/shared';
import {
  checkConflicts,
  windowFor,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
  type ExistingAppointment,
} from '@domain/scheduling';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { requiredConsentPurposes } from './create';
import {
  appointmentRow,
  exclusionConflict,
  hasOpenSession,
  insertMoved,
  logClientRead,
  readAppointment,
  readMoveContext,
  retire,
  LIVE_STATUSES_EXCLUDED,
  PRACTICE_TIME_ZONE,
  REASON_MAX,
} from './move-one';
import {
  ConflictResponse,
  MoveAppointmentResponse,
  ReassignAppointmentRequest,
  type ReassignActionCode,
} from './schema';

/**
 * `POST /api/appointments/:id/reassign` — the same visit, in another
 * practitioner's hands (docs/SPEC/dispatch.md section 6). A move that also
 * changes hands: the old row becomes `rescheduled` and keeps the window and
 * the practitioner the household was promised; the new row stands beside it
 * with `rescheduled_from_id`, the new practitioner, and who it was taken from
 * (migration 210). The window may move at the same time or stay as it was.
 *
 * The checks, in order, before anything is written: the role; the visit is
 * proposed or confirmed with no session open (the two gates `move.ts` keeps);
 * the **new** practitioner exists and holds a credential valid for that
 * service on that date (`appointment.create`, which asks exactly this); and
 * `checkConflicts` passes for the new practitioner and the client. After the
 * first write a refusal is raised, never returned, for the reason `move.ts`
 * records.
 *
 * **The reads and the writes are `./move-one.ts`'s**, which pull request 121
 * extracted for exactly this kind of second caller. What is this route's own
 * is the third practitioner: `readMoveContext` loads the credentials and the
 * calendar of the practitioner the visit is *on*, and every question here is
 * about the one it is going *to*.
 */

/**
 * The practitioner the visit is being handed to. Every joined table repeats
 * the tenant predicate, as the neighbouring routes do: row security is the
 * floor, and a join that does not say so is a join that stops saying so the
 * first time somebody reads it under a different role.
 *
 * **Active only.** A visit is handed to somebody who works here. The board
 * still draws a leaver's row while they hold visits of their own that day
 * (docs/SPEC/dispatch.md section 4.2), so that row is a place a block can be
 * dragged to, and booking refuses an inactive practitioner outright
 * (`app/api/appointments/create.ts`). Refusing here as `practitioner_not_found`
 * rather than with a code of its own is the truthful answer, because the
 * drawer's picker never offers a leaver in the first place: there is nobody
 * of that id to hand this visit to.
 */
const NEW_PRACTITIONER_SQL =
  'select p.id, u.display_name from practitioner p join app_user u on u.id = p.user_id ' +
  "where p.id = $1 and p.status = 'active' " +
  'and p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id()';

const NEW_CREDENTIALS_SQL =
  'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
  'valid_from, valid_to from credential where practitioner_id = $1 and tenant_id = app.current_tenant_id()';

/**
 * Their live day. No `id <> ` exclusion, unlike `readMoveContext`'s own read
 * of the calendar: the visit being reassigned is not theirs, so there is no
 * row here that the candidate could clash with itself through.
 */
const NEW_PRACTITIONER_APPOINTMENTS_SQL =
  'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
  `where practitioner_id = $1 and status not in ${LIVE_STATUSES_EXCLUDED} and tenant_id = app.current_tenant_id()`;

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: ReassignActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

/**
 * A refusal made after the first write must *raise*, never return — the
 * reason `move.ts` and `reorder.ts` both record. A `23P01` from the insert
 * aborts the Postgres transaction, and `withRequestContext`'s guard for that
 * case replaces a returned body with `{"error":"internal"}` 500. Raised,
 * `onError` returns the 409 unchanged and the transaction is rolled back
 * beneath it.
 */
function raise(status: 409, payload: unknown): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  });
}

async function readNewPractitioner(db: Db, id: string) {
  const person = await db.query<{ id: string; display_name: string }>(NEW_PRACTITIONER_SQL, [id]);
  if (!person.rows[0]) return null;
  const credentials = await db.query<{
    service_type_id: string;
    can_execute_session: boolean;
    can_author_protocol: boolean;
    can_sign_report: boolean;
    valid_from: string;
    valid_to: string | null;
  }>(NEW_CREDENTIALS_SQL, [id]);
  const capabilities: Capability[] = credentials.rows.map((r) => ({
    serviceTypeId: r.service_type_id,
    canExecuteSession: r.can_execute_session,
    canAuthorProtocol: r.can_author_protocol,
    canSignReport: r.can_sign_report,
    validFrom: r.valid_from,
    validTo: r.valid_to,
  }));
  const appointments = await db.query<{
    id: string;
    window_start: Date;
    window_end: Date;
    travel_buffer_minutes: number;
  }>(NEW_PRACTITIONER_APPOINTMENTS_SQL, [id]);
  const existing: ExistingAppointment[] = appointments.rows.map((r) => ({
    id: r.id,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    travelBufferMinutes: r.travel_buffer_minutes,
  }));
  return {
    id: person.rows[0].id,
    displayName: person.rows[0].display_name,
    capabilities,
    existing,
  };
}

export function mountAppointmentReassign(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post('/api/appointments/:id/reassign', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // The calendar roles, before a single row is read: a refused caller must
    // never cause a household to be looked at.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!canActor(actor, { type: 'appointment.reassign' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // A reassignment rewrites a promise made to a household, so the trail
    // should be able to explain it and not merely record it. The middleware
    // has already scrubbed this header and stamped it on the transaction;
    // the route's only job is to insist there was one.
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
      return badRequest(c, requestId, 'reason_required');
    }

    const body = ReassignAppointmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return badRequest(c, requestId, 'invalid_request');

    // An id off the path, proved a uuid before it reaches a query: a typed
    // path would otherwise land in Postgres as a cast error and come back a
    // 500 rather than the plain refusal it is.
    const appointmentId = c.req.param('id');
    if (!z.uuid().safeParse(appointmentId).success)
      return badRequest(c, requestId, 'invalid_request');

    const db = c.get('db');
    const appointment = await readAppointment(db, appointmentId);
    // Row security has already hidden another practice's appointment, so
    // "not found" is the same answer for a row that does not exist and one
    // this caller may not see.
    if (!appointment) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    if (appointment.practitioner_id === body.data.practitionerId) {
      // Already theirs: there is nothing to hand over, and going ahead would
      // retire a live row and replace it with an identical one.
      return badRequest(c, requestId, 'same_practitioner');
    }
    if (appointment.status !== 'proposed' && appointment.status !== 'confirmed') {
      // A visit checked in, delivered, missed, called off or already moved is
      // not one to hand on: what happened to it has happened.
      return badRequest(c, requestId, 'appointment_settled');
    }
    if (await hasOpenSession(db, appointmentId)) return badRequest(c, requestId, 'session_open');

    // No window in the body means the household keeps the one it was
    // promised, which is the ordinary case: only the hands change.
    const windowStart = body.data.windowStart
      ? new Date(body.data.windowStart)
      : appointment.window_start;
    const { end: windowEnd } = windowFor(windowStart);
    const travelBufferMinutes = appointment.travel_buffer_minutes;

    // The practitioner the visit is going to, read before the household is
    // looked at at all: a reassignment naming nobody is refused without a
    // client's record being opened, which is the rule the role check at the
    // top of this route follows for the same reason.
    //
    // **Both calendars are read before the audit row is written**, and the
    // order is not incidental. `app.audit_chain` (migration 070) serialises
    // every audit insert on one row, so a write in flight elsewhere holds
    // this request at `logClientRead` until it commits. With the reads taken
    // after that pause, a booking committed during it would be found by
    // `checkConflicts` and refused there; taken before it, the request
    // decides on one consistent picture and a slot taken since is caught by
    // the exclusion constraint at write time — which is the refusal
    // docs/SPEC/dispatch.md section 13 asks be proved, and the order
    // `move.ts` already reads in.
    const target = await readNewPractitioner(db, body.data.practitionerId);
    if (target === null) return badRequest(c, requestId, 'practitioner_not_found');

    // The booking rule, for the practitioner the visit is going to: they must
    // hold a credential for this service that is valid on the day of the
    // visit. Handing a visit to somebody uncertified is the one thing a
    // reassignment could do that a move never can.
    //
    // **Above the household's read, and that is the point.** Everything this
    // gate needs is already in hand — the target's credentials from the read
    // just above, and the day, which is `isoDateIn(windowStart)` in the
    // practice's zone and is the same value `readMoveContext` computes for
    // its own `on`. So a refusal here writes no `read` row for the household
    // (docs/SPEC/audit.md rule 11: a refused attempt leaves no trail row),
    // where the first build opened their record and then said no.
    // `move.ts` cannot do the same, because the credentials it judges arrive
    // inside `readMoveContext`; here they do not.
    const on = isoDateIn(windowStart, PRACTICE_TIME_ZONE);
    if (
      !canActor(
        actor,
        {
          type: 'appointment.create',
          practitionerId: target.id,
          serviceTypeId: appointment.service_type_id,
          on,
        },
        { assigneeCapabilities: target.capabilities },
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const context = await readMoveContext(db, appointment, windowStart);
    if (context === null) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    // One `read` row for the household this act looked at, in this route's
    // own transaction, exactly as the move writes one.
    await logClientRead(db, appointment.client_id);

    const report = checkConflicts(
      {
        practitionerId: target.id,
        clientId: appointment.client_id,
        serviceTypeId: appointment.service_type_id,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        on: context.on,
      },
      {
        // The new practitioner's day, and the household's own — which is the
        // context's, because the household does not change hands.
        practitionerAppointments: target.existing,
        clientAppointments: context.clientAppointments,
        practitionerCredentials: target.capabilities,
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

    // Retire first, insert second, both statuses: the exclusion constraints
    // hold every live appointment apart, so a reassignment that keeps the
    // window would be refused by the row it is replacing.
    if (!(await retire(db, appointmentId, ['proposed', 'confirmed']))) {
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
        practitionerId: target.id,
        reassignedFromPractitionerId: appointment.practitioner_id,
      });
    } catch (error) {
      // A booking that slipped in between the conflict read and this insert
      // is caught by the database's own exclusion constraints and answered
      // the same way a checkConflicts refusal is. Raised and not returned,
      // so the aborted transaction is rolled back and this body survives it.
      const code = exclusionConflict(error);
      if (code === null) throw error;
      raise(
        409,
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
      );
    }
    if (!created) return c.json({ error: 'internal', requestId }, 500);

    return c.json(
      MoveAppointmentResponse.parse({
        // The new practitioner by name: `appointment` is the row this was
        // taken from, and its own name is the one on the retired row.
        appointment: appointmentRow(appointment, context.client, created, {
          id: target.id,
          displayName: target.displayName,
        }),
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
