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

    // app.client_status_for bypasses row level security: see app/api/clients/contacts.ts
    // for why this must come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteGoal(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const category = await db.query<{ id: string }>('select id from goal_category where id = $1', [
      body.data.categoryId,
    ]);
    if (category.rowCount === 0) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const goalId = randomUUID();
    if (body.data.isPrimary) {
      // The one-primary-goal index (db/migrations/100_client_record.sql) is scoped to
      // active goals, so the swap belongs here, in the same transaction as the insert,
      // rather than in a 23505 the caller has to interpret and retry (issue 8).
      await db.query(
        "update goal set is_primary = false where client_id = $1 and is_primary and status = 'active'",
        [clientId],
      );
    }
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

    // Client existence (bypassing row level security) before role, then the goal itself:
    // the same ordering as the create route above (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteGoal(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string; status: string }>(
      'select id, status from goal where id = $1 and client_id = $2',
      [goalId, clientId],
    );
    const row = existing.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
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

    if (d.isPrimary) {
      // Same swap as the create route: clear the client's current active primary, in the
      // same transaction, before this goal claims the flag (issue 8).
      await db.query(
        "update goal set is_primary = false where client_id = $1 and is_primary and status = 'active' and id <> $2",
        [clientId, goalId],
      );
    }
    values.push(goalId);
    await db.query(`update goal set ${sets.join(', ')} where id = $${values.length}`, values);
    return c.json(IdResponse.parse({ id: goalId }));
  });
}
