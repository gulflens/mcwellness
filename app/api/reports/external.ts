import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { checkExternalUpload } from '../../../domain/reports';
import { clientDocumentKey, isoDateIn } from '../../../domain/shared';
// By its own path, as app/api/assessments/file.ts imports it: the seam's
// retention arithmetic is not in the shared barrel.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { logAction } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import { practiceTimeZone } from './gather';
import { ExternalUploadResponse } from './schema';
import { asRow, readReport } from './source';

/**
 * `POST /api/reports/external?clientId=&reportDate=` — a report the practice
 * made in another tool, uploaded as its PDF and filed against a client
 * (docs/SPEC/reports-v1.md section 12; migrations 607 and 608). Once filed it
 * is a report like any other on the client's Reports tab: opened through
 * `GET /api/reports/:id`, sent through `POST /api/reports/:id/deliver`, and
 * listed and opened in the household's portal.
 *
 * **Raw bytes, not JSON**, for the assessments door's reason
 * (app/api/assessments/file.ts): a report with its pictures in it is
 * megabytes, and the ordinary envelope is 64 KiB. So this path has its own cap
 * (twenty megabytes, `EXTERNAL_REPORT_MAX_BYTES`), its own clock and a pass
 * out of `jsonOnly` (app/api/create-api.ts), and takes the browser's
 * `X-Sha256`, recomputed over the bytes actually received.
 *
 * **A PDF by its bytes.** The declared type is checked before a byte is read,
 * and the bytes are checked against it after: a route that files whatever it
 * is told is a route that will one day hold an HTML page called a report, and
 * a signed link to it is a link a browser may render.
 *
 * **The title travels in a header, percent-encoded**, and the client and the
 * date in the query. The title is free text a person typed, and may name the
 * household; a query string is what a proxy's access log keeps, a header is
 * not. Percent-encoded so a title in Arabic survives a header, which carries
 * Latin-1 at most. The file's own name never crosses this door: the
 * practice's files are named after the people in them.
 *
 * **Who may upload is who may write a report** (`report.draft`: the owner,
 * the lead practitioner, a practitioner for a client on her schedule).
 * `app.file_external_report` asks the same underneath, and is what writes the
 * document row a practitioner holds no insert on herself.
 *
 * **The order is row, then bytes, and the bytes go after the commit**, the
 * assessments door's rule: a store cannot be rolled back and a transaction
 * can. And its repair: the same bytes sent again for the same client are
 * handed back to the report already filed, and put in the store if it never
 * received them — which is also how a practice puts back a file the store
 * lost, since an upload, unlike a report rendered here, cannot be made again.
 */

const Query = z.object({ clientId: z.uuid(), reportDate: z.string().max(10) });
const Digest = z.string().regex(/^[0-9a-f]{64}$/);

const KEY_SQL =
  'select storage_key from document where tenant_id = app.current_tenant_id() and id = $1';

/** The SQLSTATEs `app.file_external_report` raises, as this door answers them. */
const ANSWER_FOR: Readonly<Record<string, { status: 400 | 403 | 404 | 422; code: string }>> = {
  '42501': { status: 403, code: 'not_permitted' },
  P0002: { status: 404, code: 'not_found' },
  '23001': { status: 422, code: 'record_erased' },
};

/**
 * The function's refusal of a date still to come: a check violation carrying
 * its own hint (migration 608). Read by the hint and not by the SQLSTATE alone,
 * because every row check on `report` is a check violation too, and a row the
 * database refused for any other reason is a fault to report, not a date the
 * person can correct.
 */
const DATE_IN_FUTURE_HINT = 'report_date_in_future';

export function answerForFilingError(
  error: unknown,
): { status: 400 | 403 | 404 | 422; code: string } | undefined {
  const { code, hint } = error as { code?: string; hint?: string };
  if (code === '23514') {
    return hint === DATE_IN_FUTURE_HINT ? { status: 400, code: 'date_in_future' } : undefined;
  }
  return ANSWER_FOR[code ?? ''];
}

/** The title header, decoded; null where it is missing or will not decode. */
function titleFrom(header: string | undefined): string | null {
  if (header === undefined) return null;
  try {
    return decodeURIComponent(header);
  } catch {
    return null;
  }
}

