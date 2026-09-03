import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { hasRole } from '@domain/shared';
import { DEFAULT_NOTICE_HOURS, cancellationStatusFor } from '@domain/scheduling';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  CancelAppointmentRequest,
  CancelAppointmentResponse,
  type AppointmentActionCode,
  type AppointmentRow,
  type CancellationReason,
} from './schema';

/**
 * `POST /api/appointments/:id/cancel` — a visit that is not going to happen
 * (docs/SPEC/scheduling-manual.md sections 2, 3 and 6.4).
 *
 * **What it costs, and who decided.** Inside the practice's notice period the
 * appointment is written `cancelled_late` rather than `cancelled`, and
 * billing's own trigger (404_billing_consumption.sql) takes one of the
 * client's credits for it. The rule is `cancellationStatusFor`
 * (domain/scheduling/cancellation.ts) and the figure it is given is the
 * practice's own `scheduling_setting.notice_hours` — nothing in this file
 * decides either. The way back is billing's waiver, and this route hands the
 * screen the id it needs for it rather than leaving somebody to go and find
 * the credit that was taken.
 *
 * **Who may call a visit off.** The three calendar roles, for any visit. And
 * a practitioner, for their own stop and no one else's: they are the person
 * who arrives at a door to find the visit cannot go ahead, and
 * `unfit_to_attend` is that. Section 2 gives a practitioner "request a change
 * (Stage 2)" rather than a cancellation, so this widens that table by one
 * narrow case, on the operator's direction of 2026-09-03. It is not a
 * widening of the calendar: the row policy is untouched and a practitioner
 * still cannot update an appointment. They go through
 * `app.cancel_own_appointment`, a security definer door that can set exactly
 * these two statuses on exactly their own unsettled stop — the shape
 * `app.complete_appointment_for_session` (302_session_close.sql) already
 * established for the one transition a practitioner legitimately owns.
 *
 * **`unfit_to_attend` is late whatever the calendar says.** The practitioner
 * has already driven there; the notice was nil however early the visit was
 * booked. The practice also holds a fee for it
 * (`scheduling_setting.unfit_fee_fils`, AED 150 by the operator's decision of
 * 2026-09-03) — recorded, and charged by nothing yet
 * (docs/CHANGE-REQUESTS/scheduling-04.md).
 */

const EXPECTED_STATUSES = ['proposed', 'confirmed'] as const;

const APPOINTMENT_SQL =
  'select id, client_id, status, window_start from appointment ' +
  'where id = $1 and tenant_id = app.current_tenant_id()';

const NOTICE_SQL =
  'select notice_hours from scheduling_setting where tenant_id = app.current_tenant_id()';

const CANCEL_SQL =
  'update appointment set status = $2, cancellation_reason = $3, cancelled_at = now() ' +
  "where id = $1 and tenant_id = app.current_tenant_id() and status in ('proposed', 'confirmed')";

const CANCEL_OWN_SQL = 'select app.cancel_own_appointment($1, $2, $3) as cancelled';

// What billing's trigger did about it, read back rather than assumed. A
// practitioner may read this row for a client on their own schedule
// (db/policies/billing/ledger.sql); the office may read it for anyone. When
// the client held no credit, the trigger queued an exception instead and
// nothing comes back here, which is the honest answer to "was anything
// charged" rather than a claim that something was.
const CONSUMED_CREDIT_SQL =
  'select id from entitlement where tenant_id = app.current_tenant_id() ' +
  "and consumed_by_appointment_id = $1 and status = 'consumed' limit 1";

type AppointmentDbRow = {
  id: string;
  client_id: string;
  status: AppointmentRow['status'];
  window_start: Date;
};

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: AppointmentActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

/**
 * The practice's own notice period, or the figure it starts life with.
 *
 * 202_scheduling_setting.sql gives every practice this row on the day it
 * exists and never lets it be deleted, so the fallback is for a database
 * mid-migration rather than for ordinary life. Falling back rather than
 * refusing is deliberate: a practice with a missing settings row should still
 * be able to call a visit off, and twenty-four hours is what it would have
 * had.
 */
async function noticeHoursFor(db: Db): Promise<number> {
  const { rows } = await db.query<{ notice_hours: number }>(NOTICE_SQL);
  return rows[0]?.notice_hours ?? DEFAULT_NOTICE_HOURS;
}

export function mountAppointmentCancel(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post('/api/appointments/:id/cancel', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // Before any read at all. Finance and a client contact are refused here
    // and never cause an appointment to be looked at.
    const isCalendarRole = hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    if (!isCalendarRole && !hasRole(actor, 'practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // A cancellation takes something from a household — its visit, and inside
    // the notice period one of its credits — so the trail carries why
    // (docs/SPEC/scheduling-manual.md section 9). The middleware has already
    // scrubbed and stamped the header; this only insists there was one.
    if ((c.req.header('x-reason') ?? '').trim().length === 0) {
      return badRequest(c, requestId, 'reason_required');
    }

    const body = CancelAppointmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return badRequest(c, requestId, 'invalid_request');
    }
    const reason: CancellationReason = body.data.reason;

    const appointmentId = c.req.param('id');
    if (!z.uuid().safeParse(appointmentId).success) {
      return badRequest(c, requestId, 'invalid_request');
    }

    const db = c.get('db');
    const { rows } = await db.query<AppointmentDbRow>(APPOINTMENT_SQL, [appointmentId]);
    const appointment = rows[0];
    // Row security has already narrowed a practitioner to their own stops
    // (db/policies/scheduling/appointment_access.sql), so a practitioner
    // asking about somebody else's visit is answered "not found" and is never
    // told that it exists. The definer door below checks the same thing again
    // for itself, because it runs with row security switched off.
    if (!appointment) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    if (!(EXPECTED_STATUSES as readonly string[]).includes(appointment.status)) {
      return badRequest(c, requestId, 'appointment_settled');
    }

    const noticeHours = await noticeHoursFor(db);
    const status = cancellationStatusFor(
      { windowStart: appointment.window_start },
      reason,
      now(),
      noticeHours,
    );

    let cancelled: boolean;
    if (isCalendarRole) {
      const result = await db.query(CANCEL_SQL, [appointmentId, status, reason]);
      cancelled = result.rowCount === 1;
    } else {
      const result = await db.query<{ cancelled: boolean }>(CANCEL_OWN_SQL, [
        appointmentId,
        status,
        reason,
      ]);
      cancelled = result.rows[0]?.cancelled === true;
    }
    // Nothing was written: either somebody settled this visit between the read
    // above and the write, or — for a practitioner — it is not their stop
    // after all. Both are the same answer to this caller, and neither is an
    // error to raise, since the transaction is otherwise sound.
    if (!cancelled) {
      return badRequest(c, requestId, 'appointment_settled');
    }

    // Billing's trigger has already run, in this same transaction.
    const credit = await db.query<{ id: string }>(CONSUMED_CREDIT_SQL, [appointmentId]);
    const waiverEntitlementId = credit.rows[0]?.id ?? null;

    // No separate read row: the update above carries the whole story into the
    // audit trail through appointment's own row trigger — before and after,
    // the acting person, and the reason from the header
    // (080_audit_triggers.sql, docs/SPEC/audit.md section 5).
    return c.json(
      CancelAppointmentResponse.parse({
        id: appointmentId,
        status,
        reason,
        noticeHours,
        creditConsumed: waiverEntitlementId !== null,
        waiverEntitlementId,
      }),
    );
  });
}
