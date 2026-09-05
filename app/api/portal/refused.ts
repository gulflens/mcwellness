import type { Db } from '../_middleware/request-context';

/**
 * Records that this request tried to reach a specific row and was turned away
 * — a 403, or a 404 for a row that exists rather than for an id that never did
 * (docs/SPEC/client-portal.md section 7, which asks the portal to answer "as
 * the client-record routes do").
 *
 * The same insert `app/api/clients/refused.ts` writes, local to this module
 * for the reason that one is local to its own: nothing shared owns it yet, and
 * a helper copied twice is cheaper than a shared-zone change nobody asked for.
 * Every context column comes off the transaction's own settings in the SQL, so
 * a caller cannot attribute a refusal to somebody else.
 *
 * A refusal is only ever written where a row was actually named. A household
 * asking for a client that is not theirs never reaches a row at all — the
 * household is resolved from the actor stamp, so the id simply is not in it —
 * and writing an audit row there would let anybody signed in fill the trail
 * with uuids of their choosing.
 */
export async function logPortalRefusal(
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
