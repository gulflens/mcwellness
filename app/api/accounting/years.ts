import type { Hono } from 'hono';
import { z } from 'zod';
import { isWithin, mayCloseYear } from '../../../domain/accounting';
import { isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayCloseYear as actorMayCloseYear, mayReadBooks } from './access';
import { postPendingEvents } from './poster';
import { requiredReason } from './reason';
import { readYears } from './rows';
import { YearResponse, YearsResponse } from './schema';

/**
 * `GET /api/accounting/years` — the practice's financial years, oldest first,
 * with why each was closed or reopened (docs/SPEC/accounting.md section 4.4).
 * A year exists because something was posted into it, so an empty answer says
 * only that the journal is empty.
 */
export function mountYears(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/years', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const years = await readYears(c.get('db'));
    return c.json(YearsResponse.parse({ years }));
  });
}

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const UNPOSTED_SQL = 'select occurred_on::text as occurred_on from app.unposted_money_events()';

const CLOSE_SQL =
  "update fiscal_year set status = 'closed', closed_at = now(), closed_by = app.current_actor_id(), " +
  'close_reason = $2 where tenant_id = app.current_tenant_id() and id = $1';

const REOPEN_SQL =
  "update fiscal_year set status = 'open', reopened_at = now(), reopened_by = app.current_actor_id(), " +
  'reopen_reason = $2 where tenant_id = app.current_tenant_id() and id = $1';

/**
 * Closing a year and reopening one, the owner's alone (docs/SPEC/accounting.md
 * section 4.4, rule 11). Closing runs the poster first and then asks whether
 * anything dated inside the year is still outstanding: a year closed over an
 * unposted payment would be a year that is closed and wrong.
 */
export function mountYearWrites(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/accounting/years/:id/close', async (c) => {
    const requestId = c.get('requestId');
    if (!actorMayCloseYear(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const reason = requiredReason(c);
    if (reason === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const db = c.get('db');
    const year = (await readYears(db)).find((row) => row.id === id.data);
    if (!year) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // The poster first, then the question: what is left unposted inside the
    // year after everything that could be posted has been.
    await postPendingEvents(db);
    const pending = await db.query<{ occurred_on: string }>(UNPOSTED_SQL);
    const unpostedInYear = pending.rows.filter((row) =>
      isWithin(row.occurred_on, year.startsOn, year.endsOn),
    ).length;
    if (!mayCloseYear(year, isoDateIn(now(), PRACTICE_TIME_ZONE), unpostedInYear)) {
      return c.json({ error: 'conflict', code: 'year_not_closable', requestId }, 409);
    }
    await db.query(CLOSE_SQL, [year.id, reason]);
    const closed = (await readYears(db)).find((row) => row.id === year.id);
    return c.json(YearResponse.parse({ year: closed }));
  });

  api.post('/api/accounting/years/:id/reopen', async (c) => {
    const requestId = c.get('requestId');
    if (!actorMayCloseYear(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const reason = requiredReason(c);
    if (reason === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const db = c.get('db');
    const year = (await readYears(db)).find((row) => row.id === id.data);
    if (!year) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (year.status !== 'closed') {
      return c.json({ error: 'conflict', code: 'year_not_closed', requestId }, 409);
    }
    await db.query(REOPEN_SQL, [year.id, reason]);
    const reopened = (await readYears(db)).find((row) => row.id === year.id);
    return c.json(YearResponse.parse({ year: reopened }));
  });
}
