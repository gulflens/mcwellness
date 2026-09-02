import type { Db } from '../_middleware/request-context';

/**
 * Records a refused check-in on the audit trail (docs/SPEC/session-capture.md
 * section 8: "every block reason" is logged). Same insert shape as
 * app/api/_middleware/audit.ts's logRead, for action 'refused': the reason
 * column carries the gate's own block reasons, not the caller's X-Reason
 * header, so logRead's version does not fit here. A local helper rather than
 * an edit to that shared file (coordinator's direction).
 *
 * Written before the route returns its refusal response; the request's
 * transaction commits normally on a 4xx (only a thrown error or a 5xx rolls
 * it back — see app/api/_middleware/request-context.ts), so this row is not
 * undone by the refusal it records.
 */
export async function logRefusal(
  db: Db,
  entityType: string,
  entityId: string,
  clientId: string,
  reasons: readonly string[],
): Promise<void> {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, reason, request_id) values (' +
      "app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), 'refused', $1, $2, $3, $4, " +
      "nullif(current_setting('app.request_id', true), '')::uuid)",
    [entityType, entityId, clientId, reasons.join(', ')],
  );
}
