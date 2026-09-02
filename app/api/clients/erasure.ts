import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { hasRole } from '../../../domain/shared';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { ErasureRequestBody, IdResponse } from './record-schema';
import { logRefused } from './refused';

/**
 * "Record erasure request" (docs/SPEC/client-record.md section 8). Owner,
 * admin or the lead practitioner may ask for one; app.erase_client
 * (db/migrations/100_client_record.sql) does the work as the table owner, in
 * one transaction, and this route only opens the request and hands it the id.
 */

const ClientParams = z.object({ id: z.uuid() });

export function mountErasureRequests(api: Hono<ApiEnv>): void {
  api.post('/api/clients/:id/erasure-requests', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = ErasureRequestBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const client = await db.query<{ id: string; status: string }>(
      'select id, status from client where id = $1',
      [clientId],
    );
    const row = client.rows[0];
    if (!row) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (row.status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const erasureId = randomUUID();
    await db.query(
      'insert into erasure_request (id, tenant_id, client_id, requested_by_contact_id, reason) ' +
        'values ($1, $2, $3, $4, $5)',
      [
        erasureId,
        actor.tenantId,
        clientId,
        body.data.requestedByContactId ?? null,
        cleanText(body.data.reason, 1000),
      ],
    );
    await db.query('select app.erase_client($1, $2)', [clientId, erasureId]);
    return c.json(IdResponse.parse({ id: erasureId }), 201);
  });
}
