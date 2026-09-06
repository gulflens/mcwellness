import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, hasRole } from '../../../domain/shared/actor';
import { narrate, type AuditEvent } from '../../../domain/shared/audit-narrative';
import { logAction, logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import {
  AccessReportResponse,
  ActivityFilters,
  ActivityResponse,
  type AccessReportReader,
  type ActivityEvent,
} from './schema';

/**
 * The practice's whole trail, and who has read one record
 * (docs/SPEC/audit.md section 9, views 2 and 4).
 *
 * - `GET /api/audit/activity` — every row of the trail, newest first,
 *   narrowable by who did it, what kind of row it was, which action, which
 *   days and which household.
 * - `GET /api/audit/filters` — what those lists may be narrowed to, so the
 *   screen offers what exists rather than a free-text box.
 * - `GET /api/audit/access-report?clientId=` — "everyone who has viewed this
 *   record, ever", which is the answer a household is owed the first time it
 *   asks and the reason it is worth having in one press.
 *
 * **The sentences are composed here**, by the same catalogue the record
 * timeline uses, so the browser never sees a raw audit row and no line carries
 * anything the trail does not already hold. A row the catalogue has no
 * sentence for is left out rather than shown as JSON.
 *
 * **An erased household stays with the owner and the lead practitioner, and
 * only with a typed reason.** `app.client_erasure_gate` is what says so
 * everywhere else (db/policies/client/readers.sql), and it is asked here too:
 * `audit_log`'s own policies are tenant-wide, so without this an administrator
 * would reach an erased record through the feed that the record's own screens
 * refuse them. The reason is the other half, and it is the half the first
 * build of this route left out: `docs/SPEC/client-record.md` section 8 step 3
 * makes opening an erased record a sensitive action, the record timeline
 * (app/api/audit/timeline.ts) and the access report below both insist on it,
 * and a feed that did not would be the one door in the building that opened
 * without one. A feed narrowed to an erased record answers 400
 * `reason_required` without it, exactly as the timeline does; the unfiltered
 * feed withholds erased households' rows until a reason is typed, so
 * scrolling the practice's whole trail is never a way to read them by
 * accident.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/** A bounded word from the trail: an action or an entity type, never free text. */
const Word = z
  .string()
  .max(64)
  .regex(/^[a-z_][a-z0-9_.]*$/i, 'A trail word is letters, digits, underscores and dots.');

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Days are YYYY-MM-DD.');

const ActivityQuery = z.object({
  before: z.coerce.bigint().positive().lte(9223372036854775807n).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  locale: z.enum(['en', 'ar']).default('en'),
  actorId: z.uuid().optional(),
  entityType: Word.optional(),
  action: Word.optional(),
  from: IsoDay.optional(),
  to: IsoDay.optional(),
  clientId: z.uuid().optional(),
});

const ClientQuery = z.object({ clientId: z.uuid() });

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
  client_id: string | null;
  client_mrn: string | null;
};

/**
 * The feed's own statement. Every filter is a parameter and every one of them
 * is optional in the same shape — `$n is null or <column> = $n` — so one
 * prepared statement serves every combination and nothing is ever built by
 * joining strings.
 *
 * The day filters are half-open instants rather than a formatted comparison,
 * so the partition pruning `audit_log` is built for still applies: the trail is
 * partitioned by `occurred_at` (070_audit_log.sql).
 */
const ACTIVITY_SQL =
  'select a.id::text, a.occurred_at, a.actor_id, u.display_name as actor_name, a.actor_type, ' +
  'a.actor_role, a.action, a.entity_type, a.entity_id, a.changed_fields, a.old_values, ' +
  'a.new_values, a.reason, a.client_id, c.mrn as client_mrn ' +
  'from audit_log a ' +
  'left join app_user u on u.id = a.actor_id ' +
  'left join client c on c.id = a.client_id ' +
  'where ($1::bigint is null or a.id < $1::bigint) ' +
  '  and ($2::uuid is null or a.actor_id = $2::uuid) ' +
  '  and ($3::text is null or a.entity_type = $3::text) ' +
  '  and ($4::text is null or a.action = $4::text) ' +
  '  and ($5::text is null or a.occurred_at >= ($5::date)::timestamp at time zone $8::text) ' +
  '  and ($6::text is null or a.occurred_at < ($6::date + 1)::timestamp at time zone $8::text) ' +
  '  and ($7::uuid is null or a.client_id = $7::uuid) ' +
  // An erased household's history stays with the owner and the lead
  // practitioner, and only while a reason is on the request. $9 is
  // "owner-or-lead **and** a reason was typed"; without it a row belonging to
  // an erased record is withheld from everybody, because `client_erasure_gate`
  // on its own admits the owner and the lead practitioner with nothing said,
  // and scrolling the practice's whole trail would then be a way to read an
  // erased record without the reason its own screens insist on.
  '  and (a.client_id is null or $9::boolean ' +
  "       or (app.client_status_for(a.client_id) is distinct from 'erased'::public.client_status " +
  '           and app.client_erasure_gate(app.client_status_for(a.client_id)))) ' +
  'order by a.id desc limit $10';

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

/** The people of this practice, for the "who" list. Their own names, never a client's. */
const ACTORS_SQL =
  'select id, display_name from app_user ' +
  "where tenant_id = app.current_tenant_id() and status = 'active' order by display_name";

/**
 * What the trail actually holds, over the last ninety days. Bounded on purpose:
 * a list of every action ever taken is a table scan for a select box, and a
 * kind of row nobody has touched in three months is not a filter anybody is
 * looking for.
 */
const VOCABULARY_SQL =
  'select entity_type, action from audit_log ' +
  "where occurred_at >= now() - interval '90 days' group by entity_type, action";

