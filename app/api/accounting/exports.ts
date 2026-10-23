import type { Hono } from 'hono';
import { z } from 'zod';
import {
  isWithin,
  toCsv,
  yearBoundsContaining,
  zohoAccountRows,
  zohoJournalRows,
} from '../../../domain/accounting';
import { isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { csvResponse } from './csv-response';
import { readChart, readPostedLines, readSetting } from './rows';
import { IsoDate } from './schema';

/**
 * The two files in Zoho Books' own import layout (docs/SPEC/accounting.md
 * section 4.6): the journal for a period, and the chart of accounts. Nothing
 * is sent anywhere — the person downloads the file — so no vendor is involved
 * and docs/COMPLIANCE/approved-vendors.md does not change.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const Period = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

export function mountExports(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/exports/zoho-journal.csv', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const parsed = Period.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
    if (!parsed.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const to = parsed.data.to ?? today;
    // The start of the financial year `to` falls in, as the statements' own
    // period defaults (./statements.ts), never 1 January.
    let from = parsed.data.from;
    if (!from) {
      const setting = await readSetting(db);
      from = yearBoundsContaining(to, setting.yearEndMonth, setting.yearEndDay).startsOn;
    }
    const lines = (await readPostedLines(db)).filter((line) => isWithin(line.enteredOn, from, to));
    return csvResponse(c, `zoho-journal-${from}-${to}.csv`, toCsv(zohoJournalRows(lines)));
  });

  api.get('/api/accounting/exports/zoho-accounts.csv', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const chart = await readChart(c.get('db'));
    return csvResponse(c, 'zoho-accounts.csv', toCsv(zohoAccountRows(chart)));
  });
}
