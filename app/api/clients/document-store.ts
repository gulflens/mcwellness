import { randomUUID } from 'node:crypto';
import {
  bytesMatchMimeType,
  computeRetentionUntil,
  isConsentEvidenceKind,
} from '../../../domain/client';
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  clientDocumentKey,
  isoDateIn,
  practiceDocumentKey,
  type Actor,
} from '../../../domain/shared';
// By its own path: the seam's retention arithmetic is not in the shared
// barrel, and domain/shared is the trunk's to export from, not this stream's
// (docs/SPEC/OWNERSHIP.md). Browser-safe either way — it is the same file
// clientDocumentKey comes from.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import type { ServerStorageProvider } from '../_middleware/storage';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { Db } from '../_middleware/request-context';
import { MAX_DOCUMENT_BYTES, type DocumentBytes } from './record-schema';

/**
 * Putting a file into the practice's store and filing the row that names it
 * (docs/SEAMS.md, docs/CHANGE-REQUESTS/trunk-notes.md round 14 item 3). One
 * place, because the consent route and the Documents tab file documents for
 * different reasons and must not each invent the order of operations.
 *
 * The order is the seam's rule and it is deliberate: **bytes first, row
 * second**. A row written before its bytes points at nothing for as long as
 * the upload takes and forever if it fails; bytes written before their row are
 * an orphan in a bucket, which costs storage and tells nobody anything. Both
 * happen inside the request's own transaction (app/api/_middleware/
 * request-context.ts), so a refusal after the put rolls the row back and
 * leaves only that orphan.
 *
 * Everything a route may get wrong is refused here rather than in each route:
 * no store configured, bytes that are not what they claim to be, a file over
 * the cap the API's own body limit implies.
 */

/** The practice's time zone: a client document's retention is counted in the practice's day. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

export type FileDocumentRefusal =
  'storage_unavailable' | 'bytes_do_not_match_type' | 'document_too_large';

export type FiledDocument = {
  id: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
};

/**
 * Decodes `bytesBase64` and checks it is what it says it is. Kept apart from
 * the write so a route can refuse before it has touched the store at all.
 */
export function decodeDocumentBytes(
  file: DocumentBytes,
): { ok: true; bytes: Uint8Array } | { ok: false; reason: FileDocumentRefusal } {
  const bytes = new Uint8Array(Buffer.from(file.bytesBase64, 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: 'document_too_large' };
  }
  // The declared media type is a claim; the leading bytes are the evidence
  // (domain/client/fileSignature.ts). A page filed as an image would otherwise
  // be handed back through a signed link that a browser may well render.
  if (!bytesMatchMimeType(bytes, file.mimeType)) {
    return { ok: false, reason: 'bytes_do_not_match_type' };
  }
  return { ok: true, bytes };
}

/**
 * Files one document against a client: bytes into the store under a key made
 * of ids alone, then the row that names them.
 *
 * `retentionUntil` follows the client, not the upload: a client document is
 * kept five years from the client's last activity (docs/SPEC/client-record.md
 * rule 7, `computeRetentionUntil`), and filing it is an activity, so the clock
 * starts now and the erasure job moves it on. `documentRetentionUntil` in
 * domain/shared is the other rule — five years from upload — and belongs to
 * practice documents, which have no client whose activity to follow.
 *
 * **Consent evidence is on neither clock**, and that is the exception worth
 * reading twice. A signature or a scanned form is filed immutable, and
 * migration 903 freezes an immutable row the moment it exists — every column,
 * `retention_until` included. So a date written here could never be moved on,
 * and the evidence of a consent still live in year six would be a file marked
 * for deletion in year five: the record would delete the proof of the
 * agreement it is still acting on. `isConsentEvidenceKind` therefore leaves
 * `retention_until` null, exactly as 903 does for `consent_text`, meaning "not
 * on an upload clock" and never "nobody computed it". Whatever removes files
 * must ask what still references one before it removes it — which is already
 * the rule for the wording, and is now the rule for what was signed against
 * it. docs/CHANGE-REQUESTS/client-record-03.md records it (CR-13).
 *
 * `isImmutable` is the caller's to decide and true for anything that evidences
 * what a person was shown or agreed to. Migration 903 makes it mean something:
 * once set, the row is neither changed nor deleted outside an erasure.
 */
