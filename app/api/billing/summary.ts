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
 *
 * **The ledger comes through `app.practice_money_ledger` (migration 952), and
 * that is what makes the figure the same whoever asks.** Read as the caller,
 * `payment` and `entitlement` pass through the erasure gate
 * (db/policies/billing/ledger.sql), so a month holding an erased household
 * answered finance a smaller total than the owner, silently. The function
 * reads the ledger whole and names nobody — an amount and a day, no client, no
 * invoice — because what an erasure protects is whose money it was, not what
 * the practice took that month.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const LEDGER_SQL = 'select app.practice_money_ledger() as ledger';

/** What the function answers: amounts and days, and nothing that names anybody. */
type PracticeLedger = {
  payments: { amountFils: number; receivedOn: string }[];
  credits: {
    status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
    allocatedNetFils: number;
    consumedOn: string | null;
  }[];
};

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
    const { rows } = await db.query<{ ledger: PracticeLedger }>(LEDGER_SQL);
    const ledger = rows[0]?.ledger ?? { payments: [], credits: [] };

    const figures = monthlyMoney(
      ledger.payments.map((row) => ({
        amountFils: fils(row.amountFils),
        receivedOn: row.receivedOn,
      })),
      ledger.credits.map((row) => ({
        status: row.status,
        allocatedNetFils: fils(row.allocatedNetFils),
        consumedOn: row.consumedOn,
      })),
      month,
    );

    return c.json(MonthlyMoneyResponse.parse(figures));
  });
}
