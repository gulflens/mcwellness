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

    // app.client_status_for bypasses row level security: see app/api/clients/contacts.ts
    // for why this must come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    // text_document_id must name the practice's own wording for this purpose — a document
    // with client_id null (00-data-model.md section 3) — never a document filed against a
    // client, signed consent included: this is the exact wording shown, not a copy of what
    // someone else once signed (issue 16).
    const textDocument = await db.query<{ id: string }>(
      'select id from document where id = $1 and client_id is null',
      [body.data.textDocumentId],
    );
    if (textDocument.rowCount === 0) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const contact = await db.query<{ id: string }>(
      'select id from contact where id = $1 and client_id = $2',
      [body.data.givenByContactId, clientId],
    );
    if (contact.rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
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

    // Client existence (bypassing row level security) before role, then the reason
    // prompt, then the consent itself — the same ordering as the record route above
    // (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Withdrawal is a sensitive action and always needs a reason (section 9).
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string; status: string }>(
      'select id, status from consent where id = $1 and client_id = $2',
      [consentId, clientId],
    );
    const row = existing.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
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
