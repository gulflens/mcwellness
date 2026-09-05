import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  CreateKitRequest,
  KitListResponse,
  KitOptionsResponse,
  UpdateKitRequest,
  type KitRow,
} from './schema';

/**
 * The equipment register's routes (docs/SPEC/practitioner-phone.md sections
 * 6.2 and 9).
 *
 * `GET /api/kit` — the register. The owner, an admin and the lead practitioner
 * see all of it; a practitioner sees the items assigned to them, which is what
 * lets somebody stopped at a door see which amplifier is overdue without
 * telephoning the practice. The narrowing is `db/policies/session/kit.sql`'s,
 * not this route's: the select below is the same statement for everybody and
 * the database decides what it returns.
 *
 * `POST /api/kit` and `PATCH /api/kit/:id` — adding an item, editing one,
 * assigning it and recording a calibration. All four are `kit.manage`, because
 * they are one act: deciding what the register says. A calibration is a PATCH
 * of two dates, which is the only date the practice records.
 *
 * **Nothing here is personal data**, and that is why there is no audit read: a
 * serial, a model and two dates. The row's own audit trigger records every
 * change (migration 306), which is what "who moved it, when and why" needs.
 *
 * **Nothing is deleted.** An item the practice retires is set inactive, and
 * migration 306 grants app_role no delete at all, so there is no route to
 * write for it.
 */

const Params = z.object({ id: z.uuid() });
/** The length app/api/_middleware/request-context.ts itself trims a reason to. */
const REASON_MAX = 500;

type Row = {
  id: string;
  serial: string;
  model: string;
  kind: KitRow['kind'];
  status: KitRow['status'];
  assigned_practitioner_id: string | null;
  assigned_to: string | null;
  last_calibrated_at: Date | null;
  calibration_due_at: Date | null;
};

// The practitioner's display name comes through a left join, so an unassigned
// item is still a row. Every joined table repeats the tenant predicate, as
// every other route in this codebase does.
const LIST_SQL =
  'select k.id, k.serial, k.model, k.kind::text as kind, k.status::text as status, ' +
  'k.assigned_practitioner_id, u.display_name as assigned_to, ' +
  'k.last_calibrated_at, k.calibration_due_at ' +
  'from kit k ' +
  'left join practitioner p on p.id = k.assigned_practitioner_id ' +
  'and p.tenant_id = app.current_tenant_id() ' +
  'left join app_user u on u.id = p.user_id and u.tenant_id = app.current_tenant_id() ' +
  'where k.tenant_id = app.current_tenant_id() ' +
  'order by k.status, k.kind, k.serial';

const ONE_SQL =
  'select k.id, k.serial, k.model, k.kind::text as kind, k.status::text as status, ' +
  'k.assigned_practitioner_id, u.display_name as assigned_to, ' +
  'k.last_calibrated_at, k.calibration_due_at ' +
  'from kit k ' +
  'left join practitioner p on p.id = k.assigned_practitioner_id ' +
  'and p.tenant_id = app.current_tenant_id() ' +
  'left join app_user u on u.id = p.user_id and u.tenant_id = app.current_tenant_id() ' +
  'where k.id = $1 and k.tenant_id = app.current_tenant_id()';

const PRACTITIONERS_SQL =
  'select p.id, u.display_name from practitioner p ' +
  'join app_user u on u.id = p.user_id and u.tenant_id = app.current_tenant_id() ' +
  "where p.tenant_id = app.current_tenant_id() and p.status = 'active' " +
  'order by u.display_name';

function toRow(row: Row): KitRow {
  return {
    id: row.id,
    serial: row.serial,
    model: row.model,
    kind: row.kind,
    status: row.status,
    assignedPractitionerId: row.assigned_practitioner_id,
    assignedTo: row.assigned_to,
    lastCalibratedAt: row.last_calibrated_at?.toISOString() ?? null,
    calibrationDueAt: row.calibration_due_at?.toISOString() ?? null,
  };
}

async function readOne(db: Db, id: string): Promise<KitRow | null> {
  const { rows } = await db.query<Row>(ONE_SQL, [id]);
  const row = rows[0];
  return row ? toRow(row) : null;
}

/** A calendar date as the practice types it, read as that day in the practice's zone. */
function atPracticeMidnight(date: string | null): string | null {
  return date === null ? null : `${date}T00:00:00+04:00`;
}

