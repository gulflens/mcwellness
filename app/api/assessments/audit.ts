import type { Db } from '../_middleware/request-context';

/**
 * Records a refused attempt on a measurement (docs/SPEC/assessment.md section
 * 8: "every refusal is written before the answer, as the check-in route writes
 * its own").
 *
 * The same insert shape as `logRead` in app/api/_middleware/audit.ts, for
 * action `refused`: the `reason` column carries the gate's own reasons rather
 * than the caller's `X-Reason` header, so that helper does not fit. A local
 * copy rather than an edit of the shared file, exactly as
 * app/api/sessions/audit.ts is — a stream does not edit the trunk's
 * (docs/SPEC/OWNERSHIP.md).
 *
 * `clientId` is null wherever nothing has yet been verified to belong to a
 * real client of this practice: a caller's own claimed id is not proof of
 * anything, and a refusal that filed itself against whatever id was posted
 * would let anyone write rows onto anyone's trail.
 *
 * Written before the route returns; the request's transaction commits normally
 * on a 4xx (only a thrown error or a 5xx rolls it back), so the row is not
 * undone by the refusal it records.
 */
export async function logRefusal(
  db: Db,
  entityType: string,
  entityId: string,
  clientId: string | null,
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
