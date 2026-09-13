import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  classifyAssessmentFile,
  isAssessmentFileMimeType,
  normaliseExtension,
} from '@domain/assessment';
import { clientDocumentKey, hasRole } from '@domain/shared';
// By its own path, as app/api/assessments/file.ts imports it: the seam's
// retention arithmetic is not in the shared barrel, and domain/shared is the
// trunk's to export from.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { logAction } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { logRefusal } from './audit';
import { ExportFiledResponse, SESSION_EXPORT_KIND } from './schema';
import { loadSession, resolvePractitioner } from './session-row';

/**
 * `PUT /api/sessions/:id/export` — the door the practice software's own
 * export goes through, on the visit it belongs to
 * (docs/SPEC/session-capture.md section 3.6; the operator, 13 September 2026).
 *
 * **This is app/api/assessments/file.ts under a second name, deliberately.**
 * That route is "the door the equipment's own export goes through" for a
 * measurement; this is the same door for a visit. The same two declared media
 * types, the same three kinds decided from the bytes rather than from the
 * caller's word for them, the same `X-Sha256` recomputed over what actually
 * arrived, the same after-commit put, the same audit row. A second, different
 * way of attaching a file to a record would be the defect here, not the
 * feature, so nothing about the shape is re-derived: only the row it hangs on
 * is this stream's.
 *
 * **Raw bytes, not JSON.** The body *is* the file, so this path has the
 * sixty-four megabyte cap and the seven-minute budget the assessment door
 * already has (app/api/create-api.ts), and a pass out of `jsonOnly`. The
 * practice's raw recordings run 22 to 33 MB apiece.
 *
 * **The file's own name never crosses this door.** The one kind that cannot
 * be told by its bytes is recognised by the extension the file was chosen
 * under — `?extension=eeg`, a few characters and no more. The practice's files
 * are named after the people in them, and nothing here receives, logs or
 * stores a name.
 *
 * **Optional, and never a gate.** `domain/session/canCheckIn.ts` gates entry;
 * nothing gates exit. A practitioner in someone's home must always be able to
 * close the visit, so a visit with no export closes exactly as it did before
 * this route existed, and the record carries a quiet marker rather than a
 * refusal.
 *
 * **Open visits only.** Migration 960 took away the one change a closed visit
 * admitted, on the ground that a guard with nothing to guard is a guard
 * somebody later mistakes for permission. Nothing here asks for it back: the
 * attach control sits on the Summary step, where the practitioner is finishing
 * the visit on the same laptop the export sits on, so the file goes on before
 * check-out or not at all. A closed visit answers 409 `session_closed`, which
 * says what happened rather than pretending the visit is not there.
 *
 * **The order is row, then bytes, and the bytes go after the commit** (the
 * same reasoning as the assessment door's, and app/api/billing/documents.ts's
 * before it): a store cannot be rolled back and a transaction can, so a put
 * inside the transaction leaves a person's recording in the store under a key
 * no `document` row names whenever anything downstream fails — unreachable,
 * and out of reach of the erasure's own key list, which reads the rows.
 *
 * **Idempotent on the digest**, and the retry repairs. A browser that asks
 * again with the same file is handed the same document; if nothing is behind
 * that document's key the bytes it brought are put there then, because a 200
 * over missing bytes would tell a practitioner their export is filed when it
 * is not.
 */

const Params = z.object({ id: z.uuid() });
const Digest = z.string().regex(/^[0-9a-f]{64}$/, 'Not a sha256 digest');
const PRACTITIONER_ROLES = ['practitioner', 'lead_practitioner'] as const;

