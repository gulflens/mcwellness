import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { IdResponse, RecordConsentBody } from './record-schema';
import { logRefused } from './refused';

/**
 * Recording and withdrawing consent (docs/SPEC/client-record.md sections 2
 * and 7). Withdrawal needs a reason and takes effect immediately (section
 * 7); this route does not cancel future appointments (Stage 2, out of scope
 * for this worktree).
 */

const ClientParams = z.object({ id: z.uuid() });
const ConsentParams = z.object({ id: z.uuid(), consentId: z.uuid() });

export function mountConsents(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/clients/:id/consents', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = RecordConsentBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    // Verbal witness is a re-confirmation method only, never how initial
    // participation is recorded (section 7).
    if (body.data.method === 'verbal_witnessed' && body.data.purpose !== 'home_visit') {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const contact = await db.query<{ id: string; client_status: string }>(
      'select ct.id, c.status as client_status from contact ct ' +
        'join client c on c.id = ct.client_id where ct.id = $1 and ct.client_id = $2',
      [body.data.givenByContactId, clientId],
    );
    const contactRow = contact.rows[0];
    if (!contactRow) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (contactRow.client_status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const consentId = randomUUID();
    await db.query(
      'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
        'text_document_id, method, expires_at) values ($1, $2, $3, $4, $5, 1, $6, $7, $8)',
      [
        consentId,
        actor.tenantId,
        clientId,
        body.data.givenByContactId,
        body.data.purpose,
        body.data.textDocumentId,
        body.data.method,
        body.data.expiresAt ?? null,
      ],
    );
    return c.json(IdResponse.parse({ id: consentId }), 201);
  });

  api.post('/api/clients/:id/consents/:consentId/withdraw', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ConsentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, consentId } = params.data;

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Withdrawal is a sensitive action and always needs a reason (section 9).
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const existing = await db.query<{ id: string; status: string; client_status: string }>(
      'select cs.id, cs.status, c.status as client_status from consent cs ' +
        'join client c on c.id = cs.client_id where cs.id = $1 and cs.client_id = $2',
      [consentId, clientId],
    );
    const row = existing.rows[0];
    if (!row) {
      await logRefused(db, 'consent', consentId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (row.client_status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    await db.query("update consent set status = 'withdrawn', withdrawn_at = now() where id = $1", [
      consentId,
    ]);
    return c.json(IdResponse.parse({ id: consentId }));
  });
}
