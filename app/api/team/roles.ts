import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { canActor, canSwitchRole } from '@domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { TEAM_REFUSALS } from './schema';
import { readTargetRoles } from './target';

/**
 * One working role, on or off, for one colleague: `PUT` and
 * `DELETE /api/team/:id/roles/:role`. The owner's alone
 * (`staff.access.manage`). Round 58, 2026-09-21, replacing
 * `POST /api/team/:id/roles`, which could only ever add one.
 *
 * On is an insert, idempotent. Off is `app.revoke_staff_role` (migration 923),
 * because the API role holds no delete on `user_role` and gains none: a role is
 * a row, and a row that is gone fails closed where a `revoked_at` column read
 * by a forgetful reader would fail open (design section 4).
 *
 * The pure rule `canSwitchRole` answers first, so a person reads a sentence and
 * the switch greys out for the same reason the route refuses; the function
 * beneath asks every question again and is the answer that binds.
 *
 * **Both halves answer the same race the same way**, which is the point of
 * their sharing one savepoint and one `catch` below: a switch that goes one way
 * and a switch that goes the other must not differ in what an owner is told.
 */

/** What each refusal is on the wire (design section 7); the screen holds the sentences. */
const REFUSAL_STATUS: Record<(typeof TEAM_REFUSALS)[number], 400 | 409> = {
  locked: 409,
  last_role: 409,
  not_yourself: 400,
  not_a_working_role: 400,
  conflict: 409,
};

/** Postgres: insufficient_privilege. Here, always a refusal raised by a guard. */
function isRefusedBeneath(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '42501'
  );
}

/** Postgres: unique_violation. Here, the same role granted twice in one moment. */
function isDuplicateRole(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

export const GRANT_SQL =
  'insert into user_role (tenant_id, user_id, role, granted_by, created_by) ' +
  'values ($1, $2, $3::role_kind, $4, $4) on conflict (user_id, role) do nothing';

async function switchRole(c: Context<ApiEnv>, on: boolean, now: () => Date): Promise<Response> {
  const actor = c.get('actor');
  const db = c.get('db');
  const requestId = c.get('requestId');
  if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
    return c.json({ error: 'forbidden', requestId }, 403);
  }
  const id = z.uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
  // Who they are and what they hold: nothing here shows a name, an address or a
  // telephone number to anybody, so nothing here reads one.
  const target = await readTargetRoles(db, id.data);
  if (!target) return c.json({ error: 'not_found', requestId }, 404);
  const role = c.req.param('role') ?? '';
  const refusal = canSwitchRole({
    actorUserId: actor.userId,
    targetUserId: target.id,
    targetRoles: target.roles,
    role,
    on,
  });
  if (refusal !== null) {
    return c.json({ error: refusal, requestId }, REFUSAL_STATUS[refusal]);
  }
  // A failed statement poisons the transaction, and the transaction belongs to
  // the middleware, so both halves run inside their own savepoint.
  await db.query('savepoint switch_role');
  try {
    if (on) {
      // A role they already hold is not an error: the switch is idempotent, so
      // two windows agreeing with each other settle rather than argue.
      await db.query(GRANT_SQL, [actor.tenantId, target.id, role, actor.userId]);
    } else {
      await db.query('select app.revoke_staff_role($1, $2::role_kind)', [target.id, role]);
    }
  } catch (error) {
    // 42501 either way: the rule above already said yes, so what stands beneath
    // disagrees, which means the role set or the actor's own roles moved
    // between the read and the write — another owner switching something at the
    // same moment. Which of the guard's six refusals it is cannot be told from
    // the SQLSTATE, and guessing `last_role` would put a sentence on the screen
    // that may be untrue. 23505 is the grant's own half of the same race:
    // `on conflict (user_id, role) do nothing` covers a duplicate that is
    // already committed, and not one committed a microsecond ago. Not retried:
    // the caller reads the profile again and sees what is actually there.
    if (!isRefusedBeneath(error) && !(on && isDuplicateRole(error))) throw error;
    await db.query('rollback to savepoint switch_role');
    return c.json({ error: 'conflict', requestId }, 409);
  }
  await db.query('release savepoint switch_role');
  return c.json({ ok: true });
}

export function mountTeamRoles(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.put('/api/team/:id/roles/:role', (c) => switchRole(c, true, now));
  api.delete('/api/team/:id/roles/:role', (c) => switchRole(c, false, now));
}