export function mountKit(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/kit', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    // `assignedToSelf` is true here because the row policy is what narrows the
    // answer: a practitioner asking for the register gets their own items, and
    // an actor who may read nothing at all is refused before the query runs.
    if (!canActor(actor, { type: 'kit.read', assignedToSelf: true }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await c.get('db').query<Row>(LIST_SQL);
    return c.json(KitListResponse.parse({ kit: rows.map(toRow) }));
  });

  api.get('/api/kit/options', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'kit.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await c
      .get('db')
      .query<{ id: string; display_name: string }>(PRACTITIONERS_SQL);
    return c.json(
      KitOptionsResponse.parse({
        practitioners: rows.map((row) => ({ id: row.id, displayName: row.display_name })),
      }),
    );
  });

  api.post('/api/kit', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'kit.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = CreateKitRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const id = randomUUID();
    try {
      await db.query(
        'insert into kit (id, tenant_id, serial, model, kind, assigned_practitioner_id, ' +
          'last_calibrated_at, calibration_due_at, created_by) values ' +
          '($1, app.current_tenant_id(), $2, $3, $4::kit_kind, $5, $6, $7, $8)',
        [
          id,
          body.data.serial,
          body.data.model,
          body.data.kind,
          body.data.assignedPractitionerId,
          atPracticeMidnight(body.data.lastCalibratedAt),
          atPracticeMidnight(body.data.calibrationDueAt),
          actor.userId,
        ],
      );
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        // A serial the practice already has. Two rows for one amplifier would
        // have the practice calibrating one and carrying the other.
        return c.json({ error: 'conflict', code: 'serial_exists', requestId }, 409);
      }
      if (pgError.code === '23514') {
        // A due date before the calibration it follows.
        return c.json({ error: 'bad_request', code: 'calibration_dates', requestId }, 400);
      }
      if (pgError.code === '23503') {
        return c.json({ error: 'bad_request', code: 'practitioner_not_found', requestId }, 400);
      }
      throw error;
    }
    const created = await readOne(db, id);
    if (!created) {
      // Written but not readable: the caller is a practitioner whose own
      // policy hides an item assigned to somebody else. Nothing to hand back.
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    return c.json(created, 201);
  });

  api.patch('/api/kit/:id', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'kit.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    // A reason is required, and the row's own audit trigger carries it: this
    // changes what a practitioner is allowed to check in with, and "who moved
    // it, when and why" is exactly what the trail should answer about it.
    const reason = (c.req.header('x-reason') ?? '').trim().slice(0, REASON_MAX);
    if (reason.length === 0) {
      return c.json({ error: 'bad_request', code: 'reason_required', requestId }, 400);
    }
    const body = UpdateKitRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const patch = body.data;
    // coalesce against the column, with an explicit flag per nullable field, so
    // "leave it alone" and "set it to nothing" are two different requests
    // rather than one ambiguous null.
    const sql =
      'update kit set ' +
      'serial = coalesce($2, serial), ' +
      'model = coalesce($3, model), ' +
      'kind = coalesce($4::kit_kind, kind), ' +
      'status = coalesce($5::active_status, status), ' +
      'assigned_practitioner_id = case when $6 then $7 else assigned_practitioner_id end, ' +
      'last_calibrated_at = case when $8 then $9 else last_calibrated_at end, ' +
      'calibration_due_at = case when $10 then $11 else calibration_due_at end ' +
      'where id = $1 and tenant_id = app.current_tenant_id() returning id';
    let changed: number;
    try {
      const result = await db.query(sql, [
        params.data.id,
        patch.serial ?? null,
        patch.model ?? null,
        patch.kind ?? null,
        patch.status ?? null,
        'assignedPractitionerId' in patch,
        patch.assignedPractitionerId ?? null,
        'lastCalibratedAt' in patch,
        atPracticeMidnight(patch.lastCalibratedAt ?? null),
        'calibrationDueAt' in patch,
        atPracticeMidnight(patch.calibrationDueAt ?? null),
      ]);
      changed = result.rowCount ?? 0;
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        return c.json({ error: 'conflict', code: 'serial_exists', requestId }, 409);
      }
      if (pgError.code === '23514') {
        return c.json({ error: 'bad_request', code: 'calibration_dates', requestId }, 400);
      }
      if (pgError.code === '23503') {
        return c.json({ error: 'bad_request', code: 'practitioner_not_found', requestId }, 400);
      }
      throw error;
    }
    if (changed === 0) {
      // Row security refused, or there is no such item. Neither is something a
      // caller can fix by trying again, and a 404 tells them nothing they
      // should not already know.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const updated = await readOne(db, params.data.id);
    if (!updated) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(updated);
  });
}
