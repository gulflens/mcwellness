import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import {
  canRecordPastSession,
  pastSessionDateProblem,
  pastSessionTimes,
  type CheckInConsentPurpose,
  type DeliveryMode,
} from '@domain/session';
import { ageOn, hasRole, isoDateIn, type Capability } from '@domain/shared';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { logRefusal, logSensitive } from './audit';
import {
  RecordPastSessionRequest,
  RecordPastSessionResponse,
  type RecordPastBadRequestCode,
  type RecordPastBlockReason,
  type VoidSessionResponse,
} from './schema';
import {
  loadVoidTarget,
  refuseVoid,
  voidFunctionRefusal,
  voidRecordedSession,
  voidRefusalFor,
} from './void';

/**
 * POST /api/sessions/from-records — a visit that happened before the app,
 * logged by the office from the practice's records
 * (docs/superpowers/specs/2026-09-16-past-sessions-design.md; trunk round 51).
 *
 * The clients the practice already has were seen on paper, and their history
 * belongs on their record. This writes one visit as a live one is written —
 * a completed appointment for its window and a completed session linked to
 * it, in the request's own transaction — so the day schedule, the household's
 * portal, and the report and assessment pickers all see it.
 *
 * **Who.** The calendar's three roles, for a practitioner who held a
 * credential for the service on the visit's own date (`session.record_past`,
 * domain/shared/actor.ts). Never the practitioner's device: the check-in
 * route is for a visit happening now.
 *
 * **What it refuses, and logs before refusing** (docs/SPEC/session-capture.md
 * section 8): a day after today or before the practice existed; the booking
 * route's own not-found and mismatch cases; the gate's reasons; a visit the
 * ledger cannot settle — no credit valid on that day and the visit not
 * marked settled before the app, which the database refuses inside the
 * billing trigger (migration 966) and this route answers as
 * `no_credit_available`, nothing written; and an overlap with a visit the
 * practitioner or the client already had then, which the calendar's own
 * exclusion constraints refuse.
 *
 * **`X-Reason` is required**: why this visit is being logged now is part of
 * the record, and the sensitive action `session_recorded_from_records`
 * carries it.
 *
 * **A correction** (`replaces`, trunk round 60,
 * docs/superpowers/specs/2026-09-23-void-logged-session-design.md): the
 * visit named is voided and this one written as its next version, in one
 * act under the same savepoint — a refusal of either half leaves both as
 * they were, so the wrong visit is never gone while the right one is
 * missing. The old visit is held to `app/api/sessions/void.ts`'s rules and
 * answers with its codes.
 *
 * **Who it is for.** A current client — active, or paused — whose
 * practitioner is on the practice's books today; a practitioner who has
 * since left is not offered, and a visit of theirs is logged under whoever
 * the office decides, which the reason should say.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const EXCLUSION_VIOLATION = '23P01';
const RESTRICT_VIOLATION = '23001';

type ClientRow = { status: string; date_of_birth: string | null };
type PractitionerRow = { status: string };
type ServiceTypeRow = { delivery_modes: DeliveryMode[]; status: string; duration_minutes: number };
type LocationRow = { owner_type: string; owner_id: string; tenant_location_id: string | null };
type CredentialRow = {
  service_type_id: string;
  can_execute_session: boolean;
  can_author_protocol: boolean;
  can_sign_report: boolean;
  valid_from: string;
  valid_to: string | null;
};
type ConsentRow = { purpose: string };

const CONSENT_PURPOSES: readonly CheckInConsentPurpose[] = [
  'participation',
  'minor_participation',
  'home_visit',
  'health_data',
];

function badRequest(c: Context<ApiEnv>, requestId: string, code: RecordPastBadRequestCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

export function mountRecordPastSession(api: Hono<ApiEnv>, now: () => Date): void {
  api.post('/api/sessions/from-records', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    // The session's id is minted first, so every refusal below has a row to
    // be logged against, whether or not one is ever written (section 8:
    // every block reason is logged). Until the client is verified to exist
    // the refusal names no client: a claimed id is not proof of anything.
    const sessionId = randomUUID();
    const refuse = async (reasons: readonly RecordPastBlockReason[], clientId: string | null) => {
      await logRefusal(db, 'session', sessionId, clientId, reasons);
      return c.json(RecordPastSessionResponse.parse({ status: 'blocked', reasons }), 422);
    };
    const refuseBadRequest = async (code: RecordPastBadRequestCode, clientId: string | null) => {
      await logRefusal(db, 'session', sessionId, clientId, [code]);
      return badRequest(c, requestId, code);
    };

    const body = RecordPastSessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return refuseBadRequest('invalid_request', null);
    }
    // The office's role before a single row is read; the practitioner's own
    // credential is judged by the gate once it is loaded.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      await logRefusal(db, 'session', sessionId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return refuseBadRequest('reason_required', null);
    }

    const input = body.data;
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const dateProblem = pastSessionDateProblem(input.on, today);
    if (dateProblem) {
      return refuseBadRequest(dateProblem, null);
    }

    const clientResult = await db.query<ClientRow>(
      'select status, date_of_birth::text as date_of_birth from client where id = $1',
      [input.clientId],
    );
    const client = clientResult.rows[0];
    if (!client) {
      return refuseBadRequest('client_not_found', null);
    }
    await logRead(db, 'client', input.clientId, input.clientId);
    // A current client: active, or paused and coming back. A lead has no
    // history with the practice yet, and a closed or erased record takes
    // nothing more.
    if (client.status !== 'active' && client.status !== 'paused') {
      return refuse(['client_inactive'], input.clientId);
    }

    const practitionerResult = await db.query<PractitionerRow>(
      'select status from practitioner where id = $1',
      [input.practitionerId],
    );
    const practitioner = practitionerResult.rows[0];
    if (!practitioner) {
      return refuseBadRequest('practitioner_not_found', input.clientId);
    }
    if (practitioner.status !== 'active') {
      return refuseBadRequest('practitioner_inactive', input.clientId);
    }

    const serviceTypeResult = await db.query<ServiceTypeRow>(
      'select delivery_modes::text[] as delivery_modes, status, duration_minutes ' +
        'from service_type where id = $1',
      [input.serviceTypeId],
    );
    const serviceType = serviceTypeResult.rows[0];
    if (!serviceType) {
      return refuseBadRequest('service_type_not_found', input.clientId);
    }
    if (serviceType.status !== 'active') {
      return refuseBadRequest('service_type_inactive', input.clientId);
    }
    if (!serviceType.delivery_modes.includes(input.deliveryMode)) {
      return refuseBadRequest('delivery_mode_unavailable', input.clientId);
    }

    // The place, held to the booking route's own rule: a home visit at the
    // client's own address, a studio visit at the practice's.
    const locationResult = await db.query<LocationRow>(
      'select l.owner_type::text as owner_type, l.owner_id, t.location_id as tenant_location_id ' +
        'from location l, tenant t where l.id = $1 and t.id = $2',
      [input.locationId, actor.tenantId],
    );
    const location = locationResult.rows[0];
    if (!location) {
      return refuseBadRequest('location_not_found', input.clientId);
    }
    if (
      input.deliveryMode === 'home' &&
      !(location.owner_type === 'client' && location.owner_id === input.clientId)
    ) {
      return refuseBadRequest('location_mismatch', input.clientId);
    }
    if (input.deliveryMode === 'studio' && input.locationId !== location.tenant_location_id) {
      return refuseBadRequest('location_mismatch', input.clientId);
    }

    const credentialResult = await db.query<CredentialRow>(
      'select service_type_id, can_execute_session, can_author_protocol, can_sign_report, ' +
        'valid_from::text as valid_from, valid_to::text as valid_to from credential where practitioner_id = $1',
      [input.practitionerId],
    );
    const practitionerCapabilities: Capability[] = credentialResult.rows.map((r) => ({
      serviceTypeId: r.service_type_id,
      canExecuteSession: r.can_execute_session,
      canAuthorProtocol: r.can_author_protocol,
      canSignReport: r.can_sign_report,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }));
    const consentResult = await db.query<ConsentRow>(
      "select purpose::text as purpose from consent where client_id = $1 and status = 'active' " +
        'and (expires_at is null or expires_at > $2)',
      [input.clientId, now().toISOString()],
    );
    const activeConsentPurposes = consentResult.rows
      .map((r) => r.purpose)
      .filter((p): p is CheckInConsentPurpose =>
        (CONSENT_PURPOSES as readonly string[]).includes(p),
      );

    const gate = canRecordPastSession(
      {
        actor,
        practitionerId: input.practitionerId,
        practitionerCapabilities,
        serviceTypeId: input.serviceTypeId,
        on: input.on,
        deliveryMode: input.deliveryMode,
        hasDateOfBirth: client.date_of_birth !== null,
        isMinor: client.date_of_birth !== null && ageOn(client.date_of_birth, today) < 18,
        activeConsentPurposes,
      },
      now(),
    );
    if (!gate.ok) {
      return refuse(gate.reasons, input.clientId);
    }

    // A correction: the visit it replaces must be one a void may withdraw,
    // asked of the domain first so the refusal is its sentence.
    const replaces = input.replaces ?? null;
    const replaced = replaces ? await loadVoidTarget(db, replaces) : null;
    if (replaces) {
      if (!replaced) return refuseVoid(c, replaces, null, 'not_found');
      const refusal = voidRefusalFor(actor.roles, replaced);
      if (refusal) return refuseVoid(c, replaces, replaced.client_id, refusal);
    }

    const { startsAt, endsAt } = pastSessionTimes({
      on: input.on,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? serviceType.duration_minutes,
    });

    // One visit as a live one is written: the appointment for its window,
    // then the session linked to it. Under a savepoint, so a refusal by the
    // calendar's constraints or the ledger's trigger leaves the transaction
    // usable for the refusal's own audit row.
    await db.query('savepoint record_past');
    let appointmentId: string;
    let voided: VoidSessionResponse | undefined;
    try {
      // The wrong visit first, which frees its window for the right one.
      if (replaces) voided = await voidRecordedSession(db, replaces);
      const created = await db.query<{ id: string }>(
        'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, ' +
          'location_id, delivery_mode, window_start, window_end, status, created_by) values ' +
          "($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz + interval '45 minutes', " +
          "'completed', $8) returning id",
        [
          actor.tenantId,
          input.clientId,
          input.practitionerId,
          input.serviceTypeId,
          input.locationId,
          input.deliveryMode,
          startsAt,
          actor.userId,
        ],
      );
      appointmentId = created.rows[0]!.id;
      await db.query(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'delivery_mode, location_id, appointment_id, status, checked_in_at, started_at, ' +
          'ended_at, checked_out_at, closed_at, closed_by, created_by, recorded_from, ' +
          'settled_outside_app, version, supersedes_id, amendment_reason) values ' +
          "($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, 'completed', $8, $8, $9, $9, " +
          "$10, $11, $11, 'records', $12, $13, $14::uuid, " +
          "case when $14::uuid is null then null else current_setting('app.reason', true) end)",
        [
          sessionId,
          input.clientId,
          input.practitionerId,
          input.serviceTypeId,
          input.deliveryMode,
          input.locationId,
          appointmentId,
          startsAt,
          endsAt,
          now().toISOString(),
          actor.userId,
          input.billing === 'settled_outside',
          // A correction is the next version of the visit it replaces, under
          // the request's reason (302's session_amendment_reason_with_version).
          replaced ? replaced.version + 1 : 1,
          replaces,
        ],
      );
      await db.query('release savepoint record_past');
    } catch (error) {
      await db.query('rollback to savepoint record_past');
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === EXCLUSION_VIOLATION) {
        return refuse(
          [
            pgError.constraint === 'appointment_no_overlap_client'
              ? 'client_overlap'
              : 'practitioner_overlap',
          ],
          input.clientId,
        );
      }
      if (
        pgError.code === RESTRICT_VIOLATION &&
        pgError.constraint === 'session_no_credit_available'
      ) {
        return refuse(['no_credit_available'], input.clientId);
      }
      // The void refused after all: another request withdrew it first.
      const voidRefusal = replaces ? voidFunctionRefusal(error) : null;
      if (replaces && voidRefusal) {
        return refuseVoid(c, replaces, replaced?.client_id ?? null, voidRefusal);
      }
      throw error;
    }

    if (replaces && voided) {
      await logSensitive(db, 'session_voided', 'session', replaces, replaced?.client_id ?? null);
    }
    await logSensitive(db, 'session_recorded_from_records', 'session', sessionId, input.clientId);
    return c.json(
      RecordPastSessionResponse.parse({
        status: 'recorded',
        sessionId,
        appointmentId,
        billed: input.billing,
        ...(voided ? { voided } : {}),
      }),
      201,
    );
  });
}