export async function fileClientDocument(
  db: Db,
  storage: ServerStorageProvider | undefined,
  actor: Actor,
  input: {
    clientId: string;
    kind: string;
    file: DocumentBytes;
    isImmutable: boolean;
    now: Date;
  },
): Promise<{ ok: true; document: FiledDocument } | { ok: false; reason: FileDocumentRefusal }> {
  if (!storage) {
    // c.get('storage') is typed `| undefined` on purpose: a deployment with no
    // store configured is refused cleanly rather than assumed away.
    return { ok: false, reason: 'storage_unavailable' };
  }
  const decoded = decodeDocumentBytes(input.file);
  if (!decoded.ok) return decoded;

  const documentId = randomUUID();
  const storageKey = clientDocumentKey(actor.tenantId, input.clientId, documentId);
  // A fresh uuid cannot already be in the store, so the default refusal to
  // overwrite is the right one and is never expected to fire; if it ever does,
  // something is very wrong and a 409 is a better answer than a silent replace.
  const stored = await storage.put(storageKey, decoded.bytes, input.file.mimeType);

  await db.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      'uploaded_by, retention_until, is_immutable) ' +
      "values ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), $8, $9, $10)",
    [
      documentId,
      actor.tenantId,
      input.clientId,
      input.kind,
      storageKey,
      input.file.mimeType,
      stored.sha256,
      actor.userId,
      isConsentEvidenceKind(input.kind)
        ? null
        : computeRetentionUntil(isoDateIn(input.now, PRACTICE_TIME_ZONE)),
      input.isImmutable,
    ],
  );

  return {
    ok: true,
    document: {
      id: documentId,
      storageKey,
      sha256: stored.sha256,
      sizeBytes: stored.size,
    },
  };
}

/**
 * Files one document the practice holds about nobody: `client_id` null, keyed
 * `tenant/<t>/practice/<d>`. The erasure's confirmation letter is filed this
 * way, and it has to be — the client it is about has just been erased, and a
 * letter filed against an erased record would be a letter nobody may open
 * (db/policies/client/readers.sql closes that door to everyone but the owner
 * and the lead practitioner, and only with a reason). It belongs to the
 * erasure request instead, which names it.
 *
 * The bytes are the platform's own rendering rather than an upload, so there
 * is no signature check here and `mimeType` is the caller's to state: the four
 * magic numbers `bytesMatchMimeType` knows are the four kinds of file a person
 * may send us, and the letter is markdown, as the consent wording is. Bytes
 * first and the row second, exactly as `fileClientDocument` does it and for
 * the same reason.
 *
 * `retentionUntil` comes from `documentRetentionUntil` — five years from
 * upload, the practice-document rule — because this letter follows no client's
 * activity: there is no longer a client whose activity to follow.
 */
export async function filePracticeDocument(
  db: Db,
  storage: ServerStorageProvider,
  actor: Actor,
  input: { kind: string; bytes: Uint8Array; mimeType: string; isImmutable: boolean; now: Date },
): Promise<FiledDocument> {
  const documentId = randomUUID();
  const storageKey = practiceDocumentKey(actor.tenantId, documentId);
  const stored = await storage.put(storageKey, input.bytes, input.mimeType);
  await db.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      "uploaded_by, retention_until, is_immutable) values ($1, $2, null, $3, $4, $5, decode($6, 'hex'), " +
      '$7, $8, $9)',
    [
      documentId,
      actor.tenantId,
      input.kind,
      storageKey,
      input.mimeType,
      stored.sha256,
      actor.userId,
      documentRetentionUntil(input.kind, input.now),
      input.isImmutable,
    ],
  );
  return {
    id: documentId,
    storageKey,
    sha256: stored.sha256,
    sizeBytes: stored.size,
  };
}

/**
 * A short-lived link to a document's bytes, with the read written to the trail
 * first.
 *
 * `auditDocumentRead` before `getSignedUrl`, every time and without exception
 * (app/api/_middleware/storage/audit.ts): signing is the only moment there is
 * an actor to name. The folder implementation serves its own bytes from ahead
 * of the authentication fence, and the bucket's bytes never reach this API at
 * all, so neither fetch is a place the trail can be kept. Handing someone the
 * means to open a client's file is the act worth recording, whether or not
 * they go on to open it.
 */
export async function signedDocumentLink(
  db: Db,
  storage: ServerStorageProvider,
  document: { id: string; clientId: string | null; storageKey: string },
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<{ url: string; expiresInSeconds: number }> {
  await auditDocumentRead(db, { id: document.id, clientId: document.clientId });
  const url = await storage.getSignedUrl(document.storageKey, ttlSeconds);
  return { url, expiresInSeconds: ttlSeconds };
}
