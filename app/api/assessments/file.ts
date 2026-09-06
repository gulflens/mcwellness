import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  classifyAssessmentFile,
  isAssessmentFileMimeType,
  normaliseExtension,
} from '@domain/assessment';
import { canActor, clientDocumentKey } from '@domain/shared';
// By its own path, as app/api/sessions/photo.ts imports it: the seam's
// retention arithmetic is not in the shared barrel, and domain/shared is the
// trunk's to export from.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { logAction } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { logRefusal } from './audit';
import { readOne } from './rows';
import { ASSESSMENT_FILE_ROLES, FileFiledResponse, type AssessmentFileRole } from './schema';

/**
 * `PUT /api/assessments/:id/file` — the door the equipment's own export goes
 * through (docs/SPEC/assessment.md section 7.1).
 *
 * **Raw bytes, not JSON.** The Documents tab cannot carry them: its envelope
 * is 45 KB inside a 64 KB body, and a vendor's report with its pictures in it
 * is megabytes. So this gets a door of its own, with a raw body, its own cap
 * and a declared `X-Sha256` the route recomputes over the bytes it actually
 * received — the exemption the setup photograph's door already set the
 * precedent for (`app/api/create-api.ts`, `PHOTO_LIMIT_BYTES`).
 *
 * **Three kinds of file**, because the founder named the equipment on
 * 2026-09-06: the analysis software's PDF report, the EDF recording the
 * amplifier's recorder writes, and the recording in the amplifier software's
 * own format. Which one a body is, is `classifyAssessmentFile`'s question in
 * `domain/assessment`, answered from the bytes and never from the caller's
 * word for them: a route that files whatever it is handed under whatever it is
 * told will one day hold an HTML page called a report, and a signed link to it
 * is a link a browser may render. The declared type is checked first, before
 * the body is read, so an unusable type costs nothing to refuse.
 *
 * **The file's own name never crosses this door.** The one kind that cannot be
 * told by its bytes is recognised by an extension the console sends on its
 * own — `?extension=eeg`, a few characters and no more. The practice's files
 * are named after the people in them, and nothing here receives, logs or
 * stores a name.
 *
 * **The order is row, then bytes, and the bytes go after the commit**
 * (spec section 7.1), through `c.get('afterCommit')` exactly as
 * app/api/billing/documents.ts does. A store cannot be rolled back and a
 * transaction can, so a put inside the transaction leaves a person's qEEG
 * export in the store under a key no `document` row names whenever anything
 * downstream fails — unreachable, and out of reach of the erasure's own key
 * list, which reads the rows.
 *
 * **What the invoice can do and this cannot** is re-make the bytes: rendering
 * is deterministic, an upload is not. So the repair is the retry. A browser
 * that asks again with the same digest is handed the same document, and if
 * nothing is behind that document's key the bytes it brought are put there
 * then — a 200 over missing bytes would tell a practitioner their export is
 * filed when it is not, and no later request would ever put it right, because
 * the digest matches and the same id comes back for ever.
 *
 * **`overwrite` stays false**, on the first filing and on the repair. A fresh
 * uuid cannot already be in the store, and a repair only runs where
 * `storage.exists` says there is nothing under the key. A filed evidence
 * document is never replaced (docs/SEAMS.md).
 *
 * **Idempotent on the digest.** A different file against the same measurement
 * is an ordinary second file, because one brain map produces several.
 */

const Params = z.object({ id: z.uuid() });
const Digest = z.string().regex(/^[0-9a-f]{64}$/, 'Not a sha256 digest');
const Role = z.enum(ASSESSMENT_FILE_ROLES).default('raw');

