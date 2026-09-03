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
 */
export async function retirePhotoEvidence(
  db: Db,
  storage: ServerStorageProvider | undefined,
  clientId: string,
): Promise<{ removed: number; unreachable: number }> {
  const stillPermitted = await db.query<{ n: string }>(
    "select count(*)::text as n from consent where client_id = $1 and purpose = 'photo_video' " +
      "and status = 'active'",
    [clientId],
  );
  if (Number(stillPermitted.rows[0]?.n ?? '0') > 0) {
    return { removed: 0, unreachable: 0 };
  }

  const { rows } = await db.query<{ id: string; storage_key: string }>(
    "select id, storage_key from document where client_id = $1 and kind = 'setup_photo'",
    [clientId],
  );
  if (rows.length === 0) return { removed: 0, unreachable: 0 };

  // No store configured is not a reason to pretend: the count comes back so
  // the caller knows the bytes are still out there.
  if (!storage) return { removed: 0, unreachable: rows.length };

  let removed = 0;
  for (const row of rows) {
    await auditDocumentRead(db, { id: row.id, clientId });
    await storage.delete(row.storage_key);
    removed += 1;
  }
  return { removed, unreachable: 0 };
}
