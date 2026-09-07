import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { readYears } from './rows';
import { YearsResponse } from './schema';

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