export function mountSessionExport(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.put('/api/sessions/:id/export', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const sessionId = params.data.id;

    if (!hasRole(actor, ...PRACTITIONER_ROLES)) {
      await logRefusal(db, 'session', sessionId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      // No store configured is refused cleanly rather than assumed away: a
      // document row against a key nothing ever uploads to is a record of a
      // file that does not exist.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    // Every one of these is checked before the body is read, so an unusable
    // request costs nothing to refuse and no megabytes are carried for it.
    const mimeType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!isAssessmentFileMimeType(mimeType)) {
      return c.json({ error: 'unsupported_media_type', requestId }, 415);
    }
    // The chooser's own extension, and nothing else it knows about the file.
    const extension = normaliseExtension(c.req.query('extension') ?? null);
    const declared = Digest.safeParse(c.req.header('x-sha256') ?? '');
    if (!declared.success) {
      return c.json({ error: 'bad_request', code: 'digest_missing', requestId }, 400);
    }

    const practitionerId = await resolvePractitioner(db, actor.userId);
    if (!practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['no_practitioner_row']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Row security decides whether this visit is one this person may reach, so
    // another practice's visit — or another practitioner's, under
    // db/policies/session/practitioner_scope.sql — is simply not there.
    const session = await loadSession(db, sessionId);
    if (session === null) {
      await logRefusal(db, 'session', sessionId, null, ['session_not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (session.practitioner_id !== practitionerId) {
      // Belt to row security's braces: an oversight role can see a visit it
      // did not run, and this door is the practitioner's own.
      await logRefusal(db, 'session', sessionId, session.client_id, ['session_not_yours']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (session.closed_at !== null) {
      await logRefusal(db, 'session', sessionId, session.client_id, ['session_closed']);
      return c.json({ error: 'conflict', code: 'session_closed', requestId }, 409);
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) {
      return c.json({ error: 'bad_request', code: 'empty_body', requestId }, 400);
    }
    const computed = createHash('sha256').update(body).digest('hex');
    if (computed !== declared.data) {
      await logRefusal(db, 'session', sessionId, session.client_id, ['digest_mismatch']);
      return c.json({ error: 'bad_request', code: 'digest_mismatch', requestId }, 400);
    }
    const kind = classifyAssessmentFile({ declaredMimeType: mimeType, bytes: body, extension });
    if (!kind.ok) {
      await logRefusal(db, 'session', sessionId, session.client_id, [kind.reason]);
      return c.json({ error: 'unsupported_media_type', code: kind.reason, requestId }, 415);
    }

    const documentId = randomUUID();
    // Ids and nothing else, from the seam's own helper: a key that leaks says
    // nothing about whose file it is (docs/SEAMS.md).
    const storageKey = clientDocumentKey(actor.tenantId, session.client_id, documentId);
    const retentionUntil = documentRetentionUntil(SESSION_EXPORT_KIND, now());

    // The row and the link together, through the one door there is. The
    // function reads the client off the visit itself, refuses a visit that is
    // not the caller's own or is already closed, and is idempotent on the
    // digest (migration 307).
    const filed = await db.query<{ document_id: string | null }>(
      'select app.file_session_export($1, $2, $3, $4, $5, $6) as document_id',
      [sessionId, documentId, storageKey, mimeType, Buffer.from(computed, 'hex'), retentionUntil],
    );
    const filedId = filed.rows[0]?.document_id ?? null;
    if (filedId === null) {
      // The visit already names a different export, or it closed between the
      // read above and this call. Either way the column is singular and a
      // filed evidence document is never replaced (docs/SEAMS.md).
      await logRefusal(db, 'session', sessionId, session.client_id, ['export_already_filed']);
      return c.json({ error: 'conflict', code: 'export_already_filed', requestId }, 409);
    }
    if (filedId !== documentId) {
      // These bytes are already filed against this visit: the same digest.
      // Hand that document back rather than writing a second row over the
      // same file.
      //
      // But a row is not bytes. The store is written after the commit, so a
      // first attempt whose row committed and whose put then failed leaves a
      // document with nothing behind it, and every retry after that matches on
      // the digest and is handed the same id. So the retry looks, and puts back
      // what is missing — the bytes in hand are the filed document's own,
      // because the function matched them by their digest.
      const key = await keyOf(db, filedId);
      if (key !== null && !(await storage.exists(key))) {
        c.get('afterCommit')(async () => {
          await storage.put(key, body, mimeType);
        });
      }
      return c.json(ExportFiledResponse.parse({ documentId: filedId }), 200);
    }

    c.get('afterCommit')(async () => {
      await storage.put(storageKey, body, mimeType);
    });

    // What was filed, and nothing else: bytes never appear in a payload, a log
    // line or the trail, and neither does the file's name, which never crossed
    // the door. The document's id is not among the details either — the
    // `document` row this filing writes is itself audited and its `new_values`
    // carry it (the same choice app/api/assessments/file.ts makes).
    await logAction(
      db,
      'session.export_filed',
      { type: 'session', id: sessionId, clientId: session.client_id },
      { kind: kind.kind },
    );
    return c.json(ExportFiledResponse.parse({ documentId }), 201);
  });
}

/**
 * The storage key of a document already filed, read back so a retry can tell
 * an empty key from a filed one. Row security decides whether the row is one
 * this caller may see; where it is not, there is nothing to repair and the
 * answer is the same document id either way.
 */
async function keyOf(db: Db, documentId: string): Promise<string | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'select storage_key from document where tenant_id = app.current_tenant_id() and id = $1',
    [documentId],
  );
  return rows[0]?.storage_key ?? null;
}
