import type { Hono } from 'hono';
import { canDeliver, draftReportMessage } from '../../../domain/reports';
import { isoDateIn } from '../../../domain/shared';
import {
  whatsAppHandoff,
  type DocumentSender,
  type SendOutcome,
} from '../../../domain/shared/sending';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared/storage';
import { documentSender } from '../_middleware/sending';
import { logAction } from '../_middleware/audit';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { mayDeliverReport } from './access';
import { practiceTimeZone } from './gather';
import { DeliverInput, DeliverResponse } from './schema';
import { readReport } from './source';

/**
 * `POST /api/reports/:id/deliver` — putting a signed report in front of a
 * household (docs/SPEC/reports-v1.md section 7.2).
 *
 * **Two gates that already exist, checked at the moment of sending and never
 * cached**: the client's `participation` consent must be active, and the
 * contact's own `can_receive_reports` must be true — the flag the portal's
 * Family screen already shows in words. WhatsApp needs `whatsapp_opt_in` on
 * top, exactly as the billing hand-off checks it. All three are read fresh in
 * this transaction and handed to `canDeliver`, which is the rule.
 *
 * **A hand-off, not a broadcast.** WhatsApp answers with a `wa.me` link the
 * person opens and presses send in; email goes through the sending seam, whose
 * only implementation today hands the link back for the share sheet. Nothing
 * reaches a vendor and Meta receives nothing from this server.
 *
 * **The message carries the reference and the link and never says what the
 * visit was about.** It sits in a notification on a lock screen somebody else
 * may be looking at.
 *
 * **The contact must belong to this report's own client.** Checked against the
 * row rather than trusted from the body — and refused a second time by the
 * composite key on `report_delivery` (migration 601), which is what makes it a
 * rule rather than a habit.
 *
 * **What the trail carries**: the contact's id and the channel, and never the
 * number and never the address (section 7.2). `logAction` refuses a value that
 * reads as a telephone number before the insert runs.
 */

const CONTACT_SQL =
  'select id, client_id, phone, email, whatsapp_opt_in, can_receive_reports from contact ' +
  'where tenant_id = app.current_tenant_id() and id = $1 and client_id = $2';

const CONSENT_SQL =
  'select c.status::text as status, ' +
  'to_char(expires_at at time zone (select timezone from tenant where id = c.tenant_id), ' +
  "  'YYYY-MM-DD') as expires_on " +
  'from consent c ' +
  'where c.tenant_id = app.current_tenant_id() and c.client_id = $1 ' +
  "  and c.purpose = 'participation' " +
  "order by case when c.status = 'active' then 0 else 1 end, c.version desc limit 1";

const DOCUMENT_SQL =
  'select id, storage_key from document ' + 'where tenant_id = app.current_tenant_id() and id = $1';

const DELIVERY_SQL =
  'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel, ' +
  'sent_by, created_by) values (app.current_tenant_id(), $1, $2, $3, $4::report_delivery_channel, ' +
  'app.current_actor_id(), app.current_actor_id()) returning id';

export function mountReportDeliver(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
  sender: DocumentSender = documentSender(),
): void {
  api.post('/api/reports/:id/deliver', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    const body = DeliverInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const db = c.get('db');
    const actor = c.get('actor');
    if (!mayDeliverReport(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const record = await readReport(db, reportId);
    if (!record) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const contacts = await db.query<{
      id: string;
      phone: string | null;
      email: string | null;
      whatsapp_opt_in: boolean;
      can_receive_reports: boolean;
    }>(CONTACT_SQL, [body.data.contactId, record.client_id]);
    const contact = contacts.rows[0];
    if (!contact) {
      // Another household's contact, or none. Not found, never a refusal that
      // confirms whose it is.
      return c.json({ error: 'not_found', code: 'contact_not_found', requestId }, 404);
    }

    const consents = await db.query<{ status: string; expires_on: string | null }>(CONSENT_SQL, [
      record.client_id,
    ]);
    const consentRow = consents.rows[0];
    const timeZone = await practiceTimeZone(db);
    const today = isoDateIn(now(), timeZone);

    const answer = canDeliver({
      report: { status: record.status },
      consent: consentRow
        ? {
            status: consentRow.status as 'active' | 'withdrawn' | 'expired' | 'superseded',
            expiresOn: consentRow.expires_on,
          }
        : null,
      contact: {
        canReceiveReports: contact.can_receive_reports,
        whatsappOptIn: contact.whatsapp_opt_in,
        phone: contact.phone,
        email: contact.email,
      },
      channel: body.data.channel,
      today,
    });
    if (!answer.ok) {
      // Written before the answer (section 8), with the contact's id and the
      // reason, and never the number.
      await logAction(
        db,
        'report.deliver_refused',
        { type: 'report', id: reportId, clientId: record.client_id },
        { reason: answer.code, contactId: contact.id, channel: body.data.channel },
      );
      return c.json({ error: 'unprocessable', code: answer.code, requestId }, 422);
    }

    if (!record.document_id) {
      return c.json({ error: 'unprocessable', code: 'no_document', requestId }, 422);
    }
    const documents = await db.query<{ id: string; storage_key: string }>(DOCUMENT_SQL, [
      record.document_id,
    ]);
    const document_ = documents.rows[0];
    if (!document_) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // Handing over the means to open a client's document is a read, and it is
    // recorded before the link is signed, every time (docs/SEAMS.md).
    await auditDocumentRead(db, { id: document_.id, clientId: record.client_id });
    const url = await storage.getSignedUrl(document_.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);

    const message = draftReportMessage({
      kind: record.kind,
      reference: record.reference ?? '',
      practiceName: record.practice_legal_name ?? '',
      url,
    });

    let outcome: SendOutcome;
    if (body.data.channel === 'whatsapp') {
      const handoff = contact.phone ? whatsAppHandoff(contact.phone, message) : null;
      if (!handoff) {
        // A number the record holds but E.164 does not recognise. Refused
        // rather than repaired: a repaired telephone number is a report sent
        // to somebody else.
        return c.json({ error: 'unprocessable', code: 'no_usable_number', requestId }, 422);
      }
      outcome = { delivered: false, channel: 'whatsapp', handoffUrl: handoff };
    } else {
      const sent = await sender.sendDocument({ to: contact.email ?? '', message });
      outcome = sent.delivered ? sent : { delivered: false, channel: 'email', handoffUrl: url };
    }

    const delivery = await db.query<{ id: string }>(DELIVERY_SQL, [
      reportId,
      record.client_id,
      contact.id,
      outcome.channel,
    ]);
    if (!delivery.rows[0]) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    await logAction(
      db,
      'send',
      { type: 'report', id: reportId, clientId: record.client_id },
      // The contact's id and the channel. Never the number, never the address.
      { channel: outcome.channel, contactId: contact.id, delivered: String(outcome.delivered) },
    );

    return c.json(
      DeliverResponse.parse({
        channel: outcome.channel,
        delivered: outcome.delivered,
        ...(outcome.delivered ? {} : { handoffUrl: outcome.handoffUrl }),
        message: message.text,
      }),
      201,
    );
  });
}
