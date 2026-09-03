import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mayRecordPayment } from './access';
import { RecordPaymentInput, RecordPaymentResponse } from './ledger-schema';

/**
 * `POST /api/billing/payments` — money arrived.
 *
 * Append-only, by construction: `payment` grants no update and no delete
 * (402_billing_document.sql), so a payment recorded in error is corrected by
 * a credit note, not by editing what the practice said it received. Credit
 * notes are the next pull request's.
 *
 * A payment may name the invoice it settles, or none at all — a family paying
 * something off account is ordinary in a home-visit practice. Naming one is
 * checked against the client's own invoices by the composite foreign key, so
 * a payment can never be filed against another household's bill.
 *
 * Nothing here holds a card number, and nothing ever will: `reference` is a
 * transfer reference, a link's own id, or the note a practitioner wrote at
 * the door.
 */

const CLIENT_SQL =
  "select id from client where tenant_id = app.current_tenant_id() and id = $1 and status <> 'erased'";

const INVOICE_SQL =
  'select id from invoice where tenant_id = app.current_tenant_id() and id = $1 and client_id = $2';

const INSERT_SQL =
  'insert into payment (tenant_id, client_id, method, amount_fils, received_at, reference, ' +
  'invoice_id, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id()) ' +
  'returning id, received_at';

export function mountPayments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/payments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayRecordPayment(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = RecordPaymentInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const db = c.get('db');

    const client = await db.query<{ id: string }>(CLIENT_SQL, [input.clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    if (input.invoiceId) {
      const invoice = await db.query<{ id: string }>(INVOICE_SQL, [
        input.invoiceId,
        input.clientId,
      ]);
      if (!invoice.rows[0]) {
        return c.json({ error: 'not_found', code: 'invoice_not_found', requestId }, 404);
      }
    }

    const receivedAt = input.receivedAt ?? now().toISOString();
    if (new Date(receivedAt).getTime() > now().getTime()) {
      // Money cannot have arrived tomorrow. Recording a payment taken
      // yesterday, at the door, is ordinary and stays allowed.
      return c.json({ error: 'bad_request', code: 'received_in_future', requestId }, 400);
    }

    const inserted = await db.query<{ id: string; received_at: string }>(INSERT_SQL, [
      input.clientId,
      input.method,
      input.amountFils,
      receivedAt,
      input.reference ?? null,
      input.invoiceId ?? null,
    ]);
    const row = inserted.rows[0];
    if (!row) {
      throw new Error('Insert of a payment did not return an id.');
    }

    return c.json(
      RecordPaymentResponse.parse({
        payment: {
          id: row.id,
          clientId: input.clientId,
          method: input.method,
          amountFils: input.amountFils,
          receivedAt: new Date(row.received_at).toISOString(),
          reference: input.reference ?? null,
          invoiceId: input.invoiceId ?? null,
        },
      }),
      201,
    );
  });
}
