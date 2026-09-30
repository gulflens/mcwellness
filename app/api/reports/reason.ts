import type { Db } from '../_middleware/request-context';

/**
 * The reason a brain-map save carries (`X-Reason`), as the audit trail will
 * record it.
 *
 * **The stamped reason is the one checked.** The fence cleans the header
 * (control and invisible characters out, spaces collapsed, cut at 500) and
 * stamps what is left on the transaction as `app.reason`, which is what the
 * audit trigger writes beside the row. This reads that stamp back rather than
 * the raw header, so a header of twelve zero-width spaces, which cleans to
 * nothing, is refused, and what is judged worth reading is exactly what the
 * trail keeps.
 *
 * **What counts as a reason** is the books' rule and the billing routes'
 * (`app/api/accounting/schema.ts` `isRealText`): eight characters, and not one
 * character repeated. Copied rather than imported, as accounting copied it
 * from billing: a stream does not reach into another stream's paths
 * (docs/SPEC/OWNERSHIP.md).
 */

const MINIMUM_REASON = 8;

function isRealText(value: string): boolean {
  const withoutSpaces = value.replace(/\s/g, '');
  return (
    value.length >= MINIMUM_REASON &&
    withoutSpaces.length >= MINIMUM_REASON &&
    new Set(withoutSpaces).size > 1
  );
}

/** The request's stamped reason when it is one worth reading, or null. */
export async function requiredReason(db: Db): Promise<string | null> {
  const found = await db.query<{ reason: string | null }>(
    "select current_setting('app.reason', true) as reason",
  );
  const reason = found.rows[0]?.reason ?? '';
  return isRealText(reason) ? reason : null;
}
