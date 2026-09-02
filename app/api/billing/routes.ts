import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountPrices } from './prices';
import { mountServiceTypeOptions } from './service-types';
import { mountVatRate } from './vat-rate';

/**
 * Mounts every billing route. Called from app/api/create-api.ts as of round 5
 * (docs/CHANGE-REQUESTS/billing-01.md). The database tests also mount this
 * themselves, on the api that createApi returns, so they do not depend on
 * that wiring either.
 */
export function mountBilling(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountServiceTypeOptions(api, now);
  mountPrices(api, now);
  mountVatRate(api, now);
}
