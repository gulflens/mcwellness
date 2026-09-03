import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ServerStorageProvider } from '../_middleware/storage';
import type { Db } from '../_middleware/request-context';

/**
 * What withdrawing `photo_video` does to the photographs already taken
 * (docs/SPEC/client-record.md section 7: withdrawal takes effect immediately).
 *
 * A setup photo exists only because a household said it could
 * (docs/SPEC/00-data-model.md section 4: `session.setup_photo_document_id`
 * "requires active photo_video consent"). Taking that permission back and
 * leaving the pictures on file would make the withdrawal a label rather than
 * an act, so the bytes go, through the same seam every other file goes through
 * (`storage.delete`, docs/SEAMS.md) — the same call against a bucket or a
 * folder, and no vendor needed on a laptop.
 *
 * **Two limits, both deliberate, both written down rather than worked around.**
 *
 * 1. The `document` row stays. The API role holds no delete grant on
 *    `document` (090_grants_and_rls.sql) — client data is superseded, closed
 *    or erased, never deleted by this role — and `retired_at`, the one column
 *    that could say "these bytes are gone", is constrained to consent wording
 *    (migration 902's `document_consent_text_retired_is_a_wording`). So the
 *    row goes on naming a key with nothing behind it: `exists` answers false
 *    and a signed link 404s, which is honest and detectable rather than
 *    silent, but it is not the row saying so.
 *    docs/CHANGE-REQUESTS/client-record-03.md asks for the column that would
 *    let it.
 * 2. Only setup photos, and only when no other `photo_video` consent is still
 *    active. A household may hold more than one — a second guardian's, say —
 *    and one person withdrawing does not end a permission somebody else is
 *    still giving.
 *
 * An audit row is written for each photo before its bytes are removed, through
 * `auditDocumentRead`: this is the last moment anybody could have opened it,
 * and the trail should show what the withdrawal reached. The reason the
 * withdrawal carried is already on the transaction, so the rows carry it too.
 *
 * **Why this is two functions.** Deleting bytes is not a thing a transaction
 * can take back. The first half touches only the database — the consents it
 * consults, the audit rows it writes — and hands back the keys; the second
 * half removes the bytes and is called by the route as its **last act**, after
 * every database statement the request will make. So nothing this worktree
 * writes can now roll the withdrawal back after the photographs are gone,
 * which is exactly what a mid-route failure used to do: the consent came back
 * to life and the family's photographs did not.
 *
 * What that ordering still cannot reach is the commit itself. The transaction
 * is opened and closed by app/api/_middleware/request-context.ts, which is the
 * shared zone and offers no after-commit hook, so a connection that dies
 * between the last statement and `commit` would leave the same mismatch in a
 * far narrower window. docs/CHANGE-REQUESTS/client-record-03.md (CR-12) asks
 * the trunk for that hook rather than this stream inventing one; until then
 * `removePhotoBytes` never throws, so a store that refuses cannot turn a
 * completed withdrawal into a 500 and undo it.
 */
export async function photoEvidenceToRemove(
  db: Db,
  storage: ServerStorageProvider | undefined,
  clientId: string,
): Promise<{ keys: string[]; stillOnFile: number }> {
  const stillPermitted = await db.query<{ n: string }>(
    "select count(*)::text as n from consent where client_id = $1 and purpose = 'photo_video' " +
      "and status = 'active'",
    [clientId],
  );
  if (Number(stillPermitted.rows[0]?.n ?? '0') > 0) {
    return { keys: [], stillOnFile: 0 };
  }

  const { rows } = await db.query<{ id: string; storage_key: string }>(
    "select id, storage_key from document where client_id = $1 and kind = 'setup_photo'",
    [clientId],
  );
  if (rows.length === 0) return { keys: [], stillOnFile: 0 };

  // No store configured is not a reason to pretend: the count comes back so
  // the route can say the photographs are still out there rather than let the
  // withdrawal read as having taken them.
  if (!storage) return { keys: [], stillOnFile: rows.length };

  for (const row of rows) {
    await auditDocumentRead(db, { id: row.id, clientId });
  }
  return { keys: rows.map((row) => row.storage_key), stillOnFile: 0 };
}

/**
 * The bytes themselves, removed after every database statement is done
 * (see above). Returns how many actually went.
 *
 * It never throws, and that is the point rather than laziness: a store that
 * refuses one key must not become a 500, because a 500 is what makes
 * request-context roll the withdrawal back — leaving the consent standing and
 * the photographs, or some of them, gone. A key that could not be removed
 * comes back in the count instead, and the console says so.
 */
export async function removePhotoBytes(
  storage: ServerStorageProvider | undefined,
  keys: readonly string[],
): Promise<number> {
  if (!storage) return 0;
  let removed = 0;
  for (const key of keys) {
    try {
      await storage.delete(key);
      removed += 1;
    } catch {
      // Counted as still on file; the response says how many.
    }
  }
  return removed;
}
