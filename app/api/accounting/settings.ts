import type { Hono } from 'hono';
import { lockMove, mayChangeYearEnd, mayLockThrough } from '../../../domain/accounting';
import { isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayChangeBooksSettings, mayReadBooks } from './access';
import { requiredReason } from './reason';
import { readSetting } from './rows';
import { LockInput, LockResponse, PatchSettingsInput, SettingsResponse } from './schema';

/**
 * `GET /api/accounting/settings` — the books' own settings and how many
 * entries the journal holds (docs/SPEC/accounting.md section 5.5). The count
 * is what the Settings screen reads to know whether the year end may still
 * change (rule 10) and what the entry drawer reads to know whether an opening
 * entry is still possible.
 */
export function mountSettings(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/settings', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const setting = await readSetting(c.get('db'));
    return c.json(SettingsResponse.parse(setting));
  });
}

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const PATCH_SQL =
  'update accounting_setting set ' +
  'books_start_on = coalesce($1, books_start_on), ' +
  'year_end_month = coalesce($2, year_end_month), ' +
  'year_end_day = coalesce($3, year_end_day), ' +
  'corporate_tax_rate_basis_points = coalesce($4, corporate_tax_rate_basis_points), ' +
  'corporate_tax_threshold_fils = coalesce($5, corporate_tax_threshold_fils), ' +
  'small_business_relief_elected = coalesce($6, small_business_relief_elected), ' +
  'small_business_relief_threshold_fils = coalesce($7, small_business_relief_threshold_fils) ' +
  'where tenant_id = app.current_tenant_id()';

const LOCK_SQL =
  'update accounting_setting set locked_through = $1 where tenant_id = app.current_tenant_id()';

/**
 * The books' settings and the lock date, both the owner's alone
 * (docs/SPEC/accounting.md section 5.5, rules 10 and 14). Finance keeps the
 * books; deciding what a financial year is, and which days are shut, is not
 * the same act.
 */
export function mountSettingsWrites(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.patch('/api/accounting/settings', async (c) => {
    const requestId = c.get('requestId');
    if (!mayChangeBooksSettings(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (requiredReason(c) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = PatchSettingsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const db = c.get('db');
    const current = await readSetting(db);
    const movesTheYearEnd =
      input.yearEndMonth !== undefined ||
      input.yearEndDay !== undefined ||
      input.booksStartOn !== undefined;
    if (movesTheYearEnd && !mayChangeYearEnd(current.entryCount)) {
      return c.json({ error: 'conflict', code: 'journal_not_empty', requestId }, 409);
    }
    await db.query(PATCH_SQL, [
      input.booksStartOn ?? null,
      input.yearEndMonth ?? null,
      input.yearEndDay ?? null,
      input.corporateTaxRateBasisPoints ?? null,
      input.corporateTaxThresholdFils ?? null,
      input.smallBusinessReliefElected ?? null,
      input.smallBusinessReliefThresholdFils ?? null,
    ]);
    return c.json(SettingsResponse.parse(await readSetting(db)));
  });

  api.post('/api/accounting/lock', async (c) => {
    const requestId = c.get('requestId');
    if (!mayChangeBooksSettings(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (requiredReason(c) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = LockInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const current = await readSetting(db);
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    if (!mayLockThrough(body.data.lockedThrough, today)) {
      return c.json({ error: 'bad_request', code: 'lock_in_future', requestId }, 400);
    }
    // Which way it moved, so the audit sentence can say which: moving the lock
    // back is allowed to the owner and is not the same act as moving it on.
    const move = lockMove(current.lockedThrough, body.data.lockedThrough);
    await db.query(LOCK_SQL, [body.data.lockedThrough]);
    return c.json(LockResponse.parse({ lockedThrough: body.data.lockedThrough, move }));
  });
}
