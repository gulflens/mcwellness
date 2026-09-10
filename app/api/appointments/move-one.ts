import { isoDateIn, type Capability, type IsoDate } from '@domain/shared';
import type { ExistingAppointment } from '@domain/scheduling';
import { logRead } from '../_middleware/audit';
import type { Db } from '../_middleware/request-context';
import type { AppointmentRow, DeliveryMode } from './schema';

/**
 * One visit's move, in the pieces both callers need: the drawer's own
 * `POST /api/appointments/:id/move`, which moves one visit and answers, and
 * `POST /api/appointments/reorder`, which moves several inside one
 * transaction and must retire every old row before it takes any new slot
 * (docs/SPEC/route-planning.md section 5.7).
 *
 * The rule they share is `docs/SPEC/scheduling-manual.md` section 3: a move
 * is two rows, never an edited one. Nothing here decides *whether* a visit
 * may move — that is the route's, because the two routes refuse in different
 * shapes — and nothing here opens or closes a transaction.
 */

/** The length app/api/_middleware/request-context.ts trims a reason to before
 * stamping it on the transaction. Applied by both routes, so their own test of
 * "was a reason given" asks about the same string the trail will carry: a
 * header of nothing but control characters or non-breaking spaces is not a
 * reason, and `.trim()` alone would have accepted several of them (security
 * review of the move's pull request). */
export const REASON_MAX = 500;

export const PRACTICE_TIME_ZONE = 'Asia/Dubai';
export const EXCLUSION_VIOLATION = '23P01';

