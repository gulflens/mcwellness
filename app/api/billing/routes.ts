import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountPrices } from './prices';
import { mountServiceTypeOptions } from './service-types';

/**
 * Mounts every billing route. Not called from app/api/create-api.ts yet —
 * that one line is a change request (docs/CHANGE-REQUESTS/billing-01.md),
 * since create-api.ts is shared and this pull request ships no screen to
 * reach these routes from. The database tests mount this themselves, on the
 * api that createApi returns, so they do not need the trunk change either.
 */
export function mountBilling(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountServiceTypeOptions(api, now);
  mountPrices(api, now);
}
