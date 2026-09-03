import { z } from 'zod';
import { clientDocumentKey } from '../../../domain/shared';
import type { ServerStorageProvider } from '../_middleware/storage';
import type { Db } from '../_middleware/request-context';

/**
 * The second attempt at removing the bytes an erasure left behind.
 *
 * The request that performed the erasure removes them first, from the
 * after-commit hook (app/api/clients/erasure.ts, docs/SEAMS.md). That hook has
 * no database — by the time it runs the connection is back in the pool — so it
 * cannot record which keys it managed and which it did not. It does not need
 * to: what it could not remove is still in the store, and this asks the store
 * rather than a bookkeeping column that could be wrong.
 *
 * So the sweep is: for every erasure request with keys still pending, ask the
 * store whether each object is there. Gone, and it is struck off. Still there,
 * and it is deleted and then struck off. Still there and undeletable — a
 * bucket that is down — and it stays pending for the next run. When the list
 * empties, `files_cleared_at` is stamped and the request is finished with.
 *
 * **Why a worklist and not a retry inside the request.** A retry loop inside
 * the request would hold a household's erasure open while a vendor was down,
 * and would report success or failure to somebody who can do nothing about
 * either. The erasure itself is committed and complete; what is left is
 * housekeeping the practice should be able to see the end of, which is what
 * `files_cleared_at` is for.
 *
 * This is the job's body rather than the job. `jobs/` is not this stream's to
 * write in (docs/SPEC/OWNERSHIP.md), so the entry point that calls this — and
 * the `pnpm` script that runs it — are asked for in
 * docs/CHANGE-REQUESTS/client-record-04.md, with the exact file. Everything
 * that decides anything is here, where it is owned and tested.
 */

const PendingKeys = z.array(z.object({ id: z.string(), storageKey: z.string() })).catch([]);

/**
 * Whether this key is one this erasure is entitled to delete.
 *
 * The worklist is a jsonb column, and this job runs as the owner with row
 * security behind it, so "delete whatever the column says" is a delete of
 * anything in the store that a bad write — or a bug in a future version of
 * `app.erase_client` — could name. The key shape is the check: a client
 * document's key is `tenant/<t>/client/<c>/<d>` and nothing else
 * (docs/SEAMS.md), so the tenant and the client in the key are rebuilt from
 * the request's own row and compared. A key that does not match is left alone
 * and reported, never removed.
 */
function belongsToRequest(
  key: string,
  request: { tenantId: string; clientId: string },
  documentId: string,
): boolean {
  try {
    return key === clientDocumentKey(request.tenantId, request.clientId, documentId);
  } catch {
    // clientDocumentKey refuses a key it would not have built; so does this.
    return false;
  }
}

export type SweptRequest = {
  erasureRequestId: string;
  /** Keys the store no longer holds, whether this run removed them or an earlier one did. */
  cleared: number;
  /** Keys the store still holds and would not give up. They stay pending. */
  stillPending: number;
  /** Keys whose shape did not name this request's own household. Never deleted. */
  notOurs: number;
};

/**
 * One pass. `db` is any handle that can query — the job opens its own, since
 * this never runs inside a request.
 *
 * Nothing here throws for a store that refuses: a sweep that fell over on the
 * first unreachable key would leave the rest of the practice's erasures
 * unswept, which is the opposite of what it is for.
 */
export async function sweepErasureFiles(
  db: Db,
  storage: ServerStorageProvider,
): Promise<SweptRequest[]> {
  const { rows } = await db.query<{
    id: string;
    tenant_id: string;
    client_id: string;
    storage_keys_pending: unknown;
  }>(
    'select id, tenant_id, client_id, storage_keys_pending from erasure_request ' +
      'where jsonb_array_length(storage_keys_pending) > 0 order by performed_at',
  );

  const swept: SweptRequest[] = [];
  for (const row of rows) {
    const pending = PendingKeys.parse(row.storage_keys_pending);
    const request = { tenantId: row.tenant_id, clientId: row.client_id };
    const left: { id: string; storageKey: string }[] = [];
    let refused = 0;
    for (const entry of pending) {
      if (!belongsToRequest(entry.storageKey, request, entry.id)) {
        // Not this household's file. It stays on the list, untouched, and the
        // count says so: a sweep that quietly skipped it would look identical
        // to one that had nothing to do.
        refused += 1;
        left.push(entry);
        continue;
      }
      try {
        if (await storage.exists(entry.storageKey)) {
          await storage.delete(entry.storageKey);
        }
      } catch {
        // The store answered no, or did not answer. Neither is this run's to
        // resolve, and neither is worth a message naming a key.
        left.push(entry);
        continue;
      }
      // Deliberately not checking `exists` again: the delete returned, and a
      // store that says a thing is gone is the only authority there is on it.
    }

    // The number the confirmation went to has done its work once the letter
    // has been handed over and the files are confirmed clear, so it goes:
    // that is the whole of its purpose and the whole of its retention
    // (migration 105). Both conditions, and in the same statement that
    // empties the list, so nothing can clear one without the other.
    await db.query(
      'update erasure_request set storage_keys_pending = $1::jsonb, ' +
        'files_cleared_at = case when jsonb_array_length($1::jsonb) = 0 then now() else null end, ' +
        'requested_by_phone = case when jsonb_array_length($1::jsonb) = 0 and letter_sent_at is not null ' +
        'then null else requested_by_phone end ' +
        'where id = $2',
      [JSON.stringify(left), row.id],
    );
    swept.push({
      erasureRequestId: row.id,
      cleared: pending.length - left.length,
      stillPending: left.length,
      notOurs: refused,
    });
  }
  return swept;
}

/** What the job prints. Counts and request ids; never a key, never a person. */
export function describeSweep(swept: readonly SweptRequest[]): string {
  if (swept.length === 0) return 'No erasure has files left to remove.';
  const cleared = swept.reduce((total, one) => total + one.cleared, 0);
  const left = swept.reduce((total, one) => total + one.stillPending, 0);
  const notOurs = swept.reduce((total, one) => total + one.notOurs, 0);
  return (
    `${swept.length} erasure ${swept.length === 1 ? 'request' : 'requests'} swept: ` +
    `${cleared} ${cleared === 1 ? 'file' : 'files'} now gone, ${left} still in the store` +
    (notOurs > 0
      ? `, ${notOurs} left alone for naming a household this request is not about.`
      : '.')
  );
}
