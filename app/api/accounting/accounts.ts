import type { Hono } from 'hono';
import { z } from 'zod';
import { accountLedger, balanceOf, codeMatchesType, mayArchive } from '../../../domain/accounting';
import { fils } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks, mayWriteBooks } from './access';
import { requiredReason } from './reason';
import { readAccountTotals, readChart, readPostedLines } from './rows';
import {
  AccountResponse,
  AccountsResponse,
  CreateAccountInput,
  IsoDate,
  LedgerResponse,
  PatchAccountInput,
  type AccountRow,
} from './schema';

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

const INSERT_SQL =
  'insert into account (tenant_id, code, name, name_ar, type, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, app.current_actor_id()) returning id';

const RENAME_SQL =
  'update account set name = coalesce($2, name), name_ar = case when $3 then $4 else name_ar end ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

const ARCHIVE_SQL =
  'update account set archived_at = now(), archive_reason = $2 ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

/** Postgres: unique_violation. Here, always the practice's own code. */
function isDuplicateCode(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

/**
 * Adding an account, renaming one and archiving one (docs/SPEC/accounting.md
 * section 5.3, rules 7 and 8). Nothing deletes an account, ever: the chart is
 * a history of what the practice has counted, and a code that once carried a
 * line keeps carrying it.
 */
export function mountAccountWrites(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/accounting/accounts', async (c) => {
    const requestId = c.get('requestId');
    if (!mayWriteBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (requiredReason(c) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = CreateAccountInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    if (!codeMatchesType(input.code, input.type)) {
      return c.json({ error: 'bad_request', code: 'code_type_mismatch', requestId }, 400);
    }
    const db = c.get('db');
    // The unique index is the answer, not a read beforehand: two people adding
    // the same code at once would both find it free.
    await db.query('savepoint account_attempt');
    let id: string;
    try {
      const created = await db.query<{ id: string }>(INSERT_SQL, [
        input.code,
        input.name,
        input.nameAr,
        input.type,
      ]);
      id = created.rows[0]?.id ?? '';
    } catch (error) {
      if (!isDuplicateCode(error)) {
        throw error;
      }
      await db.query('rollback to savepoint account_attempt');
      return c.json({ error: 'conflict', code: 'duplicate_code', requestId }, 409);
    }
    const accounts = await chartWithBalances(db);
    const account = accounts.find((row) => row.id === id);
    if (!account) {
      throw new Error('The account was written and could not be read back.');
    }
    return c.json(AccountResponse.parse({ account }), 201);
  });

  api.patch('/api/accounting/accounts/:id', async (c) => {
    const requestId = c.get('requestId');
    if (!mayWriteBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const reason = requiredReason(c);
    if (reason === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = PatchAccountInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const db = c.get('db');
    const before = await chartWithBalances(db);
    const account = before.find((row) => row.id === c.req.param('id'));
    if (!account) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (input.name !== undefined || input.nameAr !== undefined) {
      await db.query(RENAME_SQL, [
        account.id,
        input.name ?? null,
        input.nameAr !== undefined,
        input.nameAr ?? null,
      ]);
    }
    if (input.archive === true) {
      if (!mayArchive(account, fils(account.balanceFils))) {
        return c.json({ error: 'conflict', code: 'cannot_archive', requestId }, 409);
      }
      await db.query(ARCHIVE_SQL, [account.id, reason]);
    }
    const after = await chartWithBalances(db);
    const updated = after.find((row) => row.id === account.id);
    if (!updated) {
      throw new Error('The account could not be read back.');
    }
    return c.json(AccountResponse.parse({ account: updated }));
  });
}
