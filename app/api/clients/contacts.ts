import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { CreateContactBody, IdResponse, UpdateContactBody } from './record-schema';
import { logRefused } from './refused';

/**
 * A client's contacts (docs/SPEC/client-record.md sections 2 and 4.2). Never
 * carries the Emirates ID: identityKeys now reaches every route through
 * createApi (trunk PR 19), but sealing and hashing one is deliberately kept
 * for the third pull request alongside the search it exists for, rather than
 * adding a capture path here that nothing yet reads.
 */

const ClientParams = z.object({ id: z.uuid() });
const ContactParams = z.object({ id: z.uuid(), contactId: z.uuid() });

export function mountContacts(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/clients/:id/contacts', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = CreateContactBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const client = await db.query<{ id: string }>('select id from client where id = $1', [
      clientId,
    ]);
    if (client.rowCount === 0) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const contactId = randomUUID();
    await db.query(
      'insert into contact (id, tenant_id, client_id, relationship, is_legal_guardian, ' +
        'can_consent, can_receive_reports, can_pay, phone, email, whatsapp_opt_in) ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [
        contactId,
        actor.tenantId,
        clientId,
        body.data.relationship,
        body.data.isLegalGuardian,
        body.data.canConsent,
        body.data.canReceiveReports,
        body.data.canPay,
        body.data.phone ?? null,
        body.data.email ?? null,
        body.data.whatsappOptIn,
      ],
    );
    return c.json(IdResponse.parse({ id: contactId }), 201);
  });

  api.patch('/api/clients/:id/contacts/:contactId', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ContactParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, contactId } = params.data;
    const bodyJson = await c.req.json().catch(() => null);
    const body = UpdateContactBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const existing = await db.query<{ id: string }>(
      'select id from contact where id = $1 and client_id = $2',
      [contactId, clientId],
    );
    if (existing.rowCount === 0) {
      await logRefused(db, 'contact', contactId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const d = body.data;
    if (d.relationship !== undefined) push('relationship', d.relationship);
    if (d.isLegalGuardian !== undefined) push('is_legal_guardian', d.isLegalGuardian);
    if (d.canConsent !== undefined) push('can_consent', d.canConsent);
    if (d.canReceiveReports !== undefined) push('can_receive_reports', d.canReceiveReports);
    if (d.canPay !== undefined) push('can_pay', d.canPay);
    if (d.phone !== undefined) push('phone', d.phone);
    if (d.email !== undefined) push('email', d.email);
    if (d.whatsappOptIn !== undefined) push('whatsapp_opt_in', d.whatsappOptIn);
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(contactId);
    await db.query(`update contact set ${sets.join(', ')} where id = $${values.length}`, values);
    return c.json(IdResponse.parse({ id: contactId }));
  });
}
