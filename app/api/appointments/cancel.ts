import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { hasRole } from '@domain/shared';
import {
  DEFAULT_NOTICE_HOURS,
  REASONS_NEEDING_THE_HOUSEHOLD_TOLD,
  cancellationStatusFor,
  householdHasBeenTold,
  reasonCanBeGivenAt,
} from '@domain/scheduling';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  CancelAppointmentRequest,
  CancelAppointmentResponse,
  type AppointmentRow,
  type CancelActionCode,
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
 * **And a visit nobody has been told about costs nobody anything.** The
 * notice period measures notice given to a household; a `proposed` visit is a
 * slot the practice is holding and has mentioned to no one (section 3), so
 * there is no notice to break and no credit to take. Two of the reasons —
 * "the family called it off" and "could not go ahead at the door" — cannot be
 * true of such a visit at all, and are refused rather than recorded
 * (docs/CHANGE-REQUESTS/qa-01.md item 5).
 *
 * **`unfit_to_attend` is late whatever the calendar says.** The practitioner
 * has already driven there; the notice was nil however early the visit was
 * booked. The practice also holds a fee for it
 * (`scheduling_setting.unfit_fee_fils`, AED 150 by the operator's decision of
 * 2026-09-03) — recorded, and charged by nothing yet
 * (docs/CHANGE-REQUESTS/scheduling-04.md).
 */

/** The length app/api/_middleware/request-context.ts trims a reason to before
 * stamping it on the transaction. Applied here too, so this route's own test
 * of "was a reason given" asks about the same string the trail will carry: a
 * header of nothing but control characters or non-breaking spaces is not a
 * reason, and `.trim()` alone would have accepted several of them (security
 * review of this pull request). */
const REASON_MAX = 500;

const EXPECTED_STATUSES = ['proposed', 'confirmed'] as const;

const APPOINTMENT_SQL =
  'select id, client_id, status, window_start from appointment ' +
  'where id = $1 and tenant_id = app.current_tenant_id()';

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

const NOTICE_SQL =
  'select notice_hours from scheduling_setting where tenant_id = app.current_tenant_id()';

const CANCEL_SQL =
  'update appointment set status = $2, cancellation_reason = $3, cancelled_at = now() ' +
  "where id = $1 and tenant_id = app.current_tenant_id() and status in ('proposed', 'confirmed')";

// Answers both halves at once: whether the visit was called off, and which
// credit billing's trigger took for it. The second cannot be read by the
// caller on this path — see the note in the function itself.
const CANCEL_OWN_SQL =
  'select cancelled, entitlement_id from app.cancel_own_appointment($1, $2, $3)';

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

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: CancelActionCode) {
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
    if (cleanText(c.req.header('x-reason') ?? '', REASON_MAX).length === 0) {
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

    const openSession = await db.query(OPEN_SESSION_SQL, [appointmentId]);
    if (openSession.rows.length > 0) {
      return badRequest(c, requestId, 'session_open');
    }

    // As much of the visit as the two rules below need: when it opens, and
    // whether the household has been told about it at all.
    const visit = { windowStart: appointment.window_start, status: appointment.status };

    // Two reasons say the household did something, and neither can be true of
    // a visit still `proposed` — a slot the practice is holding and has
    // mentioned to nobody (docs/CHANGE-REQUESTS/qa-01.md item 5). The screen
    // leaves them off the list rather than offering them; this is the same
    // rule beneath, for a caller that is not the screen.
    if (
      !householdHasBeenTold(appointment.status) &&
      REASONS_NEEDING_THE_HOUSEHOLD_TOLD.includes(reason)
    ) {
      return badRequest(c, requestId, 'household_not_told');
    }

    // "The visit could not go ahead at the door" is a thing that happened at a
    // door, and nobody has been to one before the arrival window opens. Without
    // this it is a way to take a household's whole session for a visit weeks
    // away, by choosing the reason that skips the notice rule
    // (domain/scheduling/cancellation.ts, and the compliance review of the
    // pull request that added it). app.cancel_own_appointment refuses the same
    // thing again beneath, because it runs with row security switched off.
    if (!reasonCanBeGivenAt(reason, visit, now())) {
      return badRequest(c, requestId, 'reason_too_early');
    }

    const noticeHours = await noticeHoursFor(db);
    const status = cancellationStatusFor(visit, reason, now(), noticeHours);

    let cancelled: boolean;
    // Set on the practitioner path by the door itself, because that is the only
    // place it can be read from there; left null on the office path, which
    // reads it back below under its own row security.
    let creditFromDoor: string | null = null;
    if (isCalendarRole) {
      const result = await db.query(CANCEL_SQL, [appointmentId, status, reason]);
      cancelled = result.rowCount === 1;
    } else {
      const result = await db.query<{ cancelled: boolean; entitlement_id: string | null }>(
        CANCEL_OWN_SQL,
        [appointmentId, status, reason],
      );
      cancelled = result.rows[0]?.cancelled === true;
      creditFromDoor = result.rows[0]?.entitlement_id ?? null;
    }
    // Nothing was written: either somebody settled this visit between the read
    // above and the write, or — for a practitioner — it is not their stop
    // after all. Both are the same answer to this caller, and neither is an
    // error to raise, since the transaction is otherwise sound.
    if (!cancelled) {
      return badRequest(c, requestId, 'appointment_settled');
    }

    // Billing's trigger has already run, in this same transaction.
    //
    // The office reads the credit back for itself; a practitioner cannot, and
    // must not be told a story about it either. Their reach into a client's
    // ledger goes through app.client_visible_to_practitioner — confirmed visits
    // only — and the visit they have this moment called off is no longer one.
    // So this read would come back empty on that path and the answer would deny
    // a charge that had just been made, taking the waiver link with it
    // (security review of this pull request). The definer door hands it over
    // instead.
    const waiverEntitlementId = isCalendarRole
      ? ((await db.query<{ id: string }>(CONSUMED_CREDIT_SQL, [appointmentId])).rows[0]?.id ?? null)
      : creditFromDoor;

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
