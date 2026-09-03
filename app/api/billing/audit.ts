import type { Db } from '../_middleware/request-context';

/**
 * Recording an act that is not a read and not a row change.
 *
 * `app/api/_middleware/audit.ts` writes `read` and `list`; the row triggers
 * write `insert`, `update` and `delete` (080_audit_triggers.sql). Sending a
 * family their invoice is none of those — nothing was read into this response
 * and no row moved — but it is exactly the kind of act
 * `docs/SPEC/audit.md` means by a sensitive one: the practice put a client's
 * financial document in front of somebody outside it.
 *
 * The shape is `logRead`'s, deliberately: every context column comes off the
 * transaction's own settings in the SQL, so a caller cannot attribute an action
 * to somebody else. `docs/CHANGE-REQUESTS/billing-04.md` asks for this to move
 * into the shared middleware as a general `logAction`, which is where it
 * belongs — it is only here because `app/api/_middleware/**` is the shared zone.
 *
 * **What may go in `details`.** The contact's id, and the channel. Never the
 * telephone number and never the email address: the trail is kept for five
 * years and read by people who have no business knowing how to reach a family
 * (docs/SPEC/audit.md section 8). An id is enough to answer "who was it sent
 * to", and the contact record answers the rest to whoever may read it.
 */
export async function logSensitiveAction(
  db: Db,
  action: string,
  entity: { type: string; id: string; clientId: string | null },
  details: Record<string, string>,
): Promise<void> {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, new_values, reason, request_id) values (' +
      "app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), $1, $2, $3, $4, $5::jsonb, " +
      "nullif(current_setting('app.reason', true), ''), " +
      "nullif(current_setting('app.request_id', true), '')::uuid)",
    [action, entity.type, entity.id, entity.clientId, JSON.stringify(details)],
  );
}
