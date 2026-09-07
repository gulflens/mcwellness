import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mayWriteBooks } from './access';
import { postPendingEvents } from './poster';
import { requiredReason } from './reason';
import { PostResponse } from './schema';

/**
 * `POST /api/accounting/post` — write everything outstanding into the books.
 *
 * The Books page calls this when it opens and the "Bring the books up to date"
 * button calls it again, which is why it is a POST and not something a GET
 * does quietly: reads are reads (docs/SPEC/accounting.md decision 10).
 */
export function mountPosting(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/accounting/post', async (c) => {
    const requestId = c.get('requestId');
    if (!mayWriteBooks(c.get('actor'), now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (requiredReason(c) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const report = await postPendingEvents(c.get('db'));
    return c.json(PostResponse.parse(report));
  });
}
