import type { Hono } from 'hono';
import { canActor } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { ServiceTypeOptionsResponse, type ServiceTypeOption } from './schema';

/**
 * GET /api/billing/service-types: the picker behind "add a price", and, from
 * the second pull request, the billing screen itself. This route reads the
 * existing service_type table under row security as the caller; it does not
 * own that table, only reads it, the same way the clients route reads
 * location and contact.
 */

type Row = { id: string; code: string; name: string; name_ar: string | null };

const SQL =
  "select id, code, name, name_ar from service_type where status = 'active' order by name";

export function mountServiceTypeOptions(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.get('/api/billing/service-types', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'billing.price.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await c.get('db').query<Row>(SQL);
    const serviceTypes: ServiceTypeOption[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      nameAr: r.name_ar,
    }));
    return c.json(ServiceTypeOptionsResponse.parse({ serviceTypes }));
  });
}
