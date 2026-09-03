import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountBalance } from './balance';
import { mountDocuments, mountDocumentSending } from './documents';
import { mountExtensions } from './extensions';
import { mountInvoices } from './invoices';
import { mountPackages } from './packages';
import { mountPayments } from './payments';
import { mountPrices } from './prices';
import { mountReceipts } from './receipts';
import { mountSendOptions } from './send-options';
import { mountRefundQuotes } from './refunds';
import { mountSales } from './sales';
import { mountSummary } from './summary';
import { mountServiceTypeOptions } from './service-types';
import { mountVatRate } from './vat-rate';
import { mountWaivers } from './waivers';

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
  mountPackages(api, now);
  mountSales(api, now);
  mountPayments(api, now);
  mountBalance(api, now);
  mountInvoices(api, now);
  mountDocuments(api, now);
  mountDocumentSending(api, now);
  mountSummary(api, now);
  mountReceipts(api, now);
  mountSendOptions(api, now);
  mountRefundQuotes(api, now);
  mountWaivers(api, now);
  mountExtensions(api, now);
}
