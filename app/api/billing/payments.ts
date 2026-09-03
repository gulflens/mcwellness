import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mayRecordPayment } from './access';
import { IdempotencyKey, RecordPaymentInput, RecordPaymentResponse } from './ledger-schema';

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
 * bank transfer reference or a payment link's own id, constrained to that
 * alphabet in the column and in the schema, because a table with no delete
 * that copies its contents into the audit trail is no place for free text.
 *
 * **The same press twice is one payment.** The drawer generates an
 * `Idempotency-Key` when the person presses the button; a retry replays the
 * original answer instead of recording the money a second time into a table
 * that grants neither update nor delete.
 */

const CLIENT_SQL =
  "select id from client where tenant_id = app.current_tenant_id() and id = $1 and status <> 'erased'";

const INVOICE_SQL =
  'select id from invoice where tenant_id = app.current_tenant_id() and id = $1 and client_id = $2';

const INSERT_SQL =
  'insert into payment (tenant_id, client_id, method, amount_fils, received_at, reference, ' +
  'invoice_id, idempotency_key, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, app.current_actor_id()) ' +
  'returning id, received_at';

const REPLAY_SQL =
  'select id, client_id, method, amount_fils, received_at, reference, invoice_id ' +
  'from payment where tenant_id = app.current_tenant_id() and idempotency_key = $1';

/** The practice opened in 2024; a payment before that is a mistyped year. */
const EARLIEST_RECEIVED_AT = Date.UTC(2024, 0, 1);

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

    const header = c.req.header('idempotency-key');
    let idempotencyKey: string | null = null;
    if (header !== undefined) {
      const parsed = IdempotencyKey.safeParse(header);
      if (!parsed.success) {
        return c.json({ error: 'bad_request', code: 'invalid_idempotency_key', requestId }, 400);
      }
      idempotencyKey = parsed.data;
    }
    const db = c.get('db');

    if (idempotencyKey !== null) {
      const seen = await db.query<{
        id: string;
        client_id: string;
        method: 'cash' | 'transfer' | 'link';
        amount_fils: number;
        received_at: string;
        reference: string | null;
        invoice_id: string | null;
      }>(REPLAY_SQL, [idempotencyKey]);
      const already = seen.rows[0];
      if (already) {
        return c.json(
          RecordPaymentResponse.parse({
            payment: {
              id: already.id,
              clientId: already.client_id,
              method: already.method,
              amountFils: already.amount_fils,
              receivedAt: new Date(already.received_at).toISOString(),
              reference: already.reference,
              invoiceId: already.invoice_id,
            },
          }),
          201,
        );
      }
    }

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
    const receivedMs = new Date(receivedAt).getTime();
    if (receivedMs > now().getTime()) {
      // Money cannot have arrived tomorrow. Recording a payment taken
      // yesterday, at the door, is ordinary and stays allowed.
      return c.json({ error: 'bad_request', code: 'received_in_future', requestId }, 400);
    }
    if (receivedMs < EARLIEST_RECEIVED_AT) {
      // Nor before the practice existed. A date bounded on one side only
      // accepts 1970 as readily as it rejects tomorrow.
      return c.json({ error: 'bad_request', code: 'received_too_old', requestId }, 400);
    }

    const inserted = await db.query<{ id: string; received_at: string }>(INSERT_SQL, [
      input.clientId,
      input.method,
      input.amountFils,
      receivedAt,
      input.reference ?? null,
      input.invoiceId ?? null,
      idempotencyKey,
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
