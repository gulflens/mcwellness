import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { logReads } from '../_middleware/audit';
import { mayReadInvoices } from './access';
import { SendOptionsResponse } from './document-schema';
import { isUuid } from './ids';

/**
 * `GET /api/billing/clients/:clientId/send-options` — who a document may be
 * sent to.
 *
 * **No telephone number and no email address leaves this route.** It answers
 * whether a contact has one and whether they said yes to WhatsApp, which is all
 * a screen needs to offer a choice, and the send route reads the address itself
 * from the row. A screen that never holds an address cannot leak one into a
 * log, a URL or a stray copy-paste, and the person choosing does not need to see
 * it to choose.
 *
 * Reading who a family's contacts are is a read of their record, so it is one
 * `list` row apiece in the trail.
 */

const SQL =
  'select id, given_name, family_name, relationship, ' +
  '(phone is not null) as has_phone, (email is not null) as has_email, whatsapp_opt_in ' +
  'from contact where tenant_id = app.current_tenant_id() and client_id = $1 ' +
  'order by is_legal_guardian desc, created_at, id';

type ContactDbRow = {
  id: string;
  given_name: string | null;
  family_name: string | null;
  relationship: string;
  has_phone: boolean;
  has_email: boolean;
  whatsapp_opt_in: boolean;
};

export function mountSendOptions(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/clients/:clientId/send-options', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const clientId = c.req.param('clientId');
    if (!isUuid(clientId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }

    const db = c.get('db');
    const { rows } = await db.query<ContactDbRow>(SQL, [clientId]);

    await logReads(
      db,
      'contact',
      rows.map((row) => ({ id: row.id, clientId })),
      'list',
    );

    return c.json(
      SendOptionsResponse.parse({
        contacts: rows.map((row) => ({
          id: row.id,
          // A contact known only by their relationship predates the name
          // columns (101_contact_name.sql) and nothing invents one.
          name: [row.given_name, row.family_name].filter(Boolean).join(' ') || null,
          relationship: row.relationship,
          hasPhone: row.has_phone,
          hasEmail: row.has_email,
          whatsappOptIn: row.whatsapp_opt_in,
        })),
      }),
    );
  });
}
