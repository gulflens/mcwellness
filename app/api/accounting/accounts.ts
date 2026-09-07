import type { Hono } from 'hono';
import { z } from 'zod';
import { accountLedger, balanceOf } from '../../../domain/accounting';
import { fils } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { readAccountTotals, readChart, readPostedLines } from './rows';
import { AccountsResponse, IsoDate, LedgerResponse, type AccountRow } from './schema';

/**
 * The chart, and one account's ledger (docs/SPEC/accounting.md sections 5.3
 * and 4.5). A balance is the account's own direction over every line ever
 * posted, computed by `balanceOf`; no route does arithmetic on money that a
 * domain function does not name.
 */

/** The chart with each account's balance to date, in the order an accountant reads it. */
export async function chartWithBalances(
  db: Parameters<typeof readChart>[0],
): Promise<AccountRow[]> {
  const [chart, totals] = await Promise.all([readChart(db), readAccountTotals(db)]);
  return chart.map((account) => {
    const seen = totals.get(account.id) ?? { debitFils: 0, creditFils: 0 };
    return {
      ...account,
      balanceFils: balanceOf(account.type, fils(seen.debitFils), fils(seen.creditFils)),
    };
  });
}

export function mountAccounts(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/accounts', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const accounts = await chartWithBalances(c.get('db'));
    return c.json(AccountsResponse.parse({ accounts }));
  });

  api.get('/api/accounting/accounts/:id/ledger', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const range = z.object({ from: IsoDate, to: IsoDate }).safeParse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    if (!range.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const accounts = await chartWithBalances(db);
    const account = accounts.find((row) => row.id === c.req.param('id'));
    if (!account) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const lines = await readPostedLines(db);
    const ledger = accountLedger(lines, account.code, range.data.from, range.data.to);
    return c.json(
      LedgerResponse.parse({
        account,
        from: range.data.from,
        to: range.data.to,
        openingBalanceFils: ledger.openingBalanceFils,
        rows: ledger.rows,
        closingBalanceFils: ledger.closingBalanceFils,
      }),
    );
  });
}