export function mountReportExternal(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/reports/external', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');

    const query = Query.safeParse({
      clientId: c.req.query('clientId'),
      reportDate: c.req.query('reportDate') ?? '',
    });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const { clientId } = query.data;

    async function refuse(reason: string): Promise<void> {
      // Written before the answer, with the reason and nothing of the file.
      await logAction(
        db,
        'report.upload_refused',
        { type: 'client', id: clientId, clientId },
        { reason },
      );
    }

    if (!mayDraftReport(actor, clientId, now())) {
      await refuse('not_permitted');
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      // A document row against a key nothing ever uploads to is a record of a
      // file that does not exist.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const mimeType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (mimeType !== 'application/pdf') {
      return c.json({ error: 'unsupported_media_type', code: 'not_a_pdf', requestId }, 415);
    }
    const declared = Digest.safeParse(c.req.header('x-sha256') ?? '');
    if (!declared.success) {
      return c.json({ error: 'bad_request', code: 'digest_missing', requestId }, 400);
    }

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const computed = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength > 0 && computed !== declared.data) {
      await refuse('digest_mismatch');
      return c.json({ error: 'bad_request', code: 'digest_mismatch', requestId }, 400);
    }

    const today = isoDateIn(now(), await practiceTimeZone(db));
    const checked = checkExternalUpload({
      title: titleFrom(c.req.header('x-report-title')) ?? '',
      reportDate: query.data.reportDate,
      bytes,
      today,
    });
    if (!checked.ok) {
      await refuse(checked.code);
      switch (checked.code) {
        case 'not_a_pdf':
          return c.json({ error: 'unsupported_media_type', code: checked.code, requestId }, 415);
        case 'too_many_bytes':
          return c.json({ error: 'payload_too_large', code: checked.code, requestId }, 413);
        default:
          return c.json({ error: 'bad_request', code: checked.code, requestId }, 400);
      }
    }

    const documentId = randomUUID();
    // Ids and nothing else (docs/SEAMS.md): a key that leaks says nothing
    // about whose file it is.
    const storageKey = clientDocumentKey(actor.tenantId, clientId, documentId);
    const retentionUntil = documentRetentionUntil('report', now());

    // Inside a savepoint, so a refusal the function raises leaves the
    // transaction able to write that refusal to the trail.
    await db.query('savepoint file_external_report');
    let filed: { id: string; document_id: string | null };
    try {
      const found = await db.query<{ id: string; document_id: string | null }>(
        'select r.id, r.document_id from app.file_external_report(' +
          '$1::uuid, $2::text, $3::date, $4::integer, $5::uuid, $6::text, $7::bytea, ' +
          '$8::timestamptz) r',
        [
          clientId,
          checked.title,
          checked.reportDate,
          bytes.byteLength,
          documentId,
          storageKey,
          Buffer.from(computed, 'hex'),
          retentionUntil,
        ],
      );
      const row = found.rows[0];
      if (!row) throw new Error('Filing an uploaded report did not return a row.');
      filed = row;
      await db.query('release savepoint file_external_report');
    } catch (error) {
      const answer = answerForFilingError(error);
      if (!answer) throw error;
      await db.query('rollback to savepoint file_external_report');
      await refuse(answer.code);
      return c.json(
        { error: answer.status === 404 ? 'not_found' : 'refused', code: answer.code, requestId },
        answer.status,
      );
    }

    const fresh = filed.document_id === documentId;
    if (fresh) {
      c.get('afterCommit')(async () => {
        await storage.put(storageKey, bytes, 'application/pdf');
      });
    } else if (filed.document_id !== null) {
      // These bytes are already filed for this client. A row is not bytes:
      // where the store never received them, the bytes in hand are that
      // document's own (matched by their fingerprint), so they are put back.
      const key = await keyOf(db, filed.document_id);
      if (key !== null && !(await storage.exists(key))) {
        c.get('afterCommit')(async () => {
          await storage.put(key, bytes, 'application/pdf');
        });
      }
    }

    const record = await readReport(db, filed.id);
    if (!record) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (fresh) {
      // What was filed, and nothing of it: never the title, never the bytes.
      // The report row and the document row are audited by their own
      // triggers, which name both.
      await logAction(
        db,
        'report.uploaded',
        { type: 'report', id: record.id, clientId: record.client_id },
        { kind: 'external' },
      );
    }
    return c.json(ExternalUploadResponse.parse({ report: asRow(record) }), fresh ? 201 : 200);
  });
}

async function keyOf(db: Db, documentId: string): Promise<string | null> {
  const { rows } = await db.query<{ storage_key: string }>(KEY_SQL, [documentId]);
  return rows[0]?.storage_key ?? null;
}
