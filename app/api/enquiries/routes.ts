import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import { leadFromEnquiry, type LodgedEnquiry } from '@domain/enquiry';
import { logAction, logReads, refuseContactDetails } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { createLead } from '../clients/create-lead';
import { ConvertResponse, DismissBody, EnquiryListResponse, type Enquiry } from './schema';

/**
 * What a person does with an enquiry (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 * Behind the fence, so every route here has an actor; the rows themselves are
 * fenced again by row security to the same three roles.
 *
 * Reading the list is a read of personal data by a person and is logged as
 * one — for the rows that still carry any. Converting creates the lead
 * through the same function POST /api/clients uses, under this actor, so the
 * client is audited from its first byte; then the enquiry is scrubbed, which
 * the table's own constraint insists on. Dismissing scrubs the same way.
 */

type Row = {
  id: string;
  received_at: Date;
  source: 'website' | 'discovery_call';
  status: 'new' | 'converted' | 'dismissed';
  name: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  area: string | null;
  message: string | null;
  concern: string | null;
  preferred_time: string | null;
  contact_method: string | null;
  consent: boolean | null;
  actioned_at: Date | null;
  actioned_by_name: string | null;
  client_id: string | null;
  dismiss_reason: string | null;
};

const COLUMNS =
  'e.id, e.received_at, e.source, e.status, e.name, e.whatsapp_e164, e.email, e.area, ' +
  'e.message, e.concern, e.preferred_time, e.contact_method, e.consent, e.actioned_at, ' +
  'u.display_name as actioned_by_name, e.client_id, e.dismiss_reason';

const SCRUB =
  'name = null, whatsapp_e164 = null, email = null, area = null, message = null, ' +
  'concern = null, preferred_time = null, contact_method = null, consent = null, ip_hash = null';

function toWire(row: Row): Enquiry {
  return {
    id: row.id,
    receivedAt: row.received_at.toISOString(),
    source: row.source,
    status: row.status,
    name: row.name,
    whatsappE164: row.whatsapp_e164,
    email: row.email,
    area: row.area,
    message: row.message,
    concern: row.concern,
    preferredTime: row.preferred_time,
    contactMethod: row.contact_method,
    consent: row.consent,
    actionedAt: row.actioned_at ? row.actioned_at.toISOString() : null,
    actionedByName: row.actioned_by_name,
    clientId: row.client_id,
    dismissReason: row.dismiss_reason,
  };
}

export function mountEnquiries(api: Hono<ApiEnv>, now: () => Date): void {
  api.get('/api/enquiries', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // New first, then the rest newest first. Two hundred is more than a
    // practice this size will ever hold unactioned.
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from enquiry e left join app_user u on u.id = e.actioned_by ` +
        "order by (e.status = 'new') desc, e.received_at desc limit 200",
    );
    await logReads(
      db,
      'enquiry',
      rows.filter((row) => row.status === 'new').map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    return c.json(EnquiryListResponse.parse({ enquiries: rows.map(toWire) }));
  });

  api.post('/api/enquiries/:id/convert', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.action' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const idParam = z.uuid().safeParse(c.req.param('id'));
    if (!idParam.success) return c.json({ error: 'not_found', requestId }, 404);
    const id = idParam.data;
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from enquiry e left join app_user u on u.id = e.actioned_by ` +
        "where e.id = $1 and e.status = 'new' for update of e",
      [id],
    );
    const row = rows[0];
    if (!row || !row.name || !row.whatsapp_e164) {
      // Not there, not this practice's, or already actioned: one answer.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const enquiry: LodgedEnquiry = {
      name: row.name,
      whatsappE164: row.whatsapp_e164,
      email: row.email,
      area: row.area,
      message: row.message,
      concern: row.concern,
      preferredTime: row.preferred_time,
      contactMethod: row.contact_method,
      consent: row.consent,
      source: row.source,
    };
    // The one read of a row's personal fields outside the list, logged as one.
    await logReads(db, 'enquiry', [{ id, clientId: null }], 'read');
    const lead = leadFromEnquiry(enquiry);
    const { clientId, mrn } = await createLead(db, actor.tenantId, lead);
    const updated = await db.query(
      `update enquiry set status = 'converted', client_id = $2, actioned_at = now(), actioned_by = $3, ${SCRUB} ` +
        "where id = $1 and status = 'new'",
      [id, clientId, actor.userId],
    );
    if (updated.rowCount !== 1) {
      throw new Error('The enquiry could not be marked converted after its lead was created.');
    }
    // What happened to the enquiry, in the chain, under the person who did it.
    await logAction(db, 'convert', { type: 'enquiry', id, clientId }, { source: row.source });
    return c.json(ConvertResponse.parse({ clientId, mrn }), 201);
  });

  api.post('/api/enquiries/:id/dismiss', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.action' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = DismissBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'bad_request', field: 'reason', requestId }, 400);
    }
    try {
      // A number or an address in the reason would put a person back on a
      // row that, by its own constraint, keeps nothing personal.
      refuseContactDetails({ reason: body.data.reason });
    } catch {
      return c.json({ error: 'bad_request', field: 'reason', requestId }, 400);
    }
    const idParam = z.uuid().safeParse(c.req.param('id'));
    if (!idParam.success) return c.json({ error: 'not_found', requestId }, 404);
    const id = idParam.data;
    const updated = await db.query<{ source: string }>(
      `update enquiry set status = 'dismissed', dismiss_reason = $2, actioned_at = now(), actioned_by = $3, ${SCRUB} ` +
        "where id = $1 and status = 'new' returning source",
      [id, body.data.reason, actor.userId],
    );
    if (updated.rowCount !== 1) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logAction(
      db,
      'dismiss',
      { type: 'enquiry', id, clientId: null },
      { source: updated.rows[0]?.source ?? '' },
    );
    return c.json({ ok: true });
  });
}
