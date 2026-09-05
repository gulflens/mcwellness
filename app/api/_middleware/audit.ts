import { EMIRATES_ID_DIGITS } from '../../../domain/shared/emirates-id';
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
 * A uuid, wherever in a value it sits: eight hexadecimal characters, then
 * three groups of four, then twelve, hyphens between, and no further
 * hexadecimal character crowding either end. Every id this platform writes
 * has that shape, and an id is not a way to ring anybody, so one is set aside
 * before a value is read for numbers at all.
 *
 * Set aside rather than skipped: a value may be a sentence with an id inside
 * it and a telephone number beside that, and the number must still be
 * refused. Each id is replaced by a space, which also keeps the digits either
 * side of it from running together into a number neither of them is.
 */
const UUID_ANYWHERE =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

/**
 * Every run in a value that could be a telephone number written out: an
 * optional plus, then digits with the spaces, hyphens and brackets people put
 * between them, ending on a digit — and **standing on its own**, with no
 * letter or digit pressed against either end. Anything else — a letter, a
 * comma, a full stop, a colon — ends the run.
 *
 * Those boundaries are the whole trick, and they are what keeps an id out of
 * this. `00000000-0000-4000-8000-0000000000e6` is one run of thirty-four
 * digits, not a phone number of nine; `INV-000012` is a run of six;
 * `2026-09-04` is a run of eight starting with a 2. A number is judged on the
 * run as a whole, never on a window inside it.
 *
 * **Standing on its own is the half this file was missing** (round 30;
 * `docs/CHANGE-REQUESTS/assessment-01.md` items 3 and 4). The comment above
 * reasoned about a seeded id, whose thirty-two characters are all digits and
 * make one run far too long to be a number. A random id is not: its
 * hexadecimal letters cut the digits into shorter runs, and about one id in
 * eighty holds a run of nine to twelve digits beginning with a nought —
 * `eea04325-2317-4f6b-ada3-dd3a345ade00` on `04325-2317-4`. Judged on those
 * runs the id read as a telephone number, `logAction` threw, and the request
 * that carried the id rolled back.
 *
 * The two rules are both needed and neither is the other's spare. Setting the
 * uuid aside alone would still leave a hexadecimal-looking token that is not
 * quite a uuid; standing on its own alone would still refuse
 * `abcdefab-0234-4567-8901-abcdefabcdef`, whose twelve digits sit between two
 * hyphens with no letter beside them at all.
 */
const NUMERIC_RUNS = /(?<![0-9A-Za-z])\+?\d(?:[\d\s\-()]*\d)?(?![0-9A-Za-z])/g;

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

/**
 * Whether a run of that kind reads as an Emirates ID: fifteen digits
 * beginning 784, whatever a person put between them
 * (`domain/shared/emirates-id.ts` is where that shape is defined and where
 * the practice's own normaliser reads it).
 *
 * The rule this helper enforces names three things that may not reach an
 * audit detail — a telephone number, an Emirates ID and a name
 * (`.claude/rules/compliance.md`, `docs/SPEC/audit.md` section 8). Only the
 * first was ever checked. An Emirates ID is fifteen digits, so the telephone
 * shapes above pass straight over it, and it is exactly the value the rest of
 * the platform refuses to hold in clear at all. A name cannot be recognised
 * from its characters and is not attempted here.
 *
 * A plus rules it out: a number written for dialling is not an identity card.
 * Nothing else fifteen digits long in this codebase begins 784 — a tax
 * registration number does not — so the check is narrow enough to leave a
 * figure alone.
 */
function readsAsEmiratesId(run: string): boolean {
  const digits = run.replace(/\D/g, '');
  return !run.startsWith('+') && digits.length === EMIRATES_ID_DIGITS && digits.startsWith('784');
}

/** An email address: something, an at sign, a dotted host, no spaces in either. */
const EMAIL_ANYWHERE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * The rule `logAction` documents, enforced rather than trusted.
 *
 * Throws on the first value that reads as a way to reach a person, or as the
 * number on their identity card. The offending value never reaches the
 * message — putting it there would write the number into a log line, which is
 * the thing being prevented — so the key is named instead, which is what a
 * route's author needs to fix it.
 *
 * An id is not either of those, and from round 30 the check says so: a uuid
 * is set aside before the value is read, and a run of digits counts only
 * where it stands on its own. What it refused before was a document id one
 * time in eighty, which is a refusal nobody could act on
 * (`docs/CHANGE-REQUESTS/assessment-01.md` items 3 and 4).
 *
 * Exported for its own test and for any later helper that writes `new_values`
 * from a route; it is not something a route calls directly.
 */
export function refuseContactDetails(details: Record<string, string>): void {
  for (const [key, value] of Object.entries(details)) {
    for (const run of value.replace(UUID_ANYWHERE, ' ').match(NUMERIC_RUNS) ?? []) {
      if (readsAsTelephone(run)) {
        throw new Error(
          `The audit details may not carry a telephone number; "${key}" does. ` +
            "Record the contact's id instead (docs/SPEC/audit.md section 8).",
        );
      }
      if (readsAsEmiratesId(run)) {
        throw new Error(
          `The audit details may not carry an Emirates ID; "${key}" does. ` +
            "Record the client's id instead (docs/SPEC/audit.md section 8).",
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
 *   telephone number, an Emirates ID or an email address
 *   (`refuseContactDetails` above). It
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