// Every status that still holds a slot, for the conflict read — and the row
// being moved, excluded by id, because a visit cannot clash with itself.
export const LIVE_STATUSES_EXCLUDED = "('cancelled', 'cancelled_late', 'no_show', 'rescheduled')";

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
 * remember to write (schema review of the move's pull request).
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
  'and tenant_id = app.current_tenant_id() ' +
  'and status = any($2::appointment_status[])';

const INSERT_SQL =
  'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, location_id, ' +
  'delivery_mode, window_start, window_end, travel_buffer_minutes, status, rescheduled_from_id, ' +
  'created_by, reassigned_from_practitioner_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ' +
  'returning id, window_start, window_end, status, delivery_mode';

export type AppointmentDbRow = {
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

export type ClientDbRow = {
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

export type CreatedRow = {
  id: string;
  window_start: Date;
  window_end: Date;
  status: AppointmentRow['status'];
  delivery_mode: DeliveryMode;
};

function toExisting(rows: readonly OtherAppointmentRow[]): ExistingAppointment[] {
  return rows.map((r) => ({
    id: r.id,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    travelBufferMinutes: r.travel_buffer_minutes,
  }));
}

/**
 * The client's row was read to check the move and to answer with their name;
 * logged exactly as app/api/clients/list.ts logs what it shows. One row per
 * visit per action, written by the route that took the action.
 */
export async function logClientRead(db: Db, clientId: string): Promise<void> {
  await logRead(db, 'client', clientId, clientId);
}

export async function readAppointment(db: Db, id: string): Promise<AppointmentDbRow | undefined> {
  const existing = await db.query<AppointmentDbRow>(APPOINTMENT_SQL, [id]);
  return existing.rows[0];
}

export async function hasOpenSession(db: Db, id: string): Promise<boolean> {
  const openSession = await db.query(OPEN_SESSION_SQL, [id]);
  return openSession.rows.length > 0;
}

export type MoveContext = {
  client: ClientDbRow;
  assigneeCapabilities: Capability[];
  activeConsentPurposes: string[];
  practitionerAppointments: ExistingAppointment[];
  clientAppointments: ExistingAppointment[];
  /** The candidate's own calendar date: a credential is judged on the day of the visit. */
  on: IsoDate;
};

/**
 * Everything the conflict check needs, read in the caller's own transaction.
 * Null: the client is gone.
 *
 * **It writes no audit row, and the caller does.** The client's own row is
 * read here, and reading it is a thing the trail records — but a reorder
 * calls this twice for the same visit, once in phase one to decide and once
 * per visit in phase two to check the new window against the rows already
 * inserted. Logging inside meant two `read` rows per household for one
 * action, where `docs/SPEC/route-planning.md` section 11 says a reorder
 * writes what a move writes (the review of the day map's pull request, note
 * N2). So `logClientRead` below is the caller's to call, once per visit per
 * action.
 */
export async function readMoveContext(
  db: Db,
  appointment: AppointmentDbRow,
  windowStart: Date,
): Promise<MoveContext | null> {
  const clientId = appointment.client_id;
  const clientResult = await db.query<ClientDbRow>(CLIENT_SQL, [clientId]);
  const client = clientResult.rows[0];
  if (!client) return null;

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

  const consentResult = await db.query<{ purpose: string }>(CONSENTS_SQL, [clientId, windowStart]);

  // Every other live appointment of this practitioner and this client — the
  // row being moved excluded by id, since a visit cannot clash with itself.
  const practitionerAppointments = await db.query<OtherAppointmentRow>(
    'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
      `where practitioner_id = $1 and id <> $2 and status not in ${LIVE_STATUSES_EXCLUDED} ` +
      'and tenant_id = app.current_tenant_id()',
    [appointment.practitioner_id, appointment.id],
  );
  const clientAppointments = await db.query<OtherAppointmentRow>(
    'select id, window_start, window_end, travel_buffer_minutes from appointment ' +
      `where client_id = $1 and id <> $2 and status not in ${LIVE_STATUSES_EXCLUDED} ` +
      'and tenant_id = app.current_tenant_id()',
    [clientId, appointment.id],
  );

  return {
    client,
    assigneeCapabilities,
    activeConsentPurposes: consentResult.rows.map((r) => r.purpose),
    practitionerAppointments: toExisting(practitionerAppointments.rows),
    clientAppointments: toExisting(clientAppointments.rows),
    on,
  };
}

/**
 * One of `from` becomes `rescheduled`, freeing its slot. False: the row is no
 * longer in any of those statuses, so somebody else settled it first.
 *
 * The status predicate is the second half of the check the routes make on the
 * row they read, now against the row as it stands at write time, so a visit
 * somebody else settled between the two cannot be moved out from under them.
 *
 * **The statuses are the caller's, and the two callers differ.** `move.ts`
 * passes both, because moving a visit a household has agreed to is what that
 * route exists for. `reorder.ts` passes `'proposed'` alone: it proves
 * `proposed` in phase one, but under READ COMMITTED each statement takes a
 * fresh snapshot, so a confirm committed between that read and this write
 * would be visible here — and a predicate accepting `confirmed` would retire
 * it, leaving a household told 09:00 with a proposed 14:00 and nobody
 * informed. With `'proposed'` alone the confirm wins the race and the reorder
 * is refused as stale, which is the right way round (the review of the day
 * map's pull request, finding S1).
 */
export async function retire(
  db: Db,
  id: string,
  from: readonly AppointmentRow['status'][],
): Promise<boolean> {
  const retired = await db.query(RETIRE_SQL, [id, from]);
  return retired.rowCount === 1;
}

export async function insertMoved(
  db: Db,
  args: {
    tenantId: string;
    appointment: AppointmentDbRow;
    windowStart: Date;
    windowEnd: Date;
    travelBufferMinutes: number;
    status: AppointmentRow['status'];
    rescheduledFromId: string;
    createdBy: string;
    /** A reassignment's new practitioner; a move passes nothing and keeps the row's own. */
    practitionerId?: string;
    /** Set by a reassignment alone (migration 210). */
    reassignedFromPractitionerId?: string;
  },
): Promise<CreatedRow | undefined> {
  const result = await db.query<CreatedRow>(INSERT_SQL, [
    args.tenantId,
    args.appointment.client_id,
    args.practitionerId ?? args.appointment.practitioner_id,
    args.appointment.service_type_id,
    args.appointment.location_id,
    args.appointment.delivery_mode,
    args.windowStart,
    args.windowEnd,
    args.travelBufferMinutes,
    args.status,
    args.rescheduledFromId,
    args.createdBy,
    args.reassignedFromPractitionerId ?? null,
  ]);
  return result.rows[0];
}

/** Which exclusion constraint a write hit, or null when the error is something else. */
export function exclusionConflict(
  error: unknown,
): 'client_overlap' | 'practitioner_overlap' | null {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code !== EXCLUSION_VIOLATION) return null;
  return pgError.constraint === 'appointment_no_overlap_client'
    ? 'client_overlap'
    : 'practitioner_overlap';
}

/**
 * The wire row these routes answer with.
 *
 * `practitioner` is the row's own unless one is handed in: a reassignment
 * puts the visit in somebody else's hands, and `appointment` is the row it
 * was taken *from*, whose practitioner and display name are the ones the
 * household was promised rather than the ones the answer should carry.
 */
export function appointmentRow(
  appointment: AppointmentDbRow,
  client: ClientDbRow,
  created: CreatedRow,
  practitioner?: { id: string; displayName: string },
): AppointmentRow {
  return {
    id: created.id,
    windowStart: created.window_start.toISOString(),
    windowEnd: created.window_end.toISOString(),
    status: created.status,
    deliveryMode: created.delivery_mode,
    client: {
      id: appointment.client_id,
      givenName: client.given_name,
      familyName: client.family_name,
      givenNameAr: client.given_name_ar,
      familyNameAr: client.family_name_ar,
    },
    practitioner: practitioner ?? {
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
    // `created` is the row this same request just wrote: nothing can point
    // rescheduled_from_id at a row that did not exist a moment ago, so it has
    // never itself been superseded.
    movedTo: null,
  };
}
