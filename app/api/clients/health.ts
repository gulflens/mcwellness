import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';
import { canWriteHealthDeclaration } from './access';
import { IdResponse, RecordHealthBody } from './record-schema';
import { logRefused } from './refused';

/**
 * The six things the signed agreement asks a household to tell the practice
 * before the first session, and if they change (docs/CONSENT/agreement.en.md).
 *
 * **Insert only, and that is the whole route.** A change is a new row and the
 * newest is the current answer, so there is no PATCH here and the table grants
 * no update at all: what somebody said in March is not edited into what they
 * say in September. The record shows the newest; the older rows are the
 * history, and the audit trail says who recorded each.
 *
 * **Recorded by the office**, which is the operator's decision of 2026-09-14: a
 * practitioner told something at the door tells the office, which keeps one
 * path in rather than two. They read it, on their own clients, as everyone who
 * may open the record does.
 *
 * **Only under an active `health_data` consent**, read at the moment of
 * writing; the route answers 409 `consent_required` otherwise. The order of
 * refusals is the record's usual one — 400, 404, 403, erased, then this.
 */

const ClientParams = z.object({ id: z.uuid() });

/**
 * A note is a sentence about what was said, or nothing at all. 500 is the
 * ceiling health_declaration's own check constraint carries; the wording
 * version, cleaned by the same function, is bounded well below it by its
 * schema (RecordHealthBody).
 */
function note(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = cleanText(value, 500);
  return cleaned.length === 0 ? null : cleaned;
}

export function mountHealthDeclaration(api: Hono<ApiEnv>): void {
  api.post('/api/clients/:id/health', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const body = RecordHealthBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canWriteHealthDeclaration(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') return c.json({ error: 'erased', requestId }, 400);

    // The six are health data, and the consent that covers them names "the
    // health answers you gave us" as what it covers and says withdrawing it
    // means "we stop collecting it" (docs/CONSENT/health-data.en.md, approved
    // 1.1). So the consent is read here, at the moment of writing, never from
    // a flag on the client (.claude/rules/compliance.md): a household that has
    // not yet agreed is not asked, and one that has taken its agreement back
    // is not asked again. Without this, an answer recorded at enrolment sat in
    // the table for five years past a refusal at the next step (the review of
    // pull request 177, finding 1) — which is also why the enrolment screen
    // asks these after the consent step and not before
    // (docs/SPEC/client-record.md section 4.6).
    const consent = await db.query(
      "select 1 from consent where client_id = $1 and purpose = 'health_data' " +
        "and status = 'active' and (expires_at is null or expires_at > now()) limit 1",
      [clientId],
    );
    if (consent.rowCount === 0) {
      return c.json({ error: 'conflict', code: 'consent_required', requestId }, 409);
    }

    const answers = body.data;
    const declarationId = randomUUID();
    await db.query(
      'insert into health_declaration (id, tenant_id, client_id, wording_version, ' +
        'seizures, seizures_note, implanted_device, implanted_device_note, ' +
        'head_injury, head_injury_note, pregnancy, pregnancy_note, ' +
        'medication, medication_note, scalp, scalp_note, created_by) ' +
        'values ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ' +
        '$12, $13, $14, $15, app.current_actor_id())',
      [
        declarationId,
        clientId,
        // Cleaned like any typed text; not checked against consent_wording,
        // because the screen that asked is the one that knows which version
        // it showed, and only the office reaches this route.
        note(answers.wordingVersion),
        answers.seizures,
        note(answers.seizuresNote),
        answers.implantedDevice,
        note(answers.implantedDeviceNote),
        answers.headInjury,
        note(answers.headInjuryNote),
        answers.pregnancy,
        note(answers.pregnancyNote),
        answers.medication,
        note(answers.medicationNote),
        answers.scalp,
        note(answers.scalpNote),
      ],
    );
    return c.json(IdResponse.parse({ id: declarationId }), 201);
  });
}
