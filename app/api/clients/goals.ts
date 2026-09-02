import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { canWriteGoal } from './access';
import { CreateGoalBody, IdResponse, UpdateGoalBody } from './record-schema';
import { logRefused } from './refused';

/**
 * A client's goals (docs/SPEC/client-record.md sections 2 and 4.2): the
 * owner and the lead practitioner alone set and close one. Dropping a goal is
 * a sensitive action and needs a reason (section 9).
 */

const ClientParams = z.object({ id: z.uuid() });
const GoalParams = z.object({ id: z.uuid(), goalId: z.uuid() });

export function mountGoals(api: Hono<ApiEnv>): void {
  api.post('/api/clients/:id/goals', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = CreateGoalBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    if (!canWriteGoal(actor)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const client = await db.query<{ id: string; status: string }>(
      'select id, status from client where id = $1',
      [clientId],
    );
    if (client.rowCount === 0) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (client.rows[0]?.status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const category = await db.query<{ id: string }>('select id from goal_category where id = $1', [
      body.data.categoryId,
    ]);
    if (category.rowCount === 0) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const goalId = randomUUID();
    await db.query(
      'insert into goal (id, tenant_id, client_id, category_id, description, is_primary) ' +
        'values ($1, $2, $3, $4, $5, $6)',
      [
        goalId,
        actor.tenantId,
        clientId,
        body.data.categoryId,
        cleanText(body.data.description, 2000),
        body.data.isPrimary,
      ],
    );
    return c.json(IdResponse.parse({ id: goalId }), 201);
  });

  api.patch('/api/clients/:id/goals/:goalId', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = GoalParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, goalId } = params.data;
    const bodyJson = await c.req.json().catch(() => null);
    const body = UpdateGoalBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    if (!canWriteGoal(actor)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const existing = await db.query<{ id: string; status: string; client_status: string }>(
      'select g.id, g.status, c.status as client_status from goal g ' +
        'join client c on c.id = g.client_id where g.id = $1 and g.client_id = $2',
      [goalId, clientId],
    );
    const row = existing.rows[0];
    if (!row) {
      await logRefused(db, 'goal', goalId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (row.client_status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    // Removing a goal — dropping it — is a sensitive action (section 9).
    if (
      body.data.status === 'dropped' &&
      row.status !== 'dropped' &&
      !(c.req.header('x-reason') ?? '').trim()
    ) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    if (body.data.categoryId !== undefined) {
      const category = await db.query<{ id: string }>(
        'select id from goal_category where id = $1',
        [body.data.categoryId],
      );
      if (category.rowCount === 0) return c.json({ error: 'bad_request', requestId }, 400);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const d = body.data;
    if (d.categoryId !== undefined) push('category_id', d.categoryId);
    if (d.description !== undefined) push('description', cleanText(d.description, 2000));
    if (d.status !== undefined) push('status', d.status);
    if (d.isPrimary !== undefined) push('is_primary', d.isPrimary);
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(goalId);
    await db.query(`update goal set ${sets.join(', ')} where id = $${values.length}`, values);
    return c.json(IdResponse.parse({ id: goalId }));
  });
}