/**
 * Everyone who has opened this record, ever, with how often and when
 * (section 9.4). A read is `read` or `list`, which is what the application
 * writes when a record leaves the database (app/api/_middleware/audit.ts).
 */
const ACCESS_REPORT_SQL =
  'select a.actor_id, u.display_name as name, ' +
  '  max(a.actor_role) as roles, count(*)::int as reads, ' +
  '  min(a.occurred_at) as first_at, max(a.occurred_at) as last_at, ' +
  '  array_agg(distinct a.entity_type order by a.entity_type) as entity_types ' +
  'from audit_log a left join app_user u on u.id = a.actor_id ' +
  "where a.client_id = $1 and a.action in ('read', 'list') " +
  'group by a.actor_id, u.display_name ' +
  'order by max(a.occurred_at) desc';

export function mountActivity(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/audit/activity', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const query = ActivityQuery.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'audit.activity' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { before, limit, locale, actorId, entityType, action, from, to, clientId } = query.data;
    const senior = hasRole(actor, 'owner', 'lead_practitioner');
    const reason = (c.req.header('x-reason') ?? '').trim();
    // A feed narrowed to one record is that record's history, so it holds the
    // door the record's own timeline holds (app/api/audit/timeline.ts): under
    // row security a client of another practice does not exist, an erased
    // record is the owner's and the lead practitioner's, and opening one needs
    // a typed reason the trail then carries with the read.
    if (clientId !== undefined) {
      const found = await db.query<{ status: string }>(
        "select status from client where id = $1 and ($2::boolean or status <> 'erased')",
        [clientId, senior],
      );
      if (found.rowCount === 0) {
        return c.json({ error: 'not_found', requestId }, 404);
      }
      if (found.rows[0]?.status === 'erased' && reason.length === 0) {
        return c.json({ error: 'reason_required', requestId }, 400);
      }
    }
    const { rows } = await db.query<Row>(ACTIVITY_SQL, [
      before === undefined ? null : before.toString(),
      actorId ?? null,
      entityType ?? null,
      action ?? null,
      from ?? null,
      to ?? null,
      clientId ?? null,
      PRACTICE_TIME_ZONE,
      senior && reason.length > 0,
      limit + 1,
    ]);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const events: ActivityEvent[] = [];
    for (const row of page) {
      const event = toEvent(row);
      const narration = narrate(event, locale);
      if (narration === null) continue;
      events.push({
        id: event.id,
        occurredAt: event.occurredAt,
        sentence: narration.sentence,
        reason: narration.reason,
        kind: narration.kind,
        actor:
          event.actor === null
            ? null
            : { id: event.actor.id, name: event.actor.name, roles: [...event.actor.roles] },
        entityType: row.entity_type,
        clientId: row.client_id,
        clientMrn: row.client_mrn,
      });
    }
    // **Reading the trail is itself recorded**, once for the request rather
    // than once for every line: the feed names no single record, and a row per
    // line would double the trail every time somebody scrolled it. The details
    // are the filters, which are opaque ids and the trail's own words.
    await logAction(
      db,
      'audit.activity',
      { type: 'audit_log', id: c.get('requestId'), clientId: clientId ?? null },
      {
        shown: String(events.length),
        ...(actorId ? { actorId } : {}),
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(clientId ? { clientId } : {}),
      },
    );
    const last = page[page.length - 1];
    return c.json(
      ActivityResponse.parse({ events, nextBefore: hasMore && last ? last.id : null, hasMore }),
    );
  });

  api.get('/api/audit/filters', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(actor, { type: 'audit.activity' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const [people, vocabulary] = await Promise.all([
      db.query<{ id: string; display_name: string }>(ACTORS_SQL),
      db.query<{ entity_type: string; action: string }>(VOCABULARY_SQL),
    ]);
    const entityTypes = [...new Set(vocabulary.rows.map((row) => row.entity_type))].sort();
    const actions = [...new Set(vocabulary.rows.map((row) => row.action))].sort();
    return c.json(
      ActivityFilters.parse({
        actors: people.rows.map((row) => ({ id: row.id, name: row.display_name })),
        entityTypes,
        actions,
      }),
    );
  });

  api.get('/api/audit/access-report', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const query = ClientQuery.safeParse({ clientId: c.req.query('clientId') });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const clientId = query.data.clientId;
    if (!canActor(actor, { type: 'audit.read', clientId }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // The same door the record timeline holds: another practice's client does
    // not exist, and an erased record opens for the owner and the lead
    // practitioner alone, with a typed reason.
    const found = await db.query<{ status: string; mrn: string }>(
      "select status, mrn from client where id = $1 and ($2::boolean or status <> 'erased')",
      [clientId, hasRole(actor, 'owner', 'lead_practitioner')],
    );
    const row = found.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (row.status === 'erased' && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }

    const { rows } = await db.query<{
      actor_id: string | null;
      name: string | null;
      roles: string | null;
      reads: number;
      first_at: Date;
      last_at: Date;
      entity_types: string[];
    }>(ACCESS_REPORT_SQL, [clientId]);
    const readers: AccessReportReader[] = rows.map((reader) => ({
      actorId: reader.actor_id,
      name: reader.name,
      roles: reader.roles ? reader.roles.split(',') : [],
      reads: reader.reads,
      firstAt: reader.first_at.toISOString(),
      lastAt: reader.last_at.toISOString(),
      entityTypes: [...reader.entity_types].sort(),
    }));
    // Asking who has read a record is itself a read of that record.
    await logRead(db, 'client', clientId, clientId);
    return c.json(
      AccessReportResponse.parse({
        client: { id: clientId, mrn: row.mrn },
        readers,
        generatedAt: now().toISOString(),
      }),
    );
  });
}