export function mountAssessmentFile(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.put('/api/assessments/:id/file', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const assessmentId = params.data.id;

    if (!canActor(actor, { type: 'assessment.file' }, {}, now())) {
      await logRefusal(db, 'assessment', assessmentId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      // No store configured is refused cleanly rather than assumed away: a
      // document row against a key nothing ever uploads to is a record of a
      // file that does not exist.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const mimeType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!isAssessmentFileMimeType(mimeType)) {
      return c.json({ error: 'unsupported_media_type', requestId }, 415);
    }
    // The chooser's own extension, and nothing else it knows about the file.
    const extension = normaliseExtension(c.req.query('extension') ?? null);
    const role = Role.safeParse(c.req.query('role') ?? undefined);
    if (!role.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const declared = Digest.safeParse(c.req.header('x-sha256') ?? '');
    if (!declared.success) {
      return c.json({ error: 'bad_request', code: 'digest_missing', requestId }, 400);
    }

    // Row security decides whether this measurement is one this person may
    // reach, so a record of another practice — or of a client off this
    // practitioner's schedule — is simply not there.
    const assessment = await readOne(db, assessmentId);
    if (assessment === null) {
      await logRefusal(db, 'assessment', assessmentId, null, ['not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) {
      return c.json({ error: 'bad_request', code: 'empty_body', requestId }, 400);
    }
    const computed = createHash('sha256').update(body).digest('hex');
    if (computed !== declared.data) {
      await logRefusal(db, 'assessment', assessmentId, assessment.client_id, ['digest_mismatch']);
      return c.json({ error: 'bad_request', code: 'digest_mismatch', requestId }, 400);
    }
    const kind = classifyAssessmentFile({ declaredMimeType: mimeType, bytes: body, extension });
    if (!kind.ok) {
      await logRefusal(db, 'assessment', assessmentId, assessment.client_id, [kind.reason]);
      return c.json({ error: 'unsupported_media_type', code: kind.reason, requestId }, 415);
    }

    const documentId = randomUUID();
    // Ids and nothing else, from the seam's own helper: a key that leaks says
    // nothing about whose file it is (docs/SEAMS.md).
    const storageKey = clientDocumentKey(actor.tenantId, assessment.client_id, documentId);
    const retentionUntil = documentRetentionUntil('assessment_raw', now());

    // The row and the link together, through the one door there is. The
    // function reads the client off the assessment itself and refuses a caller
    // who may not reach that record (migration 501).
    const filed = await db.query<{ document_id: string }>(
      'select app.file_assessment_document($1, $2, $3, $4, $5, $6, $7::assessment_document_role) ' +
        'as document_id',
      [
        assessmentId,
        documentId,
        storageKey,
        mimeType,
        Buffer.from(computed, 'hex'),
        retentionUntil,
        role.data,
      ],
    );
    const filedId = filed.rows[0]?.document_id;
    if (!filedId) {
      throw new Error('Filing an assessment document did not return an id.');
    }
    if (filedId !== documentId) {
      // These bytes are already filed under a document of their own: the same
      // digest against the same measurement. Hand that one back rather than
      // writing a second row over the same file.
      //
      // But a row is not bytes. The store is written after the commit, so a
      // first attempt whose row committed and whose put then failed leaves a
      // document with nothing behind it, and every retry after that matches on
      // the digest and is handed the same id. So the retry looks, and puts
      // back what is missing — the bytes in hand are the filed document's own,
      // because the function matched them by their digest.
      const key = await keyOf(db, filedId);
      if (key !== null && !(await storage.exists(key))) {
        c.get('afterCommit')(async () => {
          await storage.put(key, body, mimeType);
        });
      }
      return c.json(
        FileFiledResponse.parse({ documentId: filedId, role: role.data as AssessmentFileRole }),
        200,
      );
    }

    c.get('afterCommit')(async () => {
      await storage.put(storageKey, body, mimeType);
    });

    // What was filed, and nothing else: bytes never appear in a payload, a log
    // line or the trail.
    //
    // The document's id is not among the details. That began as a way round
    // `refuseContactDetails` in app/api/_middleware/audit.ts, which read a
    // hyphenated run inside a random uuid as a telephone number about one time
    // in eighty; the trunk has since fixed the check (round 30 of
    // docs/CHANGE-REQUESTS/trunk-notes.md, which says the choice is now this
    // stream's) and the id could be passed today. It is not, because the trail
    // already names the document where it belongs: the `assessment_document`
    // row this filing writes is itself audited and its `new_values` carry it.
    await logAction(
      db,
      'assessment.file_filed',
      { type: 'assessment', id: assessmentId, clientId: assessment.client_id },
      { role: role.data },
    );
    return c.json(
      FileFiledResponse.parse({ documentId, role: role.data as AssessmentFileRole }),
      201,
    );
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
