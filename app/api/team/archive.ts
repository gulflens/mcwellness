import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, canArchive, canRestore } from '@domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { FutureVisitsRefusal, type ArchiveRefusalCode, type FutureVisit } from './schema';
import { readTargetRoles } from './target';

/**
 * Archiving a colleague, and restoring one: `POST /api/team/:id/archive` and
 * `POST /api/team/:id/restore`. The practice asked, on 6 October 2026, to be
 * able to remove a practitioner or a person; nothing in this schema is
 * deleted, so removing is archiving (migration 977; docs/superpowers/specs/
 * 2026-09-21-team-profiles-and-access-design.md section 12).
 *
 * **Who may.** The owner alone (`staff.access.manage`), as Suspend: an archive
 * is a door shut for good unless an owner opens it again, and Team access is
 * the owner's (the operator's rule of 21 September 2026).
 *
 * **The order.** The pure rule (`canArchive`, `canRestore`) answers first, so
 * the screen and the route refuse for the same reason in the same words; then
 * the diary is read, as the owner, for visits still ahead; then the door
 * (`app.archive_staff`, `app.restore_staff`) asks every question again,
 * because it is security definer and its rules are the boundary. A refusal
 * from the door after the route said yes is a race — a visit booked a moment
 * ago, another owner acting at the same instant — and is answered as what it
 * most likely was, never guessed at more finely than the SQLSTATE allows.
 *
 * **The reason.** `X-Reason` is required to archive: it is what the trail
 * cannot reconstruct a year later. The fence has already stamped it onto the
 * transaction (`app.reason`), and the door stamps its own trimmed copy too,
 * so the status change, the practitioner row and each accompaniment ended all
 * carry it. A restore takes one if it is sent and does not insist.
 */

/** What each refusal is on the wire; the screen holds the sentences. */
const STATUS: Record<ArchiveRefusalCode, 400 | 409> = {
  not_yourself: 400,
  reason_required: 400,
  locked: 409,
  already_archived: 409,
  not_archived: 409,
  future_visits: 409,
  conflict: 409,
};

/**
 * A practitioner's visits still ahead, as the owner reads them: the same
 * states and the same "not over yet" as the door's own check, so the list the
 * screen shows is the list the door refuses on.
 */
const FUTURE_VISITS_SQL =
  'select a.id, a.window_start from appointment a ' +
  'join practitioner p on p.id = a.practitioner_id and p.tenant_id = a.tenant_id ' +
  'where p.user_id = $1 and a.tenant_id = app.current_tenant_id() ' +
  "and a.status in ('proposed', 'confirmed', 'checked_in') and a.window_end > now() " +
  'order by a.window_start, a.id';

async function futureVisits(db: Db, userId: string): Promise<FutureVisit[]> {
  const { rows } = await db.query<{ id: string; window_start: Date }>(FUTURE_VISITS_SQL, [userId]);
  return rows.map((row) => ({
    appointmentId: row.id,
    windowStart: new Date(row.window_start).toISOString(),
  }));
}

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

export function mountTeamArchive(api: Hono<ApiEnv>, now: () => Date): void {
  api.post('/api/team/:id/archive', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const refuse = (error: ArchiveRefusalCode) => c.json({ error, requestId }, STATUS[error]);
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    // Asked before anything is read, so a request without one changes nothing.
    const reason = (c.req.header('x-reason') ?? '').trim();
    if (reason === '') return refuse('reason_required');
    const target = await readTargetRoles(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    const refusal = canArchive({
      actorUserId: actor.userId,
      targetUserId: target.id,
      targetRoles: target.roles,
      status: target.status,
    });
    if (refusal !== null) return refuse(refusal);

    const ahead = await futureVisits(db, target.id);
    if (ahead.length > 0) {
      return c.json(
        FutureVisitsRefusal.parse({ error: 'future_visits', visits: ahead, requestId }),
        409,
      );
    }

    // A refusal beneath poisons the transaction, which is the middleware's.
    await db.query('savepoint archive_staff');
    try {
      await db.query('select app.archive_staff($1, $2)', [target.id, reason]);
    } catch (error) {
      const state = sqlState(error);
      if (state !== '55000' && state !== '42501') throw error;
      await db.query('rollback to savepoint archive_staff');
      // 55000: a visit was booked between the read above and the door. Read
      // the diary again so the screen can say which.
      if (state === '55000') {
        const fresh = await futureVisits(db, target.id);
        if (fresh.length > 0) {
          return c.json(
            FutureVisitsRefusal.parse({ error: 'future_visits', visits: fresh, requestId }),
            409,
          );
        }
      }
      return refuse('conflict');
    }
    await db.query('release savepoint archive_staff');
    return c.json({ ok: true });
  });

  api.post('/api/team/:id/restore', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const refuse = (error: ArchiveRefusalCode) => c.json({ error, requestId }, STATUS[error]);
    if (!canActor(actor, { type: 'staff.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    const target = await readTargetRoles(db, id.data);
    if (!target) return c.json({ error: 'not_found', requestId }, 404);
    if (actor.userId === target.id) return refuse('not_yourself');
    if (
      !canRestore({ actorUserId: actor.userId, targetUserId: target.id, status: target.status })
    ) {
      return refuse('not_archived');
    }
    await db.query('savepoint restore_staff');
    let status: 'active' | 'suspended' = 'active';
    try {
      const { rows } = await db.query<{ summary: { status?: string } }>(
        'select app.restore_staff($1) as summary',
        [target.id],
      );
      // Back where the archive found them, which the function says.
      if (rows[0]?.summary.status === 'suspended') status = 'suspended';
    } catch (error) {
      if (sqlState(error) !== '42501') throw error;
      await db.query('rollback to savepoint restore_staff');
      return refuse('conflict');
    }
    await db.query('release savepoint restore_staff');
    return c.json({ ok: true, status });
  });
}
