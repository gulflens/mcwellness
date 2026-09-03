import { logRead } from '../audit';
import type { Db } from '../request-context';

/**
 * Records that this request opened a document, before the link that opens it
 * is signed (`docs/SPEC/audit.md` section 5, `docs/SEAMS.md`).
 *
 * Signing is where the trail has to be written, and it is not obvious why.
 * The bytes are fetched twice over in this platform and neither fetch is a
 * place the trail can be kept:
 *
 * - The local implementation serves its own `GET /api/storage/:key`, which
 *   sits ahead of the authentication fence because the signature in the link
 *   is its whole authorisation. There is no actor on that request, so a row
 *   written there could name nobody.
 * - The Supabase implementation hands out a URL to the vendor. That fetch
 *   never reaches this API at all, so there is nothing to write from.
 *
 * What both have in common is the moment the URL is issued: a signed-in
 * actor, a request id, and a document row in hand. So the rule is the seam's
 * rather than a route's — **every route that signs a link calls this first**
 * — and it is recorded in `docs/SEAMS.md` and
 * `docs/CHANGE-REQUESTS/trunk-notes.md` so the streams writing those routes
 * inherit it rather than each deciding.
 *
 * A signed link is a read whether or not the bytes are ever fetched: handing
 * someone the means to open a client's file is the act worth recording, and
 * an issued link that goes unused is a read that did not complete, not a read
 * that did not happen.
 *
 * The actor, the roles, the reason and the request id are deliberately NOT
 * parameters. Every one of them is already on the transaction, stamped by
 * request-context from the verified token, and `logRead` takes them from
 * `current_setting` in the SQL itself — so no caller can attribute a read to
 * someone else by passing a different actor. A helper that accepted them
 * would be a helper that could be lied to.
 *
 * `clientId` travels because the audit trail denormalises it
 * (`docs/SPEC/00-data-model.md` section 7): a practice document — consent
 * wording, a certificate — has none, and null is the honest answer there
 * rather than an invented one.
 */
export async function auditDocumentRead(
  db: Db,
  document: { id: string; clientId: string | null },
): Promise<void> {
  await logRead(db, 'document', document.id, document.clientId);
}
