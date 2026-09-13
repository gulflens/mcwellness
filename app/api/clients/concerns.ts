import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';
import { canWriteConcern } from './access';
import { CreateConcernBody, IdResponse, UpdateConcernBody } from './record-schema';
import { logRefused } from './refused';

/**
 * What a household is worried about (docs/SPEC/client-record.md section 4.2,
 * "goals **and** concerns"). Recorded by whoever enrolled them — the owner, an
 * admin or the lead practitioner — because it is the household's own words
 * rather than a decision about the programme, which is what a goal is.
 *
 * Kept out of `goal` deliberately: that table is gathered into progress
 * reports (app/api/reports/gather.ts) and printed into a signed document a
 * household reads, and a concern in it would appear there as a goal they never
 * set (108_concerns_and_health.sql).
 */

const ClientParams = z.object({ id: z.uuid() });
const ConcernParams = z.object({ id: z.uuid(), concernId: z.uuid() });

export function mountConcerns(api: Hono<ApiEnv>): void {
  api.post('/api/clients/:id/concerns', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const body = CreateConcernBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    // Before the role check, for the reason contacts.ts gives: a plain select
    // under row security cannot tell "no such client" from "not yours".
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canWriteConcern(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') return c.json({ error: 'erased', requestId }, 400);

    const description = cleanText(body.data.description, 2000);
    // The floor lives here rather than on the column: the erasure empties this
    // text, so a check constraint refusing empty would make an erased concern
    // unrepresentable (108_concerns_and_health.sql).
    if (description.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    const category = await db.query<{ id: string }>('select id from goal_category where id = $1', [
      body.data.categoryId,
    ]);
    if (category.rowCount === 0) return c.json({ error: 'bad_request', requestId }, 400);

    const concernId = randomUUID();
    await db.query(
      'insert into concern (id, tenant_id, client_id, category_id, description, created_by) ' +
        'values ($1, app.current_tenant_id(), $2, $3, $4, app.current_actor_id())',
      [concernId, clientId, body.data.categoryId, description],
    );
    return c.json(IdResponse.parse({ id: concernId }), 201);
  });

  api.patch('/api/clients/:id/concerns/:concernId', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ConcernParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, concernId } = params.data;
    const body = UpdateConcernBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canWriteConcern(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') return c.json({ error: 'erased', requestId }, 400);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.data.categoryId !== undefined) {
      const category = await db.query<{ id: string }>(
        'select id from goal_category where id = $1',
        [body.data.categoryId],
      );
      if (category.rowCount === 0) return c.json({ error: 'bad_request', requestId }, 400);
      values.push(body.data.categoryId);
      sets.push(`category_id = $${values.length}`);
    }
    if (body.data.description !== undefined) {
      const description = cleanText(body.data.description, 2000);
      if (description.length === 0) return c.json({ error: 'bad_request', requestId }, 400);
      values.push(description);
      sets.push(`description = $${values.length}`);
    }
    if (body.data.status !== undefined) {
      values.push(body.data.status);
      sets.push(`status = $${values.length}`);
    }
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(concernId, clientId);
    const updated = await db.query(
      `update concern set ${sets.join(', ')} where id = $${values.length - 1} and client_id = $${values.length}`,
      values,
    );
    if (updated.rowCount === 0) return c.json({ error: 'not_found', requestId }, 404);
    return c.json(IdResponse.parse({ id: concernId }));
  });
}
