import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { bytesAreAPdf } from '@domain/assessment';
import { canActor, clientDocumentKey } from '@domain/shared';
// By its own path, as app/api/sessions/photo.ts imports it: the seam's
// retention arithmetic is not in the shared barrel, and domain/shared is the
// trunk's to export from.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { logAction } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { logRefusal } from './audit';
import { readOne } from './rows';
import {
  ASSESSMENT_FILE_MIME_TYPE,
  ASSESSMENT_FILE_ROLES,
  FileFiledResponse,
  type AssessmentFileRole,
} from './schema';

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
 * **One media type.** `application/pdf` and nothing else until the operator
 * names the practice's equipment (section 10, decision 3), and the bytes are
 * checked against the type as well as the caller's word for it
 * (`domain/client/fileSignature.ts`): a route that files whatever bytes it is
 * handed under whatever type it is told will one day hold an HTML page called
 * a report, and a signed link to it is a link a browser may render.
 *
 * **The order is row, then bytes**, and the store call sits inside the
 * transaction rather than after it. That is deliberate and it differs from the
 * billing document's own route: an invoice is rendered deterministically and a
 * put that never ran can be put right by rendering it again, while an uploaded
 * file cannot be re-made from anything. A row that survived a failed put would
 * name bytes that will never exist, so the put is where the transaction can
 * still be rolled back with it — the setup photograph's door for the same
 * reason.
 *
 * **`overwrite` stays false.** A fresh uuid cannot already be in the store, so
 * a conflict there means something is very wrong and 409 is a better answer
 * than a silent replacement. A filed evidence document is never replaced
 * (docs/SEAMS.md).
 *
 * **Idempotent on the digest.** A browser whose connection dropped after the
 * server committed asks again and is handed the same document; a different
 * file against the same measurement is an ordinary second file, because one
 * brain map produces several.
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
    if (mimeType !== ASSESSMENT_FILE_MIME_TYPE) {
      return c.json({ error: 'unsupported_media_type', requestId }, 415);
    }
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
    if (!bytesAreAPdf(body)) {
      await logRefusal(db, 'assessment', assessmentId, assessment.client_id, ['not_a_pdf']);
      return c.json({ error: 'unsupported_media_type', code: 'not_a_pdf', requestId }, 415);
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
        ASSESSMENT_FILE_MIME_TYPE,
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
      return c.json(
        FileFiledResponse.parse({ documentId: filedId, role: role.data as AssessmentFileRole }),
        200,
      );
    }

    await storage.put(storageKey, body, ASSESSMENT_FILE_MIME_TYPE);

    // The document id and nothing else. Bytes never appear in a payload, a log
    // line or the trail.
    await logAction(
      db,
      'assessment.file_filed',
      { type: 'assessment', id: assessmentId, clientId: assessment.client_id },
      { documentId, role: role.data },
    );
    return c.json(
      FileFiledResponse.parse({ documentId, role: role.data as AssessmentFileRole }),
      201,
    );
  });
}
