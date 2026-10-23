import type { Hono } from 'hono';
import { scrubReason } from '../_middleware/request-context';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayReversePayment } from './access';
import { isUuid } from './ids';
import { ReversalRefusal, ReversePaymentInput, ReversePaymentResponse } from './ledger-schema';

/**
 * `POST /api/billing/payments/:id/reversal` — cancel a payment that was
 * recorded in error (docs/superpowers/specs/2026-10-23-payment-reversal-design.md).
 *
 * A payment is append-only, so it is never edited: a second record, the
 * reversal, cancels it in full. The route is `app.reverse_payment`'s door and
 * nothing more — the rule (`domain/billing/reversal.ts`) lives in the
 * function, which asks it under its own locks. The owner's, an admin's or
 * finance's.
 */

const REVERSE_SQL = 'select app.reverse_payment($1, $2, $3) as id';

const REVERSAL_SQL =
  "select id, to_char(reversed_on, 'YYYY-MM-DD') as reversed_on " +
  'from payment_reversal where tenant_id = app.current_tenant_id() and id = $1';

/** The function's refusal, as it raises it: `reversal_refused:<refusal>`. */
function refusalOf(error: { message?: string }): ReversalRefusal | null {
  const match = /^reversal_refused:(\w+)$/.exec(error.message ?? '');
  const parsed = ReversalRefusal.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

/**
 * One call of the function inside a savepoint. The request is a single
 * transaction and a failed statement aborts all of it; rolling back to the
 * savepoint lets the route answer a refusal (or retry a deadlock) and still
 * finish cleanly.
 */
async function reverseOnce(
  db: Db,
  args: unknown[],
): Promise<{ id: string } | { error: { code?: string; message?: string } }> {
  await db.query('savepoint reverse_payment');
  try {
    const { rows } = await db.query<{ id: string }>(REVERSE_SQL, args);
    await db.query('release savepoint reverse_payment');
    return { id: String(rows[0]?.id) };
  } catch (error) {
    await db.query('rollback to savepoint reverse_payment');
    await db.query('release savepoint reverse_payment');
    return { error: error as { code?: string; message?: string } };
  }
}

export function mountPaymentReversals(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/payments/:id/reversal', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReversePayment(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const paymentId = c.req.param('id');
    if (!isUuid(paymentId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = ReversePaymentInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    // Why it was reversed belongs in the audit trail, not only in the column
    // (docs/SPEC/audit.md section 5).
    await db.query("select set_config('app.reason', $1, true)", [scrubReason(body.data.reason)]);

    const args = [paymentId, body.data.reason, body.data.idempotencyKey];
    let outcome = await reverseOnce(db, args);
    // A deadlock against another writer is retried once; a second is the
    // caller's to try again later.
    if ('error' in outcome && outcome.error.code === '40P01') {
      outcome = await reverseOnce(db, args);
      if ('error' in outcome && outcome.error.code === '40P01') {
        c.header('Retry-After', '2');
        return c.json({ error: 'unavailable', requestId }, 503);
      }
    }

    if ('error' in outcome) {
      const { code } = outcome.error;
      if (code === 'P0001') {
        const refusal = refusalOf(outcome.error);
        if (refusal) {
          return c.json({ error: 'reversal_refused', refusal, requestId }, 409);
        }
      }
      // 22023: a reason too short, a missing key, a key used for another
      // payment. 23505: two parallel calls racing on the same key.
      if (code === '22023' || code === '23505') {
        return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
      }
      if (code === 'P0002') {
        return c.json({ error: 'not_found', requestId }, 404);
      }
      if (code === '42501') {
        return c.json({ error: 'forbidden', requestId }, 403);
      }
      throw outcome.error;
    }

    const found = await db.query<{ id: string; reversed_on: string }>(REVERSAL_SQL, [outcome.id]);
    const row = found.rows[0];
    if (!row) {
      throw new Error('The reversal that was made could not be read back.');
    }
    // 201 for a retry of the same key too: it answers with the reversal the
    // first call wrote.
    return c.json(
      ReversePaymentResponse.parse({ reversal: { id: row.id, reversedOn: row.reversed_on } }),
      201,
    );
  });
}
