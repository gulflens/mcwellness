import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';
import { canWriteClientRecord } from './access';
import { rejectedFields } from './bad-request';
import { captureEmiratesId, emiratesIdInUse } from './emirates-id-capture';
import { CreateContactBody, IdResponse, UpdateContactBody } from './record-schema';
import { logRefused } from './refused';

/**
 * A client's contacts (docs/SPEC/client-record.md sections 2 and 4.2).
 * Capturing an Emirates ID here (create or edit) seals and hashes it the
 * same way db/seed/apply.ts does (app/api/clients/emirates-id-capture.ts,
 * built the third pull request alongside the search it exists for); it is
 * never stored, logged or audited in the clear.
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
    if (!body.success) {
      return c.json({ error: 'bad_request', fields: rejectedFields(body.error), requestId }, 400);
    }

    // app.client_status_for bypasses row level security, so it tells "no such client"
    // (404, never logged) apart from "a row this role cannot write, or cannot even read"
    // (403, logged) — a plain select gated by readers.sql would collapse the second case
    // into a false not_found for a role with no read access here either (client-record.md
    // section 9, third review round issue 13).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const contactId = randomUUID();
    const emiratesIdInput = body.data.emiratesId;
    const capture =
      emiratesIdInput !== undefined
        ? captureEmiratesId(emiratesIdInput, contactId, c.get('identityKeys'))
        : null;
    if (capture && !capture.ok) {
      return capture.code === 'emirates_id_unavailable'
        ? c.json({ error: 'emirates_id_unavailable', requestId }, 503)
        : c.json({ error: 'bad_request', code: capture.code, requestId }, 400);
    }
    if (capture && capture.ok && (await emiratesIdInUse(db, capture.hash))) {
      return c.json({ error: 'conflict', code: 'emirates_id_in_use', requestId }, 409);
    }

    await db.query(
      'insert into contact (id, tenant_id, client_id, given_name, family_name, ' +
        'given_name_ar, family_name_ar, relationship, is_legal_guardian, ' +
        'can_consent, can_receive_reports, can_pay, phone, email, whatsapp_opt_in, ' +
        'emirates_id_encrypted, emirates_id_hash) ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
      [
        contactId,
        actor.tenantId,
        clientId,
        // Optional, never required: a lead is one name and one phone
        // (docs/SPEC/client-record.md section 3), and the name belongs to the
        // contact, not to whether the record can be saved.
        body.data.givenName ? cleanText(body.data.givenName, 100) : null,
        body.data.familyName ? cleanText(body.data.familyName, 100) : null,
        body.data.givenNameAr ? cleanText(body.data.givenNameAr, 100) : null,
        body.data.familyNameAr ? cleanText(body.data.familyNameAr, 100) : null,
        body.data.relationship,
        body.data.isLegalGuardian,
        body.data.canConsent,
        body.data.canReceiveReports,
        body.data.canPay,
        body.data.phone ?? null,
        body.data.email ?? null,
        body.data.whatsappOptIn,
        capture && capture.ok ? capture.sealed : null,
        capture && capture.ok ? capture.hash : null,
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
    if (!body.success) {
      return c.json({ error: 'bad_request', fields: rejectedFields(body.error), requestId }, 400);
    }

    // Client existence first (bypassing row level security, for the reason the POST route
    // above does), then role, then the contact itself: only once the actor is confirmed to
    // hold a write role here is a plain select safe to use for the sub-resource, since
    // every role that passes canWriteClientRecord can also read a live client's contacts
    // (db/policies/client/readers.sql).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string }>(
      'select id from contact where id = $1 and client_id = $2',
      [contactId, clientId],
    );
    if (existing.rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const d = body.data;
    if (d.givenName !== undefined)
      push('given_name', d.givenName ? cleanText(d.givenName, 100) : null);
    if (d.familyName !== undefined)
      push('family_name', d.familyName ? cleanText(d.familyName, 100) : null);
    if (d.givenNameAr !== undefined)
      push('given_name_ar', d.givenNameAr ? cleanText(d.givenNameAr, 100) : null);
    if (d.familyNameAr !== undefined)
      push('family_name_ar', d.familyNameAr ? cleanText(d.familyNameAr, 100) : null);
    if (d.relationship !== undefined) push('relationship', d.relationship);
    if (d.isLegalGuardian !== undefined) push('is_legal_guardian', d.isLegalGuardian);
    if (d.canConsent !== undefined) push('can_consent', d.canConsent);
    if (d.canReceiveReports !== undefined) push('can_receive_reports', d.canReceiveReports);
    if (d.canPay !== undefined) push('can_pay', d.canPay);
    if (d.phone !== undefined) push('phone', d.phone);
    if (d.email !== undefined) push('email', d.email);
    if (d.whatsappOptIn !== undefined) push('whatsapp_opt_in', d.whatsappOptIn);
    if (d.emiratesId !== undefined) {
      if (d.emiratesId === null) {
        // Clears both columns together: the check constraint requires them null as a pair.
        push('emirates_id_encrypted', null);
        push('emirates_id_hash', null);
      } else {
        const capture = captureEmiratesId(d.emiratesId, contactId, c.get('identityKeys'));
        if (!capture.ok) {
          return capture.code === 'emirates_id_unavailable'
            ? c.json({ error: 'emirates_id_unavailable', requestId }, 503)
            : c.json({ error: 'bad_request', code: capture.code, requestId }, 400);
        }
        // Every contact but this one: retyping the number already on this row is a
        // no-op, not a clash with itself.
        if (await emiratesIdInUse(db, capture.hash, contactId)) {
          return c.json({ error: 'conflict', code: 'emirates_id_in_use', requestId }, 409);
        }
        push('emirates_id_encrypted', capture.sealed);
        push('emirates_id_hash', capture.hash);
      }
    }
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(contactId);
    await db.query(`update contact set ${sets.join(', ')} where id = $${values.length}`, values);
    return c.json(IdResponse.parse({ id: contactId }));
  });
}
