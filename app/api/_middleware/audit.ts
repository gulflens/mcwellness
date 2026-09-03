import type { Db } from './request-context';

/**
 * Records that the current request read a record (docs/SPEC/audit.md
 * section 5, layer 2). Every context column comes from the transaction's
 * own settings in SQL, so a caller cannot attribute a read to someone else;
 * the insert policy on audit_log and the chain trigger do the rest.
 */
export async function logRead(
  db: Db,
  entityType: string,
  entityId: string,
  clientId: string | null,
): Promise<void> {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, reason, request_id) values (' +
      "app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), 'read', $1, $2, $3, " +
      "nullif(current_setting('app.reason', true), ''), " +
      "nullif(current_setting('app.request_id', true), '')::uuid)",
    [entityType, entityId, clientId],
  );
}

/** The same, for a list: one `read` row per record, written in one statement. */
export async function logReads(
  db: Db,
  entityType: string,
  entries: readonly { id: string; clientId: string | null }[],
  action: 'read' | 'list' = 'read',
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, reason, request_id) ' +
      "select app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), $4, $1, e.id, e.client_id, " +
      "nullif(current_setting('app.reason', true), ''), " +
      "nullif(current_setting('app.request_id', true), '')::uuid " +
      'from unnest($2::uuid[], $3::uuid[]) as e(id, client_id)',
    [entityType, entries.map((e) => e.id), entries.map((e) => e.clientId), action],
  );
}

/**
 * Records a sensitive act that is neither a read nor a row change
 * (docs/SPEC/audit.md section 5).
 *
 * `logRead` and `logReads` above write `read` and `list`; the row triggers
 * write `insert`, `update` and `delete` (080_audit_triggers.sql). Sending a
 * family their invoice is none of those — nothing was read into the response
 * and no row moved — but it is squarely what the spec means by a sensitive
 * action: the practice put a client's document in front of somebody outside
 * it. Asked for as a shared helper by the billing stream
 * (`docs/CHANGE-REQUESTS/billing-04.md` request 4), which had written one in
 * its own folder with a note saying it did not belong there.
 *
 * The shape is `logRead`'s, deliberately: every context column — the actor,
 * the roles, the reason, the request id — comes off the transaction's own
 * settings inside the SQL, so a caller cannot attribute an action to somebody
 * else. A helper that accepted them would be a helper that could be lied to.
 *
 * **What may go in `details`, and why the rule is strict.** The ids and the
 * shape of the act: a contact's id, a channel. **Never a telephone number,
 * never an email address, never free text a person wrote.** Two reasons, and
 * the second is the one that binds:
 *
 * - the trail is kept five years and read by people who have no business
 *   knowing how to reach a family (docs/SPEC/audit.md section 8), and an id
 *   answers "who was it sent to" for anyone entitled to ask;
 * - **nothing redacts this.** `app.audit_redact` is reached only from
 *   `app.audit_row`, the trigger on the audited tables, so a row written
 *   straight into `audit_log` — as this does, as `logRead` does — carries
 *   exactly what the caller passed. The dropped-key list and the free-text
 *   truncation that would catch a number in a column do not run here. The
 *   discipline is the caller's, and there is no second chance at it: the
 *   trail is append-only.
 */
export async function logAction(
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
