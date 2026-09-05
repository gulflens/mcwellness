import type { Hono } from 'hono';
import { z } from 'zod';
import { hasRole } from '@domain/shared';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared/storage';
import { auditDocumentRead } from '../_middleware/storage';
import type { ApiEnv } from '../_middleware/request-context';
import { photoStorageAvailable } from './photo-availability';
import { PhotoLinkResponse } from './schema';

/**
 * `GET /api/sessions/photo/:documentId/link` — a short-lived link to a
 * previous visit's setup photograph (docs/SPEC/practitioner-phone.md section
 * 4.5).
 *
 * **Nothing is fetched unasked** (decision 6). The pre-flight step shows a
 * button and asks for this only on the tap, so the trail records the
 * practitioner who actually looked, once, and never a photograph nobody
 * opened.
 *
 * **`auditDocumentRead` before `getSignedUrl`, every time** (docs/SEAMS.md).
 * Handing someone the means to open a client's file is the act worth
 * recording, whether or not the bytes are ever fetched, and signing is the
 * only moment there is an actor to name.
 *
 * **Who may.** A practitioner for a client visible to them, and the office
 * roles — which is exactly what `db/policies/client/readers.sql` already says
 * about a `document` row, so the select below either finds the row or does
 * not, and a document of another practice's is a flat 404 rather than a 403
 * that confirms it exists. The route restates the role list because a client
 * contact must not reach this door at all: the portal shows a household its
 * own documents through its own routes, and a photograph of an electrode
 * placement is not among them.
 */

const READERS = ['owner', 'admin', 'lead_practitioner', 'finance', 'practitioner'] as const;

const Params = z.object({ documentId: z.uuid() });

/**
 * The row, under the caller's own row security, and narrowed to the one kind
 * this door serves: a link route that would sign any document id it was given
 * is a link route to the whole filing cabinet.
 */
const DOCUMENT_SQL =
  'select id, client_id, storage_key, mime_type from document ' +
  "where id = $1 and tenant_id = app.current_tenant_id() and kind = 'setup_photo'";

export function mountSessionPhotoLink(api: Hono<ApiEnv>): void {
  api.get('/api/sessions/photo/:documentId/link', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!hasRole(actor, ...READERS)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!photoStorageAvailable(storage)) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const db = c.get('db');
    const { rows } = await db.query<{
      id: string;
      client_id: string | null;
      storage_key: string;
      mime_type: string;
    }>(DOCUMENT_SQL, [params.data.documentId]);
    const row = rows[0];
    if (!row) {
      // Row security decides what this caller can see. A photograph of a
      // client outside their schedule is simply not there.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    await auditDocumentRead(db, { id: row.id, clientId: row.client_id });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      PhotoLinkResponse.parse({
        url,
        mimeType: row.mime_type,
        expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
      }),
    );
  });
}
