import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, hasRole } from '../../../domain/shared/actor';
import { narrate, type AuditEvent } from '../../../domain/shared/audit-narrative';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { TimelineResponse, type TimelineEvent } from './schema';

/**
 * GET /api/clients/:id/timeline: one client's audit trail as sentences
 * (docs/SPEC/audit.md section 9.1). The rule is checked here (audit.read:
 * owner, admin, lead practitioner) and the trail is read under row security
 * as the caller. The sentences are composed here, so the browser never sees a
 * raw audit row. Viewing the timeline is itself a read of the record. Seeded
 * by the trunk in PR 6; owned by the audit-ui worktree (docs/SPEC/OWNERSHIP.md).
 */

const Params = z.object({ id: z.uuid() });
const Query = z.object({
  /** An audit row id: the page before it. Ids are gapless and rise with time. */
  before: z.coerce.bigint().positive().lte(9223372036854775807n).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  locale: z.enum(['en', 'ar']).default('en'),
});

type Row = {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  actor_type: string;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
};

const SQL =
  'select a.id::text, a.occurred_at, a.actor_id, u.display_name as actor_name, a.actor_type, ' +
  'a.actor_role, a.action, a.entity_type, a.entity_id, a.changed_fields, a.old_values, ' +
  'a.new_values, a.reason ' +
  'from audit_log a left join app_user u on u.id = a.actor_id ' +
  'where a.client_id = $1 and ($2::bigint is null or a.id < $2::bigint) ' +
  'order by a.id desc limit $3';

function toEvent(row: Row): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actor:
      row.actor_id === null
        ? null
        : {
            id: row.actor_id,
            name: row.actor_name,
            roles: row.actor_role ? row.actor_role.split(',') : [],
          },
    actorType: row.actor_type,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changedFields: row.changed_fields,
    oldValues: row.old_values,
    newValues: row.new_values,
    reason: row.reason,
  };
}

function sameMinute(a: string, b: string): boolean {
  return a.slice(0, 16) === b.slice(0, 16);
}

export function mountTimeline(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/clients/:id/timeline', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = Params.safeParse(c.req.param());
    const query = Query.safeParse(c.req.query());
    if (!params.success || !query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const clientId = params.data.id;
    if (!canActor(actor, { type: 'audit.read', clientId }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Under row security a client of another practice does not exist; an erased
    // record's history stays with the owner and the lead practitioner
    // (client-record.md section 2), as the list route already holds.
    const exists = await db.query<{ status: string }>(
      "select status from client where id = $1 and ($2::boolean or status <> 'erased')",
      [clientId, hasRole(actor, 'owner', 'lead_practitioner')],
    );
    if (exists.rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Opening an erased record is a sensitive action (client-record.md section 8):
    // it needs a typed reason, which the trail then carries with the read.
    if (exists.rows[0]?.status === 'erased' && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const { limit, locale } = query.data;
    const before = query.data.before === undefined ? null : query.data.before.toString();
    const { rows } = await db.query<Row>(SQL, [clientId, before, limit + 1]);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const events: TimelineEvent[] = [];
    for (const row of page) {
      const event = toEvent(row);
      const narration = narrate(event, locale);
      if (narration === null) continue;
      const previous = events[events.length - 1];
      // Nine "saw the appointment in the schedule" lines inside one minute are
      // one fact said nine times: the same person, the same sentence, the same
      // minute fold into one entry with a count. Only reads fold; every change
      // keeps its own line.
      if (
        previous &&
        narration.kind === 'read' &&
        previous.kind === 'read' &&
        previous.sentence === narration.sentence &&
        previous.actor?.name === (event.actor?.name ?? null) &&
        sameMinute(previous.occurredAt, event.occurredAt)
      ) {
        previous.count += 1;
        continue;
      }
      events.push({
        id: event.id,
        occurredAt: event.occurredAt,
        sentence: narration.sentence,
        reason: narration.reason,
        kind: narration.kind,
        count: 1,
        actor:
          event.actor === null ? null : { name: event.actor.name, roles: [...event.actor.roles] },
      });
    }
    await logRead(db, 'client', clientId, clientId);
    const last = page[page.length - 1];
    return c.json(
      TimelineResponse.parse({ events, nextBefore: hasMore && last ? last.id : null, hasMore }),
    );
  });
}
