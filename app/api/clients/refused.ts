import type { Db } from '../_middleware/request-context';

/**
 * Records that the current request tried to reach a specific row and was
 * turned away — a 403 or a 404 for a row that exists, as opposed to a 404 for
 * an id that never did (docs/SPEC/client-record.md section 9: every write
 * goes through triggers, every sensitive read is logged; a refused attempt is
 * the same class of fact). Same insert shape as logRead
 * (app/api/_middleware/audit.ts), action 'refused', local to these routes
 * because no other module needs it yet.
 *
 * `entityId` names the row that was refused. Where there is no such row — a
 * collection action, where nothing can be named — the caller passes a fresh
 * `randomUUID()`, never the request id: `x-request-id` comes from the caller,
 * and an entity taken from it would let any signed-in actor write an audit row
 * pointing at a uuid of their choosing. The request id reaches `request_id`
 * from the transaction's own setting either way.
 */
export async function logRefused(
  db: Db,
  entityType: string,
  entityId: string,
  clientId: string | null,
): Promise<void> {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, reason, request_id) values (' +
      "app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), 'refused', $1, $2, $3, " +
      "nullif(current_setting('app.reason', true), ''), " +
      "nullif(current_setting('app.request_id', true), '')::uuid)",
    [entityType, entityId, clientId],
  );
}
