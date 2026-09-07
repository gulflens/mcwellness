import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAccounts } from './accounts';
import { mountEntries } from './entries';
import { mountSettings } from './settings';
import { mountYears } from './years';

/**
 * Mounts every route of the books. Called from app/api/create-api.ts beside
 * `mountBilling` (docs/CHANGE-REQUESTS/accounting-01.md item 5); the database
 * tests mount it through `createApi` too, so they do not depend on that wiring
 * being right by accident.
 */
export function mountAccounting(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountSettings(api, now);
  mountAccounts(api, now);
  mountYears(api, now);
  mountEntries(api, now);
}
