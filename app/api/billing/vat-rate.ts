import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { IsoDate, VatRateResponse } from './schema';

/**
 * GET /api/billing/vat-rate?date=YYYY-MM-DD: the VAT setting in force on a
 * given date — the same rule domain/billing/vat.ts's resolveVat is stamped
 * against (the row with the greatest effective_from at or before the date),
 * expressed here as the one query the "add a price" drawer needs so its live
 * total can preview against the rate that will actually apply on the chosen
 * effective-from date, never today's rate and never a rate read off an
 * existing price row (docs/SPEC/billing.md section 5.1: nobody types the
 * rate, and nothing displays one that isn't the rate itself). 404 when the
 * date predates the tenant's earliest setting; every tenant has one from
 * 2018-01-01 onward (migration 400's app.default_vat_setting()), so this is
 * only reachable for a date before that.
 */

const Query = z.object({ date: IsoDate });

const SQL =
  'select rate_basis_points, effective_from from vat_setting ' +
  'where tenant_id = app.current_tenant_id() and effective_from <= $1 ' +
  'order by effective_from desc, version desc limit 1';

export function mountVatRate(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/vat-rate', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'billing.price.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const { rows } = await c
      .get('db')
      .query<{ rate_basis_points: number; effective_from: string }>(SQL, [query.data.date]);
    const setting = rows[0];
    if (!setting) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    return c.json(
      VatRateResponse.parse({
        rateBasisPoints: setting.rate_basis_points,
        effectiveFrom: setting.effective_from,
      }),
    );
  });
}
