import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { hasRole } from '@domain/shared';
import { canBeConfirmed } from '@domain/scheduling';
import type { ApiEnv } from '../_middleware/request-context';
import { ConfirmAppointmentResponse, type AppointmentRow, type ConfirmActionCode } from './schema';

/**
 * `POST /api/appointments/:id/confirm` — the household has been told
 * (docs/SPEC/scheduling-manual.md section 3: "`confirmed`: client informed
 * (manual toggle in Phase 1; WhatsApp in Phase 2)").
 *
 * **Why this route exists at all.** Until it did, nothing anywhere moved an
 * appointment upward: `create` writes the column's default, which is
 * `proposed`, and `move` and `cancel` both act only on a row already
 * `proposed` or `confirmed` without promoting either. Meanwhile
 * `app/api/appointments/list.ts`'s own `OWN_STATUS_FILTER` admits nothing
 * below `confirmed` to a practitioner's Today, deliberately — "nobody should
 * be driving to a house that is not expecting them". The two together meant
 * every visit placed through "Add appointment" was invisible for ever to the
 * practitioner meant to drive to it (docs/CHANGE-REQUESTS/qa-01.md item 1).
 * This is the toggle section 3 names, and it is the whole of the fix.
 *
 * **Who may say it.** The three calendar roles, the same ones that place,
 * move and call off a visit (section 2). A practitioner is deliberately not
 * here: telling a household its visit is arranged is the office's act, and
 * the row policy `scheduling_update`
 * (db/policies/scheduling/appointment_access.sql) already admits exactly
 * these three to an update, so this route needs no door of its own beneath
 * it.
 *
 * **No reason header.** Move and cancel each insist on one because each takes
 * something back from a household — a window it was promised, a credit it
 * holds — and section 9 asks for a reason on the acts that cost somebody
 * something. Confirming costs nobody anything: it records a telephone call
 * that has already happened. The trail still carries the whole of it, from
 * appointment's own row trigger (080_audit_triggers.sql) — who, when, and
 * `proposed` to `confirmed` — which is section 9's "create, move, reassign,
 * cancel each logged with before/after" applied to the one act it did not
 * anticipate.
 *
 * **No request body is read.** The act carries no choices, only the visit it
 * is about, so nothing is parsed from the body at all — though the caller
 * still declares it JSON, because the shared `jsonOnly` middleware
 * (app/api/_middleware/security.ts) declines every POST that does not.
 *
 * **One direction only.** `canBeConfirmed` (domain/scheduling/status.ts) is
 * the rule, and it is asked twice: once against the row as read, so the
 * refusal can name what is wrong, and once again inside the update's own
 * `where`, so a visit somebody moved or called off between the two cannot be
 * quietly brought back to life.
 */

const APPOINTMENT_SQL =
  'select id, status from appointment where id = $1 and tenant_id = app.current_tenant_id()';

const CONFIRM_SQL =
  "update appointment set status = 'confirmed' where id = $1 " +
  "and tenant_id = app.current_tenant_id() and status = 'proposed'";

type AppointmentDbRow = { id: string; status: AppointmentRow['status'] };

function badRequest(c: Context<ApiEnv>, requestId: string | null, code: ConfirmActionCode) {
  return c.json({ error: 'bad_request', code, requestId }, 400);
}

export function mountAppointmentConfirm(api: Hono<ApiEnv>): void {
  api.post('/api/appointments/:id/confirm', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // The calendar role, before a single row is read: a refused caller must
    // never cause an appointment to be looked at.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // An id off the path, proved a uuid before it reaches a query: without
    // this, a typed path lands in Postgres as a cast error and comes back a
    // 500 rather than the plain refusal it is.
    const appointmentId = c.req.param('id');
    if (!z.uuid().safeParse(appointmentId).success) {
      return badRequest(c, requestId, 'invalid_request');
    }

    const db = c.get('db');
    const { rows } = await db.query<AppointmentDbRow>(APPOINTMENT_SQL, [appointmentId]);
    const appointment = rows[0];
    // Row security has already hidden another practice's appointment, so
    // "not found" is the same answer for a row that does not exist and one
    // this caller may not see. That is the intended answer to both.
    if (!appointment) {
      return c.json({ error: 'not_found', code: 'appointment_not_found', requestId }, 404);
    }
    if (!canBeConfirmed(appointment.status)) {
      return badRequest(c, requestId, 'appointment_not_proposed');
    }

    const confirmed = await db.query(CONFIRM_SQL, [appointmentId]);
    if (confirmed.rowCount !== 1) {
      // Somebody else settled or confirmed this visit between the read and
      // the write. Not an error to raise: the transaction is sound and the
      // answer is the same one the caller would have had a moment earlier.
      return badRequest(c, requestId, 'appointment_not_proposed');
    }

    // No separate read row: the update carries the whole story into the audit
    // trail through appointment's own row trigger (080_audit_triggers.sql),
    // exactly as the cancel route's does.
    return c.json(ConfirmAppointmentResponse.parse({ id: appointmentId, status: 'confirmed' }));
  });
}
