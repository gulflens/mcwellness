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

    // app.client_status_for bypasses row level security: see app/api/clients/contacts.ts
    // for why this must come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    // requestedByContactId, when given, must be one of this client's own contacts — never
    // someone else's household standing in as the requester (issue 16).
    if (body.data.requestedByContactId) {
      const contact = await db.query<{ id: string }>(
        'select id from contact where id = $1 and client_id = $2',
        [body.data.requestedByContactId, clientId],
      );
      if (contact.rowCount === 0) {
        return c.json({ error: 'bad_request', requestId }, 400);
      }
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
        // erasure_request.reason follows the request's own retention, tighter than the
        // general free-text ceiling elsewhere in this file (db/migrations/100_client_record.sql).
        cleanText(body.data.reason, 200),
      ],
    );
    await db.query('select app.erase_client($1, $2)', [clientId, erasureId]);
    return c.json(IdResponse.parse({ id: erasureId }), 201);
  });
}
