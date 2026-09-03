import type { Hono } from 'hono';
import { hasRole } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { GoalCategoryListResponse } from './record-schema';

/**
 * The owner-editable goal categories (docs/SPEC/client-record.md section 6,
 * 00-data-model.md section 4): reference data the Goals tab and the
 * enrolment wizard's goals step choose from, never free text standing in
 * for it. Reference data, not personal data — no read is logged, the same
 * as billing's service-types route. Gated to the roles that ever see a
 * goal (db/policies/client/readers.sql); the table's own row policy is
 * otherwise open to the whole tenant, since it names no client.
 */

type Row = { id: string; code: string; name: string; name_ar: string | null };

export function mountGoalCategories(api: Hono<ApiEnv>): void {
  api.get('/api/clients/goal-categories', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await c
      .get('db')
      .query<Row>(
        "select id, code, name, name_ar from goal_category where status = 'active' order by name",
      );
    return c.json(
      GoalCategoryListResponse.parse({
        categories: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, nameAr: r.name_ar })),
      }),
    );
  });
}
