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
 * Every run in a value that could be a telephone number written out: an
 * optional plus, then digits with the spaces, hyphens and brackets people put
 * between them. Anything else — a letter, a comma, a full stop, a colon —
 * ends the run.
 *
 * That boundary is the whole trick, and it is what keeps an id out of this.
 * `00000000-0000-4000-8000-0000000000e6` is one run of thirty-four digits, not
 * a phone number of nine; `INV-000012` is a run of six; `2026-09-04` is a run
 * of eight starting with a 2. A number is judged on the run as a whole, never
 * on a window inside it.
 */
const NUMERIC_RUNS = /\+?\d[\d\s\-()]*/g;

/**
 * Whether a run of that kind reads as a way to ring somebody.
 *
 * Two shapes, because a number reaches an audit detail written both ways:
 *
 * - **International**, with the plus: eight to fifteen digits, the first not a
 *   zero. That is E.164's own range, and it catches `+971500000001` and
 *   `+971 50 000 0001` alike.
 * - **Local or bare**, without it: nine to twelve digits beginning `971` or
 *   `0` — `0501234567` as a person writes it on a form, `971501234567` as a
 *   system strips it. The prefixes are what make this narrow: nine to twelve
 *   digits beginning with anything else is a reference, an amount or a date,
 *   and is left alone.
 *
 * `04 123 4567` is a Dubai landline and `000000012` is a padded reference,
 * and stripped of their punctuation the two are the same nine digits. Both are
 * refused. That is the safe direction and it costs nothing: a reference is
 * written the way it is printed — `INV-000012` — where a landline written bare
 * would sit in the trail for its five years.
 */
function readsAsTelephone(run: string): boolean {
  const digits = run.replace(/\D/g, '');
  if (run.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
  }
  return (
    digits.length >= 9 &&
    digits.length <= 12 &&
    (digits.startsWith('971') || digits.startsWith('0'))
  );
}

/** An email address: something, an at sign, a dotted host, no spaces in either. */
const EMAIL_ANYWHERE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * The rule `logAction` documents, enforced rather than trusted.
 *
 * Throws on the first value that reads as a way to reach a person. The
 * offending value never reaches the message — putting it there would write
 * the number into a log line, which is the thing being prevented — so the key
 * is named instead, which is what a route's author needs to fix it.
 *
 * Exported for its own test and for any later helper that writes `new_values`
 * from a route; it is not something a route calls directly.
 */
export function refuseContactDetails(details: Record<string, string>): void {
  for (const [key, value] of Object.entries(details)) {
    for (const run of value.match(NUMERIC_RUNS) ?? []) {
      if (readsAsTelephone(run)) {
        throw new Error(
          `The audit details may not carry a telephone number; "${key}" does. ` +
            "Record the contact's id instead (docs/SPEC/audit.md section 8).",
        );
      }
    }
    if (EMAIL_ANYWHERE.test(value)) {
      throw new Error(
        `The audit details may not carry an email address; "${key}" does. ` +
          "Record the contact's id instead (docs/SPEC/audit.md section 8).",
      );
    }
  }
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
 * never an email address, never free text a person wrote.** The trail is kept
 * five years and read by people who have no business knowing how to reach a
 * family (docs/SPEC/audit.md section 8), and an id answers "who was it sent
 * to" for anyone entitled to ask.
 *
 * **Two things now hold that rule, where once it held only itself.**
 *
 * - This helper refuses, before the insert, any value that reads as an E.164
 *   telephone number or an email address (`refuseContactDetails` above). It
 *   throws rather than dropping the value quietly: a route that means to
 *   record who a document went to has passed the wrong thing, and finding out
 *   at once is better than a trail that silently says less than its author
 *   thought.
 * - Beneath it, `app.audit_chain_link()` redacts `old_values` and
 *   `new_values` on the way in, whichever path wrote the row (migration 908).
 *   Until that migration `app.audit_redact` ran from `app.audit_row` alone —
 *   the trigger on the audited tables — so a row written straight into
 *   `audit_log`, as this does, carried exactly what the caller passed. It no
 *   longer does: the dropped-key list and the free-text truncation reach
 *   here too.
 *
 * Neither makes the other unnecessary. The database drops the keys it knows
 * and truncates what is long; a telephone number under any other key is
 * short and unremarkable, and this is what catches it. And the trail is
 * append-only, so there is no second chance at either.
 */
export async function logAction(
  db: Db,
  action: string,
  entity: { type: string; id: string; clientId: string | null },
  details: Record<string, string>,
): Promise<void> {
  refuseContactDetails(details);
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
