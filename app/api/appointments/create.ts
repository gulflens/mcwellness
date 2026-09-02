import type { Context, Hono } from 'hono';
import { ageOn, canActor, hasRole, isoDateIn, type Capability, type IsoDate } from '@domain/shared';
import {
  checkConflicts,
  windowFor,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
  type ExistingAppointment,
} from '@domain/scheduling';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import {
  AppointmentRow,
  ConflictResponse,
  CreateAppointmentRequest,
  type BadRequestCode,
  type DeliveryMode,
} from './schema';

/**
 * POST /api/appointments: places a proposed appointment (scheduling-manual.md
 * section 4.3, cut to what this stream's first pull request needs — no
 * entitlement balance yet, no override).
 *
 * Gates, in order: the booking role, checked before any read at all, so a
 * refused caller never causes a client row to be looked at; `canActor`'s
 * credential rule, once the assignee's own credentials are loaded; a set of
 * plain-code 400s for a row that does not exist, is not active, or does not
 * fit (a service the location or delivery mode do not support); then
 * `checkConflicts` (the credential rule again, the two overlaps, the
 * client's status and the consents this appointment needs), which refuses
 * with a plain reason and no write. What survives every gate is inserted as
 * `proposed` — telling the family is still a manual step (scheduling-manual.md
 * section 3). The insert itself is still guarded a last time by the
 * database's own exclusion constraints (db/migrations/200_appointment.sql):
 * a concurrent booking that slips past the checkConflicts read is caught
 * there and answered the same way, not as a raw 500.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const LIVE_STATUSES_EXCLUDED = "('cancelled', 'cancelled_late', 'no_show', 'rescheduled')";
const EXCLUSION_VIOLATION = '23P01';

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

type ClientRow = {
  given_name: string;
  family_name: string;
  status: string;
  date_of_birth: string | null;
};
type PractitionerRow = { display_name: string; status: string };
type ServiceTypeRow = { name: string; delivery_modes: DeliveryMode[]; status: string };
type LocationRow = {
  label: string;
  emirate: string;
  owner_type: string;
  owner_id: string;
  tenant_location_id: string | null;
};
type ConsentRow = { purpose: string };

/** The consent purposes this appointment needs (scheduling-manual.md section 6.1). A
 * null date of birth cannot be proven adult, so it counts as needing the minor
 * purpose too — fail closed, not open. Booking policy, not a scheduling
 * conflict rule, so it lives here rather than in domain/scheduling; and not in
 * domain/client, which this stream may not import from (docs/SPEC/OWNERSHIP.md
 * rule 3). */
export function requiredConsentPurposes(
  deliveryMode: DeliveryMode,
  dateOfBirth: string | null,
  on: IsoDate,
): string[] {
  const purposes = ['participation'];
  if (dateOfBirth === null || ageOn(dateOfBirth, on) < 18) {
    purposes.push('minor_participation');
  }
  if (deliveryMode === 'home') {
    purposes.push('home_visit');
  }
  return purposes;
}

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: BadRequestCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

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
      return badRequest(c, requestId, 'invalid_request');
    }

    // The booking role, before a single row is read: a refused caller must
    // never trigger a client read (the credential-bound check below still
    // runs later, once the assignee's own credentials are loaded).
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const { clientId, practitionerId, serviceTypeId, locationId, deliveryMode } = body.data;
    const travelBufferMinutes = body.data.travelBufferMinutes ?? 15;
    const windowStart = new Date(body.data.windowStart);
    const { end: windowEnd } = windowFor(windowStart);
    const on = isoDateIn(windowStart, PRACTICE_TIME_ZONE);

    // One query at a time: a request holds a single connection (request-context.ts),
    // so running these concurrently only queues them anyway, and pg now warns about it.
    const clientResult = await db.query<ClientRow>(
      'select given_name, family_name, status, date_of_birth from client where id = $1',
      [clientId],
    );
    const client = clientResult.rows[0];
    if (!client) {
      return badRequest(c, requestId, 'client_not_found');
    }
    // Read logging, exactly as app/api/clients/list.ts logs the clients it shows.
    await logRead(db, 'client', clientId, clientId);

    const practitionerResult = await db.query<PractitionerRow>(
      'select u.display_name, p.status from practitioner p join app_user u on u.id = p.user_id ' +
        'where p.id = $1',
      [practitionerId],
    );
    const practitioner = practitionerResult.rows[0];
    if (!practitioner) {
      return badRequest(c, requestId, 'practitioner_not_found');
    }
    if (practitioner.status !== 'active') {
      return badRequest(c, requestId, 'practitioner_inactive');
    }

    const serviceTypeResult = await db.query<ServiceTypeRow>(
      // Cast: pg has no built-in parser for a custom enum's array OID and
      // would otherwise hand back the raw "{home,studio}" text.
      'select name, delivery_modes::text[] as delivery_modes, status from service_type where id = $1',
      [serviceTypeId],
    );
    const serviceType = serviceTypeResult.rows[0];
    if (!serviceType) {
      return badRequest(c, requestId, 'service_type_not_found');
    }
    if (serviceType.status !== 'active') {
      return badRequest(c, requestId, 'service_type_inactive');
    }
    if (!serviceType.delivery_modes.includes(deliveryMode)) {
      return badRequest(c, requestId, 'delivery_mode_unavailable');
    }

    const locationResult = await db.query<LocationRow>(
      'select l.label::text as label, l.emirate::text as emirate, l.owner_type::text as owner_type, ' +
        'l.owner_id, t.location_id as tenant_location_id ' +
        'from location l, tenant t where l.id = $1 and t.id = $2',
      [locationId, actor.tenantId],
    );
    const location = locationResult.rows[0];
    if (!location) {
      return badRequest(c, requestId, 'location_not_found');
    }
    // The location must actually be this client's own (a home visit) or the
    // practice's studio (a studio visit): the day sheet reads it live, so the
    // wrong location is not a cosmetic mistake (scheduling-manual.md section 4.3).
    // 'remote' carries no such constraint.
    if (
      deliveryMode === 'home' &&
      !(location.owner_type === 'client' && location.owner_id === clientId)
    ) {
      return badRequest(c, requestId, 'location_mismatch');
    }
    if (deliveryMode === 'studio' && locationId !== location.tenant_location_id) {
      return badRequest(c, requestId, 'location_mismatch');
    }

    const credentialResult = await db.query<CredentialRow>(
      'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
        'valid_from, valid_to from credential where practitioner_id = $1',
      [practitionerId],
    );
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

    const consentResult = await db.query<ConsentRow>(
      "select purpose from consent where client_id = $1 and status = 'active' " +
        'and (expires_at is null or expires_at > $2)',
      [clientId, windowStart],
    );

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
        requiredConsentPurposes: requiredConsentPurposes(deliveryMode, client.date_of_birth, on),
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

    type CreatedRow = {
      id: string;
      window_start: Date;
      window_end: Date;
      status: AppointmentRow['status'];
      delivery_mode: DeliveryMode;
    };
    let created: CreatedRow | undefined;
    try {
      const result = await db.query<CreatedRow>(
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
      created = result.rows[0];
    } catch (error) {
      // A concurrent booking can slip past the read above and still be caught
      // here, by the database's own exclusion constraints
      // (db/migrations/200_appointment.sql) — answered the same way a
      // checkConflicts refusal is, not as a raw 500.
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
