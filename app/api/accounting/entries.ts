import type { Hono } from 'hono';
import { z } from 'zod';
import {
  UnbalancedEntryError,
  assertBalanced,
  balanceWithOpeningEquity,
  landingDayFor,
  mayPostOn,
  reversalOf,
  type DraftLine,
} from '../../../domain/accounting';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayReadBooks, mayWriteBooks } from './access';
import { requiredReason } from './reason';
import { readChart, readEntry, readEntries, readSetting, readYears } from './rows';
import { CreateEntryInput, EntriesResponse, EntryResponse, IsoDate } from './schema';

/**
 * The journal: the entries newest first, and one entry with its lines
 * (docs/SPEC/accounting.md sections 5.2 and 9). Bounded by a limit and not a
 * cursor, which is how this codebase bounds a list (billing's invoice book);
 * `truncated` says there are more without a second count-only query.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const Query = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  account: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export function mountEntries(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/accounting/entries', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const parsed = Query.safeParse({
      from: c.req.query('from'),
      to: c.req.query('to'),
      account: c.req.query('account'),
      limit: c.req.query('limit') ?? DEFAULT_LIMIT,
    });
    if (!parsed.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const found = await readEntries(c.get('db'), {
      from: parsed.data.from,
      to: parsed.data.to,
      accountId: parsed.data.account,
      limit: parsed.data.limit,
    });
    return c.json(EntriesResponse.parse(found));
  });

  api.get('/api/accounting/entries/:id', async (c) => {
    const requestId = c.get('requestId');
    if (!mayReadBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const found = await readEntry(c.get('db'), id.data);
    if (!found) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(EntryResponse.parse(found));
  });
}

/** The practice's own day, for a reversal that is dated when it is written. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const YEAR_SQL = 'select app.fiscal_year_for($1) as id';

const ENTRY_SQL =
  'insert into journal_entry (tenant_id, entered_on, fiscal_year_id, kind, memo, ' +
  'reverses_entry_id, reversal_reason, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id()) returning id';

const LINE_SQL =
  'insert into journal_line (tenant_id, entry_id, line_no, account_id, debit_fils, credit_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, app.current_actor_id())';

/** Writes the header and its lines, and reads back what the database made of them. */
async function writeEntry(
  db: Db,
  header: {
    enteredOn: string;
    kind: 'manual' | 'opening' | 'reversal';
    memo: string;
    reversesEntryId?: string;
    reversalReason?: string;
  },
  lines: readonly DraftLine[],
): Promise<{ entry: EntryResponse['entry']; lines: EntryResponse['lines'] }> {
  const year = await db.query<{ id: string }>(YEAR_SQL, [header.enteredOn]);
  const yearId = year.rows[0]?.id;
  if (!yearId) {
    throw new Error('No financial year could be found or made for the entry.');
  }
  const created = await db.query<{ id: string }>(ENTRY_SQL, [
    header.enteredOn,
    yearId,
    header.kind,
    header.memo,
    header.reversesEntryId ?? null,
    header.reversalReason ?? null,
  ]);
  const entryId = created.rows[0]?.id;
  if (!entryId) {
    throw new Error('The journal entry was not written.');
  }
  let lineNo = 1;
  for (const line of lines) {
    await db.query(LINE_SQL, [entryId, lineNo, line.accountId, line.debitFils, line.creditFils]);
    lineNo += 1;
  }
  const written = await readEntry(db, entryId);
  if (!written) {
    throw new Error('The journal entry could not be read back.');
  }
  return written;
}

/**
 * The two ways a person writes in the books by hand: an entry of their own
 * (docs/SPEC/accounting.md section 5.2, rules 1, 3 and 9) and a reversal of
 * one that was wrong (section 4.2). Nothing is ever edited: a correction is a
 * new entry, and both stay.
 */
export function mountEntryWrites(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/accounting/entries', async (c) => {
    const requestId = c.get('requestId');
    if (!mayWriteBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (requiredReason(c) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = CreateEntryInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const db = c.get('db');
    const [chart, setting, years] = await Promise.all([
      readChart(db),
      readSetting(db),
      readYears(db),
    ]);

    const usable = new Set(
      chart.filter((account) => account.archivedAt === null).map((account) => account.id),
    );
    if (input.lines.some((line) => !usable.has(line.accountId))) {
      return c.json({ error: 'bad_request', code: 'unknown_account', requestId }, 400);
    }
    if (input.balanceWithOpeningEquity && input.kind !== 'opening') {
      return c.json({ error: 'bad_request', code: 'not_an_opening_entry', requestId }, 400);
    }
    if (input.kind === 'opening' && input.enteredOn !== setting.booksStartOn) {
      return c.json({ error: 'bad_request', code: 'opening_day', requestId }, 400);
    }
    if (!mayPostOn(input.enteredOn, years, setting.lockedThrough)) {
      return c.json({ error: 'conflict', code: 'period_locked', requestId }, 409);
    }

    const drafted: DraftLine[] = input.lines.map((line) => ({
      accountId: line.accountId,
      debitFils: fils(line.debitFils),
      creditFils: fils(line.creditFils),
    }));
    const lines = input.balanceWithOpeningEquity
      ? balanceWithOpeningEquity(drafted, chart)
      : drafted;
    try {
      assertBalanced(lines);
    } catch (error) {
      if (error instanceof UnbalancedEntryError) {
        return c.json({ error: 'bad_request', code: 'unbalanced', requestId }, 400);
      }
      throw error;
    }

    const written = await writeEntry(
      db,
      { enteredOn: input.enteredOn, kind: input.kind, memo: input.memo },
      lines,
    );
    return c.json(EntryResponse.parse(written), 201);
  });

  api.post('/api/accounting/entries/:id/reversal', async (c) => {
    const requestId = c.get('requestId');
    if (!mayWriteBooks(c.get('actor'), now())) {
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
    const original = await readEntry(db, id.data);
    if (!original) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (original.entry.reversedByEntryId !== null) {
      return c.json({ error: 'conflict', code: 'already_reversed', requestId }, 409);
    }
    const [setting, years] = await Promise.all([readSetting(db), readYears(db)]);
    // A reversal is dated when it is written, moved to the first day the books
    // will take it (rule 4): the original's day may be closed or locked, and
    // the correction must land somewhere all the same.
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const enteredOn = landingDayFor(today, years, setting.lockedThrough);
    const lines = reversalOf(
      original.lines.map((line) => ({
        accountId: line.accountId,
        debitFils: fils(line.debitFils),
        creditFils: fils(line.creditFils),
      })),
    );
    const written = await writeEntry(
      db,
      {
        enteredOn,
        kind: 'reversal',
        memo: `Reversal of ${original.entry.reference}`,
        reversesEntryId: original.entry.id,
        reversalReason: reason,
      },
      lines,
    );
    return c.json(EntryResponse.parse(written), 201);
  });
}
