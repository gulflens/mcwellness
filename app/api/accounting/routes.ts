import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAccountWrites, mountAccounts } from './accounts';
import { mountEntries, mountEntryWrites } from './entries';
import { mountExports } from './exports';
import { mountOverview } from './overview';
import { mountPosting } from './post';
import { mountSettings, mountSettingsWrites } from './settings';
import { mountStatements } from './statements';
import { mountYearWrites, mountYears } from './years';

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
  mountAccountWrites(api, now);
  mountSettingsWrites(api, now);
  mountYearWrites(api, now);
  mountEntryWrites(api, now);
  mountPosting(api, now);
  mountOverview(api, now);
  mountStatements(api, now);
  mountExports(api, now);
}
