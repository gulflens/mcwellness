import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';
import { canWriteHealthScreening } from './access';
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
 */

const ClientParams = z.object({ id: z.uuid() });

/** A note is a sentence about what was said, or nothing at all. */
function note(value: string | undefined): string | null {
  if (value === undefined) return null;
  // 500, the ceiling health_screening's own check constraint carries.
  const cleaned = cleanText(value, 500);
  return cleaned.length === 0 ? null : cleaned;
}

export function mountHealthScreening(api: Hono<ApiEnv>): void {
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
    if (!canWriteHealthScreening(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') return c.json({ error: 'erased', requestId }, 400);

    const answers = body.data;
    const screeningId = randomUUID();
    await db.query(
      'insert into health_screening (id, tenant_id, client_id, wording_version, ' +
        'seizures, seizures_note, implanted_device, implanted_device_note, ' +
        'head_injury, head_injury_note, pregnancy, pregnancy_note, ' +
        'medication, medication_note, scalp, scalp_note, created_by) ' +
        'values ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ' +
        '$12, $13, $14, $15, app.current_actor_id())',
      [
        screeningId,
        clientId,
        answers.wordingVersion ?? null,
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
    return c.json(IdResponse.parse({ id: screeningId }), 201);
  });
}
