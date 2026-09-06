import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { renderReport } from '../../../domain/reports/document';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared/storage';
import { isUuid } from '../billing/ids';
import { documentFonts } from '../billing/fonts';
import { logRead } from '../_middleware/audit';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadReport } from './access';
import { contactClientIds } from './household';
import { ReportResponse } from './schema';
import { asRow, documentFrom, readReport } from './source';

/**
 * `GET /api/reports/:id` — one report, its delivery history, and a short-lived
 * signed link to the PDF (docs/SPEC/reports-v1.md sections 4.3 and 7.1).
 *
 * **The link is audited before it is signed, every time.** Handing somebody
 * the means to open a client's file is the read worth recording, and signing
 * is the only moment it can be recorded (docs/SEAMS.md): the local store
 * serves its own bytes ahead of the authentication fence, and the hosted one
 * is fetched from the vendor and never reaches this API at all.
 *
 * **The repair path.** A put that never ran leaves a row naming bytes that are
 * not there. Rendering is deterministic, so the fix is to render the same
 * report again rather than to lose it — but only if it *is* the same report.
 * The hash on the `document` row decides: a re-render whose fingerprint
 * differs is not a repair, it means something the report was rendered from has
 * moved since it was filed, and writing the new bytes under the old key would
 * replace a household's filed document with a different one. So it is refused,
 * and the mismatch is logged with the request id and nothing else — a key and
 * a hash both name a client's document.
 *
 * This is the same shape `app/api/billing/documents.ts` keeps, and it is what
 * the integrator asked for on the specification's own pull request: the report
 * carries `document_id` on its row *and* has billing's repair path, so the
 * column can never become the dead `invoice.document_id` migration 407
 * replaced.
 */

const DELIVERIES_SQL =
  'select d.id, d.contact_id, d.channel::text as channel, ' +
  'to_char(d.sent_at, \'YYYY-MM-DD"T"HH24:MI:SSOF\') as sent_at, ' +
  "coalesce(nullif(btrim(coalesce(ct.given_name, '') || ' ' || coalesce(ct.family_name, '')), ''), " +
  '  ct.relationship::text) as contact_label ' +
  'from report_delivery d ' +
  'join contact ct on ct.tenant_id = d.tenant_id and ct.id = d.contact_id ' +
  'where d.tenant_id = app.current_tenant_id() and d.report_id = $1 ' +
  'order by d.sent_at desc, d.id';

const DOCUMENT_SQL =
  'select d.id, d.storage_key, d.sha256 from document d ' +
  'where d.tenant_id = app.current_tenant_id() and d.id = $1';

export function mountReportGet(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/reports/:id', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) {
      // Checked before it reaches a uuid column, the way billing's own routes
      // check theirs: an id that is not one is a 400, not a raise dressed up
      // as a 500 on a path a stranger can call.
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const actor = c.get('actor');

    const record = await readReport(db, reportId);
    if (!record) {
      // Row security decides which rows this actor can see, so another
      // practice's — or a household's draft — is simply not there. A 404,
      // never a 403 that confirms it exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const clientIds = await contactClientIds(db);
    if (!mayReadReport(actor, record.client_id, { clientIds }, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // Opening a report is a `read` (section 8), written whether or not there
    // is a document behind it yet.
    await logRead(db, 'report', record.id, record.client_id);

    const deliveries = await db.query<{
      id: string;
      contact_id: string;
      contact_label: string;
      channel: 'whatsapp' | 'email';
      sent_at: string;
    }>(DELIVERIES_SQL, [reportId]);

    let url: string | null = null;
    const storage = c.get('storage');
    if (record.document_id && storage) {
      const found = await db.query<{ id: string; storage_key: string; sha256: Buffer }>(
        DOCUMENT_SQL,
        [record.document_id],
      );
      const row = found.rows[0];
      if (row) {
        if (!(await storage.exists(row.storage_key))) {
          // From the row and nothing else, which is what makes the repair
          // path sound: the bytes it re-renders are the bytes that were filed,
          // whatever has been corrected on the client record since.
          const remade = documentFrom(record);
          if (remade) {
            const bytes = renderReport(remade, documentFonts());
            if (createHash('sha256').update(bytes).digest('hex') !== row.sha256.toString('hex')) {
              console.error(
                JSON.stringify({
                  requestId,
                  name: 'ReportWouldNotMatchWhatWasFiled',
                  documentId: row.id,
                }),
              );
              return c.json({ error: 'conflict', code: 'document_bytes_differ', requestId }, 409);
            }
            c.get('afterCommit')(async () => {
              await storage.put(row.storage_key, bytes, 'application/pdf', { overwrite: true });
            });
          }
        }
        // Before the link, every time (docs/SEAMS.md).
        await auditDocumentRead(db, { id: row.id, clientId: record.client_id });
        url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
      }
    }

    return c.json(
      ReportResponse.parse({
        report: asRow(record),
        content: record.content,
        deliveries: deliveries.rows.map((row) => ({
          id: row.id,
          contactId: row.contact_id,
          contactLabel: row.contact_label,
          channel: row.channel,
          sentAt: row.sent_at,
        })),
        url,
        expiresInSeconds: url === null ? null : DEFAULT_SIGNED_URL_TTL_SECONDS,
      }),
    );
  });
}
