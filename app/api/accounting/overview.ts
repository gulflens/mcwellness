import type { Hono } from 'hono';
import { z } from 'zod';
import {
  accountByRole,
  balanceOf,
  cashPosition,
  corporateTaxEstimate,
  profitAndLoss,
  reliefWatch,
  yearBoundsContaining,
} from '../../../domain/accounting';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { classifyPending } from './poster';
import { readAccountTotals, readChart, readEntries, readPostedLines, readSetting } from './rows';
import { OverviewResponse } from './schema';

/**
 * The Books overview (docs/SPEC/accounting.md section 5.1): the practice's
 * result and cash position, what it is owed, the corporate-tax set-aside with
 * the relief watch beside it, and how many money events are not yet in the
 * books. The three billing figures the screen shows alongside these come from
 * `/api/billing/summary`, which finance already reads.
 *
 * Every figure is computed by a pure function over the posted lines; the route
 * chooses the days and nothing else.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const RECENT_ENTRIES = 50;

const Query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

export function mountOverview(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/overview', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const query = Query.safeParse({ month: c.req.query('month') });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const asOf = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const month = query.data.month ?? asOf.slice(0, 7);
    const [lines, setting, chart, totals] = await Promise.all([
      readPostedLines(db),
      readSetting(db),
      readChart(db),
      readAccountTotals(db),
    ]);
    const year = yearBoundsContaining(asOf, setting.yearEndMonth, setting.yearEndDay);
    const yearToDate = profitAndLoss(lines, year.startsOn, asOf);
    const cash = cashPosition(lines, asOf);

    // What households owe, read off the account found by role and never by
    // code: the codes are the owner's to change and the role is not. A chart
    // with no receivable account is a fault, and `accountByRole` says so rather
    // than letting the figure read zero (rule 6).
    const receivable = accountByRole(chart, 'receivable');
    const owed = totals.get(receivable.id) ?? { debitFils: 0, creditFils: 0 };
    const receivableFils = balanceOf(receivable.type, fils(owed.debitFils), fils(owed.creditFils));

    const pending = await classifyPending(db);
    // Section 5.1 asks for "the month's automatic entries", and the screen's
    // caption says so: an entry somebody wrote by hand, or a reversal, belongs
    // to the journal and not to the overview's account of what the platform
    // itself put in the books this month.
    const recent = await readEntries(db, {
      from: `${month}-01`,
      to: lastDayOf(month),
      kind: 'automatic',
      limit: RECENT_ENTRIES,
    });

    return c.json(
      OverviewResponse.parse({
        month,
        asOf,
        fiscalYearStartsOn: year.startsOn,
        resultYearToDateFils: yearToDate.resultFils,
        revenueYearToDateFils: yearToDate.incomeFils,
        cashPositionFils: cash.totalFils,
        cashAccounts: cash.accounts,
        receivableFils,
        corporateTaxEstimateFils: corporateTaxEstimate(
          yearToDate.resultFils,
          yearToDate.incomeFils,
          setting,
        ),
        reliefWatch: reliefWatch(yearToDate.incomeFils, setting.smallBusinessReliefThresholdFils),
        reliefThresholdFils: setting.smallBusinessReliefThresholdFils,
        reliefElected: setting.smallBusinessReliefElected,
        unpostedCount: pending.pending,
        unknownCount: pending.unknown,
        recentEntries: recent.entries,
      }),
    );
  });
}

/** The last day of a YYYY-MM, without constructing a local-time date. */
function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
}
