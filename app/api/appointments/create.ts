import type { Hono } from 'hono';
import { canActor, isoDateIn, type Capability } from '@domain/shared';
import { checkConflicts, windowFor, type ExistingAppointment } from '@domain/scheduling';
import type { ApiEnv } from '../_middleware/request-context';
import {
  AppointmentRow,
  ConflictResponse,
  CreateAppointmentRequest,
  type DeliveryMode,
} from './schema';

/**
 * POST /api/appointments: places a proposed appointment (scheduling-manual.md
 * section 4.3, cut to what this stream's first pull request needs — no
 * entitlement balance yet, no override). Two gates, in order: `canActor`
 * (the booking role, and the assignee actually holding a valid, executing
 * credential for the chosen service on the chosen date) refuses before
 * anything else is even loaded; `checkConflicts` (the same credential rule
 * again, plus the two overlaps and the client's status) then refuses with a
 * plain reason. What survives both is inserted as `proposed`; telling the
 * family is still a manual step (scheduling-manual.md section 3).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const LIVE_STATUSES_EXCLUDED = "('cancelled', 'cancelled_late', 'no_show', 'rescheduled')";

type CredentialRow = {
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

type ClientRow = { given_name: string; family_name: string; status: string };
type PractitionerRow = { display_name: string; status: string };
type ServiceTypeRow = { name: string; delivery_modes: DeliveryMode[]; status: string };
type LocationRow = { label: string; emirate: string };

export function mountAppointmentCreate(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post('/api/appointments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    const body = CreateAppointmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const { clientId, practitionerId, serviceTypeId, locationId, deliveryMode } = body.data;
    const travelBufferMinutes = body.data.travelBufferMinutes ?? 15;
    const windowStart = new Date(body.data.windowStart);
    const { end: windowEnd } = windowFor(windowStart);
    const on = isoDateIn(windowStart, PRACTICE_TIME_ZONE);

    // One query at a time: a request holds a single connection (request-context.ts),
    // so running these concurrently only queues them anyway, and pg now warns about it.
    const clientResult = await db.query<ClientRow>(
      'select given_name, family_name, status from client where id = $1',
      [clientId],
    );
    const practitionerResult = await db.query<PractitionerRow>(
      'select u.display_name, p.status from practitioner p join app_user u on u.id = p.user_id ' +
        'where p.id = $1',
      [practitionerId],
    );
    const serviceTypeResult = await db.query<ServiceTypeRow>(
      // Cast: pg has no built-in parser for a custom enum's array OID and
      // would otherwise hand back the raw "{home,studio}" text.
      'select name, delivery_modes::text[] as delivery_modes, status from service_type where id = $1',
      [serviceTypeId],
    );
    const locationResult = await db.query<LocationRow>(
      'select label::text as label, emirate::text as emirate from location where id = $1',
      [locationId],
    );
    const credentialResult = await db.query<CredentialRow>(
      'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
        'valid_from, valid_to from credential where practitioner_id = $1',
      [practitionerId],
    );

    const client = clientResult.rows[0];
    const practitioner = practitionerResult.rows[0];
    const serviceType = serviceTypeResult.rows[0];
    const location = locationResult.rows[0];
    if (!client || !practitioner || !serviceType || !location) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!serviceType.delivery_modes.includes(deliveryMode)) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const assigneeCapabilities: Capability[] = credentialResult.rows.map((r) => ({
      serviceTypeId: r.service_type_id,
      canExecuteSession: r.can_execute_session,
      canAuthorProtocol: r.can_author_protocol,
      canSignReport: r.can_sign_report,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));

    if (
      !canActor(
        actor,
        { type: 'appointment.create', practitionerId, serviceTypeId, on },
        { assigneeCapabilities },
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const practitionerAppointmentsResult = await db.query<OtherAppointmentRow>(
      `select id, window_start, window_end, travel_buffer_minutes from appointment ` +
        `where practitioner_id = $1 and status not in ${LIVE_STATUSES_EXCLUDED}`,
      [practitionerId],
    );
    const clientAppointmentsResult = await db.query<OtherAppointmentRow>(
      `select id, window_start, window_end, travel_buffer_minutes from appointment ` +
        `where client_id = $1 and status not in ${LIVE_STATUSES_EXCLUDED}`,
      [clientId],
    );
    const toExisting = (rows: OtherAppointmentRow[]): ExistingAppointment[] =>
      rows.map((r) => ({
        id: r.id,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        travelBufferMinutes: r.travel_buffer_minutes,
      }));

    const report = checkConflicts(
      {
        practitionerId,
        clientId,
        serviceTypeId,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        on,
      },
      {
        practitionerAppointments: toExisting(practitionerAppointmentsResult.rows),
        clientAppointments: toExisting(clientAppointmentsResult.rows),
        practitionerCredentials: assigneeCapabilities,
        clientActive: client.status === 'active',
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

    const { rows } = await db.query<{
      id: string;
      window_start: Date;
      window_end: Date;
      status: AppointmentRow['status'];
      delivery_mode: DeliveryMode;
    }>(
      'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
        'delivery_mode, window_start, window_end, travel_buffer_minutes, created_by) ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ' +
        'returning id, window_start, window_end, status, delivery_mode',
      [
        actor.tenantId,
        clientId,
        practitionerId,
        serviceTypeId,
        locationId,
        deliveryMode,
        windowStart,
        windowEnd,
        travelBufferMinutes,
        actor.userId,
      ],
    );
    const created = rows[0];
    if (!created) {
      return c.json({ error: 'internal', requestId }, 500);
    }

    return c.json(
      AppointmentRow.parse({
        id: created.id,
        windowStart: created.window_start.toISOString(),
        windowEnd: created.window_end.toISOString(),
        status: created.status,
        deliveryMode: created.delivery_mode,
        client: { id: clientId, givenName: client.given_name, familyName: client.family_name },
        practitioner: { id: practitionerId, displayName: practitioner.display_name },
        serviceType: { id: serviceTypeId, name: serviceType.name },
        location: { id: locationId, label: location.label, emirate: location.emirate },
      }),
      201,
    );
  });
}
