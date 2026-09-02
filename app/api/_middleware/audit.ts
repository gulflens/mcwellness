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
