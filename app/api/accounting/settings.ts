import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { readSetting } from './rows';
import { SettingsResponse } from './schema';

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
