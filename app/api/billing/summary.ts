import type { Hono } from 'hono';
import { monthlyMoney } from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadInvoices } from './access';
import { MonthlyMoneyResponse } from './document-schema';

/**
 * `GET /api/billing/summary` — cash collected, revenue recognised, and the
 * deferred balance (docs/SPEC/billing.md section 4.1).
 *
 * Three facts about the practice, not about a client, so nothing here is a read
 * of a person's record and nothing is audited as one: the query names no client
 * and answers three integers.
 *
 * The arithmetic is `domain/billing/recognition.ts` and the filtering is its
 * own. This route hands it the whole ledger rather than a month of it, because
 * the deferred balance is a position at a moment and not a total for a period —
 * asking the database for "this month's credits" would answer a different
 * question and look right.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const PAYMENTS_SQL =
  "select amount_fils, to_char(received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as received_on " +
  'from payment where tenant_id = app.current_tenant_id()';

const CREDITS_SQL =
  'select status, allocated_net_fils, ' +
  "to_char(consumed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as consumed_on " +
  'from entitlement where tenant_id = app.current_tenant_id()';

/** YYYY-MM, and a month that exists. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function mountSummary(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/summary', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const asked = c.req.query('month');
    const month = asked ?? isoDateIn(now(), PRACTICE_TIME_ZONE).slice(0, 7);
    if (!MONTH.test(month)) {
      return c.json({ error: 'bad_request', code: 'invalid_month', requestId }, 400);
    }

    const db = c.get('db');
    const [payments, credits] = await Promise.all([
      db.query<{ amount_fils: number; received_on: string }>(PAYMENTS_SQL),
      db.query<{
        status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
        allocated_net_fils: number;
        consumed_on: string | null;
      }>(CREDITS_SQL),
    ]);

    const figures = monthlyMoney(
      payments.rows.map((row) => ({
        amountFils: fils(row.amount_fils),
        receivedOn: row.received_on,
      })),
      credits.rows.map((row) => ({
        status: row.status,
        allocatedNetFils: fils(row.allocated_net_fils),
        consumedOn: row.consumed_on,
      })),
      month,
    );

    return c.json(MonthlyMoneyResponse.parse(figures));
  });
}
