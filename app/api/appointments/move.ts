import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { canActor, hasRole, isoDateIn, type Capability, type IsoDate } from '@domain/shared';
import {
  checkConflicts,
  windowFor,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
  type ExistingAppointment,
} from '@domain/scheduling';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { requiredConsentPurposes } from './create';
import {
  ConflictResponse,
  MoveAppointmentRequest,
  MoveAppointmentResponse,
  type AppointmentActionCode,
  type AppointmentRow,
  type DeliveryMode,
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
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const EXCLUSION_VIOLATION = '23P01';

// Every status that still holds a slot, for the conflict read — and the row
// being moved, excluded by id, because a visit cannot clash with itself.
const LIVE_STATUSES_EXCLUDED = "('cancelled', 'cancelled_late', 'no_show', 'rescheduled')";

const APPOINTMENT_SQL =
  'select a.id, a.client_id, a.practitioner_id, a.service_type_id, a.location_id, ' +
  'a.delivery_mode, a.status, a.window_start, a.window_end, a.travel_buffer_minutes, ' +
  'u.display_name as practitioner_display_name, st.name as service_type_name, ' +
  'l.label::text as location_label, l.emirate::text as location_emirate ' +
  'from appointment a ' +
  'join practitioner p on p.id = a.practitioner_id ' +
  'join app_user u on u.id = p.user_id ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.id = $1 and a.tenant_id = app.current_tenant_id() ' +
  'and p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  'and st.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id()';

/**
 * Whether somebody has already started delivering this visit.
 *
 * `session.appointment_id` points at the appointment a visit was created from
 * (db/migrations/300_session.sql), and a session with no `closed_at` is one in
 * progress. Neither moving nor calling off is a thing to do underneath one,
 * and both go wrong in their own way if it is allowed: a move retires the
 * appointment the open session still points at, so closing it later would try
 * to complete a row that has been superseded and the replacement would stand
 * for ever; and a late cancellation takes a credit, which the session's own
 * close then takes again when it completes.
 *
 * The proper fix is upstream — check-in should move the appointment to
 * `checked_in`, and the session-capture stream is adding exactly that — at
 * which point the status test both routes already make would catch this on its
 * own. This is the belt beneath that brace, and it stays afterwards: it asks
 * the question directly rather than through a status that something has to
 * remember to write (schema review of this pull request).
 */
const OPEN_SESSION_SQL =
  'select 1 from session s where s.appointment_id = $1 ' +
  'and s.tenant_id = app.current_tenant_id() and s.closed_at is null limit 1';

const CLIENT_SQL =
  'select given_name, family_name, given_name_ar, family_name_ar, status, date_of_birth ' +
  'from client where id = $1 and tenant_id = app.current_tenant_id()';

const CREDENTIALS_SQL =
  'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
  'valid_from, valid_to from credential where practitioner_id = $1 ' +
  'and tenant_id = app.current_tenant_id()';

const CONSENTS_SQL =
  "select purpose from consent where client_id = $1 and status = 'active' " +
  'and (expires_at is null or expires_at > $2) and tenant_id = app.current_tenant_id()';

const RETIRE_SQL =
  "update appointment set status = 'rescheduled' where id = $1 " +
  "and tenant_id = app.current_tenant_id() and status in ('proposed', 'confirmed')";

const INSERT_SQL =
  'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
  'delivery_mode, window_start, window_end, travel_buffer_minutes, status, rescheduled_from_id, ' +
  'created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ' +
  'returning id, window_start, window_end, status, delivery_mode';

type AppointmentDbRow = {
  id: string;
  client_id: string;
  practitioner_id: string;
  service_type_id: string;
  location_id: string;
  delivery_mode: DeliveryMode;
  status: AppointmentRow['status'];
  window_start: Date;
  window_end: Date;
  travel_buffer_minutes: number;
  practitioner_display_name: string;
  service_type_name: string;
  location_label: string;
  location_emirate: string;
};

type ClientDbRow = {
  given_name: string;
  family_name: string;
  given_name_ar: string | null;
  family_name_ar: string | null;
  status: string;
  date_of_birth: string | null;
};

type CredentialDbRow = {
  service_type_id: string;
  can_execute_session: boolean;
  can_author_protocol: boolean;
  can_sign_report: boolean;
  valid_from: string;
  valid_to: string | null;
};

type OtherAppointmentRow = {
  id: string;
  window_start: Date;
  window_end: Date;
  travel_buffer_minutes: number;
};

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: AppointmentActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

function toExisting(rows: readonly OtherAppointmentRow[]): ExistingAppointment[] {
  return rows.map((r) => ({
    id: r.id,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    travelBufferMinutes: r.travel_buffer_minutes,
  }));
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
    if ((c.req.header('x-reason') ?? '').trim().length === 0) {
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
    const existing = await db.query<AppointmentDbRow>(APPOINTMENT_SQL, [appointmentId]);
    const appointment = existing.rows[0];
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

    const openSession = await db.query(OPEN_SESSION_SQL, [appointmentId]);
    if (openSession.rows.length > 0) {
      return badRequest(c, requestId, 'session_open');
    }

    const clientId = appointment.client_id;
    const clientResult = await db.query<ClientDbRow>(CLIENT_SQL, [clientId]);
    const client = clientResult.rows[0];
    if (!client) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    // The client's own row is read to check the move and to answer with their
    // name; logged exactly as app/api/clients/list.ts logs what it shows.
    await logRead(db, 'client', clientId, clientId);

    const windowStart = new Date(body.data.windowStart);
    const { end: windowEnd } = windowFor(windowStart);
    const travelBufferMinutes = body.data.travelBufferMinutes ?? appointment.travel_buffer_minutes;
    // The candidate's own date, in the practice's zone: a credential is judged
    // valid on the day of the visit, not on today.
    const on: IsoDate = isoDateIn(windowStart, PRACTICE_TIME_ZONE);

    const credentialResult = await db.query<CredentialDbRow>(CREDENTIALS_SQL, [
      appointment.practitioner_id,
    ]);
    const assigneeCapabilities: Capability[] = credentialResult.rows.map((r) => ({
      serviceTypeId: r.service_type_id,
      canExecuteSession: r.can_execute_session,
      canAuthorProtocol: r.can_author_protocol,
      canSignReport: r.can_sign_report,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));

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
          on,
        },
        { assigneeCapabilities },
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const consentResult = await db.query<{ purpose: string }>(CONSENTS_SQL, [
      clientId,
      windowStart,
    ]);

    // Every other live appointment of this practitioner and this client — the
    // row being moved excluded by id, since a visit cannot clash with itself.
    const practitionerAppointments = await db.query<OtherAppointmentRow>(
      'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
        `where practitioner_id = $1 and id <> $2 and status not in ${LIVE_STATUSES_EXCLUDED} ` +
        'and tenant_id = app.current_tenant_id()',
      [appointment.practitioner_id, appointmentId],
    );
    const clientAppointments = await db.query<OtherAppointmentRow>(
      'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
        `where client_id = $1 and id <> $2 and status not in ${LIVE_STATUSES_EXCLUDED} ` +
        'and tenant_id = app.current_tenant_id()',
      [clientId, appointmentId],
    );

    const report = checkConflicts(
      {
        practitionerId: appointment.practitioner_id,
        clientId,
        serviceTypeId: appointment.service_type_id,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        on,
      },
      {
        practitionerAppointments: toExisting(practitionerAppointments.rows),
        clientAppointments: toExisting(clientAppointments.rows),
        practitionerCredentials: assigneeCapabilities,
        clientActive: client.status === 'active',
        requiredConsentPurposes: requiredConsentPurposes(
          appointment.delivery_mode,
          client.date_of_birth,
          on,
        ),
        activeConsentPurposes: consentResult.rows.map((r) => r.purpose),
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
    // The status predicate is the second half of the same check made above,
    // now against the row as it stands at write time, so a visit somebody
    // else settled between the two cannot be moved out from under them.
    const retired = await db.query(RETIRE_SQL, [appointmentId]);
    if (retired.rowCount !== 1) {
      return badRequest(c, requestId, 'appointment_settled');
    }

    type CreatedRow = {
      id: string;
      window_start: Date;
      window_end: Date;
      status: AppointmentRow['status'];
      delivery_mode: DeliveryMode;
    };
    let created: CreatedRow | undefined;
    try {
      const result = await db.query<CreatedRow>(INSERT_SQL, [
        actor.tenantId,
        clientId,
        appointment.practitioner_id,
        appointment.service_type_id,
        appointment.location_id,
        appointment.delivery_mode,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        appointment.status,
        appointmentId,
        actor.userId,
      ]);
      created = result.rows[0];
    } catch (error) {
      // A booking that slipped in between the conflict read and this insert
      // is caught by the database's own exclusion constraints and answered
      // the same way a checkConflicts refusal is, not as a raw 500. The
      // transaction rolls back, so the retired row is not left retired.
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === EXCLUSION_VIOLATION) {
        const isClientConflict = pgError.constraint === 'appointment_no_overlap_client';
        return c.json(
          ConflictResponse.parse({
            error: 'conflict',
            issues: [
              {
                code: isClientConflict ? 'client_overlap' : 'practitioner_overlap',
                message: isClientConflict ? CLIENT_OVERLAP_MESSAGE : PRACTITIONER_OVERLAP_MESSAGE,
                conflictsWithAppointmentId: null,
              },
            ],
            requestId,
          }),
          409,
        );
      }
      throw error;
    }
    if (!created) {
      return c.json({ error: 'internal', requestId }, 500);
    }

    return c.json(
      MoveAppointmentResponse.parse({
        appointment: {
          id: created.id,
          windowStart: created.window_start.toISOString(),
          windowEnd: created.window_end.toISOString(),
          status: created.status,
          deliveryMode: created.delivery_mode,
          client: {
            id: clientId,
            givenName: client.given_name,
            familyName: client.family_name,
            givenNameAr: client.given_name_ar,
            familyNameAr: client.family_name_ar,
          },
          practitioner: {
            id: appointment.practitioner_id,
            displayName: appointment.practitioner_display_name,
          },
          serviceType: {
            id: appointment.service_type_id,
            name: appointment.service_type_name,
          },
          location: {
            id: appointment.location_id,
            label: appointment.location_label,
            emirate: appointment.location_emirate,
          },
        },
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
