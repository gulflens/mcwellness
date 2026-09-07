import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { readEntries, readEntry } from './rows';
import { EntriesResponse, EntryResponse, IsoDate } from './schema';

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
